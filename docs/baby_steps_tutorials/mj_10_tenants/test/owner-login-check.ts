// The owner hides what it can do from the start-up check: functions in public with
// PostgreSQL's names, which say "no", found first through a search path it set. All of it
// inside one transaction that is rolled back, so nothing is kept. Not a test file:
// audit.db.test.ts starts it. The key stays in this child, and it prints only the problems
// the check found. Found by step 16's review, and fixed from step 09 on.
// Run by the tests as:  node test/owner-login-check.ts
import pg from "pg";
import { loadDotEnv, requireEnv, runtimeRoleProblems } from "../src/postgres.ts";
import { redact } from "./db.ts";

// One look-alike for each function the check calls, with the same argument types, so the
// search path alone decides which one answers.
const LOOK_ALIKES = [
  `CREATE FUNCTION public.has_table_privilege(text, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  `CREATE FUNCTION public.has_any_column_privilege(text, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  `CREATE FUNCTION public.pg_has_role(oid, name, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  "SET LOCAL search_path TO public, pg_catalog",
];

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
try {
  await client.connect();
  await client.query("BEGIN");
  for (const sql of LOOK_ALIKES) await client.query(sql);
  console.log(JSON.stringify(await runtimeRoleProblems(client)));
} catch (error) {
  console.error(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
