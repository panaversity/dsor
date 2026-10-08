// The record of an agent's call names where DSoR learned what the signer holds, and as of
// when. Here on the database, read back as dsor_runtime reads it (DSOR-DEL-10 in
// specs/dsor/02-security.md, section 13.2; step 19's README, C9 and decision 7). The unit
// tests prove the clock in memory, with a fake one.
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { AGENT, keyed, storyDirectories } from "./helpers.ts";
import { dbRegistry, newPool, requestId, tryThenRollBack } from "./db.ts";

// The program's own pool, and the test's window into the database, both dsor_runtime.
const pool = newPool();
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const log = createDbLog(pool);

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The subject_authority of the record of this request, as dsor_runtime reads it in org_456. */
async function authorityRecorded(request_id: string): Promise<unknown> {
  // The decision's record. Since step 22 a draft's proposal has records of its own (step 22's
  // README, decision 4).
  const sql = `SELECT identity->'subject_authority' AS authority FROM dsor.audit
                WHERE correlation->>'request_id' = $1 AND kind = 'decision'`;
  const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
  expect(rows).toHaveLength(1);
  return (rows[0] as { authority: unknown }).authority;
}

describe("the source and time of the signer's authority, on the database", () => {
  it("DSOR-DEL-10: a draft on a fresh answer: the log holds role_source and the time of the answer", async () => {
    const before = Date.now();
    const request_id = requestId("s19-fresh");
    const answer = await call(
      dbRegistry(pool),
      log,
      keyed({ ...AGENT, request_id }),
      "payment.create",
      { ...INV_1008, expected_version: 1 },
    );
    expect(answer).toMatchObject({ data: { status: "draft" } });
    const authority = (await authorityRecorded(request_id)) as { source: string; as_of: string };
    expect(authority.source).toBe("role_source");
    expect(Date.parse(authority.as_of)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(authority.as_of)).toBeLessThanOrEqual(Date.now());
  });

  it("DSOR-DEL-10: a draft on a kept answer: the log holds the time of that answer, not of the call", async () => {
    const directories = storyDirectories();
    const registry = dbRegistry(pool, directories);
    const first = requestId("s19-kept-read");
    await call(registry, log, { ...AGENT, request_id: first }, "invoice.get", INV_1008);
    // The directory goes off. The kept answer is seconds old, far under org_456's PT1H.
    directories.get("org_456")!.turn("off");
    const second = requestId("s19-kept-draft");
    const answer = await call(
      registry,
      log,
      keyed({ ...AGENT, request_id: second }),
      "payment.create",
      { ...INV_1008, expected_version: 1 },
    );
    expect(answer).toMatchObject({ data: { status: "draft" } });
    expect(await authorityRecorded(second)).toStrictEqual(await authorityRecorded(first));
  });
});
