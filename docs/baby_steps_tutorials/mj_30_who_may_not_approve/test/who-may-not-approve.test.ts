// Who may approve, and who may not (step 30's README, claims C1 to C6, decisions D1 to D8, and
// D10). No one in a proposal's requesting chain approves it: not the person who asked, not the
// person who signed the slip of the agent that asked, and not an actor (DSOR-SOD-02). An AP
// supervisor may approve a payment now, and a rule of org_456's own sends payments above 10,000
// USD to one. user_123, an AP supervisor, signed del_100, the slip of accounts-payable-fte.
// user_124, a second AP supervisor, lives in these tests only. And what step 29 built, held here by
// the rules' own ids: an agent never approves, every approver is a person, and a quorum counts
// distinct people (DSOR-SOD-01a, DSOR-SOD-01b, DSOR-SOD-04c).
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import type { Principal } from "../src/principals.ts";
import type { MoveBy, ProposalDraft, Requester } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  CFO,
  contract,
  DEL_101,
  FIRM_IN_456,
  FIRM_IN_789,
  keyed,
  rolesFile,
  shippedWith,
  STARTING_ROLES,
  SUPERVISOR,
  withPlanted,
} from "./helpers.ts";
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
// org_789's AP supervisor, who signed del_102, the slip of firm-ap-fte in org_789.
const USER_700: RequestEnvelope = { token: "tok_e1a7", tenant: "org_789" };

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

// A rule of org_789's own, so that org_789's agent has a waiting payment of its company to try.
const RULE_789: Control = {
  ...shippedRule(),
  id: "admin-above-1000",
  version: 1,
  owner: "admin_700",
  reviewed_by: "admin_700",
  authority: { system: "local" },
  condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("1000", "USD"))',
  effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
};
const BOTH_COMPANIES: ControlsSource = {
  file: "controls.json",
  text: JSON.stringify({ org_456: [shippedRule()], org_789: [RULE_789] }),
};

/** A waiting payment in this company: INV-1008 in org_456, INV-2002 in org_789. */
async function waitingIn(w: RuleWorld, tenant: string) {
  const [who, invoice] = tenant === "org_456" ? [AGENT, "INV-1008"] : [FIRM_IN_789, "INV-2002"];
  const answer = await w.ask(keyed(who), "payment.create", {
    invoice: `dsor://${tenant}/invoice/${invoice}`,
    expected_version: 1,
  });
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const id = idOf(answer);
  const kept = (await w.proposals.get(tenant, id))!;
  return { id, uri: kept.uri, payload_hash: kept.payload_hash };
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

/** A refusal's code and words, without the call's own correlation, or nothing for a yes. */
function refusalOf(answer: Answer): { code?: string; message?: string } {
  return "code" in answer ? { code: answer.code, message: answer.message } : {};
}

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

  // Changed by step 30's review, finding L2: the test compared only the code, so a dry run that
  // refused for another reason passed.
  it("DSOR-SOD-02: a dry run of user_123's approval hears what the real call hears, word for word: SOD_VIOLATION, and nothing is approved", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-1012");
    const dry = { ...SUPERVISOR, mode: "validate_only" as const };
    const answer = await w.ask(dry, "proposal.approve", { proposal: uri, payload_hash });
    expect((await recordOf(w, answer))?.authorization).toBe("DENY");
    const real = await approves(w, SUPERVISOR, uri, payload_hash);
    expect(refusalOf(answer)).toStrictEqual(refusalOf(real));
    expect(refusalOf(answer)).toMatchObject({ code: "SOD_VIOLATION" });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  // Found by step 30's review, finding L2: no test held decision D3's order, so the check could move
  // after the proposal's state, or before the operation's own permission, and every test passed.
  it("DSOR-SOD-02: the chain is asked before the proposal's state: after user_124 approved INV-1012, user_123 still hears SOD_VIOLATION, not CONFLICT", async () => {
    const w = await withSupervisors();
    const { id, uri, payload_hash } = await drafted(w, "INV-1012");
    await withPlanted("tok_user_124", user124, () => approves(w, USER_124, uri, payload_hash));
    expect(await stateOf(w, id)).toStrictEqual({ state: "APPROVED", approvals: 1 });
    expect(await approves(w, SUPERVISOR, uri, payload_hash)).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_123 may not approve proposal ${id}: user_123 signed slip del_100, which the agent that asked works under`,
    });
  });

  it("DSOR-SOD-02: who may approve the operation at all is asked before the chain: with payment:approve gone from ap_supervisor, user_123 hears AUTHORIZATION_DENIED for the payment, not SOD_VIOLATION", async () => {
    const supervisor = STARTING_ROLES["ap_supervisor"]!.filter((p) => p !== "payment:approve");
    const roles = rolesFile({ ...STARTING_ROLES, ap_supervisor: supervisor });
    const rules = controlsOf(shippedRule(), supervisorRule());
    const w = await ruleWorldOnTuesday(rules, undefined, undefined, undefined, undefined, roles);
    const { uri, payload_hash } = await drafted(w, "INV-1012");
    expect(await approves(w, SUPERVISOR, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "user_123 may not approve payment.create@1: it needs payment:approve",
    });
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

  // Changed by step 30's review, finding L3: with one actor in the chain, a check of only the first
  // actor passed.
  it("DSOR-SOD-02: no actor in the request approves it: user_124, the second of two actors in a request for user_123, hears SOD_VIOLATION", async () => {
    const w = await withSupervisors();
    const id = "prop_00000000-0000-4000-8000-000000000301";
    const kept = await planted(w, id, {
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["accounts-payable-fte", "user_124"],
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

  // Found by step 30's own breaks: with the slip read in org_456 whatever the call's company, every
  // test passed, because every test of the chain ran in org_456.
  it("DSOR-SOD-02: in org_789, the slip is read in the call's own company: user_700 signed del_102, so user_700 cannot approve firm-ap-fte's INV-2002", async () => {
    const w = await ruleWorldOnTuesday(BOTH_COMPANIES);
    const { id, uri, payload_hash } = await waitingIn(w, "org_789");
    expect(await approves(w, USER_700, uri, payload_hash)).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_700 may not approve proposal ${id}: user_700 signed slip del_102, which the agent that asked works under`,
    });
    expect(await w.proposals.approvals("org_789", id)).toStrictEqual([]);
  });
});

describe("C4: an agent never approves, and every approver is a person (step 30's README, decision D7)", () => {
  it.each([
    ["accounts-payable-fte", "org_456", AGENT],
    ["firm-ap-fte", "org_456", FIRM_IN_456],
    ["firm-ap-fte", "org_789", FIRM_IN_789],
  ] as const)(
    "DSOR-SOD-01a: %s, an agent, cannot approve a waiting payment in %s: line ⑤ refuses it, for people only, and nothing is approved",
    async (agent, tenant, who) => {
      const w = await ruleWorldOnTuesday(BOTH_COMPANIES);
      const { id, uri, payload_hash } = await waitingIn(w, tenant);
      expect(await approves(w, who, uri, payload_hash)).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"proposal.approve" is for people only, and ${agent} is not a person`,
      });
      expect(await w.proposals.approvals(tenant, id)).toStrictEqual([]);
    },
  );

  // Line ⑤ refuses every agent by the contract's people_only, so line ⑨'s own look is reached only
  // by a contract that lost that flag. firm-ap-fte is outside the chain of accounts-payable-fte's
  // request, so DSOR-SOD-02 would not stop it: only line ⑨'s check of who may approve does.
  it("DSOR-SOD-01a: with people_only gone from the contract, firm-ap-fte, under a slip that cfo_100 signed listing both approval permissions, cannot approve accounts-payable-fte's INV-1008: line ⑨ refuses it", async () => {
    const { extensions: _gone, ...approve } = contract("proposal.approve");
    const permissions = ["proposal:approve", "payment:approve"];
    const bySigner = { ...DEL_101, delegator: "cfo_100", permissions };
    const w = await ruleWorldOnTuesday(undefined, [bySigner], undefined, shippedWith(approve));
    const { id, uri, payload_hash } = await waitingIn(w, "org_456");
    expect(await approves(w, FIRM_IN_456, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"proposal.approve" is accepted only in direct identity mode, on the approver\'s own login',
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  // An application, planted as step 25b's tests plant one.
  const OPS: RequestEnvelope = { token: "tok_ops", tenant: "org_456" };
  const ops = {
    id: "ops-console",
    type: "application",
    memberships: [{ tenant_id: "org_456", roles: ["tenant_admin"] }],
  } as unknown as Principal;

  it.each([
    ["dsor-scheduler", "system", "tok_5c4e"],
    ["dsor-rates", "system", "tok_3b8f"],
    ["ops-console", "application", OPS.token],
  ])(
    "DSOR-SOD-01b: %s, a login of type %s, cannot approve INV-1008: line ⑤ refuses it, for people only",
    async (login, _type, token) => {
      const who: RequestEnvelope = { token, tenant: "org_456" };
      const w = await ruleWorldOnTuesday();
      const { id, uri, payload_hash } = await waitingIn(w, "org_456");
      const answer = await withPlanted("tok_ops", ops, () => approves(w, who, uri, payload_hash));
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"proposal.approve" is for people only, and ${login} is not a person`,
      });
      expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
    },
  );

  it.each(["system", "application"])(
    "DSOR-SOD-01b: with people_only gone from the contract, a login of type %s that holds the CFO's role passes line ⑤, and line ⑨ refuses it: not a person",
    async (type) => {
      const { extensions: _gone, ...approve } = contract("proposal.approve");
      const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(approve));
      const { id, uri, payload_hash } = await waitingIn(w, "org_456");
      const login = {
        id: `cfo-${type}`,
        type,
        memberships: [{ tenant_id: "org_456", roles: ["CFO"] }],
      } as unknown as Principal;
      const LOGIN: RequestEnvelope = { token: "tok_cfo_login", tenant: "org_456" };
      const answer = await withPlanted("tok_cfo_login", login, () =>
        approves(w, LOGIN, uri, payload_hash),
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: '"proposal.approve" is accepted only from a person, on their own login',
      });
      expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
    },
  );
});

describe("C5: a quorum counts distinct people (step 30's README, decision D8)", () => {
  // Above 25,000 USD, two CFOs: a rule a test writes, as the store keeps it.
  const TWO_CFOS: Control = {
    ...shippedRule(),
    effect: { require_approval: { role: "CFO", quorum: 2 } },
  };
  // A second CFO of org_456, planted as step 29's tests plant one.
  const CFO_200: RequestEnvelope = { token: "tok_cfo200", tenant: "org_456" };
  const cfo200 = {
    id: "cfo_200",
    type: "human",
    memberships: [{ tenant_id: "org_456", roles: ["CFO"] }],
  } as unknown as Principal;

  it("DSOR-SOD-04c: INV-1008 waits for two CFOs: cfo_100's second approval counts for nothing, CONFLICT, and only cfo_200's makes it APPROVED, with two approvals by two people", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(TWO_CFOS));
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      outcome: "COMMITTED",
      data: { state: "PENDING_APPROVAL" },
    });
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      code: "CONFLICT",
      message: `cfo_100 approved proposal ${id} already`,
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 1 });
    const second = await withPlanted("tok_cfo200", cfo200, () =>
      approves(w, CFO_200, uri, payload_hash),
    );
    expect(second).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    const given = await w.proposals.approvals("org_456", id);
    expect(given.flatMap((a) => a.approvers.map((p) => p.principal))).toStrictEqual([
      "cfo_100",
      "cfo_200",
    ]);
  });
});
