// Step 40: the events the story's calls leave in the outbox. A draft writes payment.created, a
// payment sent or settled paid writes payment.executed, and the approval that moves a proposal to
// APPROVED writes proposal.approved; a refusal, a replay, a silent bank, and an approval that leaves
// the proposal waiting write none. Each event carries its call's correlation ids and its company's
// (DSOR-EVT-01a, DSOR-EVT-01b, DSOR-COR-01a; step 40's README, claims C1 to C3 and C5).
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import type { DomainEvent } from "../src/events.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, ADMIN, keyed, SUPERVISOR } from "./helpers.ts";
import { handlersFor } from "../src/operations.ts";
import type { Payment } from "../src/payment.ts";
import type { Handler } from "../src/registry.ts";
import { heard, ruleWorld, ruleWorldOnTuesday, shippedRule, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";
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

/** user_123 sends this payment through the fake bank. */
function send(w: RuleWorld, payment: string): Promise<Answer> {
  return w.ask(keyed(SUPERVISOR), "payment.execute", {
    invoice: INV_1002,
    payment,
    expected_version: 1,
  });
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
    const w = ruleWorld(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      lying,
    );
    await w.rates.load("org_456", {
      source: "ecb-daily",
      base: "EUR",
      published_at: "2026-10-06T14:00:00.000Z",
      rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
    });
    await draft(w);
    const [event] = await eventsOf(w);
    expect(event!.data).toMatchObject({
      vendor_id: "VENDOR-44",
      amount: { value: "8900.50", currency: "USD" },
    });
  });

  it("DSOR-EVT-01a: the company's code returns no payment at all: the call does not commit, and no event is written", async () => {
    const shipped = handlersFor();
    const silent: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        return { done: true };
      },
    };
    const w = ruleWorld(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      silent,
    );
    const answer = await draft(w);
    expect(heard(answer)).not.toBe("COMMITTED");
    expect(await eventsOf(w)).toStrictEqual([]);
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
  it("DSOR-COR-01a: the agent's draft: the event names the agent, the request, and the company", async () => {
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

  it("DSOR-COR-01a: a task id the agent says it works on stays in agent_asserted: no event carries it", async () => {
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
