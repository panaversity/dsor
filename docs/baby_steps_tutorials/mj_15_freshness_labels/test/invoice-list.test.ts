// invoice.list, the first query that returns many rows. DSoR decides how
// many rows one answer holds, whatever the caller asks for (DSOR-QRY-01; step 13's README,
// C1). The invoices are in memory. test/invoice-list.db.test.ts asks the same of the
// database.
import { describe, expect, it } from "vitest";
import {
  invoices,
  listInvoices,
  memoryInvoices,
  type Invoice,
  type InvoiceStore,
} from "../src/invoice.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  INV_1008_OF_456,
  FIRM_IN_789,
  THE_AGENT,
  correlationFor,
  idsOf,
  log,
  notValid,
  registry,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  walk,
  withoutRequestId,
  CFO,
} from "./helpers.ts";

// org_456's twelve invoices, in order of id, typed out from step 13's README, decision 7.
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

/** Asks org_456's or org_789's invoice.list for a page, in memory. */
function pageAsked(who: RequestEnvelope, input: unknown): Promise<unknown> {
  return call(registry, log, who, "invoice.list", input).then(idsOf);
}

describe("C1: a page holds at most 10 rows, whatever the caller asks, and says when it was cut down", () => {
  it("DSOR-QRY-01: invoice.list with no limit gives the first 10 of org_456's 12 invoices, and a cursor", async () => {
    expect(await pageAsked(AGENT, {})).toStrictEqual({
      items: ORG_456.slice(0, 10),
      next_cursor: "INV-1010",
    });
  });

  it("DSOR-QRY-01: invoice.list { limit: 1000000 } gives 10 invoices, says the limit was capped, and gives a cursor", async () => {
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

  it("DSOR-QRY-01: a limit of 10 is not capped, and a limit of 11 is", async () => {
    const page = { items: ORG_456.slice(0, 10), next_cursor: "INV-1010" };
    expect(await pageAsked(AGENT, { limit: 10 })).toStrictEqual(page);
    expect(await pageAsked(AGENT, { limit: 11 })).toStrictEqual({
      ...page,
      capped: { asked: 11, max: 10 },
    });
  });

  it("DSOR-QRY-01: org_789's 5 invoices fit in one page, so there is no cursor", async () => {
    expect(await pageAsked(FIRM_IN_789, {})).toStrictEqual({ items: ORG_789 });
  });

  // The page reads one row more than it holds. Without that row, it cannot tell "exactly
  // 5 left" from "more than 5 left".
  it("DSOR-QRY-01: a page that ends exactly at the last invoice has no cursor", async () => {
    expect(await pageAsked(FIRM_IN_789, { limit: 5 })).toStrictEqual({ items: ORG_789 });
    expect(await pageAsked(FIRM_IN_789, { limit: 4 })).toStrictEqual({
      items: ORG_789.slice(0, 4),
      next_cursor: "INV-2003",
    });
  });

  // NEW IN STEP 14: cfo_100 asks, a person. An agent's items have no money (step 14's
  // README, decision 5).
  it("decision 1: each item is a whole invoice, with its company, its money as text", async () => {
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

// Our decision, not a rule of DSoR: a limit below 1 or not whole cannot be cut down to a
// page. A large one can, so it passes line ⑥ and is capped (step 13's README, decision 5).
describe("C4: a limit must be a whole number of at least 1", () => {
  it.each([
    ["0", 0, "/limit must be >= 1"],
    ["-1", -1, "/limit must be >= 1"],
    ["1.5", 1.5, "/limit must be integer"],
    ['"10", written as text', "10", "/limit must be integer"],
  ])("decision 5: a limit of %s is refused at line ⑥", async (_what, limit, problem) => {
    expect(await call(registry, log, AGENT, "invoice.list", { limit })).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.list", problem),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
  });

  // A cursor looks like an id: the characters the specification's resourceUri allows in
  // an id, at most 64 of them (step 13's README, decision 5). Found by the review.
  const ID_ONLY = '/cursor must match pattern "^[A-Za-z0-9_.\\-]+$"';
  it.each([
    ["of 65 characters", "A".repeat(65), "/cursor must NOT have more than 64 characters"],
    ["holding a NUL character", "INV-\u00001008", ID_ONLY],
    // Found by the sweep: a cursor that could be null passed every test.
    ["that is null", null, "/cursor must be string"],
    ["that is another company's URI", "dsor://org_789/invoice/INV-2001", ID_ONLY],
  ])("decision 5: a cursor %s is refused at line ⑥", async (_what, cursor, problem) => {
    expect(await call(registry, log, AGENT, "invoice.list", { cursor })).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.list", problem),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
  });

  it("decision 5: a cursor of 64 characters is accepted", async () => {
    // Every id of org_456 comes after AAAA…, so the page starts at the first.
    expect(await pageAsked(AGENT, { limit: 1, cursor: "A".repeat(64) })).toStrictEqual({
      items: ORG_456.slice(0, 1),
      next_cursor: "INV-1001",
    });
  });
});

describe("C3: the cursor walks the whole list, once", () => {
  it("DSOR-QRY-01: following next_cursor from { limit: 5 } gives org_456's 12 invoices as 5, 5, and 2, each once, in order, the last page with no cursor", async () => {
    expect(await walk((input) => pageAsked(AGENT, input), 5)).toStrictEqual([
      { items: ORG_456.slice(0, 5), next_cursor: "INV-1005" },
      { items: ORG_456.slice(5, 10), next_cursor: "INV-1010" },
      { items: ORG_456.slice(10) },
    ]);
  });

  // The cursor is a place in the alphabet of the caller's own company. It tells nothing
  // about another company's invoice of that name (step 13's README, decision 4). Found by
  // the review: two cursors past org_456's last id gave two empty pages, whatever the code
  // did with them. Here both land between org_789's INV-1008 and INV-2001.
  it("DSOR-IDN-03b: as org_789, the cursor INV-1010, which only org_456 has, gives the same page as the made-up INV-1099", async () => {
    const theirs = await call(registry, log, FIRM_IN_789, "invoice.list", { cursor: "INV-1010" });
    const nobodys = await call(registry, log, FIRM_IN_789, "invoice.list", { cursor: "INV-1099" });
    expect(withoutRequestId(theirs)).toStrictEqual(withoutRequestId(nobodys));
    expect(idsOf(theirs)).toStrictEqual({ items: ORG_789.slice(1) });
  });
});

// Found by the sweep: nothing checked how many rows the store was asked for, or read. A
// store that read every row, or a handler that asked for the caller's million, gave the
// same pages, because pageOf cut them afterwards. The cap must hold where the rows are read.
describe("C1: the store is asked for one row more than the page, and reads no more", () => {
  it("DSOR-QRY-01: for no limit, a million, and 3, the code asks the store for 11, 11, and 4 rows", async () => {
    const memory = memoryInvoices();
    const asked: number[] = [];
    const counting: InvoiceStore = {
      get: memory.get,
      list: async (tenant, after, count) => {
        asked.push(count);
        return memory.list(tenant, after, count);
      },
    };
    // The registry holds the store (step 10's README, decision 13). Found by the Stage 2
    // review, and fixed from step 10 on.
    const counted = buildRegistry(
      shipped,
      handlersFor(),
      shippedRoles,
      shippedInputs,
      shippedLabels,
      counting,
    );
    for (const input of [{}, { limit: 1000000 }, { limit: 3 }]) {
      await call(counted, log, AGENT, "invoice.list", input);
    }
    expect(asked).toStrictEqual([11, 11, 4]);
  });

  it("DSOR-QRY-01: the store in memory gives no more rows than it is asked for", async () => {
    const three = await memoryInvoices().list("org_456", undefined, 3);
    expect(three.map(({ id }) => id)).toStrictEqual(["INV-1001", "INV-1002", "INV-1003"]);
    const two = await memoryInvoices().list("org_456", "INV-1003", 2);
    expect(two.map(({ id }) => id)).toStrictEqual(["INV-1004", "INV-1005"]);
  });

  // As invoice.get's copy, found by step 04's review. Found for list by the sweep.
  it("decision 1: a listed invoice is a copy: changing it changes nothing stored", async () => {
    const [first] = await memoryInvoices().list("org_456", "INV-1007", 1);
    first!.amount.value = "0.01";
    const [again] = await memoryInvoices().list("org_456", "INV-1007", 1);
    expect(again).toStrictEqual(INV_1008_OF_456);
    expect(invoices[0]).toStrictEqual(INV_1008_OF_456);
  });

  // The database's C.UTF-8 puts every capital letter before every small one. A sort by
  // the reader's language would not, and memory and the database would walk in different
  // orders. Found by the sweep.
  it("decision 4: ids are ordered by their character codes: INV-B before INV-a", () => {
    const named = (id: string): Invoice => ({ ...INV_1008_OF_456, status: "issued", id });
    const list = [named("INV-a"), named("INV-B"), named("INV-1")];
    const ids = listInvoices(list, "org_456", undefined, 10).map(({ id }) => id);
    expect(ids).toStrictEqual(["INV-1", "INV-B", "INV-a"]);
  });
});
