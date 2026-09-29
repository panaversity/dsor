// NEW IN STEP 12: the cross-tenant suite on the database, where both locks hold (step 12's
// README, outcome 7), and the record each attack leaves (C6).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbLog } from "../src/postgres.ts";
import { crossTenantSuite, readExamples, type Report } from "./cross-tenant.ts";
import { dbRegistry, newPool, tryThenRollBack } from "./db.ts";

const pool = newPool();
afterAll(() => pool.end());

// One run of the suite, which the tests below look at. About 20 calls, each waiting for
// the database, so it gets more time than one test.
let report: Report;
beforeAll(async () => {
  report = await crossTenantSuite(dbRegistry(pool), createDbLog(pool), readExamples());
}, 120_000);

/** The request id, result, and decision of every record with one of these ids, read in a company. */
async function recordsIn(company: string, ids: string[]): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT correlation->>'request_id' AS request_id, "authorization", result
       FROM dsor.audit WHERE correlation->>'request_id' = ANY($1) ORDER BY sequence`,
    company,
    [ids],
  );
  return rows;
}

describe("the suite, on the database", () => {
  it("DSOR-TEN-02b: every operation, reading from the database, is attacked and refused", () => {
    expect(report.findings).toStrictEqual([]);
    expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue"]);
    expect(report.attacks).toHaveLength(15);
  });

  it("DSOR-EXE-02: every attack left one record, in org_456, the caller's company", async () => {
    // Without this, a run that attacked nothing would find nothing wrong below.
    expect(report.attacks).toHaveLength(15);
    const in456 = await recordsIn("org_456", report.attacks);
    expect(in456.map((row) => row["request_id"])).toStrictEqual(report.attacks);
    for (const row of in456) {
      expect(row).toMatchObject({ authorization: "DENY", result: "TENANT_MISMATCH" });
    }
    // None in the company it attacked.
    expect(await recordsIn("org_789", report.attacks)).toStrictEqual([]);
  });
});
