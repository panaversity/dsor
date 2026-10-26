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
  callsWaiting,
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";

const pool = newPool();
// A pool of its own, for a lock held by hand and for watching who waits for it.
const observer = newPool();
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
  await observer.end();
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

// Proposals planted by hand, through the store: one that waits for two CFOs, where cfo_100 tries to
// be both, and one whose subject is not the slip's signer.
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

// What a payment that the supervisor rule stops waits for.
const ONE_SUPERVISOR: Requirement = {
  approval: { role: "ap_supervisor", quorum: 1 },
  control: "supervisor-above-10000",
  control_version: 1,
};

/** A proposal of INV-9001 planted by hand, that waits for these requirements, with this requester. */
async function plantedWaiting(
  requires: Requirement[],
  requester: ProposalDraft["requester"] = DRAFT.requester,
): Promise<{ id: string; uri: string; payload_hash: string }> {
  const id = `prop_${randomUUID()}`;
  const draft = { ...DRAFT, requester, idempotency_key: `k-s30-${id}` };
  await proposals.create("org_456", id, draft, BY_AGENT, "P7D");
  await proposals.move("org_456", id, "PROPOSED", "PENDING_APPROVAL", BY_AGENT, requires);
  return { id, uri: `dsor://org_456/proposal/${id}`, payload_hash: DRAFT.payload_hash };
}

/**
 * Starts two calls while the company's ending lock is held by hand, waits until both wait for it,
 * and lets go: so both calls reach the store's step, and one runs after the other there.
 */
async function bothWaitingFirst<T>(start: () => Promise<T>): Promise<T> {
  const client = await observer.connect();
  let both: Promise<T> | undefined;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dsor.ending/org_456', 0))");
    both = start();
    await callsWaiting(observer, 2);
  } finally {
    // Let go, whatever happened, so no test after this one waits for the lock.
    await client.query("COMMIT");
    client.release();
  }
  return both;
}

/** What one answer says, in one word: its outcome or its code. */
function outcomeOf(answer: Answer): string {
  if ("code" in answer) return answer.code;
  return "outcome" in answer ? answer.outcome : "answered";
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

  // Found by step 30's own breaks: with the signer taken from the request's subject, every database
  // test passed, since an agent's request names the slip's signer as its subject. This request,
  // planted by hand, names another subject, so only dsor.delegations knows who signed del_190.
  it("DSOR-SOD-02: on the database, the slip's signer comes from dsor.delegations: a request for user_124 under del_190, which user_123 signed, is refused to user_123", async () => {
    const requester = { ...DRAFT.requester, subject: "user_124" };
    const { id, uri, payload_hash } = await plantedWaiting([ONE_SUPERVISOR], requester);
    expect(await approves(SUPERVISOR, uri, payload_hash)).toMatchObject({
      code: "SOD_VIOLATION",
      message: `user_123 may not approve proposal ${id}: user_123 signed slip del_190, which the agent that asked works under`,
    });
    expect(await approvalRows(id)).toStrictEqual([]);
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

  it("DSOR-SOD-04c: on the database, a proposal that waits for two CFOs: the store keeps no second approval by cfo_100, and only cfo_200's makes it APPROVED, with two rows by two people", async () => {
    const { id } = await plantedWaiting([TWO_CFOS]);
    expect(await storeApproves(id, "cfo_100")).toMatchObject({ state: "PENDING_APPROVAL" });
    expect(await storeApproves(id, "cfo_100")).toMatchObject({ refused: "twice" });
    expect(await approvalRows(id)).toStrictEqual([{ approver: "cfo_100" }]);
    expect(await storeApproves(id, "cfo_200")).toMatchObject({ state: "APPROVED", waits_for: [] });
    expect(await approvalRows(id)).toStrictEqual([
      { approver: "cfo_100" },
      { approver: "cfo_200" },
    ]);
  });

  // Found by step 30's review, finding M1: the quorum's tests ran one call after another. Here
  // cfo_100 approves twice at the same moment, with two keys, through DSoR's whole path; and the
  // store's own step runs twice at once. The company's ending lock puts them one after the other.
  // Found by step 30's own breaks: two calls sent together did not always overlap, and passed with no
  // lock and no key at all. So each test holds the lock by hand until both calls wait for it: both
  // pass line ⑨'s look first, and only the store's own step can keep one person from counting twice.
  it("DSOR-SOD-04c: on the database, cfo_100 approves a proposal that waits for two CFOs twice at the same moment, with two keys: both pass line ⑨, one approval is kept, the other hears CONFLICT from the store, and it still waits", async () => {
    const { id, uri, payload_hash } = await plantedWaiting([TWO_CFOS]);
    const answers = await bothWaitingFirst(() =>
      Promise.all([approves(CFO, uri, payload_hash), approves(CFO, uri, payload_hash)]),
    );
    expect(answers.map(outcomeOf).sort()).toStrictEqual(["COMMITTED", "CONFLICT"]);
    expect(answers).toContainEqual(
      expect.objectContaining({ message: `cfo_100 approved proposal ${id} already` }),
    );
    expect(await approvalRows(id)).toStrictEqual([{ approver: "cfo_100" }]);
    expect((await proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-04c: on the database, the store's own step runs twice at once for cfo_100: one approval is kept, the other is refused, and it still waits", async () => {
    const { id } = await plantedWaiting([TWO_CFOS]);
    const done = await bothWaitingFirst(() =>
      Promise.all([storeApproves(id, "cfo_100"), storeApproves(id, "cfo_100")]),
    );
    const results = done.map((d) => ("refused" in d ? d.refused : d.state));
    expect(results.sort()).toStrictEqual(["PENDING_APPROVAL", "twice"]);
    expect(await approvalRows(id)).toStrictEqual([{ approver: "cfo_100" }]);
  });
});
