// The program's full runs, moved here from startup.test.ts, because the
// program now needs the database (step 09's README, decision 15).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { RUNTIME_URL, redact } from "./db.ts";
import { notGranted } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

type Run = { status: number | null; stdout: string; stderr: string };

/**
 * Starts the program and gives back its output with every secret replaced by a label, so
 * a failing check can never print a secret (step 09's README, decision 18).
 */
function start(
  env: NodeJS.ProcessEnv = process.env,
  cwd?: string,
  secrets: Record<string, string> = {},
): Run {
  const run = spawnSync(process.execPath, [MAIN], { encoding: "utf8", env, cwd });
  const all = { ...secrets, "<runtime URL>": RUNTIME_URL };
  return { status: run.status, stdout: redact(run.stdout, all), stderr: redact(run.stderr, all) };
}

// No rule id: the program itself. Found by step 07's review: nothing ran src/main.ts, so
// a start-up that skipped the registry passed every test.
describe("the program", () => {
  // Found live 2026-09-26: on a busy machine, starting node took longer than vitest's
  // 5-second default. The database adds a connection, so each test waits up to 60 seconds.
  it(
    "starts, reads INV-1008 through invoice.get, and prints every answer as an envelope",
    { timeout: 60_000 },
    () => {
      const run = start();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const output = run.stdout;
      expect(output).toMatch("operations: [ 'invoice.get', 'invoice.issue' ]");
      // Found by step 08's review: "id: 'INV-1008'" also matches the address read back, so
      // the success envelope could go unprinted. "data: {" is only in the success.
      expect(output).toMatch("data: {");
      expect(output).toMatch("id: 'INV-1008'");
      // The money read from the database, still a string. Anchored to the start of the line:
      // found by break T7, "amount: {" also matches inside "open_amount: {".
      expect(output).toMatch(/^\s+amount: \{ value: '31400\.00', currency: 'USD' \}/m);
      expect(output).toMatch(/^\s+open_amount: \{ value: '31400\.00', currency: 'USD' \}/m);
      expect(output).toMatch(/request_id: 'req_/);
      expect(output).toMatch("agent_id: 'accounts-payable-fte'");
      expect(output).toMatch("dsor://org_456/invoice/INV-1008");
      expect(output).toMatch("{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }");
      expect(output).toMatch("code: 'RESOURCE_NOT_FOUND'");
      expect(output).toMatch(`message: '${notGranted("invoice.issue", "invoice:issue")}'`);
      expect(output).toMatch(`message: '"invoice.issue" is not built yet'`);
      expect(output).toMatch(
        `message: 'the input of "invoice.issue" is not valid: /invoice must match pattern`,
      );
      expect(output).toMatch("code: 'AUTHENTICATION_REQUIRED'");
      expect(output).toMatch("code: 'AUTHORIZATION_DENIED'");
      expect(output).not.toMatch("principal_id: 'cfo_100'");
      expect(output).toMatch("{ request_id: 'ap-desk-7', principal_id: 'user_123' }");
      // NEW IN STEP 10: each company's own INV-1008, a stranger refused, a foreign URI.
      expect(output).toMatch("org_456 INV-1008 VENDOR-44 { value: '31400.00', currency: 'USD' }");
      expect(output).toMatch("org_789 INV-1008 VENDOR-77 { value: '99000.00', currency: 'USD' }");
      expect(output).toMatch("message: 'the caller may not work in the tenant it named'");
      expect(output).toMatch("code: 'TENANT_MISMATCH'");
    },
  );

  // Found by step 06's review: a program that looked for roles.json in the folder it was
  // started from passed every test, because the tests start it from here. From step 09,
  // the same holds for .env.
  it(
    "finds its own role table and .env, whatever folder it is started from",
    { timeout: 60_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-elsewhere-"));
      try {
        // Without DSOR_DB_URL from this process, so the program must find .env itself.
        const { DSOR_DB_URL: _, ...env } = process.env;
        const run = start(env, dir);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(`message: '${notGranted("invoice.issue", "invoice:issue")}'`);
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );
});

describe("the program's log", () => {
  it(
    "DSOR-EXE-02: prints one record for each of its twelve calls, in order",
    { timeout: 60_000 },
    () => {
      const run = start();
      expect(run.status).toBe(0);
      const lines = run.stdout.split("\n").filter((l) => /^\d+ \S+ (ALLOW|DENY) \S+ \S+$/.test(l));
      // The database numbers the records across every run, so the numbers are not 1 to 8
      // any more. They still go up, in the order of the calls.
      const numbers = lines.map((l) => Number(l.split(" ")[0]));
      expect(numbers).toStrictEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size).toBe(12);
      // NEW IN STEP 10: each record ends with its company, or "-" when none was checked.
      expect(lines.map((l) => l.split(" ").slice(1).join(" "))).toStrictEqual([
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 ALLOW RESOURCE_NOT_FOUND org_456",
        "invoice.issue@1 DENY AUTHORIZATION_DENIED org_456",
        "invoice.get@1 DENY AUTHENTICATION_REQUIRED -",
        "invoice.get@1 DENY AUTHORIZATION_DENIED -",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.issue@1 DENY UNSUPPORTED_CAPABILITY org_456",
        "invoice.issue@1 DENY VALIDATION_FAILED org_456",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 ALLOW ok org_789",
        "invoice.get@1 DENY AUTHORIZATION_DENIED -",
        "invoice.issue@1 DENY TENANT_MISMATCH org_456",
      ]);
      expect(run.stdout).toMatch("code: 'EVIDENCE_STORE_UNAVAILABLE'");
    },
  );
});

// The program refuses to run as a login that could change the log (step
// 09's README, decision 17). Found by the second review: with the check deleted from
// main.ts, every test stayed green. Two tests make a program use the owner's key: this
// one, which hands it to the program, and the migrate test in test/tenants.db.test.ts,
// whose migrate.ts reads it from .env itself. No test logs in as the owner. Found by the
// Stage 2 review: this comment still said "the only test".
describe("the program's start-up check", () => {
  it(
    "DSOR-AUD-04a: refuses to run as the owner, names why, and makes no call",
    { timeout: 60_000 },
    () => {
      // Into a variable of this test's own, never into process.env, so no program started
      // later inherits the owner's key. Found by the third review.
      const found: NodeJS.ProcessEnv = { DSOR_MIGRATION_URL: process.env["DSOR_MIGRATION_URL"] };
      loadDotEnv(["DSOR_MIGRATION_URL"], undefined, found);
      const owner = requireEnv("DSOR_MIGRATION_URL", found);
      const run = start({ ...process.env, DSOR_DB_URL: owner }, undefined, {
        "<owner URL>": owner,
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toMatch("DSOR_DB_URL must log in as dsor_runtime. Refused:");
      expect(run.stderr).toMatch("not dsor_runtime");
      expect(run.stderr).toMatch("can change or remove records in dsor.audit");
      // Every fact the start-up check reads is proven on the real database: the owner
      // holds each one. Hand-made facts in runtime-role.test.ts prove only the wording.
      // Found by the Stage 2 review, and fixed from step 09 on.
      expect(run.stderr).toMatch("holds BYPASSRLS");
      expect(run.stderr).toMatch("is a member of pg_write_all_data");
      expect(run.stderr).toMatch(/owns \d+ tables/);
      // No call was made, so nothing was answered.
      expect(run.stdout).not.toMatch("data: {");
      // The refusal names the problems, never the secret.
      expect(run.stdout + run.stderr).not.toContain("<owner URL>");
    },
  );
});
