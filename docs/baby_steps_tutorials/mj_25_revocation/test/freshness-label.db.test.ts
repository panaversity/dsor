// On the database, every successful query's answer says how fresh its data
// is. A read from PostgreSQL within the request is current, and its connector is postgres
// (DSOR-FRS-01a; step 15's README, C1 and outcome 2).
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog, openPool } from "../src/postgres.ts";
import { RUNTIME_URL, dbRegistry } from "./db.ts";
import { AGENT, CFO } from "./helpers.ts";
import { freshnessOf } from "./stores.ts";

const pool = openPool(RUNTIME_URL);
afterAll(async () => {
  await pool.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
const CURRENT_FROM_POSTGRES = {
  mode: "current",
  observed_at: expect.any(String),
  connector: "postgres",
};
// A read of one invoice names its version too (step 21's README, decision 9).
const ONE_FROM_POSTGRES = { ...CURRENT_FROM_POSTGRES, resource_version: "1" };

describe("C1 on the database: every successful query answer states the mode, observed_at, and the connector", () => {
  it("DSOR-FRS-01a: on the database, the agent's INV-1008 is current, from postgres", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", GET_1008);
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(freshnessOf(answer)).toStrictEqual(ONE_FROM_POSTGRES);
  });

  it("DSOR-FRS-01a: on the database, cfo_100's INV-1008 is current, from postgres", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", GET_1008);
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(freshnessOf(answer)).toStrictEqual(ONE_FROM_POSTGRES);
  });

  it("DSOR-FRS-01a: on the database, a page of invoices is current, from postgres, for the agent and for cfo_100", async () => {
    for (const who of [AGENT, CFO]) {
      const answer = await call(registry, log, who, "invoice.list", { limit: 3 });
      expect(answer).toMatchObject({ data: { items: expect.any(Array) } });
      expect(freshnessOf(answer)).toStrictEqual(CURRENT_FROM_POSTGRES);
    }
  });
});
