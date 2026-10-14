// The owner makes, inside one transaction, each thing the inspector must
// refuse, reads the catalog on that same connection, and rolls all of it back. Not a test
// file: store.db.test.ts starts it through ownerCatalog in test/db.ts. Nothing is kept: a
// transaction that is rolled back, or whose connection drops, leaves no trace (step 16's
// README, decision 8). The key stays in this child, and it prints only the catalog.
// Run by the tests as:  node test/owner-catalog.ts
import pg from "pg";
import { readCatalog } from "../src/catalog.ts";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

// Today's database holds none of these, so without them the inspector's SQL could forget
// each one and pass every other test. Found by the review.
const FIXTURE = [
  "CREATE VIEW dsor.fixture_view AS SELECT 1 AS one",
  "CREATE MATERIALIZED VIEW dsor.fixture_copy AS SELECT 1 AS one",
  "CREATE TABLE dsor.fixture_events (at date) PARTITION BY RANGE (at)",
  `CREATE FUNCTION dsor.fixture_tidy() RETURNS integer LANGUAGE sql SECURITY DEFINER
     AS 'SELECT 1'`,
  "CREATE RULE fixture_swallow AS ON INSERT TO dsor.audit DO INSTEAD NOTHING",
  `CREATE FUNCTION dsor.fixture_stop() RETURNS trigger LANGUAGE plpgsql
     AS 'BEGIN RETURN NULL; END'`,
  `CREATE TRIGGER fixture_drop BEFORE INSERT ON dsor.audit
     FOR EACH ROW EXECUTE FUNCTION dsor.fixture_stop()`,
  // Enabled and forced are told apart: forced, and no longer enabled.
  "ALTER TABLE app.invoices DISABLE ROW LEVEL SECURITY",
  // NEW IN STEP 21: a trigger switched off, which PostgreSQL prints as if it were on. Found by
  // the review (step 21's README, decision 11).
  "ALTER TABLE app.invoices DISABLE TRIGGER invoices_version",
  // The review's look-alike: a function in public with PostgreSQL's own name, which says
  // no to every question. With public first in the search path, it would be found first.
  `CREATE FUNCTION public.has_table_privilege(name, oid, text) RETURNS boolean
     LANGUAGE sql AS 'SELECT false'`,
  // A view can stand in for one of PostgreSQL's the same way. This one shows no relation at
  // all, so a read that only wrote pg_catalog. in front of its functions would still be
  // fooled. Found by a review of step 15's port of step 09's fix, and fixed here.
  "CREATE VIEW public.pg_class AS SELECT * FROM pg_catalog.pg_class WHERE false",
  "SET LOCAL search_path TO public, pg_catalog",
];

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
try {
  await client.connect();
  await client.query("BEGIN");
  for (const sql of FIXTURE) await client.query(sql);
  console.log(JSON.stringify(await readCatalog(client, "dsor_runtime")));
} catch (error) {
  console.error(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
