// The program's full runs, moved here from startup.test.ts, because the
// program now needs the database (step 09's README, decision 15).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { RUNTIME_URL, newPool, ownerRules, redact, tryThenRollBack } from "./db.ts";

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
      // And delegation.revoke. And the brake's two, first in name order.
      // And the sweep (step 25c's README, decision L3).
      // And rate.load (step 26's README, decision L2).
      // And the four commands of a rule's life, last in name order (step 28's README, decision D7).
      // And the sweep of where each rule came from (step 28b's README, decision D4).
      // And proposal.approve (step 29's README, decision D1).
      // And proposal.execute (step 31's README, decision D12).
      expect(output).toMatch(
        // Changed in step 35: and payment.execute (step 35's README, decision D7).
        // Changed in step 38: and payment.reconcile (step 38's README, decision D2).
        /operations: \[\s+'control\.lift',\s+'control\.suspend',\s+'delegation\.revoke',\s+'invoice\.get',\s+'invoice\.issue',\s+'invoice\.list',\s+'payment\.cancel',\s+'payment\.create',\s+'payment\.execute',\s+'payment\.reconcile',\s+'proposal\.approve',\s+'proposal\.execute',\s+'proposal\.expire_due',\s+'rate\.load',\s+'rule\.activate',\s+'rule\.check_authority',\s+'rule\.draft',\s+'rule\.retire',\s+'rule\.suspend'\s+\]/,
      );
      // Found by step 08's review: "id: 'INV-1008'" also matches the address read back, so
      // the success envelope could go unprinted. "data: {" is only in the success.
      // The brake, told in memory: the agent's draft is refused at line ④, its
      // read answers, a person's draft is made, and the freeze stops org_456's agents only
      // (step 25b's README, decision D12).
      const braked = "may make no change in org_456: an emergency brake is on";
      expect(output).toMatch(
        `03:11, the agent drafts: AGENT_SUSPENDED: accounts-payable-fte ${braked}`,
      );
      expect(output).toMatch("03:11, the agent reads INV-1008: answered, INV-1008");
      expect(output).toMatch("08:01, the agent drafts again: answered, PAY-");
      expect(output).toMatch(
        `08:06, firm-ap-fte drafts in org_456: AGENT_SUSPENDED: firm-ap-fte ${braked}`,
      );
      expect(output).toMatch("08:06, firm-ap-fte drafts in org_789: answered, PAY-");
      // The tear-up cancels the prepared draft and gives its booking back. A
      // prepared draft that nobody releases expires a week later, when dsor-scheduler sweeps, and
      // a person may not sweep (step 25c's README, claims C2, C4, and C5).
      expect(output).toMatch("the prepared draft: CANCELLED, its booking released");
      expect(output).toMatch("it expires at 2026-10-14T03:00:00.000Z");
      expect(output).toMatch("Thursday 00:00, dsor-scheduler sweeps org_456: answered, 0 expired");
      expect(output).toMatch(
        'Thursday 09:00, user_123 tries to sweep: AUTHORIZATION_DENIED: "proposal.expire_due"',
      );
      expect(output).toMatch(
        "next Thursday 00:00, dsor-scheduler sweeps org_456: answered, 1 expired",
      );
      expect(output).toMatch("the prepared draft: EXPIRED, its booking released");
      // Money in two currencies: only dsor-rates loads a sheet, a bill in EUR is
      // paid and booked in USD, one in GBP is over the limit for one payment though its number is
      // under it, one in PKR at the limit is within it, and an old sheet converts nothing (step
      // 26's README, claims C1 to C5).
      expect(output).toMatch(
        'user_123 tries to load rates: AUTHORIZATION_DENIED: "rate.load" is for DSoR\'s own system logins only',
      );
      expect(output).toMatch("dsor-rates loads Tuesday's sheet: answered, a sheet of ecb-daily");
      expect(output).toMatch("the agent drafts INV-2002, 9,000.00 EUR: answered, PAY-");
      expect(output).toMatch(
        `the agent drafts INV-2003, 49,000.00 GBP: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment`,
      );
      expect(output).toMatch("the agent drafts INV-2004, 14,000,000.00 PKR: answered, PAY-");
      expect(output).toMatch("the day's total under del_100: 59720.00 USD");
      // The agent hears no currency. Its record names it, and the cause (step 26's review, H1).
      expect(output).toMatch(
        `Saturday 09:00, the agent drafts INV-2002 again: LIMIT_EXCEEDED: "payment.create" would pass slip del_100's limit for one payment: no usable rate\n`,
      );
      expect(output).toMatch(
        "its record says why: no usable rate for EUR (the newest sheet of ecb-daily is older than P3D)",
      );
      // The company's rule. A payment above 25,000 USD waits for the CFO, in any
      // currency, and a limit's DENY wins over it. A bill in yen that no sheet lists waits too, and
      // its record says why. A dry run says what the real call would get. A week later, the sweep
      // expires the waiting payments (step 27's README, the story's numbers, and decision D11).
      // The program says that the earlier stories run with no controls (step 27's review,
      // finding H1).
      expect(output).toMatch(
        "controls.json passed its tests; the stories of steps 09 to 26 run with no controls, and the company's rule has its own story",
      );
      const waits =
        "PENDING_APPROVAL, needs CFO x1 (high-value-payment), until 2026-10-13T15:05:00.000Z";
      expect(output).toMatch(`the agent drafts INV-1008, 31,400.00 USD: ${waits}`);
      expect(output).toMatch(`the agent drafts INV-2004, 14,000,000.00 PKR: ${waits}`);
      expect(output).toMatch(`user_123 drafts INV-2006, 100,000 JPY: ${waits}`);
      expect(output).toMatch(
        "INV-2006's record: ALLOW PENDING_APPROVAL, high-value-payment v8 REQUIRE_APPROVAL, error: no usable rate compares JPY with USD",
      );
      // Changed in step 32: of INV-1004, since INV-1008 waits, in flight (step 32's README, D6).
      expect(output).toMatch("a dry run of INV-1004: VALIDATED, REQUIRE_APPROVAL");
      // Start-up checks dsor.controls too, and the story of who may switch a rule
      // on runs in memory (step 28's README, the story's numbers, and decisions D6 and D10).
      expect(output).toMatch(
        "dsor.controls passed its checks too; the program's stories keep their rules in memory",
      );
      for (const line of [
        "the agent drafts INV-1012, 22,750.00 USD: answered, PAY-",
        "cfo_100 drafts the rule above 20,000.00 USD: version 9, draft",
        "admin_100 drafts the rule false, naming admin_100 its owner: version 10, draft",
        'admin_100 switches version 10 on: AUTHORIZATION_DENIED: "rule.activate": admin_100 may not change rule "high-value-payment": only its owner may, in person',
        'the agent switches version 9 on: AUTHORIZATION_DENIED: "rule.activate" is for people only, and accounts-payable-fte is not a person',
        'cfo_100 switches version 11 on: VALIDATION_FAILED: "rule.activate": org_456\'s control high-value-payment v11 fails its test 3: expects REQUIRE_APPROVAL, gives ALLOW',
        "cfo_100 switches version 9 on: version 9, active, version 8 retired",
        `the agent drafts INV-2007, 21,000.00 USD: ${waits}`,
        "cfo_100 suspends version 9: version 9, suspended",
        "the agent drafts INV-1008, 31,400.00 USD: answered, PAY-",
        "cfo_100 switches version 9 on again: version 9, active",
        `the agent drafts INV-1004, 27,300.00 USD: ${waits}`,
        "the record: version 9 suspended, from active, by cfo_100: audit week",
      ]) {
        expect(output).toMatch(line);
      }
      // And the story of where a rule came from, in memory, with a KSoR of its own (step 28b's
      // README, the story's numbers).
      const policy = '"ksor://org_456/finance/payment-approval-policy"';
      for (const line of [
        "where a rule came from, in memory, with a store and a KSoR of its own:",
        "dsor-scheduler sweeps org_456: asked about 1 policy, 0 unanswered, marked 0",
        "the finance team publishes version 5 of the payment-approval policy in KSoR: above 20,000 USD",
        "the agent drafts INV-2007, 21,000.00 USD: answered, PAY-",
        "dsor-scheduler sweeps org_456: asked about 1 policy, 0 unanswered, marked 1",
        `the notice to cfo_100: Version 8 of rule high-value-payment cites version 4 of ${policy}, and KSoR now has version 5 in force. DSoR marked it stale_authority.`,
        `the agent drafts INV-2008, 21,000.00 USD: ${waits}`,
        `the agent drafts INV-2009, 900.00 USD: ${waits}`,
        "INV-2008's record: high-value-payment version 8, REQUIRE_APPROVAL, cites version 4, superseded_version 4, and beside it the policy's version 5 in force",
        "cfo_100 drafts version 9 above 20,000.00 USD, still citing version 4: version 9, draft",
        `cfo_100 switches version 9 on: VALIDATION_FAILED: "rule.activate": version 9 of rule high-value-payment cites version 4 of ${policy}, and KSoR has version 5 in force`,
        "cfo_100 drafts version 10 above 20,000.00 USD, citing version 5: version 10, draft",
        "cfo_100 switches version 10 on: version 10, active, version 8 retired",
        "the agent drafts INV-2010, 19,500.00 USD: answered, PAY-",
        `the agent drafts INV-2011, 21,000.00 USD: ${waits}`,
      ]) {
        expect(output).toMatch(line);
      }
      // The approvals, in memory: who may approve, with which fingerprint, and a
      // second rule that asks for a second person (step 29's README, the story's numbers).
      const approvals = output.slice(output.indexOf("approvals, in memory"));
      for (const line of [
        "the agent drafts INV-2009, 900.00 USD: answered, PAY-",
        "the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment)",
        'the agent approves its own payment: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and accounts-payable-fte is not a person',
        "admin_100 approves it: AUTHORIZATION_DENIED: admin_100 holds none of the roles proposal prop_",
        "cfo_100 approves it, with the 900.00 USD payment's fingerprint: APPROVAL_MISMATCH",
        "cfo_100 approves it, with its own fingerprint: APPROVED, by approval apr_",
        "cfo_100 approves it again: CONFLICT: proposal prop_",
        "cfo_100 drafts admin-above-30000, a rule of org_456's own: version 1, draft",
        "cfo_100 switches it on: version 1, active",
        "the agent drafts INV-2012, 35,000.00 USD: PENDING_APPROVAL, needs tenant_admin x1 (admin-above-30000), CFO x1 (high-value-payment)",
        "cfo_100 approves it: PENDING_APPROVAL, still waits for tenant_admin",
        "admin_100 approves it: APPROVED, by approval apr_",
        // Changed in step 31: the release has scenes of its own, in a world of their own.
        "payments drafted: 1, INV-2009's; the approved ones wait for their release",
      ]) {
        expect(approvals).toMatch(line);
      }
      // Who may not approve, in memory: the AP supervisor's rule, and the people in
      // each request's chain (step 30's README, the story's numbers).
      const sod = output.slice(output.indexOf("who may not approve, in memory"));
      for (const line of [
        "cfo_100 drafts supervisor-above-10000, a rule of org_456's own: version 1, draft",
        "cfo_100 switches it on: version 1, active",
        "the agent drafts INV-1012, 22,750.00 USD: PENDING_APPROVAL, needs ap_supervisor x1 (supervisor-above-10000)",
        "user_123, who signed del_100, approves it: SOD_VIOLATION: user_123 may not approve proposal prop_",
        ": user_123 signed slip del_100, which the agent that asked works under",
        "cfo_100 approves it: AUTHORIZATION_DENIED: cfo_100 holds none of the roles proposal prop_",
        "user_123 drafts INV-2013, 12,000.00 USD, on their own login: PENDING_APPROVAL, needs ap_supervisor x1 (supervisor-above-10000)",
        "user_123 approves it: SOD_VIOLATION: user_123 may not approve proposal prop_",
        ": user_123 asked for it",
        'the agent approves INV-1012: AUTHORIZATION_DENIED: "proposal.approve" is for people only, and accounts-payable-fte is not a person',
        // Changed by step 30's review, finding L6: the states, as DSoR keeps them.
        "INV-1012's proposal: PENDING_APPROVAL, INV-2013's: PENDING_APPROVAL; org_456 has no AP supervisor outside their chains",
      ]) {
        expect(sod).toMatch(line);
      }
      // The release, in memory, in a world of its own: what was approved is paid, what a stricter
      // rule now stops is invalidated, and the release runs only the stored request (step 31's
      // README, the story's numbers).
      const releases = output.slice(output.indexOf("releases, in memory, in a world of their own"));
      for (const line of [
        "the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment)",
        "cfo_100 approves it: APPROVED",
        "the agent releases it: COMMITTED, INV-1008 31400.00 USD drafted",
        "INV-1008's proposal: COMMITTED, its booking committed",
        "cfo_100 switches on admin-above-30000: version 1, active",
        "the agent drafts INV-2012, 35,000.00 USD: PENDING_APPROVAL, needs tenant_admin x1 (admin-above-30000), CFO x1 (high-value-payment)",
        "admin_100 approves it: APPROVED",
        "cfo_100 switches on a version that asks for two CFOs: version 9, active, version 8 retired",
        "the agent releases INV-2012: APPROVAL_INVALIDATED: proposal prop_",
        " is INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for 2 approvals by CFO, and 1 counts",
        "INV-2012's proposal: INVALIDATED, its booking released",
        'the agent releases INV-1008\'s proposal and sends invoice INV-1002 with it: VALIDATION_FAILED: the input of "proposal.execute" is not valid: must NOT have additional properties: "invoice"',
        "the agent prepares INV-1009, 7,425.00 USD, in propose_only mode: READY",
        "user_123 releases it: COMMITTED, INV-1009 7425.00 USD drafted",
        "payments drafted in this world: INV-1008, INV-1009",
      ]) {
        expect(releases).toMatch(line);
      }
      // Step 32: preconditions and one attempt at a time, in a world of its own: the second
      // attempt is refused, naming the first; a vendor suspended after the approval invalidates at
      // the release; and a draft invoice is refused by its precondition (step 32's README, D12).
      const attempts = output.slice(
        output.indexOf(
          "preconditions and one attempt at a time, in memory, in a world of their own",
        ),
      );
      for (const line of [
        "the agent drafts INV-1008, 31,400.00 USD: PENDING_APPROVAL, needs CFO x1 (high-value-payment)",
        "the agent drafts INV-1008 again, with a new key: CONFLICT: invoice INV-1008 has an attempt in flight already: proposal dsor://org_456/proposal/prop_",
        ", PENDING_APPROVAL",
        "cfo_100 approves the first: APPROVED",
        "the accounts team suspends VENDOR-44",
        "the agent releases INV-1008: APPROVAL_INVALIDATED: proposal prop_",
        ' is INVALIDATED: CONFLICT: a precondition of payment.create does not hold: state.vendor.status == "approved"',
        "INV-1008's proposal: INVALIDATED, its booking released",
        'user_123 drafts INV-1005, a draft invoice: CONFLICT: a precondition of payment.create does not hold: state.invoice.status == "issued"',
        "payments drafted in this world: 0",
      ]) {
        expect(attempts).toMatch(line);
      }
      // Step 33: the decision bundle, in a world of its own: the release's bundle names who asked,
      // the rule and the approval that met it, what DSoR read, and how it ended; the draft's keeps
      // the agent's words apart; INV-2002's names its conversion; and the agent's words change
      // nothing for INV-1004 (step 33's README, the story's numbers).
      const bundles = output.slice(
        output.indexOf("the decision bundle, in memory, in a world of its own"),
      );
      for (const line of [
        "the agent drafts INV-1008, 31,400.00 USD, for a weekly payment run: PENDING_APPROVAL, needs CFO x1 (high-value-payment)",
        "cfo_100 approves it: answered, apr_",
        "the agent releases INV-1008: answered, PAY-901",
        "the release's bundle: payment.create@1, committed",
        "who: unattended, user_123 through accounts-payable-fte, under del_100",
        "rule: high-value-payment version 8, REQUIRE_APPROVAL, met by apr_",
        ", by cfo_100",
        "read: dsor://org_456/invoice/INV-1008 version 1, CURRENT",
        "read: dsor://org_456/vendor/VENDOR-44 version 1, CURRENT",
        "money: nothing converted",
        'the agent says, in this call: "nothing"',
        `the draft's bundle keeps what the agent said then: {"skill":{"uri":"viking://agent/skills/vendor-payment","version":3,"hash":"sha256:c0ffee5k111"},"purpose":"weekly payment run"}`,
        "the agent drafts INV-2002, 9,000.00 EUR: answered, PAY-902",
        "money: 9000.00 EUR is 9720.00 USD, at 1.08, from ecb-daily, as of 2026-10-06T14:00:00.000Z",
        'the agent drafts INV-1004, 27,300.00 USD, saying "the CFO agreed by phone": PENDING_APPROVAL, needs CFO x1 (high-value-payment)',
        "bundles in this world: 5, 5 of them valid against decision-bundle.schema.json",
      ]) {
        expect(bundles).toMatch(line);
      }
      // And, on the database, the records of the decisions about a command from line ④ on name
      // their bundles, which the database kept in the same transaction (step 33's README, D2).
      expect(output).toMatch("19 of the records it reads name a decision bundle");
      expect(output).toMatch("the day's total under del_100: 91120.00 USD");
      expect(output).toMatch("a week later, dsor-scheduler sweeps org_456: answered, 3 expired");
      expect(output).toMatch("INV-1008's payment: EXPIRED, its booking released");
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
      // And the version it read (step 21's README, decision 9).
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
      // The second cancel, decided on the draft's version, is stale (step 21's
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
      // The three ways to call. A dry run, a draft prepared and waiting, the same
      // key refused in execute mode, and the clerk who may still prepare (step 23's README,
      // outcomes 1 to 4).
      expect(output).toMatch(
        "the agent's dry run: {\n  outcome: 'VALIDATED',\n  decision: 'ALLOW',",
      );
      expect(output).toMatch(/the agent prepares a draft: \{\n {2}outcome: 'READY',/);
      expect(output).toMatch(
        /its proposal, READY: dsor:\/\/org_456\/proposal\/prop_[0-9a-f-]{36}\n {2}\(new\) → PROPOSED, by accounts-payable-fte: payment\.create called\n {2}PROPOSED → READY, by dsor: no control asks for an approval\nthe same key, to execute: IDEMPOTENCY_CONFLICT/,
      );
      expect(output).toMatch("ap_clerk, the agent prepares: READY");
      // The day's limit, told in memory (step 24's README, outcomes 1 and 4).
      expect(output).toMatch(
        '  seven drafts of 31,400.00 USD at once: 6 made, and LIMIT_EXCEEDED: "payment.create" would pass slip del_100\'s limit for one day',
      );
      expect(output).toMatch(
        '  a dry run of an eighth: LIMIT_EXCEEDED: "payment.create" would pass slip del_100\'s limit for one day',
      );
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
      // The changed payee, told in memory (step 21's README, decision 13).
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
    "DSOR-EXE-02: prints the 32 records of its 35 calls that it can read, in order, and says it cannot read 3",
    { timeout: 180_000 },
    () => {
      const run = start();
      expect(run.status).toBe(0);
      const lines = run.stdout.split("\n").filter((l) => /^\d+ \S+ (ALLOW|DENY) \S+ \S+$/.test(l));
      // The database numbers the records across every run, so the numbers are not 1 to 8
      // any more. They still go up, in the order of the calls.
      const numbers = lines.map((l) => Number(l.split(" ")[0]));
      expect(numbers).toStrictEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size).toBe(32);
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
        // The second cancel, decided on version 1, is stale, and a third, on
        // version 2, meets the business rule (step 21's README, outcome 5).
        "payment.cancel@1 ALLOW STALE_STATE org_456",
        "payment.cancel@1 ALLOW CONFLICT org_456",
        "payment.create@1 ALLOW ok org_456",
        // The agent's dry run and its prepared draft, both allowed, and the same
        // key sent to execute, refused at line ⑦ (step 23's README, outcomes 1 to 3).
        "payment.create@1 ALLOW ok org_456",
        "payment.create@1 ALLOW ok org_456",
        "payment.create@1 DENY IDEMPOTENCY_CONFLICT org_456",
        // The night. The agent drafts, user_123 moves to ap_clerk and comes back, the
        // directory goes off, and DSoR restarts (step 19's README, outcomes 1 to 5). Since step
        // 19b, the suspension is told in memory, with a log of its own, so it is not here.
        "payment.create@1 ALLOW ok org_456",
        // The agent reads INV-1009 for its version first.
        "invoice.get@1 ALLOW ok org_456",
        // The lost answer's draft, its retry, a replay that says ALLOW, and the
        // same key for another invoice, refused before the code (step 20's README, decision 8).
        "payment.create@1 ALLOW ok org_456",
        "payment.create@1 ALLOW ok org_456",
        "payment.create@1 DENY IDEMPOTENCY_CONFLICT org_456",
        "payment.create@1 DENY AUTHORIZATION_DENIED org_456",
        "invoice.get@1 ALLOW ok org_456",
        // As ap_clerk, the agent may still prepare (outcome 4).
        "payment.create@1 ALLOW ok org_456",
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
        "35 calls answered, so 35 records were written. dsor_runtime reads 32 of them, in org_456 and org_789, and cannot read the other 3",
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
  // Found by step 27's sweep, MN2: with the company's rule story reading the shipped controls.json
  // instead of the one start-up checked, every test passed.
  it(
    "Step 27: the company's rule story enforces the controls file named on the command line, the one start-up checked: with a rule that never fires, the agent's INV-1008 is paid",
    { timeout: 180_000 },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "dsor-controls-"));
      try {
        const controls = JSON.parse(
          readFileSync(new URL("../controls.json", import.meta.url), "utf8"),
        );
        controls.org_456[0].condition = "false";
        controls.org_456[0].tests = [{ expect: "ALLOW" }];
        const named = join(dir, "controls.json");
        writeFileSync(named, JSON.stringify(controls));
        const step = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
        const args = [
          "../contracts",
          "../roles.json",
          "../inputs",
          "../classifications.json",
          "../store.json",
        ];
        const run = spawnSync(process.execPath, [MAIN, ...args.map(step), named], {
          encoding: "utf8",
        });
        const stdout = redact(run.stdout, { "<runtime URL>": RUNTIME_URL });
        expect(run.status).toBe(0);
        expect(stdout).toMatch("controls.json passed its tests");
        expect(stdout).toMatch(
          "Tuesday 15:05, the agent drafts INV-1008, 31,400.00 USD: answered, PAY-",
        );
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );

  // A row of dsor.controls that a hand edit planted, active, whose test fails.
  it(
    "Step 28: refuses to start when dsor.controls holds an active rule whose test fails, and names it (step 28's README, decision D6)",
    { timeout: 180_000 },
    () => {
      ownerRules("plant");
      try {
        const run = start();
        const stderr = redact(run.stderr, { "<runtime URL>": RUNTIME_URL });
        expect(run.status).toBe(1);
        expect(stderr).toMatch(
          "the rules refused to start:\n  dsor.controls: org_456's control planted-rule v1 fails its test 1: expects ALLOW, gives REQUIRE_APPROVAL",
        );
        expect(run.stdout).not.toMatch("data: {");
      } finally {
        ownerRules("clear");
      }
    },
  );

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
