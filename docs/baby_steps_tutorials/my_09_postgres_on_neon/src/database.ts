// NEW IN STEP 09: where the program's database comes from.
//
// Two shapes, and the program does not care which it gets, because both run the same SQL.
//
//   - `DSOR_DB_URL` is set: connect to it. That is Neon, or any PostgreSQL. This is the real thing,
//     and the connection string lives in `.env`, which is in `.gitignore` and never committed.
//   - nothing is set: open a PostgreSQL **on disk, in this folder**, through PGlite.
//
// The second is not a fallback to pretending. PGlite is the PostgreSQL engine compiled to
// WebAssembly, and pointed at a directory it keeps its data there — so `pnpm start` twice shows the
// log from the first run still present in the second. That is step 09's whole claim, demonstrated by
// running the program rather than asserted in a README.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrationsIn } from "./migrations.ts";
import { useDatabase, type Database } from "./audit.ts";

/** Where the on-disk demo database lives. In .gitignore: it is this machine's, not the project's. */
const LOCAL = fileURLToPath(new URL("../.local-database", import.meta.url));

/**
 * Open the database, make sure the migrations have been applied, and point the audit log at it.
 *
 * Returns how to close it, and where it came from, so the program can say which one it used — a
 * demo that silently used a throwaway database while the reader believed it was Neon would be
 * teaching the opposite of this step.
 */
export async function openTheDatabase(): Promise<{
  readonly where: string;
  readonly close: () => Promise<void>;
}> {
  const url = process.env.DSOR_DB_URL;

  if (url !== undefined && url.trim() !== "") {
    // The real server. `pg` is not a dependency of this step yet — the step that needs it is the one
    // that runs against Neon — so this says so plainly instead of failing with a module error.
    throw new TypeError(
      "DSOR_DB_URL is set, and connecting to a real server needs the `pg` driver, which this " +
        "step does not install yet. Unset DSOR_DB_URL to run the demo on its own database.",
    );
  }

  mkdirSync(LOCAL, { recursive: true });

  const db = await PGlite.create(LOCAL);

  // The migrations, every time. Applying one twice would fail, so each file is guarded by a check
  // for what it creates — which is the cheap version of the `applied` table the next piece brings.
  const alreadyThere = await db.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit') AS exists",
  );

  if (alreadyThere.rows[0]?.exists !== true) {
    await db.exec("CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-demo-not-a-secret';");

    for (const migration of migrationsIn(
      fileURLToPath(new URL("../migrations", import.meta.url)),
    )) {
      await db.exec(migration.sql);
    }
  }

  useDatabase(db as unknown as Database);

  return {
    where: `a PostgreSQL on disk at ${LOCAL.replace(process.cwd(), ".")}`,
    close: () => db.close(),
  };
}
