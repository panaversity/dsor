// What the database tests share. Not a test file itself.
// The tests look at the database with pg directly, never through src, so a broken log
// cannot vouch for itself.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  createDbClaims,
  createDbInvoices,
  createDbPayments,
  createDbSlips,
  requireEnv,
} from "../src/postgres.ts";
import { readRoleSettings } from "../src/authority.ts";
import { handlersFor } from "../src/operations.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import type { Directories } from "../src/directory.ts";
import {
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  storyDirectories,
} from "./helpers.ts";

// dsor_runtime's connection string. test/db-setup.ts has already stopped the run if it
// is missing (step 09's README, decision 8).
export const RUNTIME_URL: string = requireEnv("DSOR_DB_URL");

/** A pool of its own, as a second program or a restart would open. */
export function newPool(url: string = RUNTIME_URL): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 2 });
}

/** The shipped operations, reading invoices through this pool. */
export function dbRegistry(
  pool: pg.Pool,
  // The story's directories, unless the test gives others.
  directories: Directories = storyDirectories(),
  // The shipped code, unless the test gives other code, such as code that
  // writes and then refuses (step 20's README, decision 9).
  code: Record<string, Handler> = handlersFor(),
): Registry {
  // The registry holds the store (step 10's README, decision 13).
  return buildRegistry(
    shipped,
    code,
    shippedRoles,
    shippedInputs,
    shippedLabels,
    createDbInvoices(pool),
    // And the payments the commands write (step 17's README, outcome 1).
    createDbPayments(pool),
    // And the slips, in dsor.delegations (step 18's README, decision 3).
    createDbSlips(pool),
    // And the directories (step 19's README, decision 2).
    directories,
    readRoleSettings(),
    // And the claims of idempotency keys, in dsor.idempotency (step 20's README,
    // decision 6).
    createDbClaims(pool),
  );
}

/** A request id no other test run has used, so each test finds only its own rows. */
export function requestId(claim: string): string {
  return `${claim}-${randomUUID()}`;
}

/**
 * Every row of dsor.audit whose correlation carries this request id, read inside this
 * company. dsor_runtime sees only the company it has set, so a read with
 * no company is empty whatever the table holds, and an empty answer would prove nothing
 * (step 11's README, "Think it through").
 */
export async function rowsFor(
  pool: pg.Pool,
  company: string | undefined,
  request_id: string,
): Promise<pg.QueryResultRow[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT record_id, sequence, at, kind, operation, "authorization", result, reason, correlation
       FROM dsor.audit WHERE correlation->>'request_id' = $1 ORDER BY sequence`,
    company,
    [request_id],
  );
  return rows;
}

/**
 * Runs one statement inside a transaction that is always rolled back. A test that tries to
 * change the log never changes it, even when a break has given dsor_runtime the privilege.
 * With a company, the transaction sets it first, as the program does
 * (step 11's README, decision 3).
 */
export async function tryThenRollBack(
  pool: pg.Pool,
  sql: string,
  company?: string,
  values: unknown[] = [],
): Promise<pg.QueryResult> {
  // Found live 2026-09-28: break T1 granted UPDATE, and the test's own UPDATE then
  // rewrote every record on the branch. Postgres checks the privilege before it runs the
  // statement, so rolling back takes nothing from the test.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (company !== undefined) {
      await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [company]);
    }
    return await client.query(sql, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

// The owner's window, for the records dsor_runtime can write and never
// read back (step 11's README, decision 4), and for DSoR's own lock alone. Since step 16's
// review, for the start-up check run as the owner too.
/**
 * Runs one of the owner's child programs, and gives back what it printed, as JSON. The
 * child reads the owner's key from .env and redacts what it prints, so the test never
 * holds the key.
 */
function asOwner(program: string, args: string[] = []): unknown {
  const file = fileURLToPath(new URL(program, import.meta.url));
  const run = spawnSync(process.execPath, [file, ...args], { encoding: "utf8", timeout: 60_000 });
  if (run.status !== 0) throw new Error(`${program} failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

// The owner writes the slips a test needs, and asks DSoR's slip store with
// no policy behind it (test/owner-slips.ts).
/** What the owner's slip program printed, for these words. */
export function ownerSlips(...args: string[]): unknown {
  return asOwner("owner-slips.ts", args);
}

// The owner ages a claim, for the test of DSOR-IDM-02 (test/owner-claims.ts).
/** What the owner's claims program printed, for these words. */
export function ownerClaims(...args: string[]): unknown {
  return asOwner("owner-claims.ts", args);
}

// NEW IN STEP 21: the owner as org_456's accounts system, which adds, changes, and removes the
// tests' own invoice, INV-9001 (test/owner-invoices.ts; step 21's README, decision 12).
/** What the owner's invoice program printed, for these words. */
export function ownerInvoices(...args: string[]): unknown {
  return asOwner("owner-invoices.ts", args);
}

/** Every row of dsor.audit with this request id, read by the owner. */
export function ownerRowsFor(request_id: string): Record<string, unknown>[] {
  return asOwner("owner-reads.ts", [request_id]) as Record<string, unknown>[];
}

/** What DSoR's own store returns to the owner, whom no policy stops (test/owner-store.ts). */
export function ownerStore(): unknown {
  return asOwner("owner-store.ts");
}

/**
 * What the start-up check finds wrong with the owner's login, when look-alikes of
 * PostgreSQL's functions come first in its search path (test/owner-login-check.ts). Found
 * by step 16's review, and fixed from step 09 on.
 */
export function ownerLoginCheck(): string[] {
  return asOwner("owner-login-check.ts") as string[];
}

// The payments store's own SQL, with no policy behind it (step 17's README,
// "Think it through").
/** What the payments store does for the owner, whom no policy stops, across companies. */
export function ownerPayments(): unknown {
  return asOwner("owner-store.ts", ["payments"]);
}

// The list's own SQL, with no policy behind it (step 13's README, C7).
/** The ids DSoR's store lists for each company to the owner, whom no policy stops, and whether it bypasses them. */
export function ownerList(): unknown {
  return asOwner("owner-store.ts", ["list"]);
}

// The catalog, read inside the owner's transaction that made each thing
// the inspector must refuse, then rolled back (step 16's README, decision 8).
/** The catalog as dsor_runtime would see it, with the owner's rolled-back objects in it. */
export function ownerCatalog(): unknown {
  return asOwner("owner-catalog.ts");
}

/** A pool that holds one connection, so every request reuses it (step 11's README, decision 8). */
export function poolOfOne(): pg.Pool {
  return new pg.Pool({ connectionString: RUNTIME_URL, max: 1 });
}

/**
 * Every privilege the logged-in user holds on every relation, column, sequence, and schema
 * outside PostgreSQL's own, one row per object. Held directly, through PUBLIC, or through
 * a role it belongs to: has_..._privilege counts them all.
 */
// The relations, sequences, and schemas come from the catalog, not from a
// list of names, so one that no list names still shows here (step 16's README, decision 6).
export const PRIVILEGES_HELD = `
  WITH outside(oid) AS (SELECT oid FROM pg_namespace
                         WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'),
  tables(rel) AS (SELECT c.oid::regclass FROM pg_class c JOIN outside o ON o.oid = c.relnamespace
                   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')),
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
           unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p
     WHERE has_column_privilege(a.attrelid, a.attnum, p) GROUP BY 1),
  on_sequences AS (
    SELECT c.oid::regclass::text AS object, string_agg(p, ' ' ORDER BY p) AS held
      FROM pg_class c JOIN outside o ON o.oid = c.relnamespace,
           unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p
     WHERE c.relkind = 'S' AND has_sequence_privilege(c.oid, p) GROUP BY 1),
  on_schemas AS (
    SELECT 'schema ' || n.nspname AS object, string_agg(p, ' ' ORDER BY p) AS held
      FROM pg_namespace n JOIN outside o ON o.oid = n.oid, unnest(ARRAY['USAGE','CREATE']) AS p
     WHERE has_schema_privilege(n.oid, p) GROUP BY n.nspname)
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
