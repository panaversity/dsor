import { defineConfig } from "vitest/config";

// The database tests only, against the Neon branch in .env
// (step 09's README, decisions 8, 10, and 14). Run with `pnpm test:db`.
export default defineConfig({
  test: {
    include: ["test/**/*.db.test.ts"],
    // Stops every file at once when DSOR_DB_URL is missing, instead of skipping.
    setupFiles: ["test/db-setup.ts"],
    // A Neon compute that has gone to sleep takes a few seconds to wake up.
    testTimeout: 30_000,
    // NEW IN STEP 10: one file at a time. Found live 2026-09-29: the migrate test sets
    // dsor_runtime's password again, and a login that another file opened at that moment
    // failed with "password authentication failed" (step 10's README, Think it through).
    fileParallelism: false,
    hookTimeout: 30_000,
  },
});
