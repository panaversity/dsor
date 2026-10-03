// A PostgreSQL for the tests, with the migrations applied.
//
// PGlite is the real PostgreSQL engine compiled to WebAssembly, in-process. No server, no account
// and no connection string, so `pnpm check` proves the step's guarantees on a fresh checkout.
//
// One database per test *file*, not per test: creating one costs about 350ms, and 266 of those would
// turn a six-second suite into a five-minute one. Tests share the file's database and empty the table
// between them — as the **owner**, because the application's own account has no DELETE, which is the
// whole point of the step.

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrationsIn } from "../../src/migrations.ts";
import { useDatabase } from "../../src/audit.ts";

/** A fresh database with the migrations applied, pointed at by `audit.ts`. */
export async function aDatabase(): Promise<PGlite> {
  const db = await PGlite.create();

  // The application's account. In Neon a human creates this once; here it is per database. The
  // password is local, throwaway, and never leaves this process.
  await db.exec("CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-throwaway-not-a-secret';");

  for (const migration of migrationsIn(
    fileURLToPath(new URL("../../migrations", import.meta.url)),
  )) {
    await db.exec(migration.sql);
  }

  useDatabase(db);

  return db;
}

/**
 * Empty the log between tests, as the owner.
 *
 * `forgetTheLog()` in `audit.ts` runs `DELETE FROM audit`, which the application's account is refused.
 * It works here only because these tests hold the owner's connection — and that asymmetry is the
 * guarantee, not a convenience: a test can clear the log and the program cannot.
 */
export async function emptyTheLog(db: PGlite): Promise<void> {
  await db.exec("DELETE FROM public.audit");
}
