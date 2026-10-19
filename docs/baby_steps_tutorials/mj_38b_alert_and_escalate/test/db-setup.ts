// Runs before each database test file. With no DSOR_DB_URL, it throws, so
// every database test fails and none is skipped (step 09's README, decision 8).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeEach } from "vitest";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { endAttempts } from "./attempts.ts";

loadDotEnv(["DSOR_DB_URL"]);
const runtime = requireEnv("DSOR_DB_URL");

// And each file starts with no proposal in flight, which would hold its invoice
//   against the file's own attempts. The owner ends them, in a child of its own, so its key never
//   reaches this process (test/owner-attempts.ts; step 32's README, decision D15).
const owner = fileURLToPath(new URL("owner-attempts.ts", import.meta.url));
const cleared = spawnSync(process.execPath, [owner, "clear"], {
  encoding: "utf8",
  timeout: 60_000,
});
if (cleared.status !== 0) throw new Error(`owner-attempts.ts failed: ${cleared.stderr}`);

// And so does each test: the tests of one file draft the tests' own INV-9001 one
//   after another. A child of the owner takes half a second, so here DSoR's own login ends them
//   (test/attempts.ts; step 32's README, decision D15).
const pool = new pg.Pool({ connectionString: runtime, max: 1 });
beforeEach(() => endAttempts(pool));
afterAll(async () => {
  await pool.end();
});
