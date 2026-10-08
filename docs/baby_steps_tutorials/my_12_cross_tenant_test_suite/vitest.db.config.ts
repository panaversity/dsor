import { defineConfig, type ViteUserConfig } from "vitest/config";

// The database tier: tests that need a real PostgreSQL server, which PGlite cannot stand in for.
//
// `pnpm check` never collects these — `vitest.config.ts` includes `test/**/*.test.ts`, and these are
// `*.db.test.ts`. They run only under `pnpm test:db`, and only with DSOR_DB_URL set, so the step
// still runs with no database and no network like every step before it.
//
// What is in here is what one in-process connection cannot do: log in as a second user, and race.
const config: ViteUserConfig = defineConfig({
  test: {
    include: ["test/**/*.db.test.ts"],

    // Read `.env` first. Without this the tier skips itself for somebody who has set up a database
    // correctly, which is worse than failing: it looks like the tests ran.
    setupFiles: ["test/support/env.ts"],
    pool: "forks",
    // STEP 11, found live 2026-10-08: `singleFork` is not an option Vitest 4 has, so it was
    // never the files one after another, whatever this comment and decision 73 believed. It held in
    // step 09 and step 10 by luck — one file wrote the audit table, so nothing could collide. The
    // day a second file wrote it (commit-dies.db.test.ts), a different test failed on every run:
    // "duplicate key" in one, a count of 0 in the next, a race for position 0 in the third.
    // Measured: 3 failed | 13 passed as configured, three runs, three different sets; 16 passed with
    // this line. A real database is one piece of shared state, and the files that write it take
    // turns. `tsconfig.json` typechecks this file now, which is how the dead option was caught.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

export default config;
