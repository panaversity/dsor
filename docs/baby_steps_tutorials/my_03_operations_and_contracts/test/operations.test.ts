// NEW IN STEP 03: nobody calls getInvoice directly any more.
//
// A caller names an operation and passes arguments. The operation is looked up in the
// registry, so an operation with no contract cannot be called at all.

import { describe, expect, it } from "vitest";
import { assertPaired, callOperation, operationIds, PAIRS_CHECKED } from "../src/operations.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";

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
    // Two different refusals, and the difference is the point. "No contract at all" and
    // "a contract whose handler is not built yet" are not the same situation, and a
    // caller reading the message needs to be able to tell them apart.
    expect(() => callOperation("invoice.delete", { invoice: INV_1008 })).toThrow(
      /no contract for it/,
    );
    expect(() => callOperation("execute_sql", { sql: "drop table invoices" })).toThrow(
      /no contract for it/,
    );
    expect(() => callOperation("invoice.issue", { invoice: INV_1009 })).toThrow(/no handler/);
  });

  // The module runs loadRegistry and assertPaired as it loads. No test in this process
  // can watch those lines run — by the time a test imports the module, they already have.
  // What a test can do is assert the state they guarantee, from outside.
  it("DSOR-OPR-01: on load, every contract is accounted for", () => {
    const ids = operationIds();

    expect(ids).toEqual(["invoice.get", "invoice.issue"]);

    // Each id either runs, or refuses for the single allowed reason. A contract nobody
    // had thought about would refuse with "no contract for", which cannot happen for an
    // id the registry just handed us — and that is the pairing, seen from the outside.
    for (const id of ids) {
      let refusal = "";

      try {
        callOperation(id, { invoice: INV_1008 });
      } catch (error) {
        refusal = (error as Error).message;
      }

      expect(refusal).not.toMatch(/no contract for it/);
    }
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
        callOperation("invoice.get", { invoice: "dsor://org_1/invoice/INV-1008" }),
      ).toThrow(/this program serves org_456/);
    });

    // A NEAR MISS, which is what the two cases above cannot catch: `org_999` and `org_1` are
    // refused by a prefix match too, so nothing protected the `!==`. Replacing it with
    // `!TENANT.startsWith(parsed.tenant)` left all 53 tests green, and `org_45` and `org_4` then
    // read org_456's invoice.
    //
    // Fifth appearance of this shape in six steps: getInvoice's id, parseUri's entity, this
    // tenant, step 05's findPerson, step 06's holds. Two of the five became real defects.
    it("DSOR-RID-01b: a tenant that is only part of ours is refused, both ways round", () => {
      for (const tenant of ["org_45", "org_4", "org_4567", "org_456789"]) {
        expect(
          () => callOperation("invoice.get", { invoice: `dsor://${tenant}/invoice/INV-1008` }),
          tenant,
        ).toThrow(/this program serves org_456/);
      }

      expect(
        callOperation("invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }),
      ).toBeDefined();
    });

    // The same near-miss question for the entity. `vendor` is refused by a prefix match too;
    // `invoices` and `invoice_line` are not.
    it("DSOR-RID-01b: an entity that is only part of ours is refused", () => {
      for (const entity of ["invoices", "invoice_line", "inv", "invoic"]) {
        expect(
          () => callOperation("invoice.get", { invoice: `dsor://org_456/${entity}/INV-1008` }),
          entity,
        ).toThrow(/is named for invoice/);
      }
    });

    // The caller's OWN argument. An object that inherits `invoice` from a prototype carries an
    // argument nobody in this program passed.
    it("DSOR-RID-01b: an invoice argument the object only inherits is not read", () => {
      const inherited = Object.create({
        invoice: "dsor://org_456/invoice/INV-1008",
      }) as Record<string, unknown>;

      expect(inherited["invoice"]).toBe("dsor://org_456/invoice/INV-1008");
      expect(() => callOperation("invoice.get", inherited)).toThrow(/needs an invoice address/);
    });
  });

  // invoice.issue ships a contract in this step and no handler. The command itself is
  // step 04's, where a refusal gets an error code — "this invoice is already issued" is
  // exactly what an error envelope is for.
  describe("invoice.issue, declared but not yet carried out", () => {
    it("DSOR-OPR-01: has a contract, and the registry knows it", () => {
      expect(operationIds()).toContain("invoice.issue");
    });

    it("cannot be called yet, and says why", () => {
      expect(() => callOperation("invoice.issue", { invoice: INV_1009 })).toThrow(/step 04/);
    });

    it("its contract declares a command, which is what makes the schema interesting", () => {
      // A query needs ten fields. A command needs six more — delegation, idempotency,
      // concurrency, execution, preconditions, controls — so the command contract is
      // what exercises the schema's conditional branch.
      const issue = loadRegistry(contractsFromDisk()).get("invoice.issue");

      if (issue === undefined) {
        throw new Error("invoice.issue has no contract");
      }

      expect(issue.kind).toBe("command");
      expect(issue.effect).toBe("mutating");
      expect(issue.execution).toEqual({ semantics: "atomic" });
    });

    it("an id on the waiting list must still have a contract", () => {
      // The other half of the rot check: a note about an operation that does not exist.
      expect(() => assertPaired(new Map(), {})).toThrow(/waiting for a handler/);
    });

    it("the waiting list cannot rot", () => {
      // An id waiting for a handler must still have a contract, and must not already
      // have a handler. assertPaired checks both, so the note cannot outlive its reason.
      const registry = loadRegistry(contractsFromDisk());

      expect(() =>
        assertPaired(registry, {
          "invoice.get": () => undefined,
          "invoice.issue": () => undefined,
        }),
      ).toThrow(/take it off the waiting list/);
    });
  });

  // The step's headline idea: the pairing is checked when the program loads, not on the first
  // request. No test in this process can watch a line at module scope run, so the constant carries
  // how many pairs the walk looked at. Deleting the call used to leave all 53 tests green, because
  // the two lists match today and the check is silent when it passes.
  it("DSOR-OPR-01: the pairing was checked at start-up, and all of it was", () => {
    const registry = loadRegistry(contractsFromDisk());

    expect(PAIRS_CHECKED).toBeGreaterThan(0);

    // Every contract, plus every id on the waiting list.
    expect(PAIRS_CHECKED).toBe(registry.size + 1);
  });
});
