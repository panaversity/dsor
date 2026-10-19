// Step 37: while a payment's outcome is unknown, DSoR holds the payment and its invoice. Any other
// command that binds a held record hears RESOURCE_HELD, retried only after reconciliation; reads,
// other bills, an approval, and the same-key replay go on (DSOR-UNK-03b; step 37's README, claims
// C1 to C5).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { holdProblems } from "../src/holds.ts";
import { dsorMover } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** user_123 drafts a payment of this invoice: its address. */
async function draft(w: RuleWorld, invoice = INV_1002): Promise<string> {
  const answer = await w.ask(keyed(SUPERVISOR), "payment.create", { invoice, expected_version: 1 });
  expect(heard(answer)).toBe("COMMITTED");
  return `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
}

/** user_123 sends this payment of this invoice. */
function send(w: RuleWorld, payment: string, invoice = INV_1002, who = keyed(SUPERVISOR)) {
  return w.ask(who, "payment.execute", { invoice, payment, expected_version: 1 });
}

/** PAY-901 of INV-1002, drafted and sent on a silent day: its address, and the unknown answer. */
async function unknownPayment(w: RuleWorld, who: RequestEnvelope = keyed(SUPERVISOR)) {
  const payment = await draft(w);
  w.bank.mode = "silent";
  const unknown = await send(w, payment, INV_1002, who as ReturnType<typeof keyed>);
  w.bank.mode = "good";
  expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return { payment, unknown };
}

/** The proposal settled by hand, as step 38's reconciliation will settle it. */
async function settle(w: RuleWorld, id: string, to: "FAILED" | "COMMITTED"): Promise<void> {
  const kept = (await w.proposals.get("org_456", id))!;
  const by = {
    mover: dsorMover(kept.requester),
    cause: "settled by the test",
    correlation: { request_id: "req_settled" },
  };
  expect(await w.proposals.move("org_456", id, "OUTCOME_UNKNOWN", to, by)).toBe(true);
}

const HELD = { code: "RESOURCE_HELD", retry: "after_reconciliation" };

describe("C1: before a payment is sent, its records are held", () => {
  it("DSOR-UNK-03b: a silent bank: PAY-901 and INV-1002 are held, for the unknown proposal", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment, unknown } = await unknownPayment(w);
    expect(
      w.holds.all().map(({ resource, proposal_id }) => ({ resource, proposal_id })),
    ).toStrictEqual([
      { resource: payment, proposal_id: idOf(unknown) },
      { resource: INV_1002, proposal_id: idOf(unknown) },
    ]);
  });

  it("DSOR-UNK-03b: the holds are there when the bank is asked, before its answer", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    let seen = 0;
    const pay = w.bank.pay;
    w.bank.pay = async (key, order) => {
      seen = w.holds.all().length;
      return pay(key, order);
    };
    expect(heard(await send(w, payment))).toBe("COMMITTED");
    expect(seen).toBe(2);
  });

  it("DSOR-UNK-03b: a command that reaches no bank places no hold", async () => {
    const w = await ruleWorldOnTuesday();
    await draft(w);
    expect(w.holds.all()).toStrictEqual([]);
  });
});

describe("C2: a command that binds a held record hears RESOURCE_HELD", () => {
  it("DSOR-UNK-03b: user_123 cancels PAY-901 while it is unknown: RESOURCE_HELD, and PAY-901 stays a draft", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment } = await unknownPayment(w);
    const cancel = await w.ask(keyed(SUPERVISOR), "payment.cancel", {
      payment,
      expected_version: 1,
    });
    expect(cancel).toMatchObject(HELD);
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["draft"]);
  });

  it("DSOR-UNK-03b: user_123 drafts a new payment of INV-1002: RESOURCE_HELD, and nothing is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    await unknownPayment(w);
    const again = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    expect(again).toMatchObject(HELD);
    expect(w.drafted).toHaveLength(1);
  });

  it("DSOR-UNK-03b: PAY-901 sent again with a new key hears RESOURCE_HELD, not CONFLICT, and the bank sends once", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment } = await unknownPayment(w);
    expect(await send(w, payment)).toMatchObject(HELD);
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-UNK-03b: a cancel of PAY-901 while the bank sends it hears RESOURCE_HELD, and the send commits", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    let cancel: Answer | undefined;
    const pay = w.bank.pay;
    w.bank.pay = async (key, order) => {
      const receipt = await pay(key, order);
      cancel = await w.ask(keyed(SUPERVISOR), "payment.cancel", { payment, expected_version: 1 });
      return receipt;
    };
    expect(heard(await send(w, payment))).toBe("COMMITTED");
    expect(cancel).toMatchObject(HELD);
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["paid"]);
  });

  it("DSOR-UNK-03b: a payment of INV-1002 prepared before the silence is released while it is held: RESOURCE_HELD, and it waits READY", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const prepared = await w.ask({ ...keyed(SUPERVISOR), mode: "propose_only" }, "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    expect(heard(prepared)).toBe("READY");
    w.bank.mode = "silent";
    expect(await send(w, payment)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    w.bank.mode = "good";
    const kept = (await w.proposals.get("org_456", idOf(prepared)))!;
    const released = await w.ask(keyed(SUPERVISOR), "proposal.execute", { proposal: kept.uri });
    expect(released).toMatchObject(HELD);
    expect((await w.proposals.get("org_456", idOf(prepared)))?.state).toBe("READY");
    expect(w.drafted).toHaveLength(1);
  });
});

describe("C3: the hold touches nothing else", () => {
  it("DSOR-UNK-03b: while INV-1002 is held, a read of it answers as before", async () => {
    const w = await ruleWorldOnTuesday();
    await unknownPayment(w);
    const read = await w.ask(SUPERVISOR, "invoice.get", { invoice: INV_1002 });
    expect(read).toMatchObject({ data: { id: "INV-1002" } });
  });

  it("DSOR-UNK-03b: while INV-1002 is held, a payment of another bill, INV-1009, is drafted and sent", async () => {
    const w = await ruleWorldOnTuesday();
    await unknownPayment(w);
    const INV_1009 = "dsor://org_456/invoice/INV-1009";
    const other = await draft(w, INV_1009);
    expect(heard(await send(w, other, INV_1009))).toBe("COMMITTED");
  });

  it("DSOR-UNK-02: the same request with the same key still answers OUTCOME_UNKNOWN, not RESOURCE_HELD", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const envelope = keyed(SUPERVISOR);
    w.bank.mode = "silent";
    await send(w, payment, INV_1002, envelope);
    w.bank.mode = "good";
    expect(await send(w, payment, INV_1002, envelope)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });

  it("DSOR-UNK-03b: while INV-1008 is held, cfo_100 approves another payment of it that waits; its release hears RESOURCE_HELD, and it stays APPROVED", async () => {
    const w = await ruleWorldOnTuesday();
    // The agent's first draft of INV-1008, approved and released: PAY-901.
    const first = await w.draft("INV-1008");
    const firstKept = (await w.proposals.get("org_456", idOf(first)))!;
    await w.ask(keyed(CFO), "proposal.approve", {
      proposal: firstKept.uri,
      payload_hash: firstKept.payload_hash,
    });
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: firstKept.uri });
    const pay901 = `dsor://org_456/payment/${(released as { data: { id: string } }).data.id}`;
    // A second draft of INV-1008, which waits for the CFO.
    const second = await w.draft("INV-1008");
    expect(heard(second)).toBe("PENDING_APPROVAL");
    const secondKept = (await w.proposals.get("org_456", idOf(second)))!;
    // PAY-901 is sent on a silent day: INV-1008 is held.
    w.bank.mode = "silent";
    const INV_1008 = "dsor://org_456/invoice/INV-1008";
    expect(await send(w, pay901, INV_1008)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    w.bank.mode = "good";
    const approval = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: secondKept.uri,
      payload_hash: secondKept.payload_hash,
    });
    expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    const release = await w.ask(keyed(AGENT), "proposal.execute", { proposal: secondKept.uri });
    expect(release).toMatchObject(HELD);
    expect((await w.proposals.get("org_456", idOf(second)))?.state).toBe("APPROVED");
  });
});

describe("C4: a hold ends with its payment", () => {
  it("DSOR-UNK-03b: PAY-901's proposal settled FAILED: INV-1002 is free, and a new payment of it is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    const { unknown } = await unknownPayment(w);
    await settle(w, idOf(unknown), "FAILED");
    expect(
      heard(
        await w.ask(keyed(SUPERVISOR), "payment.create", {
          invoice: INV_1002,
          expected_version: 1,
        }),
      ),
    ).toBe("COMMITTED");
  });

  it("DSOR-UNK-03b: after a good day, PAY-901 committed, its holds no longer count: a new payment of INV-1002 is not RESOURCE_HELD", async () => {
    const w = await ruleWorldOnTuesday();
    expect(heard(await send(w, await draft(w)))).toBe("COMMITTED");
    const again = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    expect(again).not.toMatchObject({ code: "RESOURCE_HELD" });
  });
});

describe("C5: the contracts name what is held", () => {
  it("DSOR-UNK-03b: payment.execute holds its payment and its invoice; payment.cancel binds its payment and the invoice found on it", async () => {
    const { contracts } = (await ruleWorldOnTuesday()).registry;
    const execute = contracts.get("payment.execute")!;
    expect(execute["in_flight"]).toMatchObject({ hold_on_unknown: ["payment", "invoice"] });
    expect(execute["bind"]).toMatchObject({ payment: "input.payment", invoice: "input.invoice" });
    expect(contracts.get("payment.cancel")!["bind"]).toStrictEqual({
      payment: "input.payment",
      invoice: "state.payment.invoice_id",
    });
  });

  it("DSOR-UNK-03b: start-up refuses a hold_on_unknown that names something the contract does not bind", async () => {
    const { contracts } = (await ruleWorldOnTuesday()).registry;
    const execute = contracts.get("payment.execute")!;
    const broken = {
      ...execute,
      in_flight: { ...(execute["in_flight"] as object), hold_on_unknown: ["payment", "vendor_44"] },
    };
    expect(holdProblems([broken])).toStrictEqual([
      'payment.execute: in_flight.hold_on_unknown names "vendor_44", which the contract does not bind (DSOR-UNK-03b)',
    ]);
    expect(holdProblems(contracts.values())).toStrictEqual([]);
  });
});
