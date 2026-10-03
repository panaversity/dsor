// NEW IN STEP 15: the planted cache, over the database's own store. The first read is
// PostgreSQL's, current. The second is the cache's: observational, with the database's time
// of the first read (DSOR-FRS-01b; step 15's README, C3 and decision 8).
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool } from "../src/postgres.ts";
import { RUNTIME_URL } from "./db.ts";
import { CFO } from "./helpers.ts";
import { aMomentLater, cacheOver, freshnessOf, registryOver } from "./stores.ts";

const pool = openPool(RUNTIME_URL);
afterAll(async () => {
  await pool.end();
});
const log = createDbLog(pool);

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

describe("C3 on the database: a cached value is never labelled current", () => {
  it("DSOR-FRS-01b: on the database, a second read from the cache is observational, with the first read's time", async () => {
    const registry = registryOver(cacheOver(createDbInvoices(pool)));
    const first = await call(registry, log, CFO, "invoice.get", GET_1008);
    await aMomentLater();
    const second = await call(registry, log, CFO, "invoice.get", GET_1008);
    expect(freshnessOf(first)).toMatchObject({ mode: "current", connector: "postgres" });
    const { observed_at } = freshnessOf(first) as { observed_at: string };
    expect(freshnessOf(second)).toStrictEqual({
      mode: "observational",
      observed_at,
      connector: "postgres",
    });
  });
});
