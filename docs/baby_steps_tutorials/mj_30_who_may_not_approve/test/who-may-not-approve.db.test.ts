// Who may not approve, on the database (step 30's README, claims C1 and C3 to C5, decisions D1 to
// D4, D7, and D8). intake-fte drafts INV-9001, 31,400.00 USD, under del_190, which user_123 signed,
// and it waits for the CFO, by version 8 of high-value-payment, in a world that reads dsor.controls.
// user_123 is an AP supervisor, and may approve payments since this step. A real PostgreSQL, never
// a mock.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Approving, Offer } from "../src/approvals.ts";
import type { Answer, Requirement } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { MoveBy, ProposalDraft } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
const registry = dbRegistry(
  pool,
  storyDirectories(),
  handlersFor(),
  ownWorkFor(),
  readLifetimes(),
  "database",
);
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;

beforeAll(() => {
  ownerRules("clear");
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("add");
});
beforeEach(() => {
  ownerLimits("reset");
});
afterAll(async () => {
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await pool.end();
});

/** intake-fte drafts INV-9001, and the test reads its proposal as an approval screen would. */
async function waiting(): Promise<{ id: string; uri: string; payload_hash: string }> {
  const answer = await withPlanted("tok_intake", intake, () =>
    call(registry, log, keyed(INTAKE), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-9001",
      expected_version: 1,
    }),
  );
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const id = String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
  const kept = await proposals.get("org_456", id);
  return { id, uri: kept!.uri, payload_hash: kept!.payload_hash };
}

/** One approval call by this caller, with a fresh key, unless the envelope names a mode. */
function approves(who: RequestEnvelope, proposal: string, payload_hash: string): Promise<Answer> {
  const envelope = "mode" in who ? who : keyed(who);
  return call(registry, log, envelope, "proposal.approve", { proposal, payload_hash });
}

/** The decision record of the call that gave this answer, as dsor.audit keeps it. */
async function decisionOf(answer: Answer): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT operation, "authorization", result FROM dsor.audit
      WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
    "org_456",
    [answer.correlation.request_id],
  );
  return rows;
}

/** The approvals of one proposal, as dsor_runtime reads them inside org_456. */
async function approvalRows(id: string): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT approver FROM dsor.approvals WHERE proposal_id = $1 ORDER BY approver",
    "org_456",
    [id],
  );
  return rows;
}

describe("C1 and C3: on the database, no one in the requesting chain approves (step 30's README, decisions D1 to D4)", () => {
  it("DSOR-SOD-02: on the database, user_123 signed del_190, so user_123 cannot approve intake-fte's INV-9001: SOD_VIOLATION, dsor.audit says DENY, and dsor.approvals keeps nothing", async () => {
    const { id, uri, payload_hash } = await waiting();
    const answer = await approves(SUPERVISOR, uri, payload_hash);
    expect(answer).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_123 may not approve proposal ${id}: user_123 signed slip del_190, which the agent that asked works under`,
    });
    expect(await decisionOf(answer)).toStrictEqual([
      { operation: "proposal.approve@1", authorization: "DENY", result: "SOD_VIOLATION" },
    ]);
    expect(await approvalRows(id)).toStrictEqual([]);
    expect((await proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-02: on the database, a dry run of user_123's approval hears SOD_VIOLATION too, and cfo_100, outside the chain, approves", async () => {
    const { id, uri, payload_hash } = await waiting();
    const dry = { ...SUPERVISOR, mode: "validate_only" as const };
    expect(await approves(dry, uri, payload_hash)).toMatchObject({ code: "SOD_VIOLATION" });
    expect(await approves(CFO, uri, payload_hash)).toMatchObject({
      outcome: "COMMITTED",
      data: { state: "APPROVED" },
    });
    expect(await approvalRows(id)).toStrictEqual([{ approver: "cfo_100" }]);
  });
});

describe("C4 and C5: on the database, an agent never approves, and a quorum counts distinct people (step 30's README, decisions D7 and D8)", () => {
  it("DSOR-SOD-01a: on the database, intake-fte cannot approve the payment it drafted: for people only, dsor.audit says DENY, and dsor.approvals keeps nothing", async () => {
    const { id, uri, payload_hash } = await waiting();
    const answer = await withPlanted("tok_intake", intake, () =>
      approves(INTAKE, uri, payload_hash),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is for people only, and intake-fte is not a person',
    });
    expect(await decisionOf(answer)).toMatchObject([
      { authorization: "DENY", result: "AUTHORIZATION_DENIED" },
    ]);
    expect(await approvalRows(id)).toStrictEqual([]);
  });

  // The store's own step, below line ⑨: the last place a second approval by one person could
  // count. Two CFOs are asked for, and cfo_100 tries to be both.
  const TWO_CFOS: Requirement = {
    approval: { role: "CFO", quorum: 2 },
    control: "high-value-payment",
    control_version: 8,
  };
  const INV_9001 = "dsor://org_456/invoice/INV-9001";
  const AS_OF = { source: "role_source" as const, as_of: "2026-10-13T09:00:00.000Z" };
  const DRAFT: ProposalDraft = {
    operation: "payment.create@1",
    mode: "execute",
    payload: { invoice: INV_9001, expected_version: 1 },
    payload_hash: `sha256:${"d".repeat(64)}`,
    resources: [INV_9001],
    requester: {
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["intake-fte"],
      active_tenant: "org_456",
      delegation: "del_190",
      subject_authority: AS_OF,
    },
    idempotency_key: "k-s30-quorum",
  };
  const BY_AGENT: MoveBy = {
    mover: {
      mode: "unattended",
      subject: "user_123",
      actor_chain: ["intake-fte"],
      subject_authority: AS_OF,
    },
    cause: "a control asked for an approval",
    correlation: { request_id: "req_s30_quorum" },
  };

  /** One CFO's approval, through the store's own step, as the work after line ⑩ asks for it. */
  function storeApproves(id: string, person: string): Promise<Approving> {
    const now = new Date().toISOString();
    const offer: Offer = {
      id: `apr_${randomUUID()}`,
      risk: "medium",
      bound_state: { mode: "predicate", versions: { [INV_9001]: 1 } },
      approver: person,
      roles: ["CFO"],
      at: now,
    };
    const by: MoveBy = {
      mover: {
        mode: "direct",
        subject: person,
        actor_chain: [],
        subject_authority: { source: "token", as_of: now },
      },
      cause: `approved by ${person}`,
      correlation: { request_id: `req_${randomUUID()}` },
    };
    return proposals.approve("org_456", id, offer, by);
  }

  it("DSOR-SOD-04c: on the database, a proposal that waits for two CFOs: the store keeps no second approval by cfo_100, and only cfo_200's makes it APPROVED, with two rows by two people", async () => {
    const id = `prop_${randomUUID()}`;
    await proposals.create("org_456", id, DRAFT, BY_AGENT, "P7D");
    await proposals.move("org_456", id, "PROPOSED", "PENDING_APPROVAL", BY_AGENT, [TWO_CFOS]);
    expect(await storeApproves(id, "cfo_100")).toMatchObject({ state: "PENDING_APPROVAL" });
    expect(await storeApproves(id, "cfo_100")).toMatchObject({ refused: "twice" });
    expect(await approvalRows(id)).toStrictEqual([{ approver: "cfo_100" }]);
    expect(await storeApproves(id, "cfo_200")).toMatchObject({ state: "APPROVED", waits_for: [] });
    expect(await approvalRows(id)).toStrictEqual([
      { approver: "cfo_100" },
      { approver: "cfo_200" },
    ]);
  });
});
