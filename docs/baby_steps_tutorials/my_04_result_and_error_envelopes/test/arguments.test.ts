// NEW IN STEP 04: the arguments belong to the caller, so they are read once and checked first.
//
// This is a file of its own because both tests need the one draft invoice, INV-1009, and
// test/operations.test.ts issues it. Every test file gets its own copy of the module, so the store
// here starts fresh.
//
// Why these are step 04's and not a later step's: this step's promise is that every refusal comes
// back as an envelope. A path that throws instead is a hole in *that* promise, so the guard that
// closes it belongs to the step making the promise.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callOperation } from "../src/operations.ts";
import { resetProposalIds, resetRequestIds } from "../src/envelopes.ts";

const INV_1009 = "dsor://org_456/invoice/INV-1009";

describe("the caller's arguments", () => {
  // An argument that cannot be written down at all. The receipt fingerprints the arguments, so
  // before this guard existed the invoice was issued and the hash *then* threw — a change that
  // happened, with no envelope, no code, and nothing recording it. It has to be refused first.
  //
  // This is the first small shape of DSOR-EXE-03a, "write it down before you do it". Step 08
  // builds the real intent record.
  it("DSOR-ERR-01a: an argument that cannot be written down is refused before anything is issued", () => {
    const circular: Record<string, unknown> = { invoice: INV_1009 };
    circular["itself"] = circular;

    for (const args of [circular, { invoice: INV_1009, big: 1n }]) {
      const answer = callOperation("invoice.issue", args as Readonly<Record<string, unknown>>);

      if (answer.kind !== "error") {
        throw new Error(`expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code).toBe("VALIDATION_FAILED");
      expect(answer.envelope.retry).toBe("never");
    }

    // A getter that throws is the same family: reading the arguments must not throw either.
    const throwing = {
      get invoice(): string {
        throw new Error("boom");
      },
    };

    const answer = callOperation("invoice.issue", throwing);

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("VALIDATION_FAILED");

    // And INV-1009 is still a draft, so none of that half-happened.
    const after = callOperation("invoice.get", { invoice: INV_1009 });

    if (after.kind !== "data") {
      throw new Error("INV-1009 should still be readable");
    }

    expect(after.invoice.status).toBe("draft");
  });

  // The arguments are read **once**. A property can be a getter, so reading it twice can give two
  // answers — and these arguments used to be read twice: once to decide which invoice to issue,
  // and again to fingerprint the receipt. A caller could make those two reads disagree, so the
  // receipt described a request that never happened. Here the getter hands back a decoy on any
  // read after the first, and the fingerprint must still be of INV-1009.
  it("DSOR-SCH-01: the arguments are read once, so the receipt describes what was done", () => {
    resetRequestIds();
    resetProposalIds();

    let reads = 0;
    const args = {
      get invoice(): string {
        reads += 1;

        return reads === 1 ? INV_1009 : "dsor://org_456/invoice/INV-0000";
      },
    };

    const answer = callOperation("invoice.issue", args);

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${answer.kind}`);
    }

    expect(reads).toBe(1);
    expect(answer.envelope.outcome).toBe("COMMITTED");

    const honest = createHash("sha256")
      .update(JSON.stringify({ invoice: INV_1009 }))
      .digest("hex");

    expect(answer.envelope.payload_hash).toBe(`sha256:${honest}`);
  });
});
