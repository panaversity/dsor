// The owner hides what it can do from the start-up check: functions in public with
// PostgreSQL's names, which say "no", found first through a search path it set. All of it
// inside one transaction that is rolled back, so nothing is kept. Not a test file: the
// database tests start it through ownerLoginCheck in test/db.ts. The key stays in this
// child, and what it prints is redacted first (step 09's README, decision 18). Found by
// step 16's review, and fixed from step 09 on.
// Run by the tests as:  node test/owner-login-check.ts
import pg from "pg";
import { loadDotEnv, requireEnv, runtimeRoleProblems } from "../src/postgres.ts";
import { redact } from "./db.ts";

// One look-alike for each function the check calls that answers yes or no, with the same
// argument types, and one for the catalog view it reads, so the search path alone decides
// which one answers.
const LOOK_ALIKES = [
  `CREATE FUNCTION public.has_table_privilege(text, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  `CREATE FUNCTION public.has_any_column_privilege(text, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  `CREATE FUNCTION public.pg_has_role(oid, name, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  // A view can stand in for one of PostgreSQL's the same way. This one says no login holds
  // BYPASSRLS, so a check that only wrote pg_catalog. in front of its functions would still
  // be fooled. Found by a review of step 15's port, and fixed from step 09 on.
  `CREATE VIEW public.pg_roles AS
     SELECT oid, rolname, rolsuper, false AS rolbypassrls FROM pg_catalog.pg_roles`,
  "SET LOCAL search_path TO public, pg_catalog",
];

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
try {
  await client.connect();
  await client.query("BEGIN");
  for (const sql of LOOK_ALIKES) await client.query(sql);
  const problems = await runtimeRoleProblems(client);
  process.stdout.write(redact(JSON.stringify(problems), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
