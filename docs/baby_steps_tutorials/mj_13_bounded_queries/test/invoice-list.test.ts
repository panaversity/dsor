// NEW IN STEP 13: invoice.list, the first query that returns many rows. DSoR decides how
// many rows one answer holds, whatever the caller asks for (DSOR-QRY-01; step 13's README,
// C1). The invoices are in memory. test/invoice-list.db.test.ts asks the same of the
// database.
import { describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  FIRM_IN_789,
  THE_AGENT,
  correlationFor,
  idsOf,
  log,
  notValid,
  registry,
} from "./helpers.ts";

// org_456's twelve invoices, in order of id, typed out from step 13's README, decision 7.
const ORG_456 = [
  "INV-1001", "INV-1002", "INV-1003", "INV-1004", "INV-1005", "INV-1006",
  "INV-1007", "INV-1008", "INV-1009", "INV-1010", "INV-1011", "INV-1012",
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

  it("decision 1: each item is a whole invoice, with its company, its money as text", async () => {
    const answer = await call(registry, log, AGENT, "invoice.list", { limit: 1 });
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
});
