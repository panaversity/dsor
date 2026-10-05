// Run with:  pnpm migrate
// NEW IN STEP 09: builds the database as the owner, DSOR_MIGRATION_URL. It creates
// dsor_runtime with SQL, never in the Neon console, then runs the migration, all in one
// transaction. Safe to run twice (step 09's README, decisions 3, 4, and 13).
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadDotEnv, requireEnv } from "./postgres.ts";

const MIGRATION = new URL("../migrations/001_audit_and_invoices.sql", import.meta.url);

loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_DB_URL"]);
let ownerUrl: string;
let runtime: URL;
try {
  ownerUrl = requireEnv("DSOR_MIGRATION_URL");
  runtime = new URL(requireEnv("DSOR_DB_URL"));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
// The password is written in one place only: DSOR_DB_URL (step 09's README, decision 4).
if (runtime.username !== "dsor_runtime" || runtime.password === "") {
  console.error("DSOR_DB_URL must log in as dsor_runtime, with a password.");
  process.exit(1);
}
const password = decodeURIComponent(runtime.password);

const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
try {
  await owner.query("BEGIN");
  const found = await owner.query("SELECT 1 FROM pg_roles WHERE rolname = 'dsor_runtime'");
  const exists = found.rowCount === 1;
  // format's %L quotes the password as SQL text, so a quote inside it cannot end the
  // string early. The password is never pasted into the SQL by JavaScript.
  const { rows } = await owner.query<{ sql: string }>(
    "SELECT format('%s ROLE dsor_runtime LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
    [exists ? "ALTER" : "CREATE", password],
  );
  await owner.query(rows[0]!.sql);
  await owner.query(readFileSync(MIGRATION, "utf8"));
  await owner.query("COMMIT");
  console.log(
    exists ? "dsor_runtime: password set again from DSOR_DB_URL" : "dsor_runtime: created",
  );
  console.log("migration 001_audit_and_invoices: done");
} catch (error) {
  await owner.query("ROLLBACK");
  // Only the database's message: it never holds the password, which travelled as a value.
  console.error(`migration failed, nothing changed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await owner.end();
}
