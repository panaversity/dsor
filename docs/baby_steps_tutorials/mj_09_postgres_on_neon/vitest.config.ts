import { defineConfig } from "vitest/config";

// This step is its own small project, so it says where its own tests live.
// Without this file, vitest would walk up the folders and use the repository's config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // NEW IN STEP 09: `pnpm test` needs no database. The database tests end in
    // .db.test.ts and run with `pnpm test:db` (step 09's README, decisions 8 and 14).
    exclude: ["**/node_modules/**", "test/**/*.db.test.ts"],
  },
});
