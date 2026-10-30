import { defineConfig } from "vitest/config";

// NEW IN STEP 09: the database tests only, against the Neon branch in .env
// (step 09's README, decisions 8, 10, and 14). Run with `pnpm test:db`.
export default defineConfig({
  test: {
    include: ["test/**/*.db.test.ts"],
    // Stops every file at once when DSOR_DB_URL is missing, instead of skipping.
    setupFiles: ["test/db-setup.ts"],
    // A Neon compute that has gone to sleep takes a few seconds to wake up.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
