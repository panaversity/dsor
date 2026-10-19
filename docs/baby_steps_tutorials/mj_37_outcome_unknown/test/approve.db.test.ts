// proposal.approve, on the database (step 29's README, claims C2, C3, and C4). intake-fte drafts
// INV-9001, 31,400.00 USD, under del_190, and it waits for the CFO, by version 8 of
// high-value-payment, in a world that reads dsor.controls. cfo_100 approves it on their own login.
// A real PostgreSQL, never a mock.
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
import { CFO, keyed, storyDirectories, withPlanted } from "./helpers.ts";

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
    `SELECT operation, "authorization", result, resources FROM dsor.audit
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
    "SELECT approver, approval FROM dsor.approvals WHERE proposal_id = $1",
    "org_456",
    [id],
  );
  return rows;
}

describe("C2 and C3: proposal.approve, on the database (step 29's README, decisions D5, D7, and D9)", () => {
  it("Step 29: on the database, cfo_100 approves intake-fte's waiting payment of INV-9001: dsor.proposals says APPROVED, dsor.approvals keeps the approval, and dsor.audit records the call and the move", async () => {
    const { id, uri, payload_hash } = await waiting();
    const answer = await approves(CFO, uri, payload_hash);
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", proposal: uri, state: "APPROVED", waits_for: [] },
    });
    const approval = (answer as { data: { id: string } }).data.id;
    const kept = await proposals.get("org_456", id);
    expect([kept?.state, kept?.approvals]).toStrictEqual(["APPROVED", [approval]]);
    expect(kept?.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "APPROVED",
      actor: "cfo_100",
      cause: "approved by cfo_100",
    });
    const rows = await approvalRows(id);
    expect(rows).toMatchObject([
      {
        approver: "cfo_100",
        approval: {
          id: approval,
          proposal: uri,
          payload_hash,
          bound_state: { mode: "predicate", versions: { "dsor://org_456/invoice/INV-9001": 1 } },
          satisfies: [{ control: "high-value-payment", version: 8 }],
          approvers: [{ principal: "cfo_100", basis: "role:CFO" }],
        },
      },
    ]);
    // The call's own record: ALLOW, and ok, naming the approval's address.
    expect(await decisionOf(answer)).toMatchObject([
      {
        operation: "proposal.approve@1",
        authorization: "ALLOW",
        result: "ok",
        resources: [`dsor://org_456/approval/${approval}`],
      },
    ]);
  });

  it("DSOR-APR-09: on the database, a fingerprint that is not the stored one: APPROVAL_MISMATCH, the record says DENY, and dsor.approvals keeps nothing", async () => {
    const { id, uri } = await waiting();
    const answer = await approves(CFO, uri, `sha256:${"f".repeat(64)}`);
    expect(answer).toMatchObject({ code: "APPROVAL_MISMATCH" });
    expect(await decisionOf(answer)).toMatchObject([
      { authorization: "DENY", result: "APPROVAL_MISMATCH" },
    ]);
    expect((await proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
    expect(await approvalRows(id)).toStrictEqual([]);
  });

  it("DSOR-APR-05a: on the database, intake-fte cannot approve the payment it drafted: for people only", async () => {
    const { id, uri, payload_hash } = await waiting();
    const answer = await withPlanted("tok_intake", intake, () =>
      approves(INTAKE, uri, payload_hash),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"proposal.approve" is for people only, and intake-fte is not a person',
    });
    expect(await approvalRows(id)).toStrictEqual([]);
  });

  // Found by the step's own breaks: every test invoice was at version 1, so an approval that
  // always named version 1 passed every test.
  it("Step 29: on the database, the approval binds INV-9001 at the version DSoR reads at the approval: the accounts system changed it after the draft, and the approval names version 2", async () => {
    const { id, uri, payload_hash } = await waiting();
    try {
      ownerInvoices("credit", "31000.00");
      await approves(CFO, uri, payload_hash);
      expect(await approvalRows(id)).toMatchObject([
        {
          approval: {
            bound_state: { mode: "predicate", versions: { "dsor://org_456/invoice/INV-9001": 2 } },
          },
        },
      ]);
    } finally {
      ownerInvoices("add", "31400.00", "USD");
    }
  });

  it("Step 29: on the database, a dry run of cfo_100's approval reads the proposal outside any claim: ALLOW, and nothing is approved", async () => {
    const { id, uri, payload_hash } = await waiting();
    const dry = { ...CFO, mode: "validate_only" as const };
    expect(await approves(dry, uri, payload_hash)).toMatchObject({
      outcome: "VALIDATED",
      decision: "ALLOW",
    });
    expect((await proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
    expect(await approvalRows(id)).toStrictEqual([]);
  });
});
