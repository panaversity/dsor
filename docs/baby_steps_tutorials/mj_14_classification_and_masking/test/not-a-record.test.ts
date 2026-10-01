// NEW IN STEP 14, from the review: what is not a record of its kind never leaves, for
// anyone. A person given text would be recorded as reading nothing, while the text held
// an amount (DSOR-CLS-05; step 14's README, decision 3).
import { describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { INV_1008_OF_456, SUPERVISOR, UNEXPECTED, registryWith } from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

describe("decision 3: what is not a record never leaves, for a person too", () => {
  it.each([
    ["text", "INV-1008 is 31,400.00 USD"],
    ["a number", 31400],
    ["null", null],
    ["nothing", undefined],
    ["a list", [INV_1008_OF_456]],
  ])(
    "DSOR-CLS-05: an answer that is not a record, %s, is refused for user_123, and its record names no read",
    async (_what, value) => {
      const log = createLog();
      const answer = await call(registryWith(async () => value), log, SUPERVISOR, "test.run", GET_1008);
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
      const [record] = await log.records();
      expect(record).toMatchObject({ authorization: "ALLOW", result: "INTERNAL_ERROR" });
      expect(record).not.toHaveProperty("row_count");
    },
  );

  it.each([
    ["items that are lists", { items: [[INV_1008_OF_456]] }],
    ["items that are text", { items: "INV-1008 is 31,400.00 USD" }],
  ])("DSOR-CLS-05: a page with %s is refused for user_123", async (_what, page) => {
    const registry = registryWith(async () => page, "InvoicePage");
    expect(await call(registry, createLog(), SUPERVISOR, "test.run", GET_1008)).toMatchObject({
      code: "INTERNAL_ERROR",
      message: UNEXPECTED,
    });
  });
});
