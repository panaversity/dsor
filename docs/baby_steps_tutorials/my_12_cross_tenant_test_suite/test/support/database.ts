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
import { APPLICATION_ROLE, overPGlite } from "../../src/database.ts";
import { forgetTheLog as forgetTheLogAsWhoeverIsConnected } from "../../src/audit.ts";
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

  // STEP 11: through the adapter, so that a statement can say its company — and AS THE
  // APPLICATION. PGlite's one connection belongs to `postgres`, a superuser, and a superuser skips
  // every row-level policy. Tests that ran the stores as it would stay green whether or not a
  // store said its company, and would prove nothing about this step. So the connection drops to
  // `dsor_runtime` here, the way the program's own door does, and the two seams below step back up
  // to the owner for exactly as long as they need.
  useDatabase(overPGlite(db));
  owner = db;
  await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

  return db;
}

/**
 * STEP 10: put the invoices back to how the story starts.
 *
 * A test seam, as the owner: the application holds neither DELETE nor INSERT on invoices, which is
 * the point. The rows come from `004_running_example.sql` — the one place the story is written —
 * rather than from a second copy of it here, so the two can never disagree.
 */
export async function resetInvoices(): Promise<void> {
  // As the owner, with no company said: these rows belong to two companies, and the owner is a
  // superuser here, which no policy filters.
  await asTheOwner(async () => {
    const db = theOwner();

    await db.query("DELETE FROM public.invoices");

    for (const migration of migrationsIn(
      fileURLToPath(new URL("../../migrations", import.meta.url)),
    )) {
      if (migration.name === "004_running_example.sql") {
        await db.query(migration.sql);
      }
    }
  });
}

function theOwner(): PGlite {
  if (owner === undefined) {
    throw new TypeError("call aDatabase() first");
  }

  return owner;
}

/**
 * STEP 11: run something as the owner, then drop back to the application.
 *
 * `SET ROLE` is per session and PGlite has one, so this is the only way a test gets owner rights:
 * for the body of `run`, and not a statement longer. The `finally` is the guarantee — a seam that
 * threw halfway would otherwise leave every later test running as a superuser, green and blind.
 */
export async function asTheOwner<T>(run: () => Promise<T>): Promise<T> {
  const db = theOwner();
  // Whoever is connected now is who is connected afterwards. A review read the first version,
  // which always dropped to the application, and asked what an `asTheOwner` inside another one
  // would do to its caller: leave it as the application, silently. Nobody nests them yet.
  const { rows } = await db.query<{ who: string }>("SELECT current_user AS who");
  const before = rows[0]?.who ?? APPLICATION_ROLE;

  await db.exec("RESET ROLE");

  try {
    return await run();
  } finally {
    await db.exec(`SET ROLE ${before}`);
  }
}

/**
 * STEP 11: erase one company's log, as the owner.
 *
 * `audit.ts` still exports the eraser, and it still runs as whoever is connected — which is now
 * the application, who may not DELETE. Tests import this one instead.
 */
export async function forgetTheLog(tenant: string): Promise<void> {
  await asTheOwner(() => forgetTheLogAsWhoeverIsConnected(tenant));
}
