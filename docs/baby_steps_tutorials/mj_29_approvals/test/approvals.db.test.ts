// DSoR keeps each approval, on the database (step 29's README, claims C4 and C5, decisions D8, D9,
// and D11). dsor.approvals keeps each approval whole, in approval.schema.json's shape. dsor_runtime
// adds approvals and never changes or removes one. The approval and the move to APPROVED are one
// step, under the company's ending lock and the proposal's row lock, so two approvers at once never
// both leave a proposal waiting. A real PostgreSQL, never a mock.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, describe, expect, it } from "vitest";
import type { Approval, Approving, Offer } from "../src/approvals.ts";
import type { Requirement } from "../src/envelope.ts";
import { createDbProposals } from "../src/postgres.ts";
import type { MoveBy, ProposalDraft } from "../src/proposals.ts";
import { callsWaiting, newPool, NO_PRIVILEGE, ownerApprovals, tryThenRollBack } from "./db.ts";

const observer = newPool();
const pool = newPool();
const second = newPool();
const proposals = createDbProposals(pool);
const others = createDbProposals(second);
afterAll(async () => {
  await observer.end();
  await pool.end();
  await second.end();
});

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
const INV_9001 = "dsor://org_456/invoice/INV-9001";

const DRAFT: ProposalDraft = {
  operation: "payment.create@1",
  mode: "execute",
  payload: { invoice: INV_9001, expected_version: 1 },
  payload_hash: `sha256:${"e".repeat(64)}`,
  resources: [INV_9001],
  requester: {
    identity_mode: "unattended",
    subject: "user_123",
    subject_type: "human",
    actor_chain: ["intake-fte"],
    active_tenant: "org_456",
    delegation: "del_190",
    subject_authority: { source: "role_source", as_of: "2026-10-13T09:00:00.000Z" },
  },
  idempotency_key: "k-s29-approvals",
};
const BY_AGENT: MoveBy = {
  mover: {
    mode: "unattended",
    subject: "user_123",
    actor_chain: ["intake-fte"],
    subject_authority: { source: "role_source", as_of: "2026-10-13T09:00:00.000Z" },
  },
  cause: "a control asked for an approval",
  correlation: { request_id: "req_s29_approvals" },
};

/** A person's own call, which approves. */
function byPerson(person: string): MoveBy {
  return {
    mover: {
      mode: "direct",
      subject: person,
      actor_chain: [],
      subject_authority: { source: "token", as_of: new Date().toISOString() },
    },
    cause: `approved by ${person}`,
    correlation: { request_id: `req_${randomUUID()}` },
  };
}

/** What a person offers: a new approval id, and their roles in org_456. */
function offerBy(person: string, roles: string[]): Offer {
  return {
    id: `apr_${randomUUID()}`,
    risk: "medium",
    bound_state: { mode: "predicate", versions: { [INV_9001]: 1 } },
    approver: person,
    roles,
    at: new Date().toISOString(),
  };
}

/** A new proposal of org_456 that waits for these requirements, for this long. */
async function waitingFor(requires: Requirement[], lifetime = "P7D"): Promise<string> {
  const id = `prop_${randomUUID()}`;
  await proposals.create("org_456", id, DRAFT, BY_AGENT, lifetime);
  await proposals.move("org_456", id, "PROPOSED", "PENDING_APPROVAL", BY_AGENT, requires);
  return id;
}

/** cfo_100's approval, through the store on this pool. */
function cfoApproves(id: string, store = proposals): Promise<Approving> {
  return store.approve("org_456", id, offerBy("cfo_100", ["CFO"]), byPerson("cfo_100"));
}

/** One statement as dsor_runtime, in this company, always rolled back: its error, or "". */
async function asRuntime(
  sql: string,
  values: unknown[] = [],
  company = "org_456",
): Promise<string> {
  try {
    await tryThenRollBack(observer, sql, company, values);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

/** The moves to APPROVED that the log keeps for this proposal. */
async function approvedMoves(id: string): Promise<number> {
  const { rows } = await tryThenRollBack(
    observer,
    `SELECT count(*)::int AS n FROM dsor.audit
      WHERE kind = 'proposal_transition' AND result = 'APPROVED' AND resources = ARRAY[$1]::text[]`,
    "org_456",
    [`dsor://org_456/proposal/${id}`],
  );
  return Number(rows[0]?.["n"]);
}

describe("C4 and C5: on the database, DSoR keeps each approval (step 29's README, decisions D8 and D9)", () => {
  it("Step 29: on the database, cfo_100 approves a proposal that waits for one CFO: dsor.approvals keeps the approval, the proposal moves to APPROVED with its record, and names its approval", async () => {
    const id = await waitingFor([CFO_BY_8]);
    const done = await cfoApproves(id);
    expect(done).toMatchObject({ state: "APPROVED", waits_for: [] });
    const approval = (done as { approval: Approval }).approval;
    const kept = await proposals.get("org_456", id);
    expect(kept?.state).toBe("APPROVED");
    expect(kept?.approvals).toStrictEqual([approval.id]);
    expect(kept?.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      actor: "cfo_100",
      cause: "approved by cfo_100",
    });
    expect(await proposals.approvals("org_456", id)).toStrictEqual([approval]);
  });

  it("DSOR-APR-02a: on the database, the approval as dsor.approvals keeps it passes approval.schema.json, and binds the proposal's own request", async () => {
    const id = await waitingFor([CFO_BY_8]);
    await cfoApproves(id);
    const [kept] = await proposals.approvals("org_456", id);
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schema = (file: string) =>
      JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), "utf8")) as object;
    ajv.addSchema(schema("common.schema.json"));
    const validate = ajv.compile(schema("approval.schema.json"));
    expect(validate(kept) ? [] : validate.errors).toStrictEqual([]);
    expect(kept).toMatchObject({
      proposal: `dsor://org_456/proposal/${id}`,
      operation: "payment.create@1",
      tenant: "org_456",
      resources: [INV_9001],
      payload_hash: DRAFT.payload_hash,
      satisfies: [
        { control: "high-value-payment", version: 8, requirement: { role: "CFO", quorum: 1 } },
      ],
      approvers: [{ principal: "cfo_100", basis: "role:CFO" }],
      expires_at: (await proposals.get("org_456", id))?.expires_at,
    });
  });

  it("DSOR-AUT-02c: on the database, a proposal that waits for the CFO and a tenant administrator still waits after cfo_100, and is APPROVED after admin_100", async () => {
    const id = await waitingFor([ADMIN_BY_1, CFO_BY_8]);
    expect(await cfoApproves(id)).toMatchObject({
      state: "PENDING_APPROVAL",
      waits_for: [ADMIN_BY_1],
    });
    expect((await proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
    const admin = offerBy("admin_100", ["tenant_admin"]);
    expect(await proposals.approve("org_456", id, admin, byPerson("admin_100"))).toMatchObject({
      state: "APPROVED",
      waits_for: [],
    });
    expect(await approvedMoves(id)).toBe(1);
  });

  it("Step 29: on the database, no second approval by one person, none that satisfies nothing, and none of a proposal that no longer waits", async () => {
    const id = await waitingFor([ADMIN_BY_1, CFO_BY_8]);
    await cfoApproves(id);
    expect(await cfoApproves(id)).toStrictEqual({ refused: "twice" });
    const cfo200 = offerBy("cfo_200", ["CFO"]);
    expect(await proposals.approve("org_456", id, cfo200, byPerson("cfo_200"))).toStrictEqual({
      refused: "nothing_open",
    });
    expect(await proposals.approvals("org_456", id)).toHaveLength(1);
    const ready = `prop_${randomUUID()}`;
    await proposals.create("org_456", ready, DRAFT, BY_AGENT, "P7D");
    await proposals.move("org_456", ready, "PROPOSED", "READY", BY_AGENT);
    expect(await cfoApproves(ready)).toStrictEqual({ refused: "moved", state: "READY" });
  });

  it("DSOR-APR-04a: on the database, a waiting proposal whose time has come is not approved, though no sweep has moved it yet", async () => {
    const id = await waitingFor([CFO_BY_8], "PT1S");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await cfoApproves(id)).toStrictEqual({ refused: "expired" });
    expect(await proposals.approvals("org_456", id)).toStrictEqual([]);
  });

  // Found by step 29's review, finding L2: line ⑨'s look asks the store whether a proposal's time
  // has come, by the database's clock, so a dry run hears what the real call hears.
  it("DSOR-APR-04a: on the database, the store says whether a proposal's time has come: not for a new one, yes a moment after a short life ends, and never for another company's", async () => {
    const fresh = await waitingFor([CFO_BY_8]);
    const short = await waitingFor([CFO_BY_8], "PT1S");
    expect(await proposals.isDue("org_456", fresh)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(await proposals.isDue("org_456", short)).toBe(true);
    expect(await proposals.isDue("org_789", short)).toBe(false);
  });

  it("DSOR-TEN-01b: on the database, org_789 sees no approval of org_456's, and cannot approve its proposal", async () => {
    const id = await waitingFor([CFO_BY_8]);
    expect(
      await proposals.approve("org_789", id, offerBy("cfo_100", ["CFO"]), byPerson("cfo_100")),
    ).toStrictEqual({ refused: "moved" });
    await cfoApproves(id);
    expect(await proposals.approvals("org_789", id)).toStrictEqual([]);
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT count(*)::int AS n FROM dsor.approvals WHERE proposal_id = $1",
      "org_789",
      [id],
    );
    expect(rows[0]?.["n"]).toBe(0);
  });

  // DSoR's own WHERE alone, with no policy behind it: the store run by the owner, who holds
  // BYPASSRLS. A twin proposal of org_789, with the same id and the same rule, has its CFO's
  // approval. Without the company in the store's WHERE, org_456's proposal would count it, and
  // cfo_100's approval would satisfy nothing.
  it("DSOR-TEN-01b: DSoR's own WHERE alone keeps an approval in its company: the owner's store does not count org_789's approval of a twin proposal toward org_456's", () => {
    expect(ownerApprovals()).toStrictEqual({
      bypassrls: true,
      before: [],
      approved: "APPROVED",
      kept: 1,
    });
  });
});

describe("D8: on the database, an approval once given says what it said (step 29's README, decision D8)", () => {
  it.each([
    ["change one", "UPDATE dsor.approvals SET approver = 'agent' WHERE proposal_id = $1"],
    ["remove one", "DELETE FROM dsor.approvals WHERE proposal_id = $1"],
  ])("Step 29: dsor_runtime may not %s", async (_what, sql) => {
    const id = await waitingFor([CFO_BY_8]);
    await cfoApproves(id);
    await expect(tryThenRollBack(observer, sql, "org_456", [id])).rejects.toMatchObject(
      NO_PRIVILEGE,
    );
  });

  it("Step 29: dsor_runtime may not empty dsor.approvals", async () => {
    await expect(
      tryThenRollBack(observer, "TRUNCATE dsor.approvals", "org_456"),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });

  /** An approval row, as dsor_runtime would add it by hand, with this approver. */
  function row(id: string, approver: string, named = approver): unknown[] {
    const apr = `apr_${randomUUID()}`;
    const approval = {
      id: apr,
      tenant: "org_456",
      proposal: `dsor://org_456/proposal/${id}`,
      approvers: [{ principal: named, basis: "role:CFO", authn: { at: new Date().toISOString() } }],
    };
    return [apr, id, approver, JSON.stringify(approval)];
  }
  const ADD = `INSERT INTO dsor.approvals (tenant_id, id, proposal_id, approver, approval)
               VALUES ('org_456', $1, $2, $3, $4::jsonb)`;

  it("Step 29: one approval for each person and proposal: a second row for cfo_100 is refused by approvals_once", async () => {
    const id = await waitingFor([CFO_BY_8]);
    await cfoApproves(id);
    expect(await asRuntime(ADD, row(id, "cfo_100"))).toContain("approvals_once");
  });

  it("Step 29: the columns say what the approval says: a row whose approver is not the approval's own is refused by approvals_keys", async () => {
    const id = await waitingFor([CFO_BY_8]);
    expect(await asRuntime(ADD, row(id, "cfo_100", "intake-fte"))).toContain("approvals_keys");
  });

  it("Step 29: an approval names a proposal of its own company: one for a proposal that is not there is refused", async () => {
    expect(await asRuntime(ADD, row(`prop_${randomUUID()}`, "cfo_100"))).toContain(
      "approvals_of_a_proposal",
    );
  });
});

describe("D9: on the database, two approvals at once (step 29's README, decision D9)", () => {
  it.each([1, 2, 3])(
    "DSOR-AUT-02c: on the database, cfo_100 and admin_100 approve one proposal at the same moment: both approvals are kept, and the proposal is APPROVED once (round %i)",
    async () => {
      const id = await waitingFor([ADMIN_BY_1, CFO_BY_8]);
      const admin = offerBy("admin_100", ["tenant_admin"]);
      const done = await Promise.all([
        cfoApproves(id),
        others.approve("org_456", id, admin, byPerson("admin_100")),
      ]);
      const states = done.map((one) => ("approval" in one ? one.state : one.refused)).sort();
      expect(states).toStrictEqual(["APPROVED", "PENDING_APPROVAL"]);
      expect((await proposals.get("org_456", id))?.state).toBe("APPROVED");
      expect(await proposals.approvals("org_456", id)).toHaveLength(2);
      expect(await approvedMoves(id)).toBe(1);
    },
  );

  it("Step 29: on the database, two CFOs approve a proposal that waits for one CFO at the same moment: one approval is kept, and the other finds it APPROVED already", async () => {
    const id = await waitingFor([CFO_BY_8]);
    const cfo200 = offerBy("cfo_200", ["CFO"]);
    const done = await Promise.all([
      cfoApproves(id),
      others.approve("org_456", id, cfo200, byPerson("cfo_200")),
    ]);
    const outcomes = done.map((one) => ("approval" in one ? one.state : one.refused)).sort();
    expect(outcomes).toStrictEqual(["APPROVED", "moved"]);
    expect(done).toContainEqual({ refused: "moved", state: "APPROVED" });
    expect(await proposals.approvals("org_456", id)).toHaveLength(1);
  });

  // Found by step 29's review, finding M1: now() is the time the approval's transaction began,
  // before its wait for the ending lock. The approval must read the clock after the wait.
  it("DSOR-APR-04a: on the database, an approval that waited for the ending lock past the proposal's expiry is not given: the store reads the clock after the wait, not when the transaction began", async () => {
    const id = await waitingFor([CFO_BY_8], "PT3S");
    const expiresAt = Date.parse((await proposals.get("org_456", id))!.expires_at);
    const client = await observer.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dsor.ending/org_456', 0))");
      const approving = cfoApproves(id);
      await callsWaiting(observer, 1);
      // The approval's transaction began before the expiry. Its step runs after it.
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt - Date.now()) + 300));
      await client.query("COMMIT");
      expect(await approving).toStrictEqual({ refused: "expired" });
    } finally {
      client.release();
    }
    expect(await proposals.approvals("org_456", id)).toStrictEqual([]);
  });

  it("Step 29: on the database, an approval waits for a tear-up that listed the proposal, and then finds it CANCELLED: the tear-up never misses an approval", async () => {
    const id = await waitingFor([CFO_BY_8]);
    // The tear-up's own first step, by hand: the company's ending lock, then its move.
    const client = await observer.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('dsor.ending/org_456', 0))",
      );
      const approving = cfoApproves(id);
      await callsWaiting(observer, 1);
      await client.query(
        "UPDATE dsor.proposals SET state = 'CANCELLED' WHERE tenant_id = 'org_456' AND id = $1",
        [id],
      );
      await client.query("COMMIT");
      expect(await approving).toStrictEqual({ refused: "moved", state: "CANCELLED" });
    } finally {
      client.release();
    }
    expect(await proposals.approvals("org_456", id)).toStrictEqual([]);
  });
});
