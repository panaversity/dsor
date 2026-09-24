// NEW IN STEP 03: nobody calls getInvoice directly any more.
//
// A caller names an operation and passes arguments. The operation is looked up in the
// registry, so an operation with no contract cannot be called at all.

import { describe, expect, it } from "vitest";
import { assertPaired, callOperation, operationIds } from "../src/operations.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

describe("callOperation", () => {
  it("DSOR-OPR-01: every contract in the registry has a handler, and every handler a contract", () => {
    // The strongest support this step can give DSOR-OPR-01. It does not prove nobody
    // imports getInvoice behind the registry's back: there is no door to close until
    // step 42. It does prove the two lists cannot drift apart.
    expect(operationIds().sort()).toEqual(["invoice.get", "invoice.issue"]);
  });

  // assertPaired runs at start-up, so these hand it the two lists directly. Asserting
  // on operationIds() alone would not do: that returns the registry's keys, so it says
  // the same thing whether the pairing is checked or not.
  it("DSOR-OPR-01: a contract with no handler is refused", () => {
    const registry = new Map([["invoice.cancel", {} as never]]);

    expect(() => assertPaired(registry, {})).toThrow(/invoice\.cancel/);
  });

  it("DSOR-OPR-01: a handler with no contract is refused", () => {
    expect(() => assertPaired(new Map(), { "invoice.cancel": () => undefined })).toThrow(
      /invoice\.cancel/,
    );
  });

  it("an operation that has no contract cannot be called", () => {
    expect(() => callOperation("invoice.delete", { invoice: INV_1008 })).toThrow(/invoice\.delete/);
    expect(() => callOperation("execute_sql", { sql: "drop table invoices" })).toThrow(TypeError);
  });

  describe("invoice.get", () => {
    it("reads one invoice by its canonical address", () => {
      expect(callOperation("invoice.get", { invoice: INV_1008 })?.amount.value).toBe("31400.00");
    });

    it("returns undefined for an address that names no invoice we hold", () => {
      expect(callOperation("invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" })).toBe(
        undefined,
      );
    });

    // Step 02's README promised the entity segment stops being trusted text in step 03.
    // No rule id: this keeps that promise, it is not DSOR-RID-01b.
    it("refuses an address whose entity no operation is named for", () => {
      expect(() =>
        callOperation("invoice.get", { invoice: "dsor://org_456/vendor/VENDOR-44" }),
      ).toThrow(/vendor/);
    });

    it("refuses an address that is not a canonical URI at all", () => {
      expect(() => callOperation("invoice.get", { invoice: "INV-1008" })).toThrow(TypeError);
      expect(() => callOperation("invoice.get", {})).toThrow(TypeError);
    });

    // A regular expression turns whatever it is given into text first, so an object
    // with a toString would sail past parseUri and read a real invoice. Only checking
    // the type stops it — the same lesson formatUri taught in step 02.
    it("refuses an argument that is not text, however convincing it looks", () => {
      const disguised = { toString: () => INV_1008 } as unknown as string;

      expect(() => callOperation("invoice.get", { invoice: disguised })).toThrow(
        /needs an invoice address/,
      );
    });

    // The address names a company. Acting on a different company's invoice than the
    // address asked for is how one tenant reads another's records.
    it("refuses an address for a company this program does not serve", () => {
      expect(() =>
        callOperation("invoice.get", { invoice: "dsor://org_999/invoice/INV-1008" }),
      ).toThrow(/org_999/);
      expect(() =>
        callOperation("invoice.issue", { invoice: "dsor://org_999/invoice/INV-1009" }),
      ).toThrow(/org_999/);
    });
  });

  describe("invoice.issue", () => {
    // Draft, issued, then refused — in one test on purpose. Tests in one file share the
    // module, so a second test could not assume INV-1009 was still a draft.
    it("turns a draft into an issued invoice, and refuses the second attempt", () => {
      expect(callOperation("invoice.get", { invoice: INV_1009 })?.status).toBe("draft");

      const issued = callOperation("invoice.issue", { invoice: INV_1009 });

      expect(issued?.status).toBe("issued");
      expect(callOperation("invoice.get", { invoice: INV_1009 })?.status).toBe("issued");

      // Refused because the status moved on. This is NOT idempotency, which arrives in
      // step 20, and NOT in-flight exclusivity, which is step 32.
      expect(() => callOperation("invoice.issue", { invoice: INV_1009 })).toThrow(/draft/);
    });

    it("refuses an invoice that is already issued", () => {
      expect(() => callOperation("invoice.issue", { invoice: INV_1008 })).toThrow(/draft/);
    });

    it("returns undefined for an address that names no invoice we hold", () => {
      expect(callOperation("invoice.issue", { invoice: "dsor://org_456/invoice/INV-9999" })).toBe(
        undefined,
      );
    });

    it("the issued invoice is still frozen, and still carries its own address", () => {
      const issued = callOperation("invoice.get", { invoice: INV_1008 });

      if (issued === undefined) {
        throw new Error("INV-1008 is missing");
      }

      expect(Object.isFrozen(issued)).toBe(true);
      expect(issued.uri).toBe(INV_1008);
    });
  });
});
