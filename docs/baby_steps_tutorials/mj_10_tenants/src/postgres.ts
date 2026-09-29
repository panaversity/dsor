// NEW IN STEP 09: everything that talks to PostgreSQL. The log is the table dsor.audit,
// which dsor_runtime can add to and read, and never change (DSOR-AUD-04a in
// specs/dsor/03-execution.md, section 30). The invoices are the table app.invoices.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";
import type { InvoiceStatus, InvoiceStore } from "./invoice.ts";
import type { Decision, DecisionLog, DecisionRecord } from "./log.ts";
import { money } from "./money.ts";

// The step's own .env, found from this file, so the program finds it whatever folder it
// is started from. Found by step 06's review, for roles.json.
const DOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));

/**
 * Copies the named variables from the step's .env into the environment, when the file
 * exists. A variable already set wins, even when it is "".
 */
export function loadDotEnv(
  names: string[],
  file: string = DOT_ENV,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // Node reads .env itself, so no package is needed (step 09's README, decision 4). There
  // is no .env in CI: there the variables are set, or missing.
  if (!existsSync(file)) return;
  // Only the names asked for. Found by step 09's review: loading the whole file put the
  // owner's key, DSOR_MIGRATION_URL, inside the running program.
  const found = parseEnv(readFileSync(file, "utf8"));
  for (const name of names) {
    const value = found[name];
    if (env[name] === undefined && value !== undefined) env[name] = value;
  }
}

/** The value of a variable. Missing or empty, it throws an error that names the variable. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value === "") {
    const where = `step 09's README, "Before you build: set up Neon"`;
    throw new Error(`${name} is not set. Put it in this step's .env file (${where}).`);
  }
  return value;
}

/** A pool of connections to the database at this URL. It connects at its first query. */
export function openPool(url: string): pg.Pool {
  // A pool keeps a few connections open and lends one to each query (step 09's README,
  // decision 1).
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // The server may close a connection the pool is keeping, for example when Neon's compute
  // goes to sleep. The pool drops it and opens another at the next query. Without this
  // listener, Node would stop the whole program. pg's documentation asks for it.
  pool.on("error", () => {});
  return pool;
}

// One row of dsor.audit, as pg gives it back.
type AuditRow = {
  record_id: string;
  sequence: string; // a bigint comes back as text, because it can outgrow a number
  at: Date;
  kind: "decision";
  operation: string | null;
  authorization: "ALLOW" | "DENY";
  result: string;
  reason: string | null;
  correlation: DecisionRecord["correlation"];
};

/** The log, as rows of dsor.audit. */
export function createDbLog(pool: pg.Pool): DecisionLog {
  return Object.freeze({
    add: async (decision: Decision): Promise<void> => {
      // One INSERT is one transaction. The query finishes only after Postgres has
      // committed it, so when add returns, the record survives a crash: "durably" in
      // DSOR-EXE-02. The database gives the record its number and its time (step 09's
      // README, decision 6).
      await pool.query(
        `INSERT INTO dsor.audit
           (record_id, kind, operation, "authorization", result, reason, correlation)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `aud_${randomUUID()}`,
          decision.kind,
          decision.operation ?? null,
          decision.authorization,
          decision.result,
          decision.reason ?? null,
          decision.correlation,
        ],
      );
    },
    records: async (): Promise<DecisionRecord[]> => {
      const { rows } = await pool.query<AuditRow>(
        `SELECT record_id, sequence, at, kind, operation, "authorization", result, reason,
                correlation
           FROM dsor.audit ORDER BY sequence`,
      );
      return rows.map(recordOf);
    },
  });
}

// The same shape as a record in memory: no operation or reason when there is none.
function recordOf(row: AuditRow): DecisionRecord {
  return {
    record_id: row.record_id,
    sequence: Number(row.sequence),
    at: row.at.toISOString(),
    kind: row.kind,
    ...(row.operation === null ? {} : { operation: row.operation }),
    authorization: row.authorization,
    result: row.result,
    ...(row.reason === null ? {} : { reason: row.reason }),
    correlation: row.correlation,
  };
}

// One row of app.invoices. Money is stored as numeric and char(3) (step 09's README,
// decision 7), and pg gives a numeric back as text, so no number ever touches it.
type InvoiceRow = {
  id: string;
  vendor_id: string;
  amount_value: string;
  amount_currency: string;
  open_amount_value: string;
  open_amount_currency: string;
  status: InvoiceStatus;
};

/** The invoices, read from app.invoices. */
export function createDbInvoices(pool: pg.Pool): InvoiceStore {
  return {
    get: async (id) => {
      const { rows } = await pool.query<InvoiceRow>(
        `SELECT id, vendor_id, amount_value, amount_currency,
                open_amount_value, open_amount_currency, status
           FROM app.invoices WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      // money() checks the text again, so a number from a wrong query is refused here.
      return {
        id: row.id,
        vendor_id: row.vendor_id,
        amount: money(row.amount_value, row.amount_currency),
        open_amount: money(row.open_amount_value, row.open_amount_currency),
        status: row.status,
      };
    },
  };
}

// NEW IN STEP 09: what Postgres says about the user the program logged in as (step 09's
// README, decision 17).
/** The facts the start-up check needs about the logged-in user. */
export type RoleFacts = {
  who: string;
  superuser: boolean;
  bypassrls: boolean;
  writes_all: boolean;
  owns: number;
  can_change_audit: boolean;
};

/** Every reason this login must not run the program. None means it may. */
export function problemsOf(facts: RoleFacts): string[] {
  const problems: string[] = [];
  if (facts.who !== "dsor_runtime") problems.push(`logged in as "${facts.who}", not dsor_runtime`);
  if (facts.superuser) problems.push("is a superuser");
  if (facts.bypassrls) problems.push("holds BYPASSRLS");
  if (facts.writes_all) problems.push("is a member of pg_write_all_data");
  if (facts.owns > 0) problems.push(`owns ${facts.owns} tables`);
  if (facts.can_change_audit) problems.push("can change or remove records in dsor.audit");
  return problems;
}

/** Asks Postgres about the pool's own login, and gives back every problem with it. */
export async function runtimeRoleProblems(pool: pg.Pool): Promise<string[]> {
  // has_..._privilege counts privileges held directly, through PUBLIC, and through every
  // role this one belongs to. A grant on one column counts too.
  const { rows } = await pool.query<RoleFacts>(
    `SELECT r.rolname AS who, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
            pg_has_role(r.oid, 'pg_write_all_data', 'MEMBER') AS writes_all,
            (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns,
            has_table_privilege('dsor.audit', 'DELETE')
              OR has_table_privilege('dsor.audit', 'TRUNCATE')
              OR has_any_column_privilege('dsor.audit', 'UPDATE') AS can_change_audit
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  return problemsOf(rows[0]!);
}
