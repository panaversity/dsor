// What is left to pay: an invoice's open amount, as line ⑨ works it out, counts the proposals in
// flight that spend it (DSOR-EXC-02; step 32's README, claim C3, decisions D9 and D11). The company's
// CFO rule makes INV-1008, 31,400.00 USD, wait for the CFO. INV-1002, 8,900.50 USD, is under the
// rule's 25,000 USD, so it is drafted at once.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { dsorMover } from "../src/proposals.ts";
import { AGENT, CFO, contract, keyed, shippedWith } from "./helpers.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const LEFT =
  'a precondition of payment.create does not hold: dsor_exceeds(state.invoice.open_amount, dsor_money("0.00", state.invoice.open_amount.currency))';

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The drafts the world holds, as [id, invoice, amount, status]. */
function drafts(w: RuleWorld): string[][] {
  return w.drafted.map((p) => [p.id, p.invoice_id, p.amount.value, p.status]);
}

/** payment.create with no in_flight block, so only DSOR-EXC-02's count can stop a second attempt. */
function withoutExclusivity() {
  const changed = contract("payment.create");
  delete changed["in_flight"];
  return shippedWith(changed);
}

describe("C3: a draft is not a proposal in flight (step 32's README, decision D9)", () => {
  // Changed while building: D9 first counted drafts too. DSOR-EXC-02 counts what is committed to
  // proposals in flight, and no step pays a draft yet, so a draft is not counted. The step that
  // pays a draft must count the payments in flight then.
  it("Step 32: INV-1002 is drafted, PAY-901, and once that proposal has ended, a second draft is PAY-902: no step pays a draft yet", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect(drafts(w)).toStrictEqual([
      ["PAY-901", "INV-1002", "8900.50", "draft"],
      ["PAY-902", "INV-1002", "8900.50", "draft"],
    ]);
  });
});

describe("C3: a proposal in flight counts as spent (step 32's README, decisions D9 and D11)", () => {
  it("DSOR-EXC-02: with no exclusive_over, a second draft of INV-1008 while the first waits for the CFO finds nothing left to pay", async () => {
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, withoutExclusivity());
    expect(await w.draft("INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const second = await w.draft("INV-1008");
    expect(second).toMatchObject({ code: "CONFLICT", message: LEFT });
    expect((await w.proposals.get("org_456", idOf(second)))?.state).toBe("DENIED");
  });

  it("DSOR-EXC-02: with no exclusive_over, a prepared INV-1009, READY, is in flight too: a draft of INV-1009 finds nothing left to pay, and so does its dry run", async () => {
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, withoutExclusivity());
    const input = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };
    const prepared = await w.ask(
      { ...keyed(AGENT), mode: "propose_only" },
      "payment.create",
      input,
    );
    expect(prepared).toMatchObject({ outcome: "READY" });
    expect(await w.draft("INV-1009")).toMatchObject({ code: "CONFLICT", message: LEFT });
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "payment.create", input);
    expect(dry).toMatchObject({ code: "CONFLICT", message: LEFT });
  });

  it("DSOR-EXC-02: the proposal being released is not counted against itself: INV-1008, approved, is drafted for 31,400.00 USD", async () => {
    const w = await ruleWorldOnTuesday();
    const waiting = await w.draft("INV-1008");
    const kept = (await w.proposals.get("org_456", idOf(waiting)))!;
    await w.ask(keyed(CFO), "proposal.approve", {
      proposal: kept.uri,
      payload_hash: kept.payload_hash,
    });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: kept.uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    expect(drafts(w)).toStrictEqual([["PAY-901", "INV-1008", "31400.00", "draft"]]);
  });

  it("DSOR-EXC-02: a dry run of that release does not count it against itself either", async () => {
    const w = await ruleWorldOnTuesday();
    const waiting = await w.draft("INV-1008");
    const kept = (await w.proposals.get("org_456", idOf(waiting)))!;
    await w.ask(keyed(CFO), "proposal.approve", {
      proposal: kept.uri,
      payload_hash: kept.payload_hash,
    });
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "proposal.execute", {
      proposal: kept.uri,
    });
    expect(dry).toMatchObject({ outcome: "VALIDATED" });
  });

  it("DSOR-EXC-02: a proposal that ended frees the invoice: INV-1008's waiting proposal is cancelled, and a new draft waits again", async () => {
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, withoutExclusivity());
    const first = await w.draft("INV-1008");
    const id = idOf(first);
    const kept = (await w.proposals.get("org_456", id))!;
    const moved = await w.proposals.move("org_456", id, "PENDING_APPROVAL", "CANCELLED", {
      mover: dsorMover(kept.requester),
      cause: "the test cancels it",
      correlation: { request_id: "req_test" } as never,
    });
    expect(moved).toBe(true);
    expect(await w.draft("INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
  });
});

/** payment.create with no in_flight block, and without its precondition that something is left. */
function withNeitherGuard() {
  const changed = contract("payment.create");
  delete changed["in_flight"];
  const preconditions = changed["preconditions"] as { predicates: string[] };
  changed["preconditions"] = {
    ...preconditions,
    predicates: preconditions.predicates.filter((p) => !p.startsWith("dsor_exceeds")),
  };
  return shippedWith(changed);
}

/** A proposal of org_456, written straight to the store, in flight over INV-1008: READY. */
async function plantReady(w: RuleWorld, operation: string): Promise<string> {
  const id = `prop_00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  const requester = {
    identity_mode: "direct" as const,
    subject: "user_123",
    subject_type: "human",
    actor_chain: [],
    active_tenant: "org_456",
    subject_authority: { source: "token" as const, as_of: "2026-10-06T15:00:00.000Z" },
  };
  const by = {
    mover: dsorMover(requester),
    cause: "the test plants it",
    correlation: { request_id: "req_test" } as never,
  };
  const uri = "dsor://org_456/invoice/INV-1008";
  const draft = {
    operation,
    mode: "propose_only" as const,
    payload: { invoice: uri },
    payload_hash: `sha256:${"d".repeat(64)}`,
    resources: [uri],
    requester,
    idempotency_key: id,
  };
  await w.proposals.create("org_456", id, draft, by, "P7D");
  if (!(await w.proposals.move("org_456", id, "PROPOSED", "READY", by))) {
    throw new Error("the planted proposal did not move");
  }
  return id;
}

// Found by a sweep of small breaks, M04: the count set what line ⑩ books to zero too. The
// precondition refuses first, so nothing showed. But a contract without that precondition booked
// 0.00 against the slip's day and drafted 31,400.00 USD. The count is for preconditions only, and
// the booking always counts the invoice's real open amount (step 32's README, decision D9).
describe("C3: the count is for preconditions; the booking counts what the invoice owes", () => {
  it("DSOR-DEL-06b: with neither guard, a second attempt on INV-1008 while the first waits books 31,400.00 USD, not nothing", async () => {
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, withNeitherGuard());
    expect(await w.draft("INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const second = await w.draft("INV-1008");
    expect(second).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect((await w.reservations.get("org_456", idOf(second)))?.amount).toStrictEqual({
      value: "31400.00",
      currency: "USD",
    });
  });
});

// Found by the sweep too, M05 and M06: no test had a proposal of another operation in flight over
// the invoice. One that spends nothing commits nothing, and only a second attempt of the same
// operation is refused (DSOR-EXC-01, DSOR-EXC-02).
describe("C2, C3: only the same operation is exclusive, and only a spender is counted", () => {
  it("DSOR-EXC-01: a prepared invoice.issue over INV-1008, in flight, neither refuses nor empties the agent's payment of INV-1008: it waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday();
    await plantReady(w, "invoice.issue@1");
    expect(await w.draft("INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
  });

  it("DSOR-EXC-02: a prepared payment.create over INV-1008, planted in flight, empties it: the agent's payment finds nothing left to pay", async () => {
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, withoutExclusivity());
    await plantReady(w, "payment.create@1");
    expect(await w.draft("INV-1008")).toMatchObject({ code: "CONFLICT", message: LEFT });
  });
});
