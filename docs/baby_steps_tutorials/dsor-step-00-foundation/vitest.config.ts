import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// Unit tier: pure and fast. No database, no network, no subprocesses.
// The database tier has its own config (vitest.db.config.ts) because it needs a
// real PostgreSQL and must never be collected here.
export default defineConfig({
  resolve: {
    // Workspace packages resolve to their source, so the unit tier never needs a build.
    alias: {
      "@panaversity/dsor-spec": src("./packages/spec/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "docs/baby_steps_tutorials/*/test/**/*.test.ts"],
    exclude: ["**/*.db.test.ts", "**/node_modules/**", "**/dist/**"],
  },
});
