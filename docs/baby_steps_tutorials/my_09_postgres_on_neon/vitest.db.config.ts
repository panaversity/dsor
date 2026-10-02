import { defineConfig } from "vitest/config";

// The database tier: tests that need a real PostgreSQL server, which PGlite cannot stand in for.
//
// `pnpm check` never collects these — `vitest.config.ts` includes `test/**/*.test.ts`, and these are
// `*.db.test.ts`. They run only under `pnpm test:db`, and only with DSOR_DB_URL set, so the step
// still runs with no database and no network like every step before it.
//
// What is in here is what one in-process connection cannot do: log in as a second user, and race.
export default defineConfig({
  test: {
    include: ["test/**/*.db.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
