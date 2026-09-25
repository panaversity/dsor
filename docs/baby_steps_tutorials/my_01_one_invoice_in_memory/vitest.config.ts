import { defineConfig } from "vitest/config";

// This step is its own small project, so it says where its own tests live.
// Without this file, vitest would walk up the folders and use the repository's config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
