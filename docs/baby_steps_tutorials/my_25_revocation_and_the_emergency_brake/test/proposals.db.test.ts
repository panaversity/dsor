// STEP 22: a proposal runs at most once, on a real server (decision 136).
//
// PGlite has one connection, so two moves sent together reach it one after the other. A pool
// against a real PostgreSQL lets them truly race: twenty requests try to move one proposal out of
// READY at the same moment, and the database lets exactly one move be written, because a state is
// left at most once.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like pool.db.test.ts.
//
// Rule DSOR-IDM-04: a proposal MUST be executed at most once; the proposal id is the idempotency key
// of its execution.
// Rule DSOR-APR-01c: a proposal MUST NOT leave a terminal state.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { theLog, type AuditRecord } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { moveProposal, moveProposalThrough, movesOf, propose, stateOf } from "../src/proposal.ts";
import { useDatabase } from "../src/store.ts";
import { BY_A_TEST } from "./support/database.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  application = new Pool({ connectionString: APPLICATION, max: 20 });
  useDatabase(overPool(application));
});

afterAll(async () => {
  await application?.end();
  await owner?.end();
});

/** A proposal of its own each run, because the database is kept between runs, walked to READY. */
async function aReadyProposal(): Promise<string> {
  const id = await propose(
    {
      tenant: "org_456",
      operation: "payment.create@1",
      mode: "execute",
      payload: "{}",
      payloadHash: "sha256:0",
      requester: '{"mode":"direct","subject":"user_123","actor_chain":[]}',
      idempotencyKey: `race-${Date.now()}`,
      actor: "user_123",
      cause: "payment.create@1 invoked",
    },
    // STEP 22, decision 157: each move's record is in a test's request's name.
    BY_A_TEST,
  );
  const ready = await moveProposal(
    "org_456",
    id,
    "PROPOSED",
    "READY",
    "dsor",
    "allowed",
    BY_A_TEST,
  );

  if (ready.kind !== "moved") {
    throw new Error(`could not make ${id} READY`);
  }

  return id;
}

describe.skipIf(!haveAServer)("one proposal, twenty requests at once, on a real pool", () => {
  it("DSOR-IDM-04: twenty moves out of READY at once: exactly one is written", async () => {
    const id = await aReadyProposal();
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        moveProposalThrough(
          "org_456",
          id,
          [["READY", "EXECUTING", `request ${i}`]],
          "dsor",
          null,
          BY_A_TEST,
        ),
      ),
    );

    expect(outcomes.filter((o) => o.kind === "moved")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "refused")).toHaveLength(19);
    expect((await movesOf("org_456", id)).filter((m) => m.to === "EXECUTING")).toHaveLength(1);
    // STEP 22, decision 157: and one record of it in the log. The nineteen refused were
    // written nowhere, the log included, whatever places they lost on the way.
    expect((await recordsOfMovesOf(id)).filter((r) => r.result === "EXECUTING")).toHaveLength(1);
  });

  it("DSOR-APR-01c: twenty moves out of a COMMITTED proposal at once: none is written", async () => {
    const id = await aReadyProposal();

    await moveProposalThrough(
      "org_456",
      id,
      [["READY", "EXECUTING", "carried out"]],
      "dsor",
      null,
      BY_A_TEST,
    );
    await moveProposal("org_456", id, "EXECUTING", "COMMITTED", "dsor", "done", BY_A_TEST);

    const outcomes = await Promise.all(
      (["FAILED", "EXECUTING", "OUTCOME_UNKNOWN", "READY", "CANCELLED"] as const).flatMap((to) =>
        Array.from({ length: 4 }, () =>
          moveProposal("org_456", id, "COMMITTED", to, "dsor", "leave", BY_A_TEST),
        ),
      ),
    );

    expect(outcomes.every((o) => o.kind === "refused")).toBe(true);
    expect(await stateOf("org_456", id)).toBe("COMMITTED");
    // STEP 22, decision 157: and the log says no more than that: the records of its moves
    // to READY, EXECUTING and COMMITTED, and none of the twenty refused.
    expect((await recordsOfMovesOf(id)).map((r) => r.result)).toStrictEqual([
      "READY",
      "EXECUTING",
      "COMMITTED",
    ]);
  });
});

/**
 * STEP 22, decision 157: the records of a proposal's moves that name it: every one but the
 * record of its creation, which cannot.
 */
async function recordsOfMovesOf(id: string): Promise<readonly AuditRecord[]> {
  return (await theLog("org_456")).filter(
    (r) => r.kind === "proposal_transition" && r.resources?.[0] === `dsor://org_456/proposal/${id}`,
  );
}
