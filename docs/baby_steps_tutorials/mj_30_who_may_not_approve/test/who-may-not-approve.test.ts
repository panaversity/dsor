// Who may approve, and who may not (step 30's README, claims C2 and C6, decisions D5, D6, and
// D10). An AP supervisor may approve a payment now, and a rule of org_456's own sends payments
// above 10,000 USD to one. user_123, an AP supervisor, signed del_100, the slip of
// accounts-payable-fte. user_124, a second AP supervisor, lives in these tests only.
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed, withPlanted } from "./helpers.ts";
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
