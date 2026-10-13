// Who may approve, and who may not (step 30's README, claims C1 to C3 and C6, decisions D1 to D6,
// and D10). No one in a proposal's requesting chain approves it: not the person who asked, not the
// person who signed the slip of the agent that asked, and not an actor (DSOR-SOD-02). An AP
// supervisor may approve a payment now, and a rule of org_456's own sends payments above 10,000
// USD to one. user_123, an AP supervisor, signed del_100, the slip of accounts-payable-fte.
// user_124, a second AP supervisor, lives in these tests only.
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import type { Principal } from "../src/principals.ts";
import type { MoveBy, ProposalDraft, Requester } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed, SUPERVISOR, withPlanted } from "./helpers.ts";
import {
  heard,
  ruleCall,
  ruleWorldOnTuesday,
  shippedRule,
  startWith,
  SUPERVISOR_RULE,
  supervisorRule,
  textOf,
  type RuleWorld,
} from "./rule-world.ts";

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]): ControlsSource {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

/** org_456 with its two rules: the CFO above 25,000 USD, an AP supervisor above 10,000 USD. */
function withSupervisors(): Promise<RuleWorld> {
  return ruleWorldOnTuesday(controlsOf(shippedRule(), supervisorRule()));
}

// A second AP supervisor of org_456, planted for the approval that the rules allow (step 30's
// README, decision D10).
const USER_124: RequestEnvelope = { token: "tok_user_124", tenant: "org_456" };
const user124 = {
  id: "user_124",
  type: "human",
  memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
} as unknown as Principal;

// What a payment that the supervisor rule stops waits for.
const ONE_SUPERVISOR = {
  approval: { role: "ap_supervisor", quorum: 1 },
  control: "supervisor-above-10000",
  control_version: 1,
};

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** Someone drafts a payment of this bill, and the test reads its proposal as an approval screen would. */
async function drafted(w: RuleWorld, invoice: string, who: RequestEnvelope = AGENT) {
  const answer = await w.draft(invoice, who);
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const id = idOf(answer);
  const kept = await w.proposals.get("org_456", id);
  return { id, uri: kept!.uri, payload_hash: kept!.payload_hash };
}

/** One approval call, with a fresh key. */
function approves(w: RuleWorld, who: RequestEnvelope, uri: string, payload_hash: string) {
  return w.ask(keyed(who), "proposal.approve", { proposal: uri, payload_hash });
}

/** The proposal's state, and how many approvals it has. */
async function stateOf(w: RuleWorld, id: string) {
  const kept = await w.proposals.get("org_456", id);
  return { state: kept?.state, approvals: (await w.proposals.approvals("org_456", id)).length };
}

describe("C6: AP supervisors approve, and a rule may ask for one (step 30's README, decisions D5 and D6)", () => {
  it("Step 30: cfo_100 drafts supervisor-above-10000, which asks for one AP supervisor, and switches it on: an AP supervisor can give the approval now", async () => {
    const w = await ruleWorldOnTuesday();
    const text = textOf(supervisorRule());
    const draft = await ruleCall(w, CFO, "rule.draft", { draft: text }, SUPERVISOR_RULE);
    expect(heard(draft)).toBe("COMMITTED");
    const on = await ruleCall(w, CFO, "rule.activate", { version: 1 }, SUPERVISOR_RULE);
    expect(heard(on)).toBe("COMMITTED");
    const { id } = await drafted(w, "INV-1012");
    expect((await w.proposals.get("org_456", id))?.requires).toStrictEqual([ONE_SUPERVISOR]);
  });

  it("Step 30: start-up accepts supervisor-above-10000 beside the shipped rule, and its tests pass", async () => {
    const registry = await startWith(controlsOf(shippedRule(), supervisorRule()));
    const versions = await registry.controls.versions("org_456");
    expect(versions.map((c) => `${c.id}@${c.version}`)).toContain("supervisor-above-10000@1");
  });
});

describe("C2: someone outside the chain who holds the role approves (step 30's README, decision D10)", () => {
  it("Step 30: user_124, a second AP supervisor, who neither asked nor signed del_100, approves the agent's INV-1012, 22,750.00 USD, and it is APPROVED", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-1012");
    expect((await w.proposals.get("org_456", id))?.requires).toStrictEqual([ONE_SUPERVISOR]);
    const answer = await withPlanted("tok_user_124", user124, () =>
      approves(w, USER_124, uri, payload_hash),
    );
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: { state: "APPROVED", waits_for: [] },
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "APPROVED", approvals: 1 });
  });

  it("Step 30: cfo_100 is outside the chain, and still cannot approve INV-1012: the rule asks for an AP supervisor, AUTHORIZATION_DENIED", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-1012");
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `cfo_100 holds none of the roles proposal ${id} waits for: ap_supervisor`,
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });
});

/** The decision record of the call that gave this answer. */
async function recordOf(w: RuleWorld, answer: Answer) {
  const records = await w.log.records();
  return records.find(
    (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
  );
}

describe("C1 and C3: no one in the requesting chain approves, and the no comes before any work (step 30's README, decisions D1 to D4)", () => {
  it("DSOR-SOD-02: user_123 signed del_100, so user_123 cannot approve the agent's INV-1012, 22,750.00 USD: SOD_VIOLATION, the record says DENY, and it still waits", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-1012");
    const answer = await approves(w, SUPERVISOR, uri, payload_hash);
    expect(answer).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_123 may not approve proposal ${id}: user_123 signed slip del_100, which the agent that asked works under`,
    });
    expect((await recordOf(w, answer))?.authorization).toBe("DENY");
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  it("DSOR-SOD-02: user_123 drafts INV-2007, 21,000.00 USD, on their own login, and cannot approve it: SOD_VIOLATION, user_123 asked for it; user_124 may", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-2007", SUPERVISOR);
    expect(await approves(w, SUPERVISOR, uri, payload_hash)).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_123 may not approve proposal ${id}: user_123 asked for it`,
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
    const other = await withPlanted("tok_user_124", user124, () =>
      approves(w, USER_124, uri, payload_hash),
    );
    expect(other).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  });

  it("DSOR-SOD-02: a dry run of user_123's approval hears what the real call hears: SOD_VIOLATION, and nothing is approved", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-1012");
    const dry = { ...SUPERVISOR, mode: "validate_only" as const };
    const answer = await w.ask(dry, "proposal.approve", { proposal: uri, payload_hash });
    expect(answer).toMatchObject({ code: "SOD_VIOLATION" });
    expect((await recordOf(w, answer))?.authorization).toBe("DENY");
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });
});

// The two clauses that the pipeline cannot reach in this tutorial, held with proposals the test
// writes into the store by hand: a person who acted in the request, and a slip whose signer is not
// the request's subject. The pipeline always records the signer as the subject (step 18).
describe("C1: every part of the chain, read from DSoR's own records (step 30's README, decisions D1 and D2)", () => {
  const BY: MoveBy = {
    mover: {
      mode: "direct",
      subject: "dsor",
      actor_chain: [],
      subject_authority: { source: "token", as_of: "2026-10-06T15:05:00.000Z" },
    },
    cause: "planted by the test",
    correlation: { request_id: "req_planted" },
  };
  const AS_OF = { source: "role_source" as const, as_of: "2026-10-06T15:05:00.000Z" };

  /** A proposal of INV-1012 that waits for an AP supervisor, written by hand with this requester. */
  async function planted(w: RuleWorld, id: string, requester: Requester) {
    const draft: ProposalDraft = {
      operation: "payment.create@1",
      mode: "execute",
      payload: { invoice: "dsor://org_456/invoice/INV-1012", expected_version: 1 },
      payload_hash: `sha256:${"a".repeat(64)}`,
      resources: ["dsor://org_456/invoice/INV-1012"],
      requester,
      idempotency_key: `planted-${id}`,
    };
    await w.proposals.create("org_456", id, draft, BY, "P7D");
    await w.proposals.move("org_456", id, "PROPOSED", "PENDING_APPROVAL", BY, [ONE_SUPERVISOR]);
    return (await w.proposals.get("org_456", id))!;
  }

  it("DSOR-SOD-02: a person who acted in the request cannot approve it: user_124, in the actor chain of a request for user_123, hears SOD_VIOLATION", async () => {
    const w = await withSupervisors();
    const id = "prop_00000000-0000-4000-8000-000000000301";
    const kept = await planted(w, id, {
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["user_124"],
      active_tenant: "org_456",
      subject_authority: AS_OF,
    });
    const answer = await withPlanted("tok_user_124", user124, () =>
      approves(w, USER_124, kept.uri, kept.payload_hash),
    );
    expect(answer).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_124 may not approve proposal ${id}: user_124 acted in the request`,
    });
  });

  it("DSOR-SOD-02: the slip's signer comes from DSoR's store of slips, not from the request's subject: a request for user_124 under del_100 is refused to user_123, who signed del_100, and to user_124, whose request it is", async () => {
    const w = await withSupervisors();
    const id = "prop_00000000-0000-4000-8000-000000000302";
    const kept = await planted(w, id, {
      identity_mode: "unattended",
      subject: "user_124",
      subject_type: "human",
      actor_chain: ["accounts-payable-fte"],
      active_tenant: "org_456",
      delegation: "del_100",
      subject_authority: AS_OF,
    });
    expect(await approves(w, SUPERVISOR, kept.uri, kept.payload_hash)).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_123 may not approve proposal ${id}: user_123 signed slip del_100, which the agent that asked works under`,
    });
    const theirs = await withPlanted("tok_user_124", user124, () =>
      approves(w, USER_124, kept.uri, kept.payload_hash),
    );
    expect(theirs).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_124 may not approve proposal ${id}: the request is user_124's, through slip del_100`,
    });
  });
});
