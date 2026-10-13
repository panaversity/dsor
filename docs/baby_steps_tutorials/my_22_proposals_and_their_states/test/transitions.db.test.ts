// NEW IN STEP 22, decision 157: every move and its record, in a crowd, on a real server.
//
// PGlite runs one statement at a time, so a request that loses its place in the log waits, and then
// goes next, whatever its pause. A real PostgreSQL lets twenty requests read the same end of the log
// together, and all but one of them lose the place. Tried again at once, they read the same new end
// together, and lose again. This is the tier that can see the pause has to be random.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like pool.db.test.ts.
//
// Rule DSOR-AUD-01: every command decision, every proposal transition, and every read covered by
// DSOR-CLS-05 MUST produce a durable audit record that validates against audit-record.schema.json.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theHead, theLog, verifyChain } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import type { OperationAnswer } from "../src/operations.ts";
import { useDatabase } from "../src/store.ts";
import { callOperation } from "./support/door.ts";
import { storyStatements } from "./support/story.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const A_SMALL_PAYMENT = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "100.00", currency: "USD" },
};

let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  // Twenty connections, so twenty requests really are at the database at once.
  application = new Pool({ connectionString: APPLICATION, max: 20 });
  useDatabase(overPool(application));
});

beforeEach(async () => {
  if (!haveAServer) {
    return;
  }

  // As the story starts, with org_456's log empty: the moves first, which empties the proposals
  // too, then the log, whose records the moves named.
  for (const statement of storyStatements()) {
    await owner.query(statement);
  }

  await owner.query("DELETE FROM dsor.audit WHERE tenant = 'org_456'");
});

afterAll(async () => {
  await application?.end();
  await owner?.end();
});

/** Twenty payments by the agent, sent at once, each with a key of its own. */
const twentyAtOnce = (): Promise<OperationAnswer[]> =>
  Promise.all(
    Array.from({ length: 20 }, () => callOperation(AGENT, "payment.create", A_SMALL_PAYMENT)),
  );

describe.skipIf(!haveAServer)("twenty commands at once, on a real pool", () => {
  it("DSOR-AUD-01: twenty commands at once on a real server: every move has its record, saying the state it entered, and every record of a move has its move", async () => {
    await twentyAtOnce();

    // As the owner, the company's moves beside the records they name, and the records of moves
    // that no move names.
    const { rows: pairs } = await owner.query<{ to_state: string; result: string; kind: string }>(
      `SELECT m.to_state, a.result, a.kind
         FROM dsor.proposal_moves m JOIN dsor.audit a ON a.record_id = m.record
        WHERE m.tenant = 'org_456'`,
    );
    const { rows: unnamed } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dsor.audit a
        WHERE a.tenant = 'org_456' AND a.kind = 'proposal_transition'
          AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves m WHERE m.record = a.record_id)`,
    );
    const { rows: moves } = await owner.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM dsor.proposal_moves WHERE tenant = 'org_456'",
    );

    // Every move has its record: the join lost none of them.
    expect(pairs).toHaveLength(moves[0]?.n ?? -1);
    expect(pairs.every((p) => p.kind === "proposal_transition" && p.result === p.to_state)).toBe(
      true,
    );
    // And every record of a move has its move.
    expect(unnamed[0]?.n).toBe(0);
    expect(verifyChain(await theLog("org_456"), await theHead("org_456"))).toBe(true);
  });

  it("DSOR-AUD-01: most of twenty commands at once are carried out, because a lost place is tried again after a random pause", async () => {
    // Measured on a local PostgreSQL 17: 20 of 20, every run. With no pause, 4 of 20; with one try,
    // none. The bar is lower than the measurement, because a slower link loses more places.
    const answers = await twentyAtOnce();

    expect(answers.filter((a) => a.kind === "result").length).toBeGreaterThanOrEqual(15);
  });
});
