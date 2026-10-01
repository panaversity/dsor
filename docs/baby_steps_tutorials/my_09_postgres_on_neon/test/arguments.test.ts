// The arguments belong to the caller, so they are read once and checked first. Added in step 04,
// whose promise -- every refusal comes back as an envelope -- a throwing path would break.
//
// This is a file of its own because both tests need the one draft invoice, INV-1009, and
// test/operations.test.ts issues it. Every test file gets its own copy of the module, so the store
// here starts fresh.
//
// The calls here ask as the agent, because from step 06 only a caller who holds invoice:issue gets
// past the gate, and this file is about the arguments rather than about authority.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callOperation } from "../src/operations.ts";
import type { Login } from "../src/login.ts";
import { resetProposalIds, resetRequestIds } from "../src/envelopes.ts";

const INV_1009 = "dsor://org_456/invoice/INV-1009";
const ISSUER: Login = { loggedInAs: "accounts-payable-fte" };

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
      const answer = callOperation(
        ISSUER,
        "invoice.issue",
        args as Readonly<Record<string, unknown>>,
      );

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

    const answer = callOperation(ISSUER, "invoice.issue", throwing);

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("VALIDATION_FAILED");

    // And INV-1009 is still a draft, so none of that half-happened.
    const after = callOperation(ISSUER, "invoice.get", { invoice: INV_1009 });

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

    // Two traps in one object, because there were two reads and they were in different places.
    // The getter is read by the copy; `toJSON` is read by whatever computes the fingerprint. A
    // review found the second one: `success()` used to stringify the caller's object again, AFTER
    // the invoice had been issued, so an object whose toJSON throws the second time committed the
    // change and then threw at the caller — no envelope, no code, nothing recording it.
    let hashed = 0;
    const args = {
      get invoice(): string {
        reads += 1;

        return reads === 1 ? INV_1009 : "dsor://org_456/invoice/INV-0000";
      },
      trap: {
        toJSON(): number {
          hashed += 1;

          if (hashed > 1) {
            throw new Error("read a second time");
          }

          return 1;
        },
      },
    };

    const answer = callOperation(ISSUER, "invoice.issue", args);

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${answer.kind}`);
    }

    expect(reads).toBe(1);
    expect(hashed).toBe(1);
    expect(answer.envelope.outcome).toBe("COMMITTED");

    const honest = createHash("sha256")
      .update(JSON.stringify({ invoice: INV_1009, trap: 1 }))
      .digest("hex");

    expect(answer.envelope.payload_hash).toBe(`sha256:${honest}`);
  });
});
