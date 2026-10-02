import { defineConfig } from "vitest/config";

// This step is its own small project, so it says where its own tests live.
// Without this file, vitest would walk up the folders and use the repository's config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],

    // NEW IN STEP 09, and it had to be found the hard way.
    //
    // `src/audit.ts` holds one database connection in a module-level variable, because a program has
    // one database. Test files each make their own PGlite and point `audit.ts` at it — and if two
    // files share a process, the second one's `useDatabase` replaces the first one's while the first
    // is still running. Both then compute `sequence` from `max(sequence)` of the wrong table, and the
    // insert fails with `duplicate key value violates unique constraint "audit_pkey"`.
    //
    // That is what it looked like: 27 failures in the whole suite, and `decision-first.test.ts`
    // passing all 21 of its tests when run on its own. A file that passes alone and fails in company
    // is shared state, every time.
    //
    // One process per file, so module state cannot cross between them.
    pool: "forks",
    poolOptions: { forks: { singleFork: false } },
    isolate: true,
    fileParallelism: true,
  },
});
