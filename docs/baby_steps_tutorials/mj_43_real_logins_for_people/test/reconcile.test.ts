// Step 38: payment.reconcile asks the company's bank, by the key of a proposal whose outcome is
// unknown, what happened, and settles it COMMITTED or FAILED with the bank's answer as evidence; a
// bank that does not answer leaves it unknown and held; an agent may never settle one
// (DSOR-UNK-04a, DSOR-UNK-04d; step 38's README, claims C1 to C7).
import { describe, expect, it } from "vitest";
import { bankKeyOf } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { dsorMover } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ADMIN, AGENT, CFO, DEL_100, keyed, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";
// dsor-scheduler, DSoR's own login for scheduled work (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const HELD = { code: "RESOURCE_HELD" };

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** user_123 drafts a payment of INV-1002: its address. */
async function draft(w: RuleWorld): Promise<string> {
  const answer = await w.ask(keyed(SUPERVISOR), "payment.create", {
    invoice: INV_1002,
    expected_version: 1,
  });
  return `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
}

/** user_123 sends this payment. */
function send(w: RuleWorld, payment: string, who = keyed(SUPERVISOR)) {
  return w.ask(who, "payment.execute", { invoice: INV_1002, payment, expected_version: 1 });
}

/**
 * PAY-901 sent on a day the bank takes the order and never answers: its address, the proposal's
 * address, and the envelope it was sent with. lost: the order never reaches the bank at all.
 */
async function unknownPayment(w: RuleWorld, lost = false) {
  const payment = await draft(w);
  const envelope = keyed(SUPERVISOR);
  const pay = w.bank.pay;
  if (lost) w.bank.pay = () => new Promise(() => {});
  else w.bank.mode = "silent";
  const unknown = await send(w, payment, envelope);
  w.bank.pay = pay;
  w.bank.mode = "good";
  expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return { payment, proposal: `dsor://org_456/proposal/${idOf(unknown)}`, envelope };
}

/** Someone reconciles this proposal. */
function reconcile(w: RuleWorld, proposal: string, who: RequestEnvelope = SCHEDULER) {
  return w.ask(keyed(who), "payment.reconcile", { proposal });
}

/** The proposal's state, as DSoR keeps it. */
async function stateOf(w: RuleWorld, proposal: string): Promise<string | undefined> {
  return (await w.proposals.get("org_456", proposal.split("/").at(-1)!))?.state;
}

describe("C1 and C2: the bank sent it: COMMITTED, paid, and the hold lifts", () => {
  it("DSOR-UNK-04a: dsor-scheduler reconciles PAY-901: the bank says TRF-1 was sent, so the proposal is COMMITTED and PAY-901 is paid", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    const settled = await reconcile(w, proposal);
    expect(settled).toMatchObject({
      outcome: "COMMITTED",
      data: { proposal, state: "COMMITTED" },
    });
    expect((settled as { data: { evidence: string } }).data.evidence).toContain("TRF-1");
    expect(await stateOf(w, proposal)).toBe("COMMITTED");
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["paid"]);
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-UNK-04a: once PAY-901 is settled paid, its cancel is refused for what it is, paid, not held, and never goes through", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment, proposal } = await unknownPayment(w);
    await reconcile(w, proposal);
    const cancel = await w.ask(keyed(SUPERVISOR), "payment.cancel", {
      payment,
      expected_version: 1,
    });
    expect(heard(cancel)).not.toBe("COMMITTED");
    expect(cancel).not.toMatchObject(HELD);
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["paid"]);
  });
});

describe("C3: the bank never received it: FAILED, still a draft, and the hold lifts", () => {
  it("DSOR-UNK-04a: the order never reached the bank: the proposal is FAILED, PAY-901 stays a draft, and a new payment of INV-1002 can be drafted and sent once", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w, true);
    const settled = await reconcile(w, proposal);
    expect(settled).toMatchObject({ outcome: "COMMITTED", data: { state: "FAILED" } });
    expect(await stateOf(w, proposal)).toBe("FAILED");
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["draft"]);
    const again = await draft(w);
    expect(heard(await send(w, again))).toBe("COMMITTED");
    expect(w.bank.transfers()).toHaveLength(1);
  });
});

describe("C2 and C3: the day's booking is the draft's", () => {
  // Found by step 38's review, F3: the agent's draft of INV-1002 books its amount on del_100's day,
  //   and the send books nothing. So settling the send leaves the draft's booking as it is.
  it.each([
    { said: "sent", lost: false, state: "COMMITTED" },
    { said: "never received", lost: true, state: "FAILED" },
  ])(
    "DSOR-UNK-04a: the agent drafts PAY-901 of INV-1002, user_123 sends it, and the bank $said: the proposal is $state and the draft's booking stays committed",
    async ({ lost, state }) => {
      const w = await ruleWorldOnTuesday();
      const drafted = await w.draft("INV-1002");
      const booked = idOf(drafted);
      expect((await w.reservations.get("org_456", booked))?.state).toBe("committed");
      const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
      const pay = w.bank.pay;
      if (lost) w.bank.pay = () => new Promise(() => {});
      else w.bank.mode = "silent";
      const unknown = await send(w, payment);
      w.bank.pay = pay;
      w.bank.mode = "good";
      expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
      expect(await w.reservations.get("org_456", idOf(unknown))).toBeUndefined();
      expect(await reconcile(w, `dsor://org_456/proposal/${idOf(unknown)}`)).toMatchObject({
        data: { state },
      });
      expect((await w.reservations.get("org_456", booked))?.state).toBe("committed");
    },
  );
});

describe("C4: a bank that does not answer settles nothing", () => {
  it.each(["silent", "broken"] as const)(
    "DSOR-UNK-04a: the bank is %s when asked: the proposal stays OUTCOME_UNKNOWN and PAY-901 stays held",
    async (mode) => {
      const w = await ruleWorldOnTuesday();
      const { payment, proposal } = await unknownPayment(w);
      w.bank.mode = mode;
      const asked = await reconcile(w, proposal);
      w.bank.mode = "good";
      expect(asked).toMatchObject({ outcome: "COMMITTED", data: { state: "OUTCOME_UNKNOWN" } });
      expect(await stateOf(w, proposal)).toBe("OUTCOME_UNKNOWN");
      expect(
        await w.ask(keyed(SUPERVISOR), "payment.cancel", { payment, expected_version: 1 }),
      ).toMatchObject(HELD);
      expect(heard(await reconcile(w, proposal))).toBe("COMMITTED");
      expect(await stateOf(w, proposal)).toBe("COMMITTED");
    },
  );
});

describe("C4b: a receipt that is not this payment settles nothing", () => {
  // Changed in step 38's review: the mismatch is refused with CONFLICT, so the record keeps its
  //   reason; an answer of OUTCOME_UNKNOWN left the record without one (finding F4).
  it.each([
    ["another payment", { payment: "PAY-999" }],
    ["another vendor", { vendor: "VENDOR-99" }],
    ["another amount", { amount: { value: "89.00", currency: "USD" } }],
    ["another currency", { amount: { value: "8900.50", currency: "EUR" } }],
  ])(
    "DSOR-UNK-04a: the bank answers the key with a receipt for %s: CONFLICT, the proposal stays OUTCOME_UNKNOWN, PAY-901 a draft, and the record says why",
    async (_, changed) => {
      const w = await ruleWorldOnTuesday();
      const { proposal } = await unknownPayment(w);
      const lookup = w.bank.lookup;
      w.bank.lookup = async (key) => {
        const found = await lookup(key);
        return found === undefined ? undefined : { ...found, ...changed };
      };
      const asked = await reconcile(w, proposal);
      expect(asked).toMatchObject({ code: "CONFLICT" });
      expect((asked as { message: string }).message).toContain("not this payment");
      expect(await stateOf(w, proposal)).toBe("OUTCOME_UNKNOWN");
      expect(w.drafted.map((p) => p.status)).toStrictEqual(["draft"]);
      const record = (await w.log.records()).at(-1)!;
      expect(record.operation).toBe("payment.reconcile@1");
      expect(record.reason).toContain("not this payment");
    },
  );
});

describe("C1b: a payment already marked paid", () => {
  it("DSOR-UNK-04a: PAY-901 is marked paid by another path before the reconcile: the bank's matching receipt still settles it COMMITTED", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    w.drafted[0]!.status = "paid";
    expect(await reconcile(w, proposal)).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await stateOf(w, proposal)).toBe("COMMITTED");
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["paid"]);
  });

  it("DSOR-UNK-04a: PAY-901 is cancelled by another path before the reconcile: nothing settles, and the proposal stays OUTCOME_UNKNOWN", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    w.drafted[0]!.status = "cancelled";
    expect(await reconcile(w, proposal)).toMatchObject({ code: "CONFLICT" });
    expect(await stateOf(w, proposal)).toBe("OUTCOME_UNKNOWN");
  });
});

describe("C5: the evidence is kept", () => {
  it("DSOR-UNK-04a: the proposal's move to COMMITTED names what the bank said, and the call leaves its record", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    await reconcile(w, proposal);
    const kept = (await w.proposals.get("org_456", proposal.split("/").at(-1)!))!;
    const last = kept.transitions.at(-1)!;
    expect(last).toMatchObject({
      from: "OUTCOME_UNKNOWN",
      to: "COMMITTED",
      actor: "dsor-scheduler",
    });
    expect(last.cause).toContain("TRF-1");
    expect(last.cause).toContain("8900.50 USD");
    expect(last.cause).toContain(bankKeyOf("org_456", proposal.split("/").at(-1)!));
    const record = (await w.log.records()).at(-1)!;
    expect(record).toMatchObject({ operation: "payment.reconcile@1", authorization: "ALLOW" });
  });
});

describe("C6: who may settle, and what", () => {
  it("DSOR-UNK-04d: the agent is refused, even with a slip that lists payment:reconcile, and nothing is settled", async () => {
    const listing = { ...DEL_100, permissions: [...DEL_100.permissions, "payment:reconcile"] };
    const w = await ruleWorldOnTuesday(undefined, [listing]);
    const { proposal } = await unknownPayment(w);
    expect(await reconcile(w, proposal, AGENT)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await stateOf(w, proposal)).toBe("OUTCOME_UNKNOWN");
  });

  // Changed in step 38b: cfo_100's role holds payment:reconcile, so the person an unknown payment
  //   escalates to can settle it (step 38b's README, decision D11). admin_100 holds none.
  it("DSOR-UNK-04d: user_123, an AP supervisor, and cfo_100 may press check now; admin_100, who does not hold the permission, may not", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    expect(await reconcile(w, proposal, ADMIN)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await reconcile(w, proposal, CFO)).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await reconcile(w, proposal, SUPERVISOR)).toMatchObject({ code: "CONFLICT" });
  });

  it("DSOR-UNK-04a: a proposal that is not OUTCOME_UNKNOWN is refused with CONFLICT: a settled one, and a draft's", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    await reconcile(w, proposal);
    expect(await reconcile(w, proposal)).toMatchObject({ code: "CONFLICT" });
    const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });
    expect(await reconcile(w, `dsor://org_456/proposal/${idOf(drafted)}`)).toMatchObject({
      code: "CONFLICT",
    });
  });

  it("DSOR-OPR-06: a dry run of a reconcile of a settled proposal hears CONFLICT, as the real call does, before the bank is asked", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    await reconcile(w, proposal);
    let asked = 0;
    const lookup = w.bank.lookup;
    w.bank.lookup = async (key) => {
      asked += 1;
      return lookup(key);
    };
    const dry = await w.ask({ ...SCHEDULER, mode: "validate_only" }, "payment.reconcile", {
      proposal,
    });
    expect(dry).toMatchObject({ code: "CONFLICT" });
    expect(await reconcile(w, proposal)).toMatchObject({ code: "CONFLICT" });
    expect(asked).toBe(0);
  });

  it("DSOR-OPR-06: a dry run of a reconcile changes nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await unknownPayment(w);
    const dry = await w.ask({ ...SCHEDULER, mode: "validate_only" }, "payment.reconcile", {
      proposal,
    });
    expect(heard(dry)).toBe("VALIDATED");
    expect(await stateOf(w, proposal)).toBe("OUTCOME_UNKNOWN");
  });
});

describe("C7: once settled, the same-key retry answers the settled outcome", () => {
  it("DSOR-UNK-02: settled COMMITTED, the original send's same-key retry answers COMMITTED with PAY-901 paid, and the bank sends nothing more", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment, proposal, envelope } = await unknownPayment(w);
    await reconcile(w, proposal);
    const again = await send(w, payment, envelope);
    expect(again).toMatchObject({ outcome: "COMMITTED", proposal, data: { status: "paid" } });
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-UNK-02: settled FAILED, the same-key retry hears that the bank never received it, and a new key is needed", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment, proposal, envelope } = await unknownPayment(w, true);
    await reconcile(w, proposal);
    const again = await send(w, payment, envelope);
    // Changed in step 38's review: CONFLICT, whose retry is never, not CONNECTOR_UNAVAILABLE,
    //   whose retry is the same key, which would ask again for ever (finding F6).
    expect(again).toMatchObject({ code: "CONFLICT", retry: "never", proposal });
    expect((again as { message: string }).message).toContain("new key");
  });

  it("DSOR-UNK-02: a proposal moved to COMMITTED while PAY-901 is still a draft: the same-key retry still answers OUTCOME_UNKNOWN, never COMMITTED with a draft", async () => {
    const w = await ruleWorldOnTuesday();
    const { payment, proposal, envelope } = await unknownPayment(w);
    const id = proposal.split("/").at(-1)!;
    const kept = (await w.proposals.get("org_456", id))!;
    const by = {
      mover: dsorMover(kept.requester),
      cause: "settled by the test",
      correlation: { request_id: "req_settled" },
    };
    expect(await w.proposals.move("org_456", id, "OUTCOME_UNKNOWN", "COMMITTED", by)).toBe(true);
    expect(await send(w, payment, envelope)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });

  it("DSOR-UNK-02: a payment prepared, then released on a silent day, is reconciled: the release's same-key retry answers COMMITTED with PAY-901 paid", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const prepared = await w.ask(
      { ...keyed(SUPERVISOR), mode: "propose_only" },
      "payment.execute",
      {
        invoice: INV_1002,
        payment,
        expected_version: 1,
      },
    );
    expect(heard(prepared)).toBe("READY");
    const kept = (await w.proposals.get("org_456", idOf(prepared)))!;
    const release = keyed(SUPERVISOR);
    w.bank.mode = "silent";
    const unknown = await w.ask(release, "proposal.execute", { proposal: kept.uri });
    w.bank.mode = "good";
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(await reconcile(w, kept.uri)).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await w.ask(release, "proposal.execute", { proposal: kept.uri })).toMatchObject({
      outcome: "COMMITTED",
      data: { status: "paid" },
    });
    expect(w.bank.transfers()).toHaveLength(1);
  });
});
