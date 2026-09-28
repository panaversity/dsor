// NEW IN STEP 09: the program's full runs, moved here from startup.test.ts, because the
// program now needs the database (step 09's README, decision 15).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { notGranted } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

// No rule id: the program itself. Found by step 07's review: nothing ran src/main.ts, so
// a start-up that skipped the registry passed every test.
describe("the program", () => {
  // Found live 2026-09-26: on a busy machine, starting node took longer than vitest's
  // 5-second default. The database adds a connection, so each test waits up to 60 seconds.
  it(
    "starts, reads INV-1008 through invoice.get, and prints every answer as an envelope",
    { timeout: 60_000 },
    () => {
      const output = execFileSync(process.execPath, [MAIN], { encoding: "utf8" });
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
        const run = spawnSync(process.execPath, [MAIN], { cwd: dir, encoding: "utf8", env });
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
    "DSOR-EXE-02: prints one record for each of its eight calls, in order",
    { timeout: 60_000 },
    () => {
      const run = spawnSync(process.execPath, [MAIN], { encoding: "utf8" });
      expect(run.status).toBe(0);
      const lines = run.stdout.split("\n").filter((l) => /^\d+ \S+ (ALLOW|DENY) \S+$/.test(l));
      // The database numbers the records across every run, so the numbers are not 1 to 8
      // any more. They still go up, in the order of the calls.
      const numbers = lines.map((l) => Number(l.split(" ")[0]));
      expect(numbers).toStrictEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size).toBe(8);
      expect(lines.map((l) => l.split(" ").slice(1).join(" "))).toStrictEqual([
        "invoice.get@1 ALLOW ok",
        "invoice.get@1 ALLOW RESOURCE_NOT_FOUND",
        "invoice.issue@1 DENY AUTHORIZATION_DENIED",
        "invoice.get@1 DENY AUTHENTICATION_REQUIRED",
        "invoice.get@1 DENY AUTHORIZATION_DENIED",
        "invoice.get@1 ALLOW ok",
        "invoice.issue@1 DENY UNSUPPORTED_CAPABILITY",
        "invoice.issue@1 DENY VALIDATION_FAILED",
      ]);
      expect(run.stdout).toMatch("code: 'EVIDENCE_STORE_UNAVAILABLE'");
    },
  );
});
