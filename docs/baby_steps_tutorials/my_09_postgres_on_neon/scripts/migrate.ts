// `pnpm migrate` — bring the database's shape up to date.
//
// Applies whatever has not been applied, in order, each one with its record in a single transaction.
// A second run does nothing, and says so, because "already up to date" and "it worked" are different
// facts and a command that prints the same thing for both is a command you cannot trust.
//
// Which database: `DSOR_DB_OWNER_URL` if it is set — the owner's connection, because migrations
// create and change tables and the application's account cannot. Otherwise the demo's own PostgreSQL
// on disk, the same one `pnpm start` uses.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, type Runner } from "../src/migrations.ts";

const FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));
const LOCAL = fileURLToPath(new URL("../.local-database", import.meta.url));

if (process.env.DSOR_DB_OWNER_URL !== undefined && process.env.DSOR_DB_OWNER_URL.trim() !== "") {
  console.error(
    "DSOR_DB_OWNER_URL is set, and connecting to a real server needs the `pg` driver, which this\n" +
      "step does not install yet. Unset it to migrate the demo's own database.",
  );
  process.exit(1);
}

mkdirSync(LOCAL, { recursive: true });

const db = await PGlite.create(LOCAL);

// The application's account. On a real server a human creates this once, before the migrations run;
// here there is nobody to do it, so the command does it and says nothing, because it is not the
// lesson. 002_runtime_user.sql is the lesson, and it is in the migrations where it can be read.
await db.exec(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsor_runtime') THEN
    CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-demo-not-a-secret';
  END IF;
END $$;`);

const applied = await applyMigrations(db as unknown as Runner, FOLDER);

if (applied.length === 0) {
  console.log("Already up to date. Nothing was applied.");
} else {
  for (const migration of applied) {
    console.log(`applied ${migration.name}`);
  }
}

const { rows } = await db.query<{ name: string; applied_at: Date }>(
  "SELECT name, applied_at FROM applied_migrations ORDER BY name",
);

console.log();
console.log(`${rows.length} migration(s) applied to this database:`);

for (const row of rows) {
  console.log(`  ${row.name.padEnd(28)} ${row.applied_at.toISOString()}`);
}

await db.close();
