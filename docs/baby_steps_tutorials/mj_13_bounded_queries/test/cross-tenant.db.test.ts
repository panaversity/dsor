// The cross-tenant suite with the database's store and log (step 12's
// README, outcome 8), and the record each attack leaves (C6). No attack reaches the
// database's own lock: a foreign URI is refused before any read (step 12's README, "What
// the specification asks", point 5).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbLog } from "../src/postgres.ts";
import { crossTenantSuite, readExamples, type Report } from "./cross-tenant.ts";
import { dbRegistry, newPool, tryThenRollBack } from "./db.ts";
import { FOREIGN_URI } from "./helpers.ts";

const pool = newPool();
afterAll(() => pool.end());

// One run of the suite, which the tests below look at. About 36 calls, each waiting for
// the database, so it gets more time than one test.
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
    expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue"]);
    expect(report.attacks).toHaveLength(27);
  });

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
