// Who may not approve, on the database (step 30's README, claims C1 and C3, decisions D1 to D4).
// intake-fte drafts INV-9001, 31,400.00 USD, under del_190, which user_123 signed, and it waits for
// the CFO, by version 8 of high-value-payment, in a world that reads dsor.controls. user_123 is an
// AP supervisor, and may approve payments since this step. A real PostgreSQL, never a mock.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
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
    "SELECT approver FROM dsor.approvals WHERE proposal_id = $1",
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
