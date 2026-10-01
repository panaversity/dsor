// NEW IN STEP 15: on the database, the record of a read keeps the answer's label. Migration
// 008 adds the audit record's own column connector. The mode and observed_at go under
// extensions, beside step 14's classification (step 15's README, C7 and decision 7).
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog, openPool } from "../src/postgres.ts";
import { RUNTIME_URL, dbRegistry, newPool, requestId, tryThenRollBack } from "./db.ts";
import { CFO, OUR_EXTENSIONS } from "./helpers.ts";
import { freshnessOf } from "./stores.ts";

const pool = openPool(RUNTIME_URL);
// A connection of its own, to read the rows the program's pool wrote.
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The label columns of the row this request id left, read inside org_456 with SQL of our own. */
async function labelOf(request_id: string): Promise<unknown[]> {
  const { rows } = await tryThenRollBack(
    observer,
    `SELECT connector, extensions FROM dsor.audit WHERE correlation->>'request_id' = $1`,
    "org_456",
    [request_id],
  );
  return rows;
}

describe("C7 on the database: the record of a read keeps its label", () => {
  it("decision 7: on the database, cfo_100's read of INV-1008 leaves a row with postgres, current, and the answer's time", async () => {
    const request_id = requestId("frs-record");
    const answer = await call(registry, log, { ...CFO, request_id }, "invoice.get", GET_1008);
    const { observed_at } = freshnessOf(answer) as { observed_at: string };
    expect(await labelOf(request_id)).toStrictEqual([
      {
        connector: "postgres",
        extensions: {
          [OUR_EXTENSIONS]: {
            classification: "confidential",
            freshness: { mode: "current", observed_at },
          },
        },
      },
    ]);
  });

  // The log's own reader, not only our SQL: a log that wrote the column and lost it when it
  // read it back would pass the test above.
  it("decision 7: on the database, the log's own reader gives the connector back", async () => {
    const request_id = requestId("frs-reader");
    await call(registry, log, { ...CFO, request_id }, "invoice.get", GET_1008);
    const mine = (await log.records("org_456")).filter(
      (record) => record.correlation.request_id === request_id,
    );
    expect(mine).toMatchObject([{ connector: "postgres" }]);
  });

  it("decision 7: on the database, a refused read leaves no connector and no extensions", async () => {
    const request_id = requestId("frs-refused");
    await call(registry, log, { ...CFO, request_id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(await labelOf(request_id)).toStrictEqual([{ connector: null, extensions: null }]);
  });
});
