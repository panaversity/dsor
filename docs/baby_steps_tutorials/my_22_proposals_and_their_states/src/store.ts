// The one database handle, shared by every store — and, STEP 11, the one place a statement
// says which company it is for.
//
// Step 10 kept the two companies apart with a WHERE in every query. That is one lock, and the
// program holds it alone: a query that forgets the WHERE leaks, and no test notices, because the
// tests only check the queries that exist today. This step adds a second lock inside PostgreSQL
// (migrations/005_row_level_security.sql): the database itself hides every other company's rows.
// A lock inside the database has to be told which company a statement is for, and the telling is
// what this file does — once, in the handle every store goes through, so that no store can run a
// statement about rows without it.
//
// Rule DSOR-RP-01c: the tenant setting MUST be transaction-local.

/**
 * Anything that can run SQL and give back rows: the connection the program holds.
 *
 * One method, because that is all the stores need. `pg`'s Pool and PGlite both become one through
 * the two adapters in database.ts, so the same SQL runs against Neon in production and against
 * PostgreSQL-in-process in the tests. This is deliberately **not** a second implementation of a
 * store. There is one store — the SQL in audit.ts and invoice.ts — and two things that can execute
 * it.
 *
 * STEP 11: the third argument. `tenant` is the company the statement is for. The statement
 * then runs in a transaction of its own that first sets `dsor.tenant_id` to that company, and the
 * setting dies with the transaction (DSOR-RP-01c) — so nothing is left on the connection for the
 * next request to inherit, which is the pool leak §36 warns about. Left out, the statement runs
 * with no company and PostgreSQL answers with no rows (DSOR-RP-01d). That is right only for a
 * statement about the database itself — the catalogue questions the start-up check asks — and
 * never for one about rows, which is why the stores cannot leave it out: see `theDatabase`.
 */
export interface Database {
  query: <T>(sql: string, params?: unknown[], tenant?: string) => Promise<{ rows: T[] }>;

  /**
   * NEW IN STEP 22, decision 158: several statements in one transaction for one company, run only
   * when it is their turn in `line`, and the turn lasts until the transaction ends. A second caller
   * in the same line waits for the first to commit or roll back. The log is the one line today:
   * `recordTogether` reads the end of a company's log and writes after it in one turn. A turn's
   * `work` must never ask for a turn in its own line: it would wait for itself, for ever.
   *
   * Optional, and only for a test's stand-in, which is a `query` and nothing else. Without it the
   * statements run one transaction each, with no turn, as they did before this decision. Both real
   * connections in database.ts have it.
   */
  inTurn?: <T>(
    tenant: string,
    line: string,
    work: (statements: Statements) => Promise<T>,
  ) => Promise<T>;
}

/** What a store is handed: statements that are always for one company. */
export interface Statements {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

/** NEW IN STEP 22, decision 158: the company's statements, and a way to wait for a turn. */
export interface StatementsInTurn extends Statements {
  inTurn: <T>(line: string, work: (statements: Statements) => Promise<T>) => Promise<T>;
}

let database: Database | undefined;

/**
 * Point every store at a database. `openTheDatabase` calls this with a connection it has checked;
 * a test calls it with PGlite.
 *
 * It is required rather than lazily defaulted, and the error below says why: a program that quietly
 * kept writing to memory when its database was missing would lose exactly the evidence step 09
 * exists to keep.
 */
export function useDatabase(db: Database): void {
  database = db;
}

/**
 * The database every store runs its SQL against, for one company.
 *
 * Throws, loudly, if nobody called `useDatabase`. And throws if no company was said: a store that
 * wants rows without saying whose is a bug in the program, and the database's own answer to that
 * bug — no rows — would come back as a tidy "not found" and hide it.
 */
export function theDatabase(tenant: string): StatementsInTurn {
  if (database === undefined) {
    throw new TypeError(
      "there is no database: call useDatabase() before reading or recording anything. " +
        "Step 09 moved the log out of memory and step 10 moved the invoices, so there is nowhere " +
        "else for a row to go.",
    );
  }

  // Blank includes whitespace: " " is not a company either, and the policy would answer it with
  // no rows — the quiet route this guard exists to close.
  if (typeof tenant !== "string" || tenant.trim() === "") {
    throw new TypeError(
      "a store asked for rows with no company said. Every statement about rows is for exactly " +
        "one company, and PostgreSQL would answer a statement with none with no rows at all.",
    );
  }

  // Captured now, not looked up per statement: one write runs on one connection from its tail
  // read to its INSERT. NEW IN STEP 22, decision 157: tests swap the handle in that gap now, to
  // write another request's record at the place this write chose; they swap it back before this
  // write goes on, so the capture is still a property worth having rather than one anything relies on.
  const connection = database;
  const query: Statements["query"] = (sql, params) => connection.query(sql, params, tenant);

  return {
    query,
    inTurn: (line, work) =>
      connection.inTurn === undefined ? work({ query }) : connection.inTurn(tenant, line, work),
  };
}
