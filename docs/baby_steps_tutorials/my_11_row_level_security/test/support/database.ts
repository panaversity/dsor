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
import { overPGlite } from "../../src/database.ts";
import { useDatabase } from "../../src/store.ts";

/** The owner's own connection, for the seams below. Set by `aDatabase`. */
let owner: PGlite | undefined;

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

  // NEW IN STEP 11: through the adapter, so that a statement can say its company.
  useDatabase(overPGlite(db));
  owner = db;

  return db;
}

/**
 * NEW IN STEP 10: put the invoices back to how the story starts.
 *
 * A test seam, as the owner: the application holds neither DELETE nor INSERT on invoices, which is
 * the point. The rows come from `004_running_example.sql` — the one place the story is written —
 * rather than from a second copy of it here, so the two can never disagree.
 */
export async function resetInvoices(): Promise<void> {
  // The owner's own connection, with no company said: these rows belong to two companies, and
  // the owner is a superuser here, which no policy filters.
  const db = owner;

  if (db === undefined) {
    throw new TypeError("call aDatabase() first");
  }

  await db.query("DELETE FROM public.invoices");

  for (const migration of migrationsIn(
    fileURLToPath(new URL("../../migrations", import.meta.url)),
  )) {
    if (migration.name === "004_running_example.sql") {
      await db.query(migration.sql);
    }
  }
}
