// NEW IN STEP 15: on the database, observed_at is the database's clock, read in the
// transaction that read the data. One clock for every server, as step 09 chose for the log
// (DSOR-FRS-01a; step 15's README, C2 and decision 2).
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog, openPool } from "../src/postgres.ts";
import { RUNTIME_URL, dbRegistry, newPool } from "./db.ts";
import { CFO } from "./helpers.ts";
import { freshnessOf } from "./stores.ts";

const pool = openPool(RUNTIME_URL);
// The test's own window into the database, to read its clock.
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
afterEach(() => {
  vi.useRealTimers();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The database's clock, now. */
async function databaseNow(): Promise<number> {
  const { rows } = await observer.query<{ now: Date }>("SELECT now() AS now");
  return rows[0]!.now.getTime();
}

/** observed_at of the answer, as a number of milliseconds. */
async function observedAtOfCall(): Promise<number> {
  const answer = await call(registry, log, CFO, "invoice.get", GET_1008);
  const { observed_at } = freshnessOf(answer) as { observed_at: string };
  return Date.parse(observed_at);
}

describe("C2 on the database: observed_at is the database's clock, in the reading transaction", () => {
  it("DSOR-FRS-01a: on the database, observed_at lies between two readings of the database's clock", async () => {
    const before = await databaseNow();
    const observed = await observedAtOfCall();
    const after = await databaseNow();
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  // The program's clock is moved to 2001 for the call. A label from the program's clock
  // would say 2001. Only Date is faked: the timers the pool needs still run. Added while
  // writing the tests, 2026-10-01: without it, break Z2 is caught only when the two clocks
  // differ by more than the call takes.
  it("DSOR-FRS-01a: on the database, observed_at does not follow the program's clock", async () => {
    const before = await databaseNow();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2001-01-01T00:00:00.000Z") });
    const observed = await observedAtOfCall();
    vi.useRealTimers();
    const after = await databaseNow();
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });
});
