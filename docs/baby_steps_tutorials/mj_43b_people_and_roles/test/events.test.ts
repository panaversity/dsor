// Step 40: the events the story's calls leave in the outbox. A draft writes payment.created, a
// payment sent or settled paid writes payment.executed, and the approval that moves a proposal to
// APPROVED writes proposal.approved; a refusal, a replay, a silent bank, and an approval that leaves
// the proposal waiting write none. Each event carries its call's correlation ids and its company's
// (DSOR-EVT-01a, DSOR-EVT-01b, DSOR-COR-01a; step 40's README, claims C1 to C3 and C5).
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import type { DomainEvent } from "../src/events.ts";
import type { DecisionLog } from "../src/log.ts";
import { memoryOutbox, type MemoryOutbox } from "../src/outbox.ts";
import { call } from "../src/pipeline.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, ADMIN, keyed, SUPERVISOR } from "./helpers.ts";
import { handlersFor } from "../src/operations.ts";
import type { Payment } from "../src/payment.ts";
import type { Handler } from "../src/registry.ts";
import { heard, ruleWorld, ruleWorldOnTuesday, shippedRule, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";
const INV_1009 = "dsor://org_456/invoice/INV-1009";
const PAY_901 = "dsor://org_456/payment/PAY-901";
const PAY_902 = "dsor://org_456/payment/PAY-902";
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };

/** The company's events, in the order they were written. */
async function eventsOf(w: RuleWorld, tenant = "org_456"): Promise<DomainEvent[]> {
  return (await w.outbox.events(tenant)).map((row) => row.event);
}

/** The ids of the call's correlation, as its answer names them, with the company's. */
function idsOf(answer: Answer, tenant = "org_456"): Record<string, string> {
  return { ...answer.correlation, tenant_id: tenant };
}

/** The payment an answer drafted or paid: its address. */
function paymentOf(answer: Answer): string {
  const { id } = (answer as { data: { id: string } }).data;
  return `dsor://org_456/payment/${id}`;
}

/** The proposal an answer names. */
function proposalOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "");
}

/** user_123 drafts a payment of INV-1002, 8,900.50 USD of VENDOR-44, under the threshold. */
function draft(w: RuleWorld, who: RequestEnvelope = keyed(SUPERVISOR)): Promise<Answer> {
  return w.ask(who, "payment.create", { invoice: INV_1002, expected_version: 1 });
}

/** user_123 sends this payment of this invoice through the fake bank. */
function send(w: RuleWorld, payment: string, invoice = INV_1002): Promise<Answer> {
  return w.ask(keyed(SUPERVISOR), "payment.execute", {
    invoice,
    payment,
    expected_version: 1,
  });
}

/** The story's world on Tuesday, with this company code, and this outbox. */
async function worldWith(
  code: Record<string, Handler> = handlersFor(),
  outbox: MemoryOutbox = memoryOutbox(),
): Promise<RuleWorld> {
  const none = undefined;
  const w = ruleWorld(none, none, none, none, none, none, none, none, none, code, none, outbox);
  await w.rates.load("org_456", {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:00:00.000Z",
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  return w;
}

/** The type and number of each of the company's events about this resource. */
async function storyOf(w: RuleWorld, resource: string): Promise<[string, number][]> {
  return (await eventsOf(w))
    .filter((e) => e.resource === resource)
    .map((e) => [e.type, e.ordering_key]);
}

describe("C1: a draft writes payment.created", () => {
  it("DSOR-EVT-01a: user_123 drafts INV-1002: one payment.created event, about that payment, numbered 1, with the call's ids and the company's", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await draft(w);
    expect(heard(drafted)).toBe("COMMITTED");
    const [event, ...more] = await eventsOf(w);
    expect(more).toStrictEqual([]);
    expect(event).toStrictEqual({
      event_id: expect.stringMatching(/^evt_[0-9a-f-]{36}$/),
      type: "payment.created",
      tenant: "org_456",
      resource: paymentOf(drafted),
      ordering_key: 1,
      origin: "dsor",
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      classification: "confidential",
      data: {
        tenant_id: "org_456",
        id: paymentOf(drafted).split("/").at(-1),
        invoice_id: "INV-1002",
        vendor_id: "VENDOR-44",
        amount: { value: "8900.50", currency: "USD" },
        status: "draft",
        version: 1,
      },
      correlation: idsOf(drafted),
    });
  });

  it("DSOR-EVT-01a: a draft refused for a stale version writes no event, and neither does a refusal before any work", async () => {
    const w = await ruleWorldOnTuesday();
    const stale = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1002,
      expected_version: 2,
    });
    expect(stale).toMatchObject({ code: "STALE_STATE" });
    const foreign = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-2001",
      expected_version: 1,
    });
    expect(heard(foreign)).not.toBe("COMMITTED");
    expect(await eventsOf(w)).toStrictEqual([]);
  });

  it("DSOR-EVT-01a: the same draft sent again with its key is a replay, and writes no second event", async () => {
    const w = await ruleWorldOnTuesday();
    const envelope = keyed(SUPERVISOR);
    const first = await draft(w, envelope);
    const again = await draft(w, envelope);
    expect(paymentOf(again)).toBe(paymentOf(first));
    expect((await eventsOf(w)).map((e) => e.type)).toStrictEqual(["payment.created"]);
  });

  it("DSOR-EVT-01a: a dry run writes no event", async () => {
    const w = await ruleWorldOnTuesday();
    await w.ask({ ...keyed(SUPERVISOR), mode: "validate_only" }, "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    expect(await eventsOf(w)).toStrictEqual([]);
  });
});

describe("D1: DSoR never takes the company code's word", () => {
  // The company's code drafts as it should, and then says the payment is 1.00 USD to VENDOR-99.
  //   The event holds the draft as DSoR's own store keeps it. Found while building: no test said so.
  it("DSOR-EVT-01a: the company's code returns a payment that is not the one it drafted: the event holds the draft DSoR's store keeps", async () => {
    const shipped = handlersFor();
    const lying: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        const drafted = (await shipped["payment.create"]!(input, company)) as Payment;
        return { ...drafted, vendor_id: "VENDOR-99", amount: { value: "1.00", currency: "USD" } };
      },
    };
    const w = await worldWith(lying);
    await draft(w);
    const [event] = await eventsOf(w);
    expect(event!.data).toMatchObject({
      vendor_id: "VENDOR-44",
      amount: { value: "8900.50", currency: "USD" },
    });
  });

  it("DSOR-EVT-01a: the company's code drafts, and returns no payment at all: the caller hears INTERNAL_ERROR, and the draft is kept with its event", async () => {
    const shipped = handlersFor();
    const silent: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        return { done: true };
      },
    };
    const w = await worldWith(silent);
    const answer = await draft(w);
    // Changed by step 40's review, H1: the event is of the draft the store saw written, never of
    //   the answer. An answer that is no payment fails as it is shaped for the caller,
    //   INTERNAL_ERROR, after the work is kept with its record, on the database too
    //   (outbox.db.test.ts).
    expect(heard(answer)).toBe("INTERNAL_ERROR");
    expect(w.drafted.map((p) => p.id)).toStrictEqual(["PAY-901"]);
    expect(await storyOf(w, PAY_901)).toStrictEqual([["payment.created", 1]]);
  });
});

describe("C3 and C1: an approval, then the release", () => {
  it("DSOR-EVT-01a: the agent drafts INV-1008, 31,400.00 USD, which waits for the CFO: no event; cfo_100 approves: proposal.approved; the release drafts PAY-901: payment.created, with the release's ids", async () => {
    const w = await ruleWorldOnTuesday();
    const waiting = await w.draft("INV-1008");
    expect(waiting).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(await eventsOf(w)).toStrictEqual([]);
    const proposal = proposalOf(waiting);
    const kept = await w.proposals.get("org_456", proposal.split("/").at(-1)!);
    const approved = await w.ask(keyed(CFO), "proposal.approve", {
      proposal,
      payload_hash: kept!.payload_hash,
    });
    expect(approved).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    const [approval] = await eventsOf(w);
    expect(approval).toMatchObject({
      type: "proposal.approved",
      resource: proposal,
      ordering_key: 1,
      classification: "internal",
      data: { proposal, state: "APPROVED", waits_for: [] },
      correlation: idsOf(approved),
    });
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal });
    expect(heard(released)).toBe("COMMITTED");
    const events = await eventsOf(w);
    expect(events.map((e) => e.type)).toStrictEqual(["proposal.approved", "payment.created"]);
    expect(events[1]).toMatchObject({
      resource: paymentOf(released),
      ordering_key: 1,
      data: { invoice_id: "INV-1008", amount: { value: "31400.00", currency: "USD" } },
      correlation: idsOf(released),
    });
  });

  it("DSOR-EVT-01a: with a second rule that asks a tenant administrator too, cfo_100's approval leaves INV-1008 waiting and writes no event; admin_100's writes proposal.approved", async () => {
    const adminAbove30000: Control = {
      ...shippedRule(),
      id: "admin-above-30000",
      version: 1,
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
    };
    const controls: ControlsSource = {
      file: "controls.json",
      text: JSON.stringify({ org_456: [shippedRule(), adminAbove30000], org_789: [] }),
    };
    const w = await ruleWorldOnTuesday(controls);
    const waiting = await w.draft("INV-1008");
    const proposal = proposalOf(waiting);
    const kept = await w.proposals.get("org_456", proposal.split("/").at(-1)!);
    const input = { proposal, payload_hash: kept!.payload_hash };
    expect(await w.ask(keyed(CFO), "proposal.approve", input)).toMatchObject({
      data: { state: "PENDING_APPROVAL" },
    });
    expect(await eventsOf(w)).toStrictEqual([]);
    await w.ask(keyed(ADMIN), "proposal.approve", input);
    expect((await eventsOf(w)).map((e) => e.type)).toStrictEqual(["proposal.approved"]);
  });
});

describe("C2: a payment paid writes payment.executed", () => {
  it("DSOR-EVT-01a: user_123 sends PAY-901 and the bank takes it: payment.executed, numbered 2 after its payment.created, holding the payment paid", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = paymentOf(await draft(w));
    const sent = await send(w, payment);
    expect(heard(sent)).toBe("COMMITTED");
    const events = await eventsOf(w);
    expect(events.map((e) => [e.type, e.resource, e.ordering_key])).toStrictEqual([
      ["payment.created", payment, 1],
      ["payment.executed", payment, 2],
    ]);
    expect(events[1]).toMatchObject({
      data: { status: "paid", version: 2 },
      correlation: idsOf(sent),
    });
  });

  it("DSOR-EVT-01a: the bank takes PAY-901 and never answers: OUTCOME_UNKNOWN, and no payment.executed; dsor-scheduler reconciles it as sent: payment.executed, with the reconcile's ids", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = paymentOf(await draft(w));
    w.bank.mode = "silent";
    const unknown = await send(w, payment);
    w.bank.mode = "good";
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect((await eventsOf(w)).map((e) => e.type)).toStrictEqual(["payment.created"]);
    const settled = await w.ask(keyed(SCHEDULER), "payment.reconcile", {
      proposal: proposalOf(unknown),
    });
    expect(settled).toMatchObject({ data: { state: "COMMITTED" } });
    const [, executed] = await eventsOf(w);
    expect(executed).toMatchObject({
      type: "payment.executed",
      resource: payment,
      ordering_key: 2,
      data: { status: "paid" },
      correlation: idsOf(settled),
    });
  });

  it("DSOR-EVT-01a: the order never reached the bank: reconciled as FAILED, PAY-901 stays a draft, and no payment.executed", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = paymentOf(await draft(w));
    const pay = w.bank.pay;
    w.bank.pay = () => new Promise(() => {});
    const unknown = await send(w, payment);
    w.bank.pay = pay;
    const settled = await w.ask(keyed(SCHEDULER), "payment.reconcile", {
      proposal: proposalOf(unknown),
    });
    expect(settled).toMatchObject({ data: { state: "FAILED" } });
    expect((await eventsOf(w)).map((e) => e.type)).toStrictEqual(["payment.created"]);
  });

  it("DSOR-EVT-01a: a send the bank refuses writes no payment.executed", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = paymentOf(await draft(w));
    w.bank.mode = "broken";
    expect(heard(await send(w, payment))).not.toBe("COMMITTED");
    expect((await eventsOf(w)).map((e) => e.type)).toStrictEqual(["payment.created"]);
  });
});

describe("C5: the correlation ids", () => {
  // And no principal_id: the event does not name user_123, whose slip the agent holds. C8 says so
  //   (step 40's review, L6).
  it("DSOR-COR-01a: the agent's draft: the event names the agent, the request, and the company, and not the human whose slip the agent holds", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.draft("INV-1002");
    const [event] = await eventsOf(w);
    expect(event!.correlation).toStrictEqual({
      request_id: drafted.correlation.request_id,
      agent_id: "accounts-payable-fte",
      tenant_id: "org_456",
    });
  });

  it("DSOR-COR-01a: a request id the caller sends is the event's request id", async () => {
    const w = await ruleWorldOnTuesday();
    await draft(w, { ...keyed(SUPERVISOR), request_id: "req_from_the_desk_1" });
    const [event] = await eventsOf(w);
    expect(event!.correlation.request_id).toBe("req_from_the_desk_1");
  });

  // Retitled by step 40's review, L6: this is the gap C8 names, not the rule met. DSOR-COR-01a asks
  //   for task_id in every event; a request has no place DSoR trusts for it (open question 157).
  it("DSOR-COR-01a: C8, not met yet: a task id the agent asserts stays in agent_asserted, so no event carries it", async () => {
    const w = await ruleWorldOnTuesday();
    const asserted = { purpose: "weekly payment run", task_id: "task-2026-10-20-40" };
    await w.ask(
      { ...keyed(AGENT), agent_asserted: asserted } as RequestEnvelope,
      "payment.create",
      {
        invoice: INV_1002,
        expected_version: 1,
      },
    );
    const [event] = await eventsOf(w);
    expect(JSON.stringify(event)).not.toContain("task-2026-10-20-40");
  });
});

describe("C5: each company's own outbox", () => {
  it("DSOR-EVT-01d: org_456's draft is in org_456's outbox only", async () => {
    const w = await ruleWorldOnTuesday();
    await draft(w);
    expect(await eventsOf(w, "org_456")).toHaveLength(1);
    expect(await eventsOf(w, "org_789")).toStrictEqual([]);
  });
});

// Step 40's review: each finding, with its test (step 40's README, "What the review found").

/** user_123 drafts a payment of INV-1009, 7,425.00 USD of VENDOR-44: PAY-902, after PAY-901. */
function draft1009(w: RuleWorld): Promise<Answer> {
  return w.ask(keyed(SUPERVISOR), "payment.create", { invoice: INV_1009, expected_version: 1 });
}

/** A log that refuses the next record of this operation, once, and keeps every other in the world's log. */
function refusingOnce(w: RuleWorld, operation: string): DecisionLog {
  let refused = false;
  return {
    add: async (decision, bundle) => {
      if (!refused && decision.operation === operation) {
        refused = true;
        throw new Error("the log's disk is full");
      }
      return w.log.add(decision, bundle);
    },
  };
}

/** An outbox that refuses every payment.executed while its switch is on, and keeps every other event. */
function refusingExecuted(): { outbox: MemoryOutbox; on: { refuse: boolean } } {
  const kept = memoryOutbox();
  const on = { refuse: false };
  const outbox: MemoryOutbox = {
    ...kept,
    add: async (tenant, draft) => {
      if (on.refuse && draft.type === "payment.executed") {
        throw new Error("the outbox's disk is full");
      }
      return kept.add(tenant, draft);
    },
  };
  return { outbox, on };
}

describe("the review, H1: an event is about the payment the call changed, never the one the code returns", () => {
  it("DSOR-EVT-01a: H1: asked to send PAY-902, the code sends it and returns PAY-901, paid already: payment.executed is about PAY-902, and PAY-901 gets no second one", async () => {
    const shipped = handlersFor();
    const pointing: Record<string, Handler> = {
      ...shipped,
      "payment.execute": async (input, company) => {
        await shipped["payment.execute"]!(input, company);
        return company.payments.get("PAY-901");
      },
    };
    const w = await worldWith(pointing);
    await send(w, paymentOf(await draft(w)));
    expect(paymentOf(await draft1009(w))).toBe(PAY_902);
    expect(heard(await send(w, PAY_902, INV_1009))).toBe("COMMITTED");
    expect(await storyOf(w, PAY_901)).toStrictEqual([
      ["payment.created", 1],
      ["payment.executed", 2],
    ]);
    expect(await storyOf(w, PAY_902)).toStrictEqual([
      ["payment.created", 1],
      ["payment.executed", 2],
    ]);
  });

  it("DSOR-EVT-01a: H1: the code drafts PAY-902 and returns PAY-901, a draft already: payment.created is about PAY-902, and PAY-901 gets no second one", async () => {
    const shipped = handlersFor();
    const pointing: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        return company.payments.get("PAY-901");
      },
    };
    const w = await worldWith(pointing);
    await draft(w);
    expect(heard(await draft1009(w))).toBe("COMMITTED");
    expect(await storyOf(w, PAY_901)).toStrictEqual([["payment.created", 1]]);
    expect(await storyOf(w, PAY_902)).toStrictEqual([["payment.created", 1]]);
  });

  it("DSOR-EVT-01a: H1: the code drafts two payments in one call: the call does not commit, and no event is written", async () => {
    const shipped = handlersFor();
    const twice: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        return shipped["payment.create"]!(input, company);
      },
    };
    const w = await worldWith(twice);
    expect(heard(await draft(w))).not.toBe("COMMITTED");
    expect(await eventsOf(w)).toStrictEqual([]);
  });

  it("DSOR-EVT-01a: H1: asked to send PAY-902, the code marks PAY-901 paid instead, with no bank: the call does not commit, and no payment.executed is written", async () => {
    const shipped = handlersFor();
    const elsewhere: Record<string, Handler> = {
      ...shipped,
      "payment.execute": async (_input, company) => {
        const other = await company.payments.get("PAY-901");
        return (await company.payments.pay("PAY-901", other!.version)).payment;
      },
    };
    const w = await worldWith(elsewhere);
    await draft(w);
    await draft1009(w);
    expect(heard(await send(w, PAY_902, INV_1009))).not.toBe("COMMITTED");
    expect((await eventsOf(w)).map((e) => e.type)).toStrictEqual([
      "payment.created",
      "payment.created",
    ]);
    expect(w.bank.transfers()).toStrictEqual([]);
  });
});

describe("the review, M5: a send whose code pays nothing", () => {
  it("DSOR-EVT-01a: M5: the code returns PAY-901 still a draft, and never asks the bank: the call does not commit, and no payment.executed is written", async () => {
    const idle: Record<string, Handler> = {
      ...handlersFor(),
      "payment.execute": async (_input, company) => company.payments.get("PAY-901"),
    };
    const w = await worldWith(idle);
    const payment = paymentOf(await draft(w));
    expect(heard(await send(w, payment))).not.toBe("COMMITTED");
    expect(await storyOf(w, payment)).toStrictEqual([["payment.created", 1]]);
    expect(w.bank.transfers()).toStrictEqual([]);
  });
});

describe("the review, M1 and L1: the event is written with the work, before the record is sealed", () => {
  it("DSOR-EVT-01a: M1: the outbox refuses PAY-901's payment.executed after the bank sent it: OUTCOME_UNKNOWN, and its only record says so; dsor-scheduler reconciles it: one payment.executed, numbered 2", async () => {
    const { outbox, on } = refusingExecuted();
    const w = await worldWith(undefined, outbox);
    const payment = paymentOf(await draft(w));
    on.refuse = true;
    const unknown = await send(w, payment);
    on.refuse = false;
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(w.bank.transfers()).toHaveLength(1);
    const records = (await w.log.records()).filter((r) => r.operation === "payment.execute@1");
    expect(records.map((r) => r.result)).toStrictEqual(["OUTCOME_UNKNOWN"]);
    expect(await storyOf(w, payment)).toStrictEqual([["payment.created", 1]]);
    const settled = await w.ask(keyed(SCHEDULER), "payment.reconcile", {
      proposal: proposalOf(unknown),
    });
    expect(settled).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await storyOf(w, payment)).toStrictEqual([
      ["payment.created", 1],
      ["payment.executed", 2],
    ]);
  });

  it("DSOR-EVT-01a: M1 and L1: the log refuses the record of PAY-901's send after the bank sent it: OUTCOME_UNKNOWN, and memory keeps PAY-901 paid with its event; the reconcile writes no second payment.executed", async () => {
    const w = await worldWith();
    const payment = paymentOf(await draft(w));
    const log = refusingOnce(w, "payment.execute@1");
    const unknown = await call(w.registry, log, keyed(SUPERVISOR), "payment.execute", {
      invoice: INV_1002,
      payment,
      expected_version: 1,
    });
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    // Memory has no transaction: the payment the code marked paid stays paid, and its event, written
    //   with the work before the record, stays with it (decision D11).
    expect(w.drafted.find((p) => p.id === "PAY-901")?.status).toBe("paid");
    expect(await storyOf(w, payment)).toStrictEqual([
      ["payment.created", 1],
      ["payment.executed", 2],
    ]);
    const settled = await w.ask(keyed(SCHEDULER), "payment.reconcile", {
      proposal: proposalOf(unknown),
    });
    expect(settled).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await storyOf(w, payment)).toStrictEqual([
      ["payment.created", 1],
      ["payment.executed", 2],
    ]);
  });
});
