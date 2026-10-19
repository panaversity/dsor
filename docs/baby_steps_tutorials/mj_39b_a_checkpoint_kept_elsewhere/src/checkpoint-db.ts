// NEW IN STEP 39b: what the checkpoint scripts read from the database, in the caller's transaction.
// The owner is the one the checkpoints guard against, so the reads trust as little of the owner's
// database as they can: PostgreSQL's own functions only, never one the owner named the same, and
// the log and its heads only when both are plain tables (found by step 39b's review, H2 and H3;
// step 39b's README, decisions D12 and D15).
import type pg from "pg";
import { readChains, readHeads } from "./audit-chain.ts";
import type { Log } from "./checkpoint.ts";

/** A log the checker must not trust: the reason, said to the person who runs the script. */
export class NotAPlainLog extends Error {}

/** Whether this login sees every record: the log forces row-level security (step 39's review, H1). */
export async function seesEveryRecord(client: pg.ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ sees: boolean }>(
    "SELECT rolsuper OR rolbypassrls AS sees FROM pg_catalog.pg_roles WHERE rolname = current_user",
  );
  return rows[0]?.sees === true;
}

/**
 * Every record, every head, the database's name and its server's id, and the database's clock. The
 * caller's transaction should be REPEATABLE READ, so the records and the heads are of one moment.
 */
export async function readLog(client: pg.ClientBase): Promise<Log & { databaseNow: string }> {
  // PostgreSQL's own functions first, always: an owner's public.now() or public.to_char() is never
  //   found (the review, H2). pg_temp last, where functions are never looked up.
  await client.query("SET LOCAL search_path TO pg_catalog, pg_temp");
  // A view or a rule in place of the log could show this read other rows than everyone else sees
  //   (the review, H3).
  const { rows: tables } = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'dsor' AND c.relname IN ('audit', 'audit_heads')
        AND c.relkind = 'r' AND NOT c.relhasrules`,
  );
  if (tables.length !== 2) {
    throw new NotAPlainLog("dsor.audit or dsor.audit_heads is not a plain table");
  }
  const rows = await readChains(client);
  const heads = await readHeads(client);
  const { rows: about } = await client.query<{ id: string; name: string; now: string }>(
    `SELECT (SELECT system_identifier::text FROM pg_control_system()) AS id,
            current_database() AS name,
            to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
  );
  const { id, name, now } = about[0]!;
  return { rows, heads, database: { system_identifier: id, name }, databaseNow: now };
}

/**
 * The log, read as the owner whose login this is, read only, at one moment: or why it was not read.
 * Exit 2 when this login cannot see every record; exit 1 when the log is not a plain table, which
 * no migration of DSoR's makes, so someone changed it (decision D15).
 */
export async function readLogAsOwner(
  pool: pg.Pool,
): Promise<{ log: Log & { databaseNow: string } } | { refused: string; exit: 1 | 2 }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (!(await seesEveryRecord(client))) {
      const refused = "this login cannot see every record of the log (it needs BYPASSRLS)";
      return { refused, exit: 2 };
    }
    try {
      return { log: await readLog(client) };
    } catch (error) {
      if (error instanceof NotAPlainLog) return { refused: error.message, exit: 1 };
      throw error;
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
