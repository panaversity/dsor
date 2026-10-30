// On the database, observed_at is the database's clock, read in the
// transaction that read the data. One clock for every server, as step 09 chose for the log
// (DSOR-FRS-01a; step 15's README, C2 and decision 2).
import pg from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool } from "../src/postgres.ts";
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

// Found by the mutation sweep, 2026-10-02: only get's time was checked against the program's
// clock, so a list labelled by the program's clock passed.
describe("C2 on the database, from the sweep: a page's observed_at is the database's clock too", () => {
  it("DSOR-FRS-01a: on the database, a page's observed_at does not follow the program's clock", async () => {
    const before = await databaseNow();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2001-01-01T00:00:00.000Z") });
    const answer = await call(registry, log, CFO, "invoice.list", { limit: 2 });
    vi.useRealTimers();
    const after = await databaseNow();
    const observed = Date.parse((freshnessOf(answer) as { observed_at: string }).observed_at);
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });
});

/** What each statement the store sent does, in the order it was sent, and on which connection. */
async function statementsOf(read: () => Promise<unknown>): Promise<string[]> {
  const sent: string[] = [];
  const connections = new Set<unknown>();
  // Every client the pool lends is a pg.Client, so its query is watched for this read only.
  const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = prototype.query;
  prototype.query = function (this: { processID?: number }, ...args: unknown[]): unknown {
    const text = typeof args[0] === "string" ? args[0] : "";
    connections.add(this.processID);
    sent.push(whatItDoes(text.replace(/\s+/g, " ").trim()));
    return original.apply(this, args);
  };
  try {
    await read();
  } finally {
    prototype.query = original;
  }
  return connections.size === 1 ? sent : [`${connections.size} connections`, ...sent];
}

/** A short name for each statement the store sends, or the statement itself. */
function whatItDoes(sql: string): string {
  if (sql === "BEGIN" || sql === "COMMIT") return sql;
  if (sql.startsWith("SELECT set_config('dsor.tenant_id'")) return "the company";
  if (sql === "SELECT now() AS now") return "now()";
  if (sql.includes("FROM app.invoices")) return "the invoices";
  return sql;
}

// Found by the review: the tests above check only that observed_at falls between two
// readings of the database's clock. A now() from another transaction, or one taken after the
// rows, passed them (step 15's README, decision 2).
describe("C2 on the database, from the review: now() is read in the transaction that reads the rows", () => {
  it("DSOR-FRS-01a: get sends BEGIN, the company, now(), the invoices, and COMMIT, on one connection", async () => {
    const store = createDbInvoices(pool);
    expect(await statementsOf(() => store.get("org_456", "INV-1008"))).toStrictEqual([
      "BEGIN",
      "the company",
      "now()",
      "the invoices",
      "COMMIT",
    ]);
  });

  it("DSOR-FRS-01a: list sends the same five, in the same order, on one connection", async () => {
    const store = createDbInvoices(pool);
    expect(await statementsOf(() => store.list("org_456", undefined, 3))).toStrictEqual([
      "BEGIN",
      "the company",
      "now()",
      "the invoices",
      "COMMIT",
    ]);
  });
});
