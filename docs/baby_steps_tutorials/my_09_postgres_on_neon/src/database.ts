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
import { applyMigrations, type Runner } from "./migrations.ts";
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

  // The application's account, if it is not there yet. On a real server a human creates this once;
  // here there is nobody to do it, and it is not the lesson — 002_runtime_user.sql is the lesson.
  await db.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsor_runtime') THEN
      CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-demo-not-a-secret';
    END IF;
  END $$;`);

  // And the migrations, through the same runner `pnpm migrate` uses. This used to ask whether the
  // `audit` table existed and skip everything if it did — which worked for exactly one migration,
  // and would have silently skipped the second the day it was added.
  await applyMigrations(
    db as unknown as Runner,
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );

  useDatabase(db as unknown as Database);

  return {
    where: `a PostgreSQL on disk at ${LOCAL.replace(process.cwd(), ".")}`,
    close: () => db.close(),
  };
}
