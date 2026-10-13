// proposal.approve, the command (step 29's README, claims C2 and C3, decisions D1 to D14). A person
// approves a waiting proposal on their own login, with its fingerprint. The agent drafts INV-1008,
// 31,400.00 USD, which waits for the CFO, by version 8 of high-value-payment.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  contract,
  DEL_101,
  FIRM_IN_456,
  FIRM_IN_789,
  FOREIGN_URI,
  keyed,
  rolesFile,
  shippedWith,
  STARTING_ROLES,
  SUPERVISOR,
  withPlanted,
} from "./helpers.ts";
import {
  ADMIN_700,
  heard,
  ruleWorldOnTuesday,
  shippedRule,
  T0,
  type RuleWorld,
} from "./rule-world.ts";

const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };

// A second rule of org_456: above 30,000 USD, one approval by a tenant administrator (decision D15).
const ADMIN_ABOVE_30000: Control = {
  ...shippedRule(),
  id: "admin-above-30000",
  version: 1,
  condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
  effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
};

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]): ControlsSource {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The agent drafts this bill, and the test reads its proposal as an approval screen would. */
async function drafted(w: RuleWorld, invoice: string) {
  const answer = await w.draft(invoice);
  const id = idOf(answer);
  const kept = await w.proposals.get("org_456", id);
  if (kept === undefined) throw new Error("no proposal");
  return { answer, id, uri: kept.uri, payload_hash: kept.payload_hash };
}

/** One approval call, with a fresh key unless the envelope names one. */
function approves(
  w: RuleWorld,
  who: RequestEnvelope,
  proposal: string,
  payload_hash: string,
): Promise<Answer> {
  const envelope = "idempotency_key" in who ? who : keyed(who);
  return w.ask(envelope, "proposal.approve", { proposal, payload_hash });
}

/** The proposal's state, and its approvals, as DSoR keeps them. */
async function stateOf(w: RuleWorld, id: string) {
  const kept = await w.proposals.get("org_456", id);
  return { state: kept?.state, approvals: (await w.proposals.approvals("org_456", id)).length };
}

describe("C2: only a person, in person, approves (step 29's README, decisions D2, D3, and D10)", () => {
  it("DSOR-APR-05a: the agent cannot approve its own proposal: line ⑤ refuses it, for people only, and INV-1008 still waits", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, AGENT, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is for people only, and accounts-payable-fte is not a person',
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  it("DSOR-APR-05a: a system login, dsor-scheduler, cannot approve either", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, SCHEDULER, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is for people only, and dsor-scheduler is not a person',
    });
  });

  // Line ⑤ refuses every caller that is not a person, by the contract's people_only, so line ⑨'s
  // own check of the identity mode is reached only by a contract that lost that flag.
  it("DSOR-APR-05a: line ⑨ checks the call's identity mode itself: with people_only gone from the contract, an agent under a slip that cfo_100 signed, listing proposal:approve, passes line ⑤ and is refused at line ⑨", async () => {
    const { extensions: _gone, ...approve } = contract("proposal.approve");
    const bySigner = { ...DEL_101, delegator: "cfo_100", permissions: ["proposal:approve"] };
    const w = await ruleWorldOnTuesday(undefined, [bySigner], undefined, shippedWith(approve));
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, FIRM_IN_456, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"proposal.approve" is accepted only in direct identity mode, on the approver\'s own login',
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  // Every call of a command is a proposal, an approval's too, and proposal.approve names no
  // approve_permission.
  it("DSOR-APR-07: a proposal whose operation names no approve_permission is approved by no one: the proposal of cfo_100's own approval call", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    const call = await approves(w, CFO, uri, payload_hash);
    const own = await w.proposals.get("org_456", idOf(call));
    expect(own?.operation).toBe("proposal.approve@1");
    expect(await approves(w, CFO, own!.uri, own!.payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "proposal.approve@1 names no approve_permission, so no one approves it",
    });
  });

  it("Step 29: user_123, the supervisor, holds no proposal:approve, so line ⑤ refuses her", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, SUPERVISOR, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  it("Step 29: admin_100 may approve payments, and INV-1008 waits for the CFO: AUTHORIZATION_DENIED, and it still waits", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, ADMIN, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `admin_100 holds none of the roles proposal ${id} waits for: CFO`,
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  it("DSOR-APR-07: the permission that decides is payment.create's approve_permission: a CFO role without payment:approve cannot approve, though it holds proposal:approve", async () => {
    const roles = JSON.parse(
      readFileSync(new URL("../roles.json", import.meta.url), "utf8"),
    ) as Record<string, string[]>;
    roles["CFO"] = roles["CFO"]!.filter((permission) => permission !== "payment:approve");
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, undefined, undefined, {
      file: "roles.json",
      text: JSON.stringify(roles),
    });
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "cfo_100 may not approve payment.create@1: it needs payment:approve",
    });
  });

  it("Step 29: a proposal that is not there is RESOURCE_NOT_FOUND, and one of org_789's is refused at line ②, before any look", async () => {
    const w = await ruleWorldOnTuesday();
    const { payload_hash } = await drafted(w, "INV-1008");
    const none = "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000000";
    expect(await approves(w, CFO, none, payload_hash)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    const theirs = "dsor://org_789/proposal/prop_00000000-0000-4000-8000-000000000000";
    expect(await approves(w, CFO, theirs, payload_hash)).toMatchObject({
      code: "TENANT_MISMATCH",
      message: FOREIGN_URI,
    });
  });
});

describe("C3: only the request with that fingerprint, only a waiting proposal, only once by each person (step 29's README, decisions D5 and D9)", () => {
  it("DSOR-APR-09: cfo_100 approves INV-1008's proposal with the fingerprint of another request, INV-1012's: APPROVAL_MISMATCH, and it still waits, with no approval", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await drafted(w, "INV-1008");
    const other = await drafted(w, "INV-1012");
    expect(await approves(w, CFO, uri, other.payload_hash)).toMatchObject({
      code: "APPROVAL_MISMATCH",
      message: `the fingerprint is not the one of proposal ${id}'s request`,
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  it("DSOR-APR-09: the fingerprint is the stored request's: SHA-256 over its canonical JSON, which the approver can compute from the request itself", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    const request = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    expect(payloadHash(request)).toBe(payload_hash);
    expect(await approves(w, CFO, uri, payloadHash(request))).toMatchObject({
      outcome: "COMMITTED",
    });
  });

  it("Step 29: cfo_100 approves INV-1008's proposal with its own fingerprint: it is APPROVED, and the answer names the approval, the state, nothing more to wait for, and the expiry", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const answer = await approves(w, CFO, uri, payload_hash);
    const proposal = await w.proposals.get("org_456", id);
    const [approval] = await w.proposals.approvals("org_456", id);
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: {
        tenant_id: "org_456",
        id: approval?.id,
        proposal: uri,
        state: "APPROVED",
        waits_for: [],
        expires_at: proposal?.expires_at,
      },
    });
    expect(approval?.id).toMatch(/^apr_[0-9a-f-]{36}$/);
    expect(proposal?.state).toBe("APPROVED");
  });

  it("DSOR-APR-01b: the move to APPROVED is recorded with its actor, cfo_100, and its cause", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    await approves(w, CFO, uri, payload_hash);
    expect((await w.proposals.get("org_456", id))?.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      actor: "cfo_100",
      cause: "approved by cfo_100",
    });
  });

  it("DSOR-APR-02a: the approval the call made passes approval.schema.json: INV-1008 at version 1, medium risk, version 8 of high-value-payment, cfo_100 on the basis role:CFO", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    await approves(w, CFO, uri, payload_hash);
    const [approval] = await w.proposals.approvals("org_456", id);
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schema = (file: string) =>
      JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), "utf8")) as object;
    ajv.addSchema(schema("common.schema.json"));
    const validate = ajv.compile(schema("approval.schema.json"));
    expect(validate(approval) ? [] : validate.errors).toStrictEqual([]);
    expect(approval).toMatchObject({
      operation: "payment.create@1",
      resources: ["dsor://org_456/invoice/INV-1008"],
      payload_hash,
      risk: "medium",
      bound_state: { mode: "predicate", versions: { "dsor://org_456/invoice/INV-1008": 1 } },
      satisfies: [
        { control: "high-value-payment", version: 8, requirement: { role: "CFO", quorum: 1 } },
      ],
      approvers: [{ principal: "cfo_100", basis: "role:CFO" }],
      sod_mode: "standard",
      status: "active",
    });
  });

  it("Step 29: cfo_100 approves again, with a new key: CONFLICT, it is APPROVED; and the same key again answers as the first call did", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const first = keyed(CFO);
    const answer = await approves(w, first, uri, payload_hash);
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${id} is APPROVED, and only a PENDING_APPROVAL proposal is approved`,
    });
    expect(await approves(w, first, uri, payload_hash)).toMatchObject({
      outcome: "COMMITTED",
      data: (answer as { data: unknown }).data,
    });
    expect((await stateOf(w, id)).approvals).toBe(1);
  });

  it("Step 29: a proposal that never waited is not approved: INV-1012's payment, 22,750.00 USD, is COMMITTED, and its approval hears CONFLICT", async () => {
    const w = await ruleWorldOnTuesday();
    const other = await drafted(w, "INV-1012");
    expect(other.answer).toMatchObject({ outcome: "COMMITTED" });
    expect(await approves(w, CFO, other.uri, other.payload_hash)).toMatchObject({
      code: "CONFLICT",
    });
  });

  it("DSOR-AUT-02c: with admin-above-30000 on too, INV-1008 waits for both: after cfo_100 it still waits, for a tenant administrator; cfo_100 again hears CONFLICT; after admin_100 it is APPROVED", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(shippedRule(), ADMIN_ABOVE_30000));
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      outcome: "COMMITTED",
      data: {
        state: "PENDING_APPROVAL",
        waits_for: [
          {
            approval: { role: "tenant_admin", quorum: 1 },
            control: "admin-above-30000",
            control_version: 1,
          },
        ],
      },
    });
    expect(await approves(w, CFO, uri, payload_hash)).toMatchObject({
      code: "CONFLICT",
      message: `cfo_100 approved proposal ${id} already`,
    });
    expect(await approves(w, ADMIN, uri, payload_hash)).toMatchObject({
      outcome: "COMMITTED",
      data: { state: "APPROVED", waits_for: [] },
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "APPROVED", approvals: 2 });
  });

  it("Step 29: an approved proposal waits: nothing executes it, and no payment is drafted (step 31 builds proposal.execute)", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    await approves(w, CFO, uri, payload_hash);
    expect(w.drafted).toStrictEqual([]);
  });

  it("Step 29: a dry run of cfo_100's approval says ALLOW and approves nothing; with another fingerprint it hears what the real call hears", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const dry = { ...CFO, mode: "validate_only" as const };
    expect(await w.ask(dry, "proposal.approve", { proposal: uri, payload_hash })).toMatchObject({
      outcome: "VALIDATED",
      decision: "ALLOW",
    });
    const other = `sha256:${"0".repeat(64)}`;
    expect(
      await w.ask(dry, "proposal.approve", { proposal: uri, payload_hash: other }),
    ).toMatchObject({ code: "APPROVAL_MISMATCH" });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  it("DSOR-APR-05b: an approval never travels through the agent: payment.create's input has no place for one, and line ⑥ refuses it", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(keyed(AGENT), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
      approved_by: "cfo_100",
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

// A second CFO of org_456, planted for the tests that need two people with one role.
const CFO_200: RequestEnvelope = { token: "tok_cfo200", tenant: "org_456" };
const cfo200 = {
  id: "cfo_200",
  type: "human",
  memberships: [{ tenant_id: "org_456", roles: ["CFO"] }],
} as unknown as Principal;

/** The decision record of the call that gave this answer. */
async function recordOf(w: RuleWorld, answer: Answer) {
  const records = await w.log.records();
  return records.find(
    (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
  );
}

describe("From step 29's review: line ⑨ says no before any work, and the store's own no reaches the caller", () => {
  // Found by the review, finding L2: the look never checked the time, so a dry run said yes where
  // the real call said no.
  it("DSOR-APR-04a: INV-1008's proposal, past its seven days and not yet swept, is refused at line ⑨: CONFLICT, the record says DENY, a dry run hears the same, and nothing is approved", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    w.clock.now = T0 + 7 * 24 * 60 * 60 * 1000;
    const answer = await approves(w, CFO, uri, payload_hash);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${id}'s time came at 2026-10-13T15:05:00.000Z, so it is not approved`,
    });
    expect((await recordOf(w, answer))?.authorization).toBe("DENY");
    const dry = { ...CFO, mode: "validate_only" as const };
    expect(await w.ask(dry, "proposal.approve", { proposal: uri, payload_hash })).toMatchObject({
      code: "CONFLICT",
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  // Found by the review, finding L7: the store checks again what line ⑨ checks, with the same
  // words, so a look that lost a check still refused, after the work began. Only the record shows
  // where the no came from.
  it("Step 29: line ⑨'s refusals come before any work, so their records say DENY: cfo_100 approving twice, and a second CFO when only a tenant administrator is still asked for", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(shippedRule(), ADMIN_ABOVE_30000));
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    await approves(w, CFO, uri, payload_hash);
    const twice = await approves(w, CFO, uri, payload_hash);
    expect(twice).toMatchObject({
      code: "CONFLICT",
      message: `cfo_100 approved proposal ${id} already`,
    });
    expect((await recordOf(w, twice))?.authorization).toBe("DENY");
    const second = await withPlanted("tok_cfo200", cfo200, () =>
      approves(w, CFO_200, uri, payload_hash),
    );
    expect(second).toMatchObject({
      code: "CONFLICT",
      message: `what cfo_200 may approve of proposal ${id} is approved already`,
    });
    expect((await recordOf(w, second))?.authorization).toBe("DENY");
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 1 });
  });

  // Found by the review, finding M6: no test reached the store's own refusal. Two CFOs approve at
  // the same moment: both looks find the proposal waiting, and the store gives the approval to the
  // first only.
  it("Step 29: cfo_100 and cfo_200 approve INV-1008 at the same moment: one is approved, and the other hears CONFLICT from the store, with no approval kept", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const answers = await withPlanted("tok_cfo200", cfo200, () =>
      Promise.all([approves(w, CFO, uri, payload_hash), approves(w, CFO_200, uri, payload_hash)]),
    );
    expect(answers.map(heard).sort()).toStrictEqual(["COMMITTED", "CONFLICT"]);
    expect(answers).toContainEqual(
      expect.objectContaining({
        code: "CONFLICT",
        message: `proposal ${id} moved on to APPROVED while it was being approved`,
      }),
    );
    expect(await stateOf(w, id)).toStrictEqual({ state: "APPROVED", approvals: 1 });
  });
});

// A person of two companies, planted for the tests of which company's roles count.
const TWO_COMPANIES: RequestEnvelope = { token: "tok_two", tenant: "org_456" };
function inTwo(in456: string[]): Principal {
  return {
    id: "two_100",
    type: "human",
    memberships: [
      { tenant_id: "org_456", roles: in456 },
      { tenant_id: "org_789", roles: ["CFO"] },
    ],
  } as unknown as Principal;
}

describe("From step 29's review: only the call's own company counts, and each field of an approval has its source", () => {
  // Found by the review, finding M5: roles from every company, in the work, passed every test.
  it("Step 29: a tenant administrator of org_456 who is CFO in org_789 approves INV-1008, which waits for both: only org_456's role counts, and it still waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(shippedRule(), ADMIN_ABOVE_30000));
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const answer = await withPlanted("tok_two", inTwo(["tenant_admin"]), () =>
      approves(w, TWO_COMPANIES, uri, payload_hash),
    );
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: {
        state: "PENDING_APPROVAL",
        waits_for: [
          {
            approval: { role: "CFO", quorum: 1 },
            control: "high-value-payment",
            control_version: 8,
          },
        ],
      },
    });
    const [approval] = await w.proposals.approvals("org_456", id);
    expect(approval?.approvers).toMatchObject([
      { principal: "two_100", basis: "role:tenant_admin" },
    ]);
  });

  // Found by the review, finding M5: the look's permissions from every company passed every test.
  it("DSOR-APR-07: a person whose org_456 role may call proposal.approve and who is CFO in org_789 cannot approve in org_456: org_456's permissions lack payment:approve", async () => {
    const roles = rolesFile({ ...STARTING_ROLES, approver_clerk: ["proposal:approve"] });
    const w = await ruleWorldOnTuesday(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      roles,
    );
    const { uri, payload_hash } = await drafted(w, "INV-1008");
    const answer = await withPlanted("tok_two", inTwo(["approver_clerk"]), () =>
      approves(w, TWO_COMPANIES, uri, payload_hash),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "two_100 may not approve payment.create@1: it needs payment:approve",
    });
  });

  // Found by the review, finding M5: no approval ran in org_789, so the look's permissions read
  // from org_456 always passed every test.
  it("Step 29: in org_789, firm-ap-fte's payment of INV-2002, 3,300.00 USD, waits for a tenant administrator of a rule of org_789's own, and admin_700 approves it", async () => {
    const rule789: Control = {
      ...shippedRule(),
      id: "admin-above-1000",
      version: 1,
      owner: "admin_700",
      reviewed_by: "admin_700",
      authority: { system: "local" },
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("1000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
    };
    const controls = {
      file: "controls.json",
      text: JSON.stringify({ org_456: [shippedRule()], org_789: [rule789] }),
    };
    const w = await ruleWorldOnTuesday(controls);
    const answer = await w.ask(keyed(FIRM_IN_789), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-2002",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const id = idOf(answer);
    const kept = await w.proposals.get("org_789", id);
    expect(
      await w.ask(keyed(ADMIN_700), "proposal.approve", {
        proposal: kept!.uri,
        payload_hash: kept!.payload_hash,
      }),
    ).toMatchObject({ outcome: "COMMITTED", data: { tenant_id: "org_789", state: "APPROVED" } });
  });

  // Found by the review, finding L5: the approval's risk, its binding mode, and its time had no
  // test of where they come from.
  it.each([
    ["high", "predicate"],
    ["critical", "strict_version"],
  ])(
    "DSOR-APR-02a: on a %s-risk payment.create, the approval names that risk, and binds the state in %s mode",
    async (level, mode) => {
      const rated = { ...contract("payment.create"), risk: { level } };
      const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(rated));
      const { id, uri, payload_hash } = await drafted(w, "INV-1008");
      await approves(w, CFO, uri, payload_hash);
      const [approval] = await w.proposals.approvals("org_456", id);
      expect([approval?.risk, approval?.bound_state.mode]).toStrictEqual([level, mode]);
    },
  );

  it("DSOR-APR-02a: the approver's authn.at is the time of the call", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const before = Date.now();
    await approves(w, CFO, uri, payload_hash);
    const after = Date.now();
    const [approval] = await w.proposals.approvals("org_456", id);
    const at = Date.parse(approval!.approvers[0]!.authn.at);
    expect(at >= before && at <= after).toBe(true);
  });
});

describe("From step 29's review: a proposal's address that names no proposal", () => {
  // Found by the review, finding L1: an address whose id is not a proposal's reached line ⑨'s
  // parse, which threw, so the answer was INTERNAL_ERROR. The input schema stays loose: the
  // cross-tenant suite sends another company's address with an id it does not have, and expects
  // TENANT_MISMATCH before line ⑥ looks at the id.
  it.each([
    ["a name for an id", "dsor://org_456/proposal/foo"],
    [
      "an id in capital letters",
      "dsor://org_456/proposal/prop_ABCDEF01-2345-4678-89AB-0123456789AB",
    ],
  ])(
    "Step 29: %s is no proposal of org_456: RESOURCE_NOT_FOUND at line ⑨, recorded DENY",
    async (_what, proposal) => {
      const w = await ruleWorldOnTuesday();
      const { payload_hash } = await drafted(w, "INV-1008");
      const answer = await approves(w, CFO, proposal, payload_hash);
      expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
      expect((await recordOf(w, answer))?.authorization).toBe("DENY");
    },
  );

  it("Step 29: an invoice's address is no proposal's: line ⑥ refuses it, VALIDATION_FAILED", async () => {
    const w = await ruleWorldOnTuesday();
    const { payload_hash } = await drafted(w, "INV-1008");
    expect(await approves(w, CFO, "dsor://org_456/invoice/INV-1008", payload_hash)).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("From step 29's review: only a person's own call is approval evidence", () => {
  // Found by the review, finding L4: line ⑨'s own look stopped agents, and a system login calls in
  // direct mode. With the contract's people_only lost, a system login holding the CFO's role
  // approved.
  it("DSOR-APR-05a: with people_only gone from the contract, a system login that holds the CFO's role passes line ⑤, and line ⑨ refuses it: not a person", async () => {
    const { extensions: _gone, ...approve } = contract("proposal.approve");
    const w = await ruleWorldOnTuesday(undefined, undefined, undefined, shippedWith(approve));
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const system = {
      id: "dsor-approver",
      type: "system",
      memberships: [{ tenant_id: "org_456", roles: ["CFO"] }],
    } as unknown as Principal;
    const SYSTEM: RequestEnvelope = { token: "tok_system_cfo", tenant: "org_456" };
    const answer = await withPlanted("tok_system_cfo", system, () =>
      approves(w, SYSTEM, uri, payload_hash),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is accepted only from a person, on their own login',
    });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });

  // Found by the review, finding M7: the test of DSOR-APR-05b looked at payment.create's input.
  // These look at proposal.approve itself: the agent names cfo_100 wherever it can, in each mode,
  // and cfo_100's own call cannot name another approver.
  it.each(["execute", "propose_only", "validate_only"] as const)(
    "DSOR-APR-05b: in %s mode, the agent's call of proposal.approve that names cfo_100 as approver, subject, or on_behalf_of is refused, and no approval is kept",
    async (mode) => {
      const w = await ruleWorldOnTuesday();
      const { id, uri, payload_hash } = await drafted(w, "INV-1008");
      const envelope = mode === "validate_only" ? { ...AGENT, mode } : { ...keyed(AGENT), mode };
      for (const named of [
        { approver: "cfo_100" },
        { subject: "cfo_100" },
        { on_behalf_of: "cfo_100" },
      ]) {
        const answer = await w.ask(envelope, "proposal.approve", {
          proposal: uri,
          payload_hash,
          ...named,
        });
        expect("code" in answer && answer.code).toBe("AUTHORIZATION_DENIED");
      }
      expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
    },
  );

  it("DSOR-APR-05b: a person's own call cannot name another approver: cfo_100 naming admin_100 is refused at line ⑥, and no approval is kept", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri, payload_hash } = await drafted(w, "INV-1008");
    const answer = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: uri,
      payload_hash,
      approver: "admin_100",
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await stateOf(w, id)).toStrictEqual({ state: "PENDING_APPROVAL", approvals: 0 });
  });
});
