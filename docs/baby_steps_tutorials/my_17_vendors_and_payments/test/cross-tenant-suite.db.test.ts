// STEP 12: the generated cross-tenant suite, against a real server.
//
// The same suite as cross-tenant-suite.test.ts, with the rows in the database `.env` names and
// the application logged in as itself. Runs only under `pnpm test:db`.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe } from "vitest";
import { useDatabase } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { storyStatements } from "./support/story.ts";
import { crossTenantSuite, ROWS_OF, type Row } from "./support/cross-tenant-suite.ts";

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
  application = new Pool({ connectionString: APPLICATION, max: 2 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  useDatabase(overPool(application));
});

/** The rows as the story starts, as the owner: the application may neither add nor remove rows. */
async function putTheStoryBack(): Promise<void> {
  // NEW IN STEP 17: the invoices and the payments that pay them, from one list (story.ts).
  for (const statement of storyStatements()) {
    await owner.query(statement);
  }

  await owner.query("DELETE FROM dsor.audit WHERE tenant IN ('org_456', 'org_789')");
}

afterAll(async () => {
  // The last generated test issues org_456's draft; leave the database as the story starts.
  if (haveAServer) {
    await putTheStoryBack();
  }

  await application?.end();
  await owner?.end();
});

// Skipped, not absent, without a server: a file that registers no test is an error to vitest, and
// a learner with no database would see a failure where every other database-tier file says
// "skipped". The hooks below touch `owner` only inside tests, which never run when skipped.
describe.skipIf(!haveAServer)("against a real server", () => {
  crossTenantSuite({
    reset: putTheStoryBack,
    rowsOf: async (tenant) => {
      // STEP 17: invoices and payments, from the one query both tiers run.
      const { rows } = await owner.query<Row>(ROWS_OF, [tenant]);

      return rows;
    },
  });
});
