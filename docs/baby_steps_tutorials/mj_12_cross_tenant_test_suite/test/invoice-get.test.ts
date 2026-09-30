// NEW IN STEP 12: invoice.get takes the invoice's canonical URI, as invoice.issue does, so
// every request holds a company the suite can swap (step 12's README, decision 1).
import { describe, expect, it } from "vitest";
import { memoryInvoices } from "../src/invoice.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import {
  AGENT,
  FIRM_IN_789,
  INV_1008_OF_456,
  INV_1008_OF_789,
  THE_AGENT,
  THE_FIRM,
  correlationFor,
  log,
  notValid,
  registry,
} from "./helpers.ts";

describe("decision 1: invoice.get takes an invoice's canonical URI", () => {
  it("invoice.get with { id }, step 07's input, is refused by line ⑥", async () => {
    expect(await call(registry, log, AGENT, "invoice.get", { id: "INV-1008" })).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.get", "must have required property 'invoice'"),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
  });

  it("DSOR-IDN-03b: invoice.get with a URI gives INV-1008 of the active company", async () => {
    const in456 = { invoice: "dsor://org_456/invoice/INV-1008" };
    expect(await call(registry, log, AGENT, "invoice.get", in456)).toStrictEqual({
      data: INV_1008_OF_456,
      correlation: correlationFor(THE_AGENT),
    });
    const in789 = { invoice: "dsor://org_789/invoice/INV-1008" };
    expect(await call(registry, log, FIRM_IN_789, "invoice.get", in789)).toStrictEqual({
      data: INV_1008_OF_789,
      correlation: correlationFor(THE_FIRM),
    });
  });

  // The specification's pattern for a URI accepts any kind of thing. invoice.get's input
  // accepts an invoice's URI only, and says so at line ⑥, before its code runs.
  it("invoice.get refuses a vendor's URI at line ⑥", async () => {
    const vendor = { invoice: "dsor://org_456/vendor/VENDOR-44" };
    expect(await call(registry, log, AGENT, "invoice.get", vendor)).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.get", '/invoice must match pattern "^dsor://[^/]+/invoice/"'),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
  });

  // The checklist refuses a foreign URI before the code runs, so no call can show this.
  // The code is asked directly. Found by the review: code that read the URI's company
  // passed every test.
  it("DSOR-IDN-03b: the code, handed org_789's URI while working in org_456, reads org_456's invoice", async () => {
    const get = handlersFor(memoryInvoices())["invoice.get"]!;
    const foreign = { invoice: "dsor://org_789/invoice/INV-1008" };
    expect(await get(foreign, "org_456")).toStrictEqual(INV_1008_OF_456);
  });
});
