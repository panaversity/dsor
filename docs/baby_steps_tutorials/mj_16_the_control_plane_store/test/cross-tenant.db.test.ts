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

// One run of the suite, which the tests below look at. 69 calls, each waiting for the
// database, so it gets more time than one test: 36 for the attacks and the same-company
// calls of invoice.get and invoice.issue, 12 for the in-company pairs, and 21 for
// invoice.list: the one question, then each reader's two calls, and page 2 of both for each
// reader in org_456. Found by the Stage 2 review, and fixed from step 12 on, the pages from
// step 13 on.
let report: Report;
beforeAll(async () => {
  report = await crossTenantSuite(dbRegistry(pool), createDbLog(pool), readExamples());
}, 180_000);

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
    // invoice.list, checked by its rows, adds no attack to the 27.
    expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue", "invoice.list"]);
    expect(report.attacks).toHaveLength(27);
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
      // NEW IN STEP 15: the store gives each invoice beside its read's label.
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
      expect(made).toHaveLength(home === "org_456" ? 15 : 12);
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
