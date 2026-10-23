// The cross-tenant suite with the database's store and log (step 12's
// README, outcome 8), and the record each attack leaves (C6). No attack reaches the
// database's own lock: a foreign URI is refused before any read (step 12's README, "What
// the specification asks", point 5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbInvoices, createDbLog } from "../src/postgres.ts";
import { HOMES, ROWS } from "./companies.ts";
import { crossTenantSuite, readExamples, type Report } from "./cross-tenant.ts";
import { dbRegistry, newPool, tryThenRollBack } from "./db.ts";
import { FOREIGN_URI } from "./helpers.ts";

const pool = newPool();
afterAll(() => pool.end());

// One run of the suite, which the tests below look at. 84 calls since step 18, each waiting
// for the database, so it gets more time than one test: 51 for the attacks and the same-company
// calls of invoice.get and invoice.issue, 12 for the in-company pairs, and 21 for
// invoice.list: the one question, then each reader's two calls, and page 2 of both for each
// reader in org_456. Found by the Stage 2 review, and fixed from step 12 on, the pages from
// step 13 on.
let report: Report;
// Found live 2026-10-05: since step 18 the agents attack the commands too, 51 attacks, and
// each call from an agent reads its slip first. The hook took longer than 180 seconds on
// Neon, and vitest reported its five tests as skipped, not failed.
beforeAll(async () => {
  report = await crossTenantSuite(dbRegistry(pool), createDbLog(pool), readExamples());
}, 600_000);

/** The records with one of these request ids, read inside a company, in the order written. */
async function recordsIn(company: string, ids: string[]): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT correlation->>'request_id' AS request_id, operation, "authorization", result, reason
       FROM dsor.audit WHERE correlation->>'request_id' = ANY($1) ORDER BY sequence`,
    company,
    [ids],
  );
  return rows;
}

describe("the suite, on the database", () => {
  it("DSOR-TEN-02b: every operation, reading from the database, is attacked from both companies and refused", () => {
    expect(report.findings).toStrictEqual([]);
    // invoice.list, checked by its rows, adds no attack to the 51. Since step 18 the agents
    // attack the commands their slips list too (step 18's README, decision 2). Since step 25 the
    // tear-up is attacked too, and since step 25b the brake.
    // And the sweep, by dsor-scheduler in each company: 6 more (step 25c's
    // README, decision D11).
    // And rate.load, by dsor-rates in each company: 6 more (step 26's README,
    // decision D1).
    expect(report.attacked).toStrictEqual([
      "alert.escalate_due",
      "alert.list",
      "control.lift",
      "control.suspend",
      "delegation.revoke",
      "invoice.get",
      "invoice.issue",
      "invoice.list",
      // Changed in step 43: login.invite and login.unlink (step 43's README, revisions R2 and R7).
      "login.invite",
      "login.unlink",
      "payment.cancel",
      "payment.create",
      // Changed in step 35: payment.execute (step 35's README, decision D7).
      "payment.execute",
      // Changed in step 38: payment.reconcile (step 38's README, decision D2).
      "payment.reconcile",
      // Step 41: and the run (step 41's README, claim C1).
      "payment.run",
      // And step 29's proposal.approve.
      "proposal.approve",
      // And step 31's release (step 31's README, decision D12).
      "proposal.execute",
      "proposal.expire_due",
      "rate.load",
      // And step 28's four commands of a rule's life.
      "rule.activate",
      // And step 28b's sweep.
      "rule.check_authority",
      "rule.draft",
      "rule.retire",
      "rule.suspend",
    ]);
    // Changed in step 28: each rule command by cfo_100 and admin_100 in org_456 and admin_700 in
    // org_789, and admin_700 on the tear-up and each brake command: 45 more (step 28's README,
    // decision D19).
    // Changed in step 28b: and the sweep rule.check_authority, by dsor-scheduler in each company:
    // 6 more (step 28b's README, decision D4).
    // Changed in step 29: and proposal.approve, by cfo_100 and admin_100 in org_456 and admin_700
    // in org_789: 9 more (step 29's README, decision D2).
    // Changed in step 30: and proposal.approve by user_123 in org_456 and user_700 in org_789, AP
    // supervisors: 6 more (step 30's README, decision D5).
    // Changed in step 31: and proposal.execute, by every member of each company that line ③ lets
    // through, 7 in org_456 and 5 in org_789: 36 more (step 31's README, decision D12).
    // Changed in step 35: and payment.execute's 12 (step 35's README, decision D7).
    // Changed in step 38: and payment.reconcile's 12 (step 38's README, decision D3).
    // Changed in step 38b: and alert.escalate_due's 6 (step 38b's README, decision D3), and
    //   payment.reconcile's 3 more, cfo_100 (decision D11).
    // Changed in step 41: and payment.run's 30, the 5 callers of payment.create, 6 swaps each of its
    //   two URIs, and proposal.approve's 15 more, 3 swaps of a run's vendor for each of its 5
    //   callers (step 41's README, claims C1 and C5).
    // Changed in step 43: and login.invite's and login.unlink's 12, admin_100 and admin_700, 3
    //   swaps each (step 43's README, revisions R2 and R7).
    expect(report.attacks).toHaveLength(285);
    // And the in-company pair, from org_456's four readers and org_789's two, through the
    // database's store. Found by the Stage 2 review, and fixed from step 12 on.
    expect(report.pairs).toHaveLength(6);
  });

  // The canaries and the in-company pair come from the invoices in memory. So the database
  // must hold exactly those, or a row only it holds could leak with no canary to show it
  // (step 12's README, decision 8). Each company is read inside itself, through the
  // program's own store. Found by the Stage 2 review, and fixed from step 12 on.
  it.each(HOMES.map((home) => [home]))(
    "step 12's decision 8: %s holds exactly the invoices the suite's canaries come from",
    async (home) => {
      const { rows } = await tryThenRollBack(
        pool,
        "SELECT id FROM app.invoices WHERE tenant_id = $1 ORDER BY id",
        home,
        [home],
      );
      const store = createDbInvoices(pool);
      // The store gives each invoice beside its read's label.
      const reads = await Promise.all(rows.map((row) => store.get(home, String(row["id"]))));
      const held = reads.map(({ invoice }) => invoice);
      const expected = (ROWS["invoice"] ?? []).filter((row) => row.tenant_id === home);
      expect(held).toStrictEqual([...expected].sort((a, b) => a.id.localeCompare(b.id)));
    },
  );

  it.each([
    ["org_456", "org_789"],
    ["org_789", "org_456"],
  ])(
    "DSOR-EXE-02: every attack made in %s left one record there, with its operation and reason, and none in %s",
    async (home, other) => {
      const made = report.attacks.filter((attack) => attack.home === home);
      // Without this, a run that attacked nothing would find nothing wrong below.
      // (4 + 1 + 1 + 3) × 3 in org_456, and (2 + 2 + 2 + 2) × 3 in org_789: since step 18 the
      // agents attack the commands their slips list too. Since step 25 the tear-up's callers too:
      // user_123, cfo_100, and admin_100 in org_456, since every role may ask, and user_700 in
      // org_789, (3 and 1) × 3. Since step 25b the brake's two commands too: user_123 and admin_100
      // in org_456, and user_700 in org_789, (2 and 1) × 2 × 3.
      // And the sweep, dsor-scheduler in each company, 1 × 3 (step 25c's README,
      // decision D11).
      // And rate.load, dsor-rates in each company, 1 × 3 (step 26's README,
      // decision D1).
      // Changed in step 28: each rule command, cfo_100 and admin_100 in org_456 and admin_700 in
      // org_789, (2 and 1) × 4 × 3, and admin_700 on the tear-up and each brake command, 3 × 3
      // (step 28's README, decision D19).
      // Changed in step 28b: and the sweep rule.check_authority, dsor-scheduler in each company,
      // 1 × 3 (step 28b's README, decision D4).
      // Changed in step 29: and proposal.approve, cfo_100 and admin_100 in org_456 and admin_700 in
      // org_789, (2 and 1) × 3 (step 29's README, decision D2).
      // Changed in step 30: and proposal.approve, user_123 in org_456 and user_700 in org_789, 1 × 3
      // each (step 30's README, decision D5).
      // Changed in step 31: and proposal.execute, 7 callers in org_456 and 5 in org_789, × 3 each
      // (step 31's README, decision D12).
      // Changed in step 38b: and alert.escalate_due, dsor-scheduler in each company, 1 × 3, and
      //   payment.reconcile by cfo_100 in org_456, 1 × 3.
      // Changed in step 41: and payment.run, 3 callers in org_456 and 2 in org_789, × 6 each, and
      //   proposal.approve's vendor, 3 callers in org_456 and 2 in org_789, × 3 each.
      // Changed in step 43: and login.invite and login.unlink, admin_100 in org_456 and admin_700 in
      //   org_789, 2 × 3 each (step 43's README, revisions R2 and R7).
      expect(made).toHaveLength(home === "org_456" ? 162 : 123);
      const ids = made.map((attack) => attack.request_id);
      expect(await recordsIn(home, ids)).toStrictEqual(
        made.map(({ operation, request_id }) => ({
          request_id,
          operation: `${operation}@1`,
          authorization: "DENY",
          result: "TENANT_MISMATCH",
          reason: FOREIGN_URI,
        })),
      );
      expect(await recordsIn(other, ids)).toStrictEqual([]);
    },
  );
});
