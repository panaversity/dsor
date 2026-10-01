// NEW IN STEP 09: the command that applies the migrations.
//
// This piece does the half that needs no database: find the migrations, check them, and say what it
// found. Applying them — and remembering which ones have been applied — is the next piece, and it
// needs a connection string.
//
// It is a script rather than a library because that is how it is used: `pnpm migrate`. The deciding
// is in src/migrations.ts, where a test can reach it.

import { fileURLToPath } from "node:url";
import { migrationsIn } from "../src/migrations.ts";

const folder = fileURLToPath(new URL("../migrations", import.meta.url));
const migrations = migrationsIn(folder);

if (migrations.length === 0) {
  console.log("No migrations yet. The first one arrives with the audit table.");
} else {
  console.log(`${migrations.length} migration(s), in the order they will be applied:\n`);

  for (const { number, name, sql } of migrations) {
    const lines = sql.trim().split("\n").length;

    console.log(`  ${String(number).padStart(3, "0")}  ${name.padEnd(32)} ${lines} line(s) of SQL`);
  }
}

console.log();

// Said plainly rather than implied by silence. A command that prints a list and exits 0 looks like a
// command that did something.
console.log("Nothing was applied: this piece can read the migrations and not yet run them.");
console.log("The next piece connects to PostgreSQL, and needs DSOR_DB_OWNER_URL in .env.");
