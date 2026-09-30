// NEW IN STEP 14: the record of a read, in dsor.audit (DSOR-CLS-05; step 14's README, C5
// and decision 7). Migration 007 adds the columns resources and row_count.
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog, openPool } from "../src/postgres.ts";
import { RUNTIME_URL, dbRegistry, newPool, requestId, tryThenRollBack } from "./db.ts";
import { CFO, OUR_EXTENSIONS } from "./helpers.ts";

const pool = openPool(RUNTIME_URL);
// A connection of its own, to read the records the program's pool wrote.
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

/** The read's own columns of the row this request id left, read inside org_456. */
async function readOf(request_id: string): Promise<unknown[]> {
  const { rows } = await tryThenRollBack(
    observer,
    `SELECT operation, resources, row_count, extensions, correlation->>'principal_id' AS who
       FROM dsor.audit WHERE correlation->>'request_id' = $1`,
    "org_456",
    [request_id],
  );
  return rows;
}

describe("C5 on the database: a read of confidential data leaves a row with who, what, and how many", () => {
  it("DSOR-CLS-05: on the database, cfo_100's read of INV-1008 leaves a row with its URI, one row, and confidential", async () => {
    const request_id = requestId("cls-05-get");
    await call(registry, log, { ...CFO, request_id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(await readOf(request_id)).toStrictEqual([
      {
        operation: "invoice.get@1",
        resources: ["dsor://org_456/invoice/INV-1008"],
        row_count: 1,
        extensions: { [OUR_EXTENSIONS]: { classification: "confidential" } },
        who: "cfo_100",
      },
    ]);
  });

  it("DSOR-CLS-05: on the database, a page's row names every invoice it returned", async () => {
    const request_id = requestId("cls-05-list");
    await call(registry, log, { ...CFO, request_id }, "invoice.list", { limit: 2 });
    expect(await readOf(request_id)).toStrictEqual([
      {
        operation: "invoice.list@1",
        resources: ["dsor://org_456/invoice/INV-1001", "dsor://org_456/invoice/INV-1002"],
        row_count: 2,
        extensions: { [OUR_EXTENSIONS]: { classification: "confidential" } },
        who: "cfo_100",
      },
    ]);
  });

  // A refusal read nothing, so its row names nothing.
  it("DSOR-CLS-05: on the database, a refused read leaves no resources and no row count", async () => {
    const request_id = requestId("cls-05-refused");
    await call(registry, log, { ...CFO, request_id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(await readOf(request_id)).toStrictEqual([
      {
        operation: "invoice.get@1",
        resources: null,
        row_count: null,
        extensions: null,
        who: "cfo_100",
      },
    ]);
  });
});
