import { defineConfig } from "vitest/config";

// This step is its own small project, so it says where its own tests live.
// Without this file, vitest would walk up the folders and use the repository's config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    // The database tier is excluded here, not merely unmatched: `*.db.test.ts` ends in `.test.ts`,
    // so without this line `pnpm check` collects it and the step stops running without a server.
    // It has its own config, vitest.db.config.ts, and its own command, `pnpm test:db`.
    exclude: ["**/node_modules/**", "test/**/*.db.test.ts"],

    // STEP 09, and the shape took three attempts to get right.
    //
    // `src/audit.ts` holds one database connection in a module-level variable, because a program has
    // one database. Each test file makes its own PostgreSQL and points `audit.ts` at it — and two
    // files sharing a process means the second one's `useDatabase` replaces the first's while the
    // first is still running. Both then read `max(sequence)` from the wrong table and the insert dies
    // on the primary key. The symptom was 27 failures in the suite while one file passed all 21 of
    // its tests alone, which is what shared state always looks like.
    //
    // So: `isolate` gives every file a fresh module registry, which fixes that.
    //
    // Then the second problem. Twenty files each building a PostgreSQL, four at a time, with
    // `main.test.ts` also starting whole processes that build one — and the suite started failing
    // differently each run, with tests reported as *skipped*, which is the tell that a worker was
    // killed rather than that anything was wrong.
    //
    // `singleFork` is the answer: one process, files one after another. It is slower than parallel
    // and it always gives the same answer, and for a step a learner runs once that is the better
    // trade. A flaky suite teaches nothing except not to trust the suite.
    pool: "forks",
    singleFork: true,
    isolate: true,

    // Five seconds is the default and is for tests that do arithmetic. These start real databases,
    // and `main.test.ts` starts processes that each build one. The timeout is a safety net against a
    // hang, so it is generous rather than tight: a twenty-second test here is slow, not broken.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
