// NEW IN STEP 12: the generated cross-tenant suite, against a real server.
//
// The same suite as cross-tenant-suite.test.ts, with the rows in the database `.env` names and
// the application logged in as itself. Runs only under `pnpm test:db`.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe } from "vitest";
import { useDatabase } from "../src/audit.ts";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner, migrationsIn } from "../src/migrations.ts";
import { crossTenantSuite } from "./support/cross-tenant-suite.ts";

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

afterAll(async () => {
  await owner?.query("DELETE FROM audit");
  await application?.end();
  await owner?.end();
});

// Skipped, not absent, without a server: a file that registers no test is an error to vitest, and
// a learner with no database would see a failure where every other database-tier file says
// "skipped". The hooks below touch `owner` only inside tests, which never run when skipped.
describe.skipIf(!haveAServer)("against a real server", () => {
  crossTenantSuite({
    reset: async () => {
      // As the owner: the application may neither add nor remove rows, and may not DELETE the log.
      await owner.query("DELETE FROM public.invoices");

      for (const migration of migrationsIn(
        fileURLToPath(new URL("../migrations", import.meta.url)),
      )) {
        if (migration.name === "004_running_example.sql") {
          await owner.query(migration.sql);
        }
      }

      await owner.query("DELETE FROM public.audit");
    },
    rowsOf: async (tenant) => {
      const { rows } = await owner.query<{ id: string }>(
        `SELECT tenant_id, id, vendor, amount_value::text AS amount, amount_currency, status
         FROM public.invoices WHERE tenant_id = $1 ORDER BY id`,
        [tenant],
      );

      return rows;
    },
  });
});
