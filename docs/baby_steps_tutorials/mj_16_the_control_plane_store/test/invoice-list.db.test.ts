// invoice.list reads its pages from app.invoices, as dsor_runtime
// (step 13's README, C1). The same claims as test/invoice-list.test.ts, asked of the
// database.
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { RUNTIME_URL, dbRegistry, newPool, ownerList, requestId, rowsFor } from "./db.ts";
import { AGENT, CFO, FIRM_IN_789, idsOf, walk } from "./helpers.ts";

const pool = openPool(RUNTIME_URL);
// A connection of its own, to read the records the program's pool wrote.
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

// Each company's invoices, in order of id, typed out from step 13's README, decision 7.
const ORG_456 = [
  "INV-1001",
  "INV-1002",
  "INV-1003",
  "INV-1004",
  "INV-1005",
  "INV-1006",
  "INV-1007",
  "INV-1008",
  "INV-1009",
  "INV-1010",
  "INV-1011",
  "INV-1012",
].map((id) => `org_456/${id}`);
const ORG_789 = ["INV-1008", "INV-2001", "INV-2002", "INV-2003", "INV-2004"].map(
  (id) => `org_789/${id}`,
);

/** Asks invoice.list for a page, from the database. */
function pageAsked(who: RequestEnvelope, input: unknown): Promise<unknown> {
  return call(registry, log, who, "invoice.list", input).then(idsOf);
}

describe("C1: a page from the database holds at most 10 rows", () => {
  it("DSOR-QRY-01: invoice.list with no limit gives the first 10 of org_456's 12 invoices, and a cursor", async () => {
    expect(await pageAsked(AGENT, {})).toStrictEqual({
      items: ORG_456.slice(0, 10),
      next_cursor: "INV-1010",
    });
  });

  it("DSOR-QRY-01: invoice.list { limit: 1000000 } gives 10 invoices, capped, and a cursor", async () => {
    expect(await pageAsked(AGENT, { limit: 1000000 })).toStrictEqual({
      items: ORG_456.slice(0, 10),
      next_cursor: "INV-1010",
      capped: { asked: 1000000, max: 10 },
    });
  });

  it("DSOR-QRY-01: invoice.list { limit: 3 } gives 3 invoices and a cursor, and is not capped", async () => {
    expect(await pageAsked(AGENT, { limit: 3 })).toStrictEqual({
      items: ORG_456.slice(0, 3),
      next_cursor: "INV-1003",
    });
  });

  it("DSOR-QRY-01: org_789's 5 invoices fit in one page, even asked for exactly 5: no cursor", async () => {
    expect(await pageAsked(FIRM_IN_789, {})).toStrictEqual({ items: ORG_789 });
    expect(await pageAsked(FIRM_IN_789, { limit: 5 })).toStrictEqual({ items: ORG_789 });
  });

  // Cfo_100 asks, a person. An agent's items have no money (step 14's
  // README, decision 5).
  it("DSOR-MON-01: each item is a whole invoice from app.invoices, its money exactly as stored", async () => {
    const answer = await call(registry, log, CFO, "invoice.list", { limit: 1 });
    expect("data" in answer && answer.data).toStrictEqual({
      items: [
        {
          tenant_id: "org_456",
          id: "INV-1001",
          vendor_id: "VENDOR-12",
          amount: { value: "1250.00", currency: "USD" },
          open_amount: { value: "0.00", currency: "USD" },
          status: "paid",
        },
      ],
      next_cursor: "INV-1001",
    });
  });
});

// Row-level security would hide a list that forgot its company. Only the owner, who
// bypasses it, can see whether DSoR's own WHERE holds by itself (step 11's README, "What
// the specification asks", point 1).
describe("C7: the list's own SQL keeps to the company, without the database's lock", () => {
  it("DSOR-TEN-01b: the owner lists each company through DSoR's store, and gets that company's invoices and nothing else", () => {
    expect(ownerList()).toStrictEqual({
      bypassrls: true,
      listed: { org_456: ORG_456, org_789: ORG_789 },
    });
  });
});

describe("C3: the cursor walks the whole list in the database, once", () => {
  it("DSOR-QRY-01: following next_cursor from { limit: 5 } gives org_456's 12 invoices as 5, 5, and 2, the last page with no cursor", async () => {
    expect(await walk((input) => pageAsked(AGENT, input), 5)).toStrictEqual([
      { items: ORG_456.slice(0, 5), next_cursor: "INV-1005" },
      { items: ORG_456.slice(5, 10), next_cursor: "INV-1010" },
      { items: ORG_456.slice(10) },
    ]);
  });

  // Found by the review: the cursor was tested as a place, never a lookup, in memory only.
  it("DSOR-IDN-03b: as org_789, the cursor INV-1010, which only org_456 has, gives the same page as the made-up INV-1099", async () => {
    const theirs = await pageAsked(FIRM_IN_789, { cursor: "INV-1010" });
    expect(await pageAsked(FIRM_IN_789, { cursor: "INV-1099" })).toStrictEqual(theirs);
    expect(theirs).toStrictEqual({ items: ORG_789.slice(1) });
  });

  it("DSOR-QRY-01: following next_cursor from { limit: 2 } gives org_789's 5 invoices as 2, 2, and 1", async () => {
    expect(await walk((input) => pageAsked(FIRM_IN_789, input), 2)).toStrictEqual([
      { items: ORG_789.slice(0, 2), next_cursor: "INV-2001" },
      { items: ORG_789.slice(2, 4), next_cursor: "INV-2003" },
      { items: ORG_789.slice(4) },
    ]);
  });
});

// Following the cursor to the end reads everything, a page at a time. Each page is a call
// of its own, so the drain is visible in the log (step 13's README, "Not the outcome").
describe("C6: each page is its own call, with its own record", () => {
  it("DSOR-EXE-02: three pages leave three records in org_456, each ALLOW and ok, and none in org_789", async () => {
    const ids = [requestId("c6-page-1"), requestId("c6-page-2"), requestId("c6-page-3")];
    let cursor: string | undefined;
    for (const id of ids) {
      const input = cursor === undefined ? { limit: 5 } : { limit: 5, cursor };
      const answer = await call(registry, log, { ...AGENT, request_id: id }, "invoice.list", input);
      cursor = "data" in answer ? (answer.data as { next_cursor?: string }).next_cursor : undefined;
    }
    // The third page was the last.
    expect(cursor).toBeUndefined();
    for (const id of ids) {
      expect(await rowsFor(observer, "org_456", id)).toMatchObject([
        { operation: "invoice.list@1", authorization: "ALLOW", result: "ok" },
      ]);
      expect(await rowsFor(observer, "org_789", id)).toStrictEqual([]);
    }
  });
});

// Found by the sweep: `LIMIT $3 + 1000` passed every test, because pageOf cut the extra
// rows afterwards. The cap must hold where the rows are read.
describe("C1: the database store reads no more rows than it is asked for", () => {
  it("DSOR-QRY-01: asked for 3, then for 2 after INV-1003, it gives exactly those", async () => {
    const store = createDbInvoices(pool);
    // The store gives the rows beside its read's label.
    const { rows: three } = await store.list("org_456", undefined, 3);
    expect(three.map(({ id }) => id)).toStrictEqual(["INV-1001", "INV-1002", "INV-1003"]);
    const { rows: two } = await store.list("org_456", "INV-1003", 2);
    expect(two.map(({ id }) => id)).toStrictEqual(["INV-1004", "INV-1005"]);
  });
});
