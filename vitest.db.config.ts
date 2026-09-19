import { defineConfig } from "vitest/config";

// Database tier: tests named *.db.test.ts. They need a real PostgreSQL reachable
// at DSOR_DB_URL. Row-level security, atomic reservations, and the idempotency
// claim cannot be proven against a mock (AGENTS.md → Testing).
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.db.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    passWithNoTests: true,
    fileParallelism: false,
  },
});
