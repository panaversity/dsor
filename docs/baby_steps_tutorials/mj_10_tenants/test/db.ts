// What the database tests share. Not a test file itself.
// The tests look at the database with pg directly, never through src, so a broken log
// cannot vouch for itself.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createDbInvoices, requireEnv } from "../src/postgres.ts";
import { handlersFor } from "../src/operations.ts";
import { buildRegistry, type Registry } from "../src/registry.ts";
import { shipped, shippedInputs, shippedRoles } from "./helpers.ts";

// dsor_runtime's connection string. test/db-setup.ts has already stopped the run if it
// is missing (step 09's README, decision 8).
export const RUNTIME_URL: string = requireEnv("DSOR_DB_URL");

/** A pool of its own, as a second program or a restart would open. */
export function newPool(url: string = RUNTIME_URL): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 2 });
}

/** The shipped operations, reading invoices through this pool. */
export function dbRegistry(pool: pg.Pool): Registry {
  // The registry holds the store (step 10's README, decision 13).
  return buildRegistry(shipped, handlersFor(), shippedRoles, shippedInputs, createDbInvoices(pool));
}

/** A request id no other test run has used, so each test finds only its own rows. */
export function requestId(claim: string): string {
  return `${claim}-${randomUUID()}`;
}

/** Every row of dsor.audit whose correlation carries this request id. */
export async function rowsFor(pool: pg.Pool, request_id: string): Promise<pg.QueryResultRow[]> {
  const { rows } = await pool.query(
    `SELECT record_id, sequence, at, kind, operation, "authorization", result, reason, correlation
       FROM dsor.audit WHERE correlation->>'request_id' = $1 ORDER BY sequence`,
    [request_id],
  );
  return rows;
}

/**
 * Runs one statement inside a transaction that is always rolled back. A test that tries to
 * change the log never changes it, even when a break has given dsor_runtime the privilege.
 */
export async function tryThenRollBack(pool: pg.Pool, sql: string): Promise<pg.QueryResult> {
  // Found live 2026-09-28: break T1 granted UPDATE, and the test's own UPDATE then
  // rewrote every record on the branch. Postgres checks the privilege before it runs the
  // statement, so rolling back takes nothing from the test.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await client.query(sql);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/**
 * Every privilege the logged-in user holds on this step's tables, their columns, their
 * sequences, and the schemas, one row per object. Held directly, through PUBLIC, or
 * through a role it belongs to: has_..._privilege counts them all.
 */
export const PRIVILEGES_HELD = `
  WITH tables(rel) AS (VALUES ('app.invoices'::regclass), ('dsor.audit'::regclass),
                             ('dsor.migrations'::regclass)),
  on_tables AS (
    SELECT rel::text AS object, string_agg(p, ' ' ORDER BY p) AS held
      FROM tables, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE',
                                'REFERENCES','TRIGGER','MAINTAIN']) AS p
     WHERE has_table_privilege(rel, p) GROUP BY rel),
  on_columns AS (
    SELECT a.attrelid::regclass::text || ' ' || p AS object,
           string_agg(a.attname, ' ' ORDER BY a.attnum) AS held
      FROM tables JOIN pg_attribute a ON a.attrelid = tables.rel
           AND a.attnum > 0 AND NOT a.attisdropped,
           unnest(ARRAY['INSERT','UPDATE','REFERENCES']) AS p
     WHERE has_column_privilege(a.attrelid, a.attnum, p) GROUP BY 1),
  on_sequences AS (
    SELECT c.oid::regclass::text AS object, string_agg(p, ' ' ORDER BY p) AS held
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p
     WHERE c.relkind = 'S' AND n.nspname IN ('app', 'dsor')
       AND has_sequence_privilege(c.oid, p) GROUP BY 1),
  on_schemas AS (
    SELECT 'schema ' || s AS object, string_agg(p, ' ' ORDER BY p) AS held
      FROM unnest(ARRAY['app','dsor','public']) AS s, unnest(ARRAY['USAGE','CREATE']) AS p
     WHERE has_schema_privilege(s, p) GROUP BY s)
  SELECT * FROM on_tables UNION ALL SELECT * FROM on_columns
  UNION ALL SELECT * FROM on_sequences UNION ALL SELECT * FROM on_schemas
  ORDER BY object`;

/**
 * The text with each secret replaced by its label: the whole connection string, then its
 * password alone, as written and as decoded. Assert on this, never on the raw output, so
 * a failing check cannot print a secret (step 09's README, decision 18).
 */
export function redact(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const [label, url] of Object.entries(secrets)) {
    const password = new URL(url).password;
    for (const secret of [url, password, decodeURIComponent(password)]) {
      if (secret !== "") out = out.split(secret).join(label);
    }
  }
  return out;
}

/** The code Postgres gives when a user lacks a privilege: "insufficient_privilege". */
export const NO_PRIVILEGE = { code: "42501" };
