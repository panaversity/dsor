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
    // `singleFork` stood here, with the comment above explaining what it bought. Vitest 4 has no
    // such option — the word appears nowhere in its code — so the files had been running in
    // parallel, and every "different failure each run" was that. Step 11 found it, measured it,
    // and this is the line that does what the comment promised. The configs are typechecked now,
    // which is how a dead option was caught.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

export default config;
