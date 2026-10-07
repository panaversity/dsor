// The program's full runs, moved here from startup.test.ts, because the
// program now needs the database (step 09's README, decision 15).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { RUNTIME_URL, newPool, redact, tryThenRollBack } from "./db.ts";

// A window into the database, to see that a run leaves the story's slips active.
const observer = newPool();
afterAll(async () => {
  await observer.end();
});

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
  // Found live 2026-10-05: step 19's night adds 8 calls, and each call to Neon took 2 to 3
  // seconds from here, so one run took 66 seconds alone. Each test now waits up to 180.
  it(
    "starts, reads INV-1008 through invoice.get, and prints every answer as an envelope",
    { timeout: 180_000 },
    async () => {
      const run = start();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const output = run.stdout;
      // invoice.list, and step 17's two commands. Five names no longer fit on one line.
      expect(output).toMatch(
        /operations: \[\s+'invoice\.get',\s+'invoice\.issue',\s+'invoice\.list',\s+'payment\.cancel',\s+'payment\.create'\s+\]/,
      );
      // Found by step 08's review: "id: 'INV-1008'" also matches the address read back, so
      // the success envelope could go unprinted. "data: {" is only in the success.
      expect(output).toMatch("data: {");
      expect(output).toMatch("id: 'INV-1008'");
      // The money read from the database, still a string. Anchored to the start of the line:
      // found by break T7, "amount: {" also matches inside "open_amount: {".
      // Printed from cfo_100's INV-1008. The agent's has no amounts.
      expect(output).toMatch(/^\s+amount: \{ value: '31400\.00', currency: 'USD' \}/m);
      expect(output).toMatch(/^\s+open_amount: \{ value: '31400\.00', currency: 'USD' \}/m);
      expect(output).toMatch(/request_id: 'req_/);
      expect(output).toMatch("agent_id: 'accounts-payable-fte'");
      // The first answer's label, and its record's (step 15's README, C1 and C7).
      expect(output).toMatch(/^\s+connector: 'postgres',$/m);
      // NEW IN STEP 21: and the version it read (step 21's README, decision 9).
      expect(output).toMatch(/^\s+resource_version: '1'$/m);
      expect(output).toMatch(/freshness: \{ mode: 'current', observed_at: '20\d\d-/);
      expect(output).toMatch("dsor://org_456/invoice/INV-1008");
      expect(output).toMatch("{ tenant_id: 'org_456', entity: 'invoice', id: 'INV-1008' }");
      expect(output).toMatch("code: 'RESOURCE_NOT_FOUND'");
      // Since step 18 the agent's invoice.issue stops at line ⑤: its slip, del_100, lists no
      // invoice:issue (step 18's README, decision 5).
      expect(output).toMatch(`message: '"invoice.issue" needs invoice:issue, which`);
      expect(output).toMatch(`message: '"invoice.issue" is not built yet'`);
      expect(output).toMatch(
        `message: 'the input of "invoice.issue" is not valid: /invoice must match pattern`,
      );
      expect(output).toMatch("code: 'AUTHENTICATION_REQUIRED'");
      expect(output).toMatch("code: 'AUTHORIZATION_DENIED'");
      expect(output).not.toMatch("principal_id: 'cfo_100'");
      expect(output).toMatch("{ request_id: 'ap-desk-7', principal_id: 'user_123' }");
      // Each company's own INV-1008, a stranger refused, a foreign URI.
      // The firm's agent gets no amount, so the vendor says whose it is.
      expect(output).toMatch(/^org_456 INV-1008 VENDOR-44$/m);
      expect(output).toMatch(/^org_789 INV-1008 VENDOR-77$/m);
      expect(output).toMatch("message: 'the caller may not work in the tenant it named'");
      expect(output).toMatch("code: 'TENANT_MISMATCH'");
      // A million asked, ten given, and the answer says so.
      expect(output).toMatch(
        "INV-1001 INV-1002 INV-1003 INV-1004 INV-1005 INV-1006 INV-1007 INV-1008 INV-1009 INV-1010 { next_cursor: 'INV-1010', capped: { asked: 1000000, max: 10 } }",
      );
      // Step 17's commands. The draft, numbered by the database, holds INV-1008's open amount
      // and vendor, and says it can be undone. The cancel says atomic, a second cancel is
      // refused. Since step 18 the agent drafts too, under del_100, and its answer leaves out
      // the amount (step 18's README, outcome 1).
      expect(output).toMatch(
        /^\s+id: 'PAY-\d+',\n\s+invoice_id: 'INV-1008',\n\s+vendor_id: 'VENDOR-44',$/m,
      );
      expect(output).toMatch(
        /^\s+status: 'draft',\n\s+version: 1\n\s+\},\n\s+classification: 'confidential',\n\s+semantics: 'compensatable',$/m,
      );
      expect(output).toMatch(
        /^\s+status: 'cancelled',\n\s+version: 2\n\s+\},\n\s+classification: 'confidential',\n\s+semantics: 'atomic',$/m,
      );
      expect(output).toMatch(
        /message: 'payment "PAY-\d+" is not a draft, so it cannot be cancelled'/,
      );
      // NEW IN STEP 21: the second cancel, decided on the draft's version, is stale (step 21's
      // README, outcome 5).
      expect(output).toMatch(
        /message: 'payment "PAY-\d+" is at version 2, and the request was decided on version 1'/,
      );
      expect(output).toMatch(
        /^\s+classification: 'internal',\n\s+redactions: \[ \{ field: 'amount', reason: 'clearance', treatment: 'omitted' \} \],\n\s+semantics: 'compensatable',$/m,
      );
      // The night. The record says where user_123's authority came from, and
      // each change in her company's directory reaches her agent at its next call (step 19's
      // README, outcomes 1 to 5).
      expect(output).toMatch(
        /subject_authority: \{ as_of: '20\d\d-[^']+', source: 'role_source' \}/,
      );
      // The lost answer, its retry with the same key, and the same key for
      // another invoice (step 20's README, outcomes 1 and 3).
      const lost = /^02:10, the agent drafts, and the answer is lost: answered, (PAY-\d+)$/m.exec(
        output,
      );
      expect(lost).not.toBeNull();
      expect(output).toMatch(`02:11, the retry with the same key hears: answered, ${lost![1]}\n`);
      expect(output).toMatch(
        'the same key, for INV-1008: IDEMPOTENCY_CONFLICT: the idempotency_key was used for a different request to "payment.create"',
      );
      expect(output).toMatch("ap_clerk, the agent drafts: AUTHORIZATION_DENIED");
      expect(output).toMatch("ap_clerk, the agent reads: answered, INV-1008");
      // The suspension, told in memory (step 19b's README, decision 11).
      expect(output).toMatch("  suspended, the agent reads: DELEGATION_REQUIRED");
      expect(output).toMatch("  del_100 is suspended, on the directory's word: suspended");
      expect(output).toMatch("  del_101 is suspended, on the directory's word: suspended");
      expect(output).toMatch(
        '  the firm\'s agent reads: DELEGATION_REQUIRED: "invoice.get": slip del_101 is suspended, not active (the directory was asked 0 times)',
      );
      expect(output).toMatch(
        '  active again, the agent reads: DELEGATION_REQUIRED: "invoice.get": slip del_100 is suspended, not active',
      );
      expect(output).toMatch("directory off, the agent reads: answered, INV-1008");
      expect(output).toMatch("after a restart, the agent reads: FRESHNESS_UNSATISFIABLE");
      expect(output).toMatch("after a restart, user_123 reads: answered, INV-1008");
      // NEW IN STEP 21: the changed payee, told in memory (step 21's README, decision 13).
      expect(output).toMatch("  02:05, the agent reads INV-1008: version 1, VENDOR-44");
      expect(output).toMatch("  02:06, the payee changes: INV-1008 is version 2, VENDOR-99");
      expect(output).toMatch(
        '  02:07, the agent drafts on version 1: STALE_STATE: invoice "INV-1008" is at version 2, and the request was decided on version 1',
      );
      expect(output).toMatch("  02:08, the agent reads again: version 2, VENDOR-99. Drafts: 0");
      // And the database's slips are still active after the run.
      const sql =
        "SELECT id, status FROM dsor.delegations WHERE id IN ('del_100', 'del_101') ORDER BY id";
      const { rows } = await tryThenRollBack(observer, sql, "org_456");
      expect(rows).toStrictEqual([
        { id: "del_100", status: "active" },
        { id: "del_101", status: "active" },
      ]);
    },
  );

  // Found by step 06's review: a program that looked for roles.json in the folder it was
  // started from passed every test, because the tests start it from here. From step 09,
  // the same holds for .env.
  it(
    "finds its own role table and .env, whatever folder it is started from",
    { timeout: 180_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-elsewhere-"));
      try {
        // Without DSOR_DB_URL from this process, so the program must find .env itself.
        const { DSOR_DB_URL: _, ...env } = process.env;
        const run = start(env, dir);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(`message: '"invoice.issue" needs invoice:issue, which`);
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );
});

describe("the program's log", () => {
  // dsor_runtime reads one company at a time, and never a record with no
  // company. The program reads org_456's and org_789's, and says how many it cannot read
  // (step 11's README, decision 6).
  it(
    "DSOR-EXE-02: prints the 28 records of its 31 calls that it can read, in order, and says it cannot read 3",
    { timeout: 180_000 },
    () => {
      const run = start();
      expect(run.status).toBe(0);
      const lines = run.stdout.split("\n").filter((l) => /^\d+ \S+ (ALLOW|DENY) \S+ \S+$/.test(l));
      // The database numbers the records across every run, so the numbers are not 1 to 8
      // any more. They still go up, in the order of the calls.
      const numbers = lines.map((l) => Number(l.split(" ")[0]));
      expect(numbers).toStrictEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size).toBe(28);
      // Each record ends with its company. The three calls refused before line ② have
      // none, and are not here.
      expect(lines.map((l) => l.split(" ").slice(1).join(" "))).toStrictEqual([
        "invoice.get@1 ALLOW ok org_456",
        // Cfo_100 reads INV-1008 whole.
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 ALLOW RESOURCE_NOT_FOUND org_456",
        // Since step 18 the agent passes line ③ under del_100, which lists no invoice:issue,
        // so line ⑤ refuses it (step 18's README, decision 5).
        "invoice.issue@1 DENY AUTHORIZATION_DENIED org_456",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.issue@1 DENY UNSUPPORTED_CAPABILITY org_456",
        "invoice.issue@1 DENY VALIDATION_FAILED org_456",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 ALLOW ok org_789",
        "invoice.issue@1 DENY TENANT_MISMATCH org_456",
        "invoice.list@1 ALLOW ok org_456",
        // Step 17's commands: a draft, its cancel, a second cancel refused by the code, so
        // ALLOW. Since step 18 the agent drafts too, under del_100.
        "payment.create@1 ALLOW ok org_456",
        "payment.cancel@1 ALLOW ok org_456",
        // NEW IN STEP 21: the second cancel, decided on version 1, is stale, and a third, on
        // version 2, meets the business rule (step 21's README, outcome 5).
        "payment.cancel@1 ALLOW STALE_STATE org_456",
        "payment.cancel@1 ALLOW CONFLICT org_456",
        "payment.create@1 ALLOW ok org_456",
        // The night. The agent drafts, user_123 moves to ap_clerk and comes back, the
        // directory goes off, and DSoR restarts (step 19's README, outcomes 1 to 5). Since step
        // 19b, the suspension is told in memory, with a log of its own, so it is not here.
        "payment.create@1 ALLOW ok org_456",
        // NEW IN STEP 21: the agent reads INV-1009 for its version first.
        "invoice.get@1 ALLOW ok org_456",
        // The lost answer's draft, its retry, a replay that says ALLOW, and the
        // same key for another invoice, refused before the code (step 20's README, decision 8).
        "payment.create@1 ALLOW ok org_456",
        "payment.create@1 ALLOW ok org_456",
        "payment.create@1 DENY IDEMPOTENCY_CONFLICT org_456",
        "payment.create@1 DENY AUTHORIZATION_DENIED org_456",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 ALLOW ok org_456",
        "invoice.get@1 DENY FRESHNESS_UNSATISFIABLE org_456",
        "invoice.get@1 ALLOW ok org_456",
        // User_123's retry after the restart, a replay.
        "payment.create@1 ALLOW ok org_456",
      ]);
      // A fact and one inference, and the line says which: every call answered, and an
      // answer leaves only after its record is committed. Found by the review: the line
      // used to state the 3 as if it had read them.
      expect(run.stdout).toMatch(
        "31 calls answered, so 31 records were written. dsor_runtime reads 28 of them, in org_456 and org_789, and cannot read the other 3",
      );
      expect(run.stdout).toMatch("code: 'EVIDENCE_STORE_UNAVAILABLE'");
    },
  );
});

// The program refuses to run as a login that could change the log (step
// 09's README, decision 17). Found by the second review: with the check deleted from
// main.ts, every test stayed green. Several tests make a program use the owner's key: this
// one, which hands it to the program; the migrate test in test/tenants.db.test.ts, whose
// migrate.ts reads it from .env itself; and, from step 11 on, the tests that start
// test/owner-reads.ts, test/owner-store.ts, from step 16 on test/owner-catalog.ts, or,
// since step 16's review, test/owner-login-check.ts, which read it from .env too. No test
// logs in as the owner itself: only those child programs do. Found by the Stage 2 review: this comment still
// said "the only test".
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
      expect(run.stderr).toMatch("is a member of pg_write_all_data");
      expect(run.stderr).toMatch(/owns \d+ tables/);
      // The two facts the check reads from the database for row-level security, word for
      // word as problemsOf says them. On Neon, the owner holds BYPASSRLS and belongs to
      // neon_superuser; the number of its roles is Neon's to choose. With rolbypassrls read
      // as false and the count of roles as 0 in runtimeRoleProblems, every test passed
      // (step 11's README, decision 7). Found by the Stage 2 review, and fixed from step 11
      // on.
      expect(run.stderr).toMatch("holds BYPASSRLS");
      expect(run.stderr).toMatch(/belongs to \d+ other roles?, which SET ROLE can switch to/);
      // No call was made, so nothing was answered.
      expect(run.stdout).not.toMatch("data: {");
      // The refusal names the problems, never the secret.
      expect(run.stdout + run.stderr).not.toContain("<owner URL>");
    },
  );

  // The database half of C6, on today's database. A map that leaves out
  // dsor.migrations is a valid map, so start-up gets past the files and logs in, and the
  // inspector finds the table nobody wrote down. Found by the sweep: the refusal in
  // src/main.ts could be deleted, and every test stayed green.
  it(
    "step 16's decision 4: refuses to start on a database that does not match its map",
    { timeout: 60_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-store-"));
      try {
        const map = JSON.parse(readFileSync(new URL("../store.json", import.meta.url), "utf8"));
        delete map.tables["dsor.migrations"];
        const partial = join(dir, "store.json");
        writeFileSync(partial, JSON.stringify(map));
        const step = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
        const args = ["../contracts", "../roles.json", "../inputs", "../classifications.json"];
        const run = spawnSync(process.execPath, [MAIN, ...args.map(step), partial], {
          encoding: "utf8",
        });
        const stderr = redact(run.stderr, { "<runtime URL>": RUNTIME_URL });
        expect(run.status).toBe(1);
        expect(stderr).toMatch("The database does not match store.json. Refused:");
        expect(stderr).toMatch("dsor.migrations is a table that store.json does not name");
        // The files were checked, and the program logged in, before the inspector ran.
        expect(run.stdout).toMatch("operations:");
        expect(run.stdout).not.toMatch("data: {");
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );
});
