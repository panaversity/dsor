// nobody calls getInvoice directly any more.
//
// A caller names an operation and passes arguments. The operation is looked up in the
// registry, so an operation with no contract cannot be called at all.

import { describe, expect, it } from "vitest";
import { assertPaired, callOperation, operationIds, WIRING_CHECKED } from "../src/operations.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import { refusal, resetProposalIds, resetRequestIds, validateEnvelope } from "../src/envelopes.ts";

/** A stand-in handler table with both operations, for assertPaired tests. */
function handlersForBoth() {
  const stub = () => ({ kind: "error", envelope: refusal("CONFLICT", "x") }) as const;

  return { "invoice.get": stub, "invoice.issue": stub };
}

/** The error envelope a refusal came back in, or a failure if it was not a refusal. */
function refusalFrom(answer: ReturnType<typeof callOperation>) {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${answer.kind}`);
  }

  expect(validateEnvelope("error", answer.envelope)).toBe(true);

  return answer.envelope;
}

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
    expect(() =>
      assertPaired(new Map(), {
        "invoice.cancel": () => ({ kind: "error", envelope: refusal("CONFLICT", "x") }),
      }),
    ).toThrow(/invoice\.cancel/);
  });

  it("DSOR-ERR-01a: an operation with no contract is refused with UNSUPPORTED_CAPABILITY", () => {
    for (const id of ["invoice.delete", "execute_sql"]) {
      const envelope = refusalFrom(callOperation(id, { invoice: INV_1008 }));

      expect(envelope.code).toBe("UNSUPPORTED_CAPABILITY");
      expect(envelope.retry).toBe("never");
      expect(envelope.message).toContain(id);
    }
  });

  // The module runs loadRegistry and assertPaired as it loads. No test in this process
  // can watch those lines run — by the time a test imports the module, they already have.
  // What a test can do is assert the state they guarantee, from outside.
  // The pairing check runs at module scope. No test can watch that line execute, but the
  // constant only exists because it did, so deleting the check cannot be silent.
  it("DSOR-OPR-01: the wiring was checked at start-up, not on first request", () => {
    expect(WIRING_CHECKED).toBe(true);
  });

  // The waiting list is a parameter, so a rotten one can be handed in. In this step the
  // real list is empty — invoice.issue came off it — and these two checks are what stop a
  // future step leaving a stale note behind.
  it("DSOR-OPR-01: an id waiting for a handler must still have a contract", () => {
    expect(() => assertPaired(new Map(), {}, new Set(["invoice.delete"]))).toThrow(
      /waiting for a handler and has no contract/,
    );
  });

  it("DSOR-OPR-01: an id that has a handler must come off the waiting list", () => {
    expect(() =>
      assertPaired(loadRegistry(contractsFromDisk()), handlersForBoth(), new Set(["invoice.get"])),
    ).toThrow(/take it off the waiting list/);
  });

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
    // A query's success is not in an envelope. There is no outcome value that means
    // "here is the data", so a read keeps handing back the invoice — the README says so.
    it("reads one invoice by its canonical address", () => {
      const answer = callOperation("invoice.get", { invoice: INV_1008 });

      if (answer.kind !== "data") {
        throw new Error(`expected data, got ${answer.kind}`);
      }

      expect(answer.invoice.amount.value).toBe("31400.00");
    });

    it("DSOR-ERR-01a: an invoice we do not hold is RESOURCE_NOT_FOUND, never retryable", () => {
      const envelope = refusalFrom(
        callOperation("invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" }),
      );

      expect(envelope.code).toBe("RESOURCE_NOT_FOUND");
      expect(envelope.retry).toBe("never");
    });

    // Step 02's README promised the entity segment stops being trusted text in step 03.
    // No rule id: this keeps that promise, it is not DSOR-RID-01b.
    it("DSOR-ERR-01a: an address whose entity no operation is named for is VALIDATION_FAILED", () => {
      const envelope = refusalFrom(
        callOperation("invoice.get", { invoice: "dsor://org_456/vendor/VENDOR-44" }),
      );

      expect(envelope.code).toBe("VALIDATION_FAILED");
      expect(envelope.retry).toBe("never");
    });

    it("DSOR-ERR-01a: an address that is not canonical, or missing, is VALIDATION_FAILED", () => {
      expect(refusalFrom(callOperation("invoice.get", { invoice: "INV-1008" })).code).toBe(
        "VALIDATION_FAILED",
      );
      expect(refusalFrom(callOperation("invoice.get", {})).code).toBe("VALIDATION_FAILED");
    });

    // A regular expression turns whatever it is given into text first, so an object
    // with a toString would sail past parseUri and read a real invoice. Only checking
    // the type stops it — the same lesson formatUri taught in step 02.
    it("DSOR-ERR-01a: an argument that is not text is VALIDATION_FAILED, however convincing", () => {
      const disguised = { toString: () => INV_1008 } as unknown as string;
      const envelope = refusalFrom(callOperation("invoice.get", { invoice: disguised }));

      expect(envelope.code).toBe("VALIDATION_FAILED");
      expect(envelope.message).toMatch(/needs an invoice address/);
    });

    // The address names a company. Acting on a different company's invoice than the
    // address asked for is how one tenant reads another's records.
    it("DSOR-ERR-01a: an address for another company is TENANT_MISMATCH", () => {
      const envelope = refusalFrom(
        callOperation("invoice.get", { invoice: "dsor://org_999/invoice/INV-1008" }),
      );

      expect(envelope.code).toBe("TENANT_MISMATCH");
      expect(envelope.retry).toBe("never");
      expect(envelope.message).toContain("org_999");
    });
  });

  // NEW IN STEP 04: the command split out of step 03 is carried out here, because a
  // command is what makes an envelope worth having.
  describe("invoice.issue", () => {
    // Issue, then issue again — in one test on purpose. Tests in one file share the
    // module, so a second test could not assume INV-1009 was still a draft. This also
    // covers the map's "done when": issuing twice returns an error envelope, not a throw.
    it("DSOR-SCH-01: issuing a draft returns COMMITTED, and the second attempt is CONFLICT", () => {
      resetRequestIds();
      resetProposalIds();

      const first = callOperation("invoice.issue", { invoice: INV_1009 });

      if (first.kind !== "result") {
        throw new Error(`expected a result, got ${first.kind}`);
      }

      expect(validateEnvelope("result", first.envelope)).toBe(true);
      expect(first.envelope.outcome).toBe("COMMITTED");
      expect(first.envelope.semantics).toBe("atomic");
      expect(first.envelope.proposal).toBe("dsor://org_456/proposal/prop_0001");
      expect((first.envelope.data as { status: string }).status).toBe("issued");

      // Again. Nothing is thrown; the refusal is an envelope a caller can act on, and
      // its retry class says plainly that trying again cannot help.
      const second = refusalFrom(callOperation("invoice.issue", { invoice: INV_1009 }));

      expect(second.code).toBe("CONFLICT");
      expect(second.retry).toBe("never");
      expect(second.message).toMatch(/draft/);
    });

    it("DSOR-ERR-01a: issuing an invoice that is already issued is CONFLICT", () => {
      expect(refusalFrom(callOperation("invoice.issue", { invoice: INV_1008 })).code).toBe(
        "CONFLICT",
      );
    });

    it("DSOR-ERR-01a: issuing an invoice we do not hold is RESOURCE_NOT_FOUND", () => {
      expect(
        refusalFrom(callOperation("invoice.issue", { invoice: "dsor://org_456/invoice/INV-9999" }))
          .code,
      ).toBe("RESOURCE_NOT_FOUND");
    });

    it("the contract is no longer on the waiting list", () => {
      // assertPaired refuses an id that has both a handler and a place in the queue, so
      // this could not have been forgotten.
      expect(operationIds()).toContain("invoice.issue");
      expect(() =>
        assertPaired(loadRegistry(contractsFromDisk()), {
          "invoice.get": () => ({ kind: "error", envelope: refusal("CONFLICT", "x") }),
        }),
      ).toThrow(/invoice\.issue has a contract and no handler/);
    });
  });
});
