// Run with:  pnpm migrate
// Builds the database as the owner, DSOR_MIGRATION_URL. It creates dsor_runtime with SQL,
// never in the Neon console, then runs the migrations, all in one transaction (step 09's
// README, decisions 3, 4, and 13).
// Each migration runs once. The table dsor.migrations remembers which
// have run (step 10's README, decision 8).
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { loadDotEnv, requireEnv } from "./postgres.ts";

const MIGRATIONS = new URL("../migrations/", import.meta.url);
// Every .sql file, in name order: 001 before 002.
const files = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort();

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
  // The list of migrations that have run. dsor_runtime gets no privilege on
  // it: 001 takes every privilege away from it in this schema, and nothing grants one.
  await owner.query("CREATE SCHEMA IF NOT EXISTS dsor");
  await owner.query(
    `CREATE TABLE IF NOT EXISTS dsor.migrations (
       name text PRIMARY KEY,
       at   timestamptz NOT NULL DEFAULT now()
     )`,
  );
  // A second pnpm migrate started at the same moment waits here, then finds the files this
  // one ran already in the list.
  await owner.query("LOCK TABLE dsor.migrations IN EXCLUSIVE MODE");
  const ran = await owner.query<{ name: string }>("SELECT name FROM dsor.migrations");
  const done = new Set(ran.rows.map((row) => row.name));
  const todo = files.filter((file) => !done.has(file));
  // A file and its line in the list are written in one transaction: both, or neither.
  for (const file of todo) {
    await owner.query(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    await owner.query("INSERT INTO dsor.migrations (name) VALUES ($1)", [file]);
  }
  await owner.query("COMMIT");
  console.log(
    exists ? "dsor_runtime: password set again from DSOR_DB_URL" : "dsor_runtime: created",
  );
  if (todo.length === 0) console.log("no migration to run");
  for (const file of todo) console.log(`migration ${file.replace(/\.sql$/, "")}: done`);
} catch (error) {
  await owner.query("ROLLBACK");
  // Only the database's message: it never holds the password, which travelled as a value.
  console.error(`migration failed, nothing changed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await owner.end();
}
