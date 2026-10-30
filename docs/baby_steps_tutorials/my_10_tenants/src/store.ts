// NEW IN STEP 10: the one database handle, shared by every store.
//
// Step 09 kept this inside audit.ts because the audit log was the only thing with rows. Now the
// invoices have rows too, and they must be the SAME rows the log is in — one database, one
// connection, so that a later step can commit a business change and DSoR's record of it together
// (§21.16, step 36). So the handle moves out to a file both stores import, and nothing else changes:
// `useDatabase` is still what main.ts and the tests call, and audit.ts still exports it.

/**
 * Anything that can run SQL and give back rows.
 *
 * One method, because that is all the stores need. `pg`'s Pool satisfies it, and so does PGlite, so
 * the same SQL runs against Neon in production and against PostgreSQL-in-process in the tests.
 *
 * This is deliberately **not** a second implementation of a store. There is one store — the SQL in
 * audit.ts and invoice.ts — and two things that can execute it. A second in-memory implementation
 * would be faster and would be a thing that can drift from the real one while the tests stay green.
 */
export interface Database {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
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

/** The database every store runs its SQL against. Throws, loudly, if nobody called `useDatabase`. */
export function theDatabase(): Database {
  if (database === undefined) {
    throw new TypeError(
      "there is no database: call useDatabase() before reading or recording anything. " +
        "Step 09 moved the log out of memory and step 10 moved the invoices, so there is nowhere " +
        "else for a row to go.",
    );
  }

  return database;
}
