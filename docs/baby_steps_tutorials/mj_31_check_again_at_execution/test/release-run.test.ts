// The release runs the stored request, once (step 31's README, claims C1 and C6, decisions D4,
// D9, and D10). The agent drafts INV-1008, 31,400.00 USD, which waits for the CFO, and cfo_100
// approves it, as in step 29. Then the release drafts the payment that was approved.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed, SUPERVISOR } from "./helpers.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return uriOf(answer).split("/").at(-1)!;
}

/** The URI of the proposal an answer names. */
function uriOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "");
}

/** The agent drafts INV-1008, and cfo_100 approves it: it waits APPROVED for its release. */
async function approved(w: RuleWorld) {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const id = idOf(answer);
  const kept = (await w.proposals.get("org_456", id))!;
  const approval = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: kept.uri,
    payload_hash: kept.payload_hash,
  });
  expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return { id, uri: kept.uri, payload_hash: kept.payload_hash };
}

/** The agent prepares INV-1009, 12,500.00 USD, in propose_only mode: it waits READY. */
async function prepared(w: RuleWorld) {
  const answer = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", {
    invoice: "dsor://org_456/invoice/INV-1009",
    expected_version: 1,
  });
  expect(answer).toMatchObject({ outcome: "READY" });
  const id = idOf(answer);
  const kept = (await w.proposals.get("org_456", id))!;
  return { id, uri: kept.uri, payload_hash: kept.payload_hash };
}

/** One release, with this envelope. */
function release(w: RuleWorld, who: RequestEnvelope, uri: string) {
  return w.ask(who, "proposal.execute", { proposal: uri });
}

/** The proposal's state, and the moves of its history, as DSoR keeps them. */
async function historyOf(w: RuleWorld, id: string) {
  const kept = (await w.proposals.get("org_456", id))!;
  return { state: kept.state, moves: kept.transitions.map((t) => `${t.from ?? ""}>${t.to}`) };
}

describe("C1 and C6: the release runs the request that was stored (DSOR-APR-10)", () => {
  it("DSOR-APR-10: the agent releases INV-1008, which cfo_100 approved: COMMITTED, and the payment of 31,400.00 USD for INV-1008 is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await approved(w);
    const answer = await release(w, keyed(AGENT), uri);
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      proposal: uri,
      // The fingerprint of the request that ran: the stored one, not the release's input.
      payload_hash,
      // The amount is above the agent's clearance, so its answer leaves it out (step 14).
      data: { invoice_id: "INV-1008" },
    });
    expect(w.drafted.map((p) => [p.invoice_id, p.amount.value])).toEqual([
      ["INV-1008", "31400.00"],
    ]);
    expect(await historyOf(w, id)).toEqual({
      state: "COMMITTED",
      moves: [
        ">PROPOSED",
        "PROPOSED>PENDING_APPROVAL",
        "PENDING_APPROVAL>APPROVED",
        "APPROVED>EXECUTING",
        "EXECUTING>COMMITTED",
      ],
    });
  });

  it("Step 31: the move to EXECUTING names the caller who released it", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    await release(w, keyed(AGENT), uri);
    const kept = (await w.proposals.get("org_456", id))!;
    const started = kept.transitions.find((t) => t.to === "EXECUTING")!;
    expect(started.cause).toBe("released by accounts-payable-fte");
  });

  it("DSOR-APR-10: user_123 releases INV-1009, which the agent prepared in propose_only mode: COMMITTED, and its payment is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await prepared(w);
    expect(w.drafted).toEqual([]);
    expect(await release(w, keyed(SUPERVISOR), uri)).toMatchObject({
      outcome: "COMMITTED",
      data: { invoice_id: "INV-1009" },
    });
    expect(w.drafted.map((p) => p.invoice_id)).toEqual(["INV-1009"]);
    expect((await historyOf(w, id)).moves.slice(-3)).toEqual([
      "PROPOSED>READY",
      "READY>EXECUTING",
      "EXECUTING>COMMITTED",
    ]);
  });

  it("Step 31: the agent whose slip holds the full payment:create releases its own prepared INV-1009", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await prepared(w);
    expect(await release(w, keyed(AGENT), uri)).toMatchObject({ outcome: "COMMITTED" });
    expect(w.drafted.map((p) => p.invoice_id)).toEqual(["INV-1009"]);
  });
});

describe("C6: the booking is kept, then spent (step 31's README, decision D4)", () => {
  it("DSOR-DEL-06c: INV-1008's booking of 31,400.00 USD, held since Tuesday, is committed by the release, and not booked again", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    expect(await w.reservations.get("org_456", id)).toMatchObject({
      state: "held",
      amount: { value: "31400.00", currency: "USD" },
    });
    await release(w, keyed(AGENT), uri);
    expect(await w.reservations.get("org_456", id)).toMatchObject({ state: "committed" });
    expect(await w.reservations.all()).toHaveLength(1);
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
  });
});

describe("C6: a proposal runs at most once (step 31's README, decision D10)", () => {
  it("DSOR-IDM-01c: the same release sent again with its key gives back the same answer, and drafts nothing more", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approved(w);
    const once = keyed(AGENT);
    const first = await release(w, once, uri);
    const again = await release(w, once, uri);
    expect(again).toMatchObject({
      outcome: "COMMITTED",
      proposal: uri,
      payload_hash: "payload_hash" in first ? first.payload_hash : "",
      data: "data" in first ? first.data : {},
    });
    expect(w.drafted).toHaveLength(1);
  });

  it("Step 31: a release with a new key, after the proposal ran, hears CONFLICT, and drafts nothing more", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    await release(w, keyed(AGENT), uri);
    expect(await release(w, keyed(AGENT), uri)).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${id} is COMMITTED, and only an APPROVED or a READY proposal is released`,
    });
    expect(w.drafted).toHaveLength(1);
  });

  it("Step 31: two releases at once, with two keys, draft one payment: one is COMMITTED, the other hears CONFLICT", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approved(w);
    const answers = await Promise.all([
      release(w, keyed(AGENT), uri),
      release(w, keyed(SUPERVISOR), uri),
    ]);
    const outcomes = answers
      .map((a) => ("code" in a ? a.code : "outcome" in a ? a.outcome : ""))
      .sort();
    expect(outcomes).toEqual(["COMMITTED", "CONFLICT"]);
    expect(w.drafted).toHaveLength(1);
  });
});

describe("C2: a dry run of a release that may run (step 31's README, decision D13)", () => {
  it("DSOR-OPR-06: the agent's dry run of INV-1008's release hears VALIDATED, and nothing moves, is drafted, or is spent", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const answer = await release(w, { ...AGENT, mode: "validate_only" }, uri);
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    expect((await historyOf(w, id)).state).toBe("APPROVED");
    expect(w.drafted).toEqual([]);
    expect(await w.reservations.get("org_456", id)).toMatchObject({ state: "held" });
  });
});
