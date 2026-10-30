// DSoR keeps each approval (step 29's README, claims C4 and C5, decisions D3, D7, D8, D9, and
// D11). An approval is one person's yes to one waiting proposal, in approval.schema.json's shape.
// The store keeps it and, when it is the last one the proposal waits for, moves the proposal to
// APPROVED, in one step. These tests use the store in memory; test/approvals.db.test.ts uses the
// database.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  approvalOf,
  stillOpen,
  type Approval,
  type Bindable,
  type Offer,
} from "../src/approvals.ts";
import type { Requirement } from "../src/envelope.ts";
import { memoryProposals, type MoveBy, type ProposalDraft } from "../src/proposals.ts";

const CFO_BY_8: Requirement = {
  approval: { role: "CFO", quorum: 1 },
  control: "high-value-payment",
  control_version: 8,
};
const ADMIN_BY_1: Requirement = {
  approval: { role: "tenant_admin", quorum: 1 },
  control: "admin-above-30000",
  control_version: 1,
};
const INV_1008 = "dsor://org_456/invoice/INV-1008";

const DRAFT: ProposalDraft = {
  operation: "payment.create@1",
  mode: "execute",
  payload: { invoice: INV_1008, expected_version: 1 },
  payload_hash: `sha256:${"0".repeat(64)}`,
  resources: [INV_1008],
  requester: {
    identity_mode: "unattended",
    subject: "user_123",
    subject_type: "human",
    actor_chain: ["accounts-payable-fte"],
    active_tenant: "org_456",
    delegation: "del_100",
    subject_authority: { source: "role_source", as_of: "2026-10-13T09:00:00.000Z" },
  },
  idempotency_key: "pay-INV-1008",
};
const BY_AGENT: MoveBy = {
  mover: {
    mode: "unattended",
    subject: "user_123",
    actor_chain: ["accounts-payable-fte"],
    subject_authority: { source: "role_source", as_of: "2026-10-13T09:00:00.000Z" },
  },
  cause: "a control asked for an approval",
  correlation: { request_id: "req_draft" },
};

/** Who approves, and why the move to APPROVED happens: a person's own call. */
function byPerson(person: string): MoveBy {
  return {
    mover: {
      mode: "direct",
      subject: person,
      actor_chain: [],
      subject_authority: { source: "token", as_of: "2026-10-13T09:05:00.000Z" },
    },
    cause: `approved by ${person}`,
    correlation: { request_id: `req_${person}` },
  };
}

/** What a person offers: a new approval id, and their roles in org_456. */
function offerBy(person: string, roles: string[], id = `apr_${randomUUID()}`): Offer {
  return {
    id,
    risk: "medium",
    bound_state: { mode: "predicate", versions: { [INV_1008]: 1 } },
    approver: person,
    roles,
    at: "2026-10-13T09:05:00.000Z",
  };
}

/** A store in memory with one proposal of org_456 that waits for these requirements. */
async function waitingFor(...requires: Requirement[]) {
  let clock = Date.parse("2026-10-13T09:00:00.000Z");
  const store = memoryProposals(() => clock);
  await store.create("org_456", "prop_1008", DRAFT, BY_AGENT, "P7D");
  await store.move("org_456", "prop_1008", "PROPOSED", "PENDING_APPROVAL", BY_AGENT, requires);
  return {
    store,
    later: (ms: number) => {
      clock += ms;
    },
  };
}

/** The proposal that approvalOf binds, as a store reads it. */
const BINDABLE: Bindable = {
  uri: "dsor://org_456/proposal/prop_1008",
  tenant: "org_456",
  operation: "payment.create@1",
  resources: [INV_1008],
  payload_hash: DRAFT.payload_hash,
  expires_at: "2026-10-20T09:00:00.000Z",
  requires: [ADMIN_BY_1, CFO_BY_8],
};

describe("C5: the count of approvals (step 29's README, decisions D3 and D9)", () => {
  it("Step 29: an approval's id is apr_ and a random UUID, as the database's CHECK keeps it", () => {
    expect(() => approvalOf(BINDABLE, [], offerBy("cfo_100", ["CFO"], "apr_cfo_100"))).toThrow(
      '"apr_cfo_100" is not an approval\'s id: apr_ and a random UUID',
    );
  });

  it("DSOR-AUT-02c: a proposal waits until every requirement has its quorum: none given, both open; the CFO's, the administrator's still open; both, none", () => {
    const cfo = approvalOf(BINDABLE, [], offerBy("cfo_100", ["CFO"])) as Approval;
    const admin = approvalOf(BINDABLE, [cfo], offerBy("admin_100", ["tenant_admin"])) as Approval;
    expect(stillOpen(BINDABLE.requires, [])).toStrictEqual([ADMIN_BY_1, CFO_BY_8]);
    expect(stillOpen(BINDABLE.requires, [cfo])).toStrictEqual([ADMIN_BY_1]);
    expect(stillOpen(BINDABLE.requires, [cfo, admin])).toStrictEqual([]);
  });

  it("Step 29: an approval counts for the rule's version it names: one for version 7 leaves version 8's requirement open", () => {
    const by7 = approvalOf(
      { ...BINDABLE, requires: [{ ...CFO_BY_8, control_version: 7 }] },
      [],
      offerBy("cfo_100", ["CFO"]),
    );
    expect(stillOpen([CFO_BY_8], [by7 as Approval])).toStrictEqual([CFO_BY_8]);
  });

  // Found by step 29's review, finding M4: an approval matched its requirement by version alone,
  // and every test passed, since no two rules shared a version.
  it("DSOR-AUT-02c: an approval counts for the rule it names: with two rules both at version 8, the CFO's approval leaves the tenant administrator's open", () => {
    const admin8 = { ...ADMIN_BY_1, control_version: 8 };
    const proposal = { ...BINDABLE, requires: [admin8, CFO_BY_8] };
    const cfo = approvalOf(proposal, [], offerBy("cfo_100", ["CFO"])) as Approval;
    expect(stillOpen([admin8, CFO_BY_8], [cfo])).toStrictEqual([admin8]);
  });

  it("DSOR-AUT-02c: a quorum of two needs two approvers: one CFO leaves it open", () => {
    const two = { ...CFO_BY_8, approval: { role: "CFO", quorum: 2 } };
    const proposal = { ...BINDABLE, requires: [two] };
    const first = approvalOf(proposal, [], offerBy("cfo_100", ["CFO"])) as Approval;
    expect(stillOpen([two], [first])).toStrictEqual([two]);
    const second = approvalOf(proposal, [first], offerBy("cfo_200", ["CFO"])) as Approval;
    expect(stillOpen([two], [first, second])).toStrictEqual([]);
  });

  it("Step 29: one approval satisfies each open requirement whose role the approver holds, and its basis names those roles", () => {
    const both = approvalOf(BINDABLE, [], offerBy("boss_1", ["CFO", "tenant_admin", "ap_clerk"]));
    expect(both).toMatchObject({
      satisfies: [
        {
          control: "admin-above-30000",
          version: 1,
          requirement: { role: "tenant_admin", quorum: 1 },
        },
        { control: "high-value-payment", version: 8, requirement: { role: "CFO", quorum: 1 } },
      ],
      approvers: [
        {
          principal: "boss_1",
          basis: "role:tenant_admin, role:CFO",
          authn: { at: "2026-10-13T09:05:00.000Z" },
        },
      ],
    });
  });

  it("Step 29: one person counts once for one proposal, and an approver whose roles are all satisfied already makes no approval", () => {
    const cfo = approvalOf(BINDABLE, [], offerBy("cfo_100", ["CFO"])) as Approval;
    expect(approvalOf(BINDABLE, [cfo], offerBy("cfo_100", ["CFO", "tenant_admin"]))).toBe("twice");
    expect(approvalOf(BINDABLE, [cfo], offerBy("cfo_200", ["CFO"]))).toBe("nothing_open");
    expect(approvalOf(BINDABLE, [], offerBy("user_123", ["ap_supervisor"]))).toBe("nothing_open");
  });

  it("Step 29: the approval binds the proposal's own request, whatever the offer is: its URI, operation, resources, and fingerprint", () => {
    const offer = offerBy("cfo_100", ["CFO"]);
    expect(approvalOf(BINDABLE, [], offer)).toMatchObject({
      id: offer.id,
      proposal: "dsor://org_456/proposal/prop_1008",
      operation: "payment.create@1",
      tenant: "org_456",
      resources: [INV_1008],
      payload_hash: DRAFT.payload_hash,
      sod_mode: "standard",
      status: "active",
    });
  });
});

describe("C5: the store's one step: the approval, and the move to APPROVED when it is the last (step 29's README, decision D9)", () => {
  it("Step 29: cfo_100 approves INV-1008's proposal, which waits for one CFO: the store keeps the approval, and moves the proposal to APPROVED, with the move's record", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    const offer = offerBy("cfo_100", ["CFO"]);
    const done = await store.approve("org_456", "prop_1008", offer, byPerson("cfo_100"));
    expect(done).toMatchObject({ state: "APPROVED", waits_for: [], approval: { id: offer.id } });
    const kept = await store.get("org_456", "prop_1008");
    expect(kept?.state).toBe("APPROVED");
    expect(kept?.approvals).toStrictEqual([offer.id]);
    expect(kept?.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      actor: "cfo_100",
      cause: "approved by cfo_100",
    });
    expect(await store.approvals("org_456", "prop_1008")).toStrictEqual([
      (done as { approval: Approval }).approval,
    ]);
  });

  it("DSOR-AUT-02c: INV-1008 waits for the CFO and a tenant administrator: after cfo_100 it still waits, for the administrator; after admin_100 it is APPROVED", async () => {
    const { store } = await waitingFor(ADMIN_BY_1, CFO_BY_8);
    const cfo = offerBy("cfo_100", ["CFO"]);
    const admin = offerBy("admin_100", ["tenant_admin"]);
    expect(await store.approve("org_456", "prop_1008", cfo, byPerson("cfo_100"))).toMatchObject({
      state: "PENDING_APPROVAL",
      waits_for: [ADMIN_BY_1],
    });
    expect((await store.get("org_456", "prop_1008"))?.state).toBe("PENDING_APPROVAL");
    expect(await store.approve("org_456", "prop_1008", admin, byPerson("admin_100"))).toMatchObject(
      { state: "APPROVED", waits_for: [] },
    );
    const kept = await store.get("org_456", "prop_1008");
    expect(kept?.approvals).toStrictEqual([cfo.id, admin.id]);
    expect(kept?.transitions.at(-1)).toMatchObject({ to: "APPROVED", actor: "admin_100" });
  });

  it("Step 29: the store keeps no second approval by one person, and none that satisfies nothing, and the proposal stays where it was", async () => {
    const { store } = await waitingFor(ADMIN_BY_1, CFO_BY_8);
    const first = offerBy("cfo_100", ["CFO"]);
    await store.approve("org_456", "prop_1008", first, byPerson("cfo_100"));
    expect(
      await store.approve("org_456", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100")),
    ).toStrictEqual({ refused: "twice" });
    expect(
      await store.approve("org_456", "prop_1008", offerBy("cfo_200", ["CFO"]), byPerson("cfo_200")),
    ).toStrictEqual({ refused: "nothing_open" });
    const kept = await store.get("org_456", "prop_1008");
    expect([kept?.state, kept?.approvals]).toStrictEqual(["PENDING_APPROVAL", [first.id]]);
  });

  it.each([
    ["APPROVED", ["APPROVED"]],
    ["CANCELLED", ["CANCELLED"]],
    ["EXPIRED", ["EXPIRED"]],
  ] as const)(
    "Step 29: a proposal that no longer waits is not approved: one that is %s keeps no new approval",
    async (state, path) => {
      const { store } = await waitingFor(CFO_BY_8);
      for (const to of path)
        await store.move("org_456", "prop_1008", "PENDING_APPROVAL", to, BY_AGENT);
      expect(
        await store.approve(
          "org_456",
          "prop_1008",
          offerBy("cfo_100", ["CFO"]),
          byPerson("cfo_100"),
        ),
      ).toStrictEqual({ refused: "moved", state });
      expect(await store.approvals("org_456", "prop_1008")).toStrictEqual([]);
    },
  );

  it("Step 29: a READY proposal, which never waited, is not approved, and neither is one that is not there", async () => {
    const store = memoryProposals();
    await store.create("org_456", "prop_ready", DRAFT, BY_AGENT, "P7D");
    await store.move("org_456", "prop_ready", "PROPOSED", "READY", BY_AGENT);
    const offer = offerBy("cfo_100", ["CFO"]);
    expect(await store.approve("org_456", "prop_ready", offer, byPerson("cfo_100"))).toStrictEqual({
      refused: "moved",
      state: "READY",
    });
    expect(await store.approve("org_456", "prop_none", offer, byPerson("cfo_100"))).toStrictEqual({
      refused: "moved",
    });
  });

  it("DSOR-APR-04a: a waiting proposal whose time has come is not approved, though no sweep has moved it yet", async () => {
    const { store, later } = await waitingFor(CFO_BY_8);
    later(7 * 24 * 60 * 60 * 1000);
    expect(
      await store.approve("org_456", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100")),
    ).toStrictEqual({ refused: "expired" });
    const kept = await store.get("org_456", "prop_1008");
    expect([kept?.state, "approvals" in kept!]).toStrictEqual(["PENDING_APPROVAL", false]);
  });

  it("DSOR-APR-04a: an approval expires with its proposal, no later than 30 days after it was given", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    const done = await store.approve(
      "org_456",
      "prop_1008",
      offerBy("cfo_100", ["CFO"]),
      byPerson("cfo_100"),
    );
    const approval = (done as { approval: Approval }).approval;
    const proposal = await store.get("org_456", "prop_1008");
    expect(approval.expires_at).toBe(proposal?.expires_at);
    const at = Date.parse(approval.approvers[0]!.authn.at);
    expect(Date.parse(approval.expires_at) - at).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
  });

  it("DSOR-TEN-01b: org_789 sees no approval of org_456's, and cannot approve its proposal", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    expect(
      await store.approve("org_789", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100")),
    ).toStrictEqual({ refused: "moved" });
    await store.approve("org_456", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100"));
    expect(await store.approvals("org_789", "prop_1008")).toStrictEqual([]);
  });

  // Found by step 29's review, finding L6: the move's own check of its actor and cause was dropped,
  // and no test noticed.
  it("DSOR-APR-01b: the store's step refuses a move with no cause or no actor, and keeps nothing", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    const offer = offerBy("cfo_100", ["CFO"]);
    await expect(
      store.approve("org_456", "prop_1008", offer, { ...byPerson("cfo_100"), cause: " " }),
    ).rejects.toThrow("a move needs a cause");
    const nobody = byPerson("cfo_100");
    nobody.mover = { ...nobody.mover, subject: "" };
    await expect(store.approve("org_456", "prop_1008", offer, nobody)).rejects.toThrow(
      "a move needs an actor",
    );
    expect(await store.approvals("org_456", "prop_1008")).toStrictEqual([]);
  });

  it("Step 29: the store keeps its own copy: a caller that changes the approval afterwards changes nothing", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    const done = await store.approve(
      "org_456",
      "prop_1008",
      offerBy("cfo_100", ["CFO"]),
      byPerson("cfo_100"),
    );
    (done as { approval: Approval }).approval.approvers[0]!.principal = "agent";
    const [kept] = await store.approvals("org_456", "prop_1008");
    expect(kept?.approvers[0]?.principal).toBe("cfo_100");
  });
});

describe("C4: an approval, and the proposal it approves, pass the specification's schemas (step 29's README, decision D7)", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const schema = (file: string) =>
    JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), "utf8")) as object;
  // The step's copies of the specification's schemas, byte for byte (test/schemas.test.ts).
  ajv.addSchema(schema("common.schema.json"));
  ajv.addSchema(schema("security-context.schema.json"));
  const approvalSchema = ajv.compile(schema("approval.schema.json"));
  const proposalSchema = ajv.compile(schema("proposal.schema.json"));

  it("DSOR-APR-02a: cfo_100's approval, as DSoR keeps it, passes approval.schema.json", async () => {
    const { store } = await waitingFor(ADMIN_BY_1, CFO_BY_8);
    await store.approve("org_456", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100"));
    const [kept] = await store.approvals("org_456", "prop_1008");
    expect(approvalSchema(kept) ? [] : approvalSchema.errors).toStrictEqual([]);
  });

  it("DSOR-SCH-01: the proposal it approved, with its list of approvals, passes proposal.schema.json", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    await store.approve("org_456", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100"));
    const kept = await store.get("org_456", "prop_1008");
    expect(proposalSchema(kept) ? [] : proposalSchema.errors).toStrictEqual([]);
  });

  it("DSOR-APR-02a: the schema itself refuses an approval without its fingerprint, or of a critical operation bound in predicate mode", async () => {
    const { store } = await waitingFor(CFO_BY_8);
    await store.approve("org_456", "prop_1008", offerBy("cfo_100", ["CFO"]), byPerson("cfo_100"));
    const [kept] = await store.approvals("org_456", "prop_1008");
    const { payload_hash: _gone, ...without } = kept!;
    expect(approvalSchema(without)).toBe(false);
    expect(approvalSchema({ ...kept, risk: "critical" })).toBe(false);
  });
});
