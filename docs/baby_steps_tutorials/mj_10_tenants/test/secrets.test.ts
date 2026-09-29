// NEW IN STEP 09: the unit tests of this step. They need no database: the secrets stay
// out of git (C7), the database tests fail loudly without one (decision 8), and the
// invoices have a store in memory for every other unit test (decision 12).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { memoryInvoices } from "../src/invoice.ts";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";

const HERE = new URL("../", import.meta.url);

describe("C7: no secret is in git", () => {
  // Read from .gitignore, not from git, so the test also runs in a copy with no git.
  it("the step's .gitignore ignores .env and every .env.* except .env.example", () => {
    const lines = readFileSync(new URL(".gitignore", HERE), "utf8").split("\n");
    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
    expect(lines).toContain("!.env.example");
  });

  it(".env.example names the two variables, with no value", () => {
    const text = readFileSync(new URL(".env.example", HERE), "utf8");
    const settings = text.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
    expect(settings).toStrictEqual(["DSOR_MIGRATION_URL=", "DSOR_DB_URL="]);
  });
});

// Found by the review: loading the whole .env put the owner's key inside the program
// (step 09's README, decision 4).
describe("C7: the program takes only the names it asks for from .env", () => {
  it("loads DSOR_DB_URL and leaves DSOR_MIGRATION_URL in the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsor-env-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(
        file,
        "DSOR_MIGRATION_URL=postgresql://owner\nDSOR_DB_URL=postgresql://runtime\n",
      );
      const env: NodeJS.ProcessEnv = {};
      loadDotEnv(["DSOR_DB_URL"], file, env);
      expect(env).toStrictEqual({ DSOR_DB_URL: "postgresql://runtime" });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("keeps a variable that is already set, even to an empty string", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsor-env-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "DSOR_DB_URL=postgresql://runtime\n");
      const env: NodeJS.ProcessEnv = { DSOR_DB_URL: "" };
      loadDotEnv(["DSOR_DB_URL"], file, env);
      expect(env).toStrictEqual({ DSOR_DB_URL: "" });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("does nothing when there is no .env, as in CI", () => {
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv(["DSOR_DB_URL"], join(tmpdir(), "no-such-dir-dsor", ".env"), env);
    expect(env).toStrictEqual({});
  });
});

// Found by the review: nothing tested migrate.ts. These refusals come before it connects,
// so they need no database. Port 1 has no server: a connection attempt would fail loudly.
describe("C7: pnpm migrate refuses a DSOR_DB_URL that is not dsor_runtime with a password", () => {
  const MIGRATE = fileURLToPath(new URL("src/migrate.ts", HERE));
  const OWNER = "postgresql://owner:secret@127.0.0.1:1/neondb";
  function migrate(env: Record<string, string>): { status: number | null; out: string } {
    const run = spawnSync(process.execPath, [MIGRATE], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: run.status, out: run.stdout + run.stderr };
  }

  it.each([
    ["the owner's name", "postgresql://neondb_owner:pw@127.0.0.1:1/neondb"],
    ["dsor_runtime with no password", "postgresql://dsor_runtime@127.0.0.1:1/neondb"],
  ])("refuses %s, and names the problem", { timeout: 30_000 }, (_why, url) => {
    const { status, out } = migrate({ DSOR_MIGRATION_URL: OWNER, DSOR_DB_URL: url });
    expect(status).toBe(1);
    expect(out).toMatch("DSOR_DB_URL must log in as dsor_runtime, with a password.");
    expect(out).not.toMatch("pw");
  });

  it("refuses to run with no DSOR_MIGRATION_URL", { timeout: 30_000 }, () => {
    const { status, out } = migrate({ DSOR_MIGRATION_URL: "", DSOR_DB_URL: "postgresql://x" });
    expect(status).toBe(1);
    expect(out).toMatch("DSOR_MIGRATION_URL is not set");
  });
});

describe("decision 8: with no database named, the database tests fail and never skip", () => {
  it("requireEnv names a variable that is missing", () => {
    expect(() => requireEnv("DSOR_DB_URL", {})).toThrow("DSOR_DB_URL is not set");
  });

  it("requireEnv treats an empty variable as missing", () => {
    expect(() => requireEnv("DSOR_DB_URL", { DSOR_DB_URL: "" })).toThrow("DSOR_DB_URL is not set");
  });

  it("requireEnv gives back the value when it is set", () => {
    expect(requireEnv("DSOR_DB_URL", { DSOR_DB_URL: "postgresql://x" })).toBe("postgresql://x");
  });

  // The real command, with the variable set to "". .env does not override a variable
  // that is already set, so no database is reached.
  it(
    "pnpm test:db with DSOR_DB_URL empty fails, and names the variable",
    { timeout: 60_000 },
    () => {
      const vitest = fileURLToPath(new URL("node_modules/vitest/vitest.mjs", HERE));
      const run = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.db.config.ts"], {
        cwd: fileURLToPath(HERE),
        encoding: "utf8",
        env: { ...process.env, DSOR_DB_URL: "" },
      });
      expect(run.status).not.toBe(0);
      expect(run.stdout + run.stderr).toMatch("DSOR_DB_URL is not set");
      // Nothing passed and nothing skipped: every database test file failed to start.
      expect(run.stdout + run.stderr).not.toMatch(/\d+ passed|skipped/);
    },
  );
});

describe("decision 12: the invoices in memory, for the unit tests", () => {
  it("DSOR-MON-01: the store in memory gives INV-1008, its money a string", async () => {
    expect(await memoryInvoices().get("org_456", "INV-1008")).toStrictEqual({
      tenant_id: "org_456",
      id: "INV-1008",
      vendor_id: "VENDOR-44",
      amount: { value: "31400.00", currency: "USD" },
      open_amount: { value: "31400.00", currency: "USD" },
      status: "issued",
    });
  });

  it("gives back undefined for an invoice that is not there", async () => {
    expect(await memoryInvoices().get("org_456", "INV-9999")).toBeUndefined();
  });

  it("gives a copy, so a caller that changes it cannot change the store", async () => {
    const store = memoryInvoices();
    const first = await store.get("org_456", "INV-1008");
    first!.status = "paid";
    expect((await store.get("org_456", "INV-1008"))!.status).toBe("issued");
  });
});
