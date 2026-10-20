// STEP 29: one way to write a request, so one request has one fingerprint (decision 167).
//
// An approval is tied to the fingerprint of the exact request. JSON can write the same request many
// ways: its fields in another order, a number as 4.50 or 4.5. RFC 8785, the JSON Canonicalization
// Scheme, picks one: keys sorted, numbers and strings written one way. The payload hash of every
// command is SHA-256 over that text.
//
// Rule DSOR-APR-02b: The payload hash MUST be computed over the RFC 8785 (JCS) canonical JSON of the
// stored input.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { aDatabase, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
});

const hashOf = (answer: OperationAnswer): string | undefined =>
  answer.kind === "result" ? answer.envelope.payload_hash : undefined;

describe("RFC 8785, the canonical form", () => {
  it("DSOR-APR-02b: writes the RFC's own example exactly", () => {
    // RFC 8785, section 3.2.4: numbers, a string with every kind of escape, and three literals.
    const parsed: unknown = JSON.parse(
      '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],' +
        ' "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        ' "literals": [null, true, false]}',
    );

    expect(canonicalJson(parsed)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("DSOR-APR-02b: sorts keys by their UTF-16 code units, as the RFC says", () => {
    // RFC 8785, section 3.2.3's example of property sorting.
    const keys = ["€", "\r", "דּ", "1", "😀", "\u0080", "ö"];
    const written = canonicalJson(Object.fromEntries(keys.map((k) => [k, k.length])));

    // The text itself: read back through JSON.parse, JavaScript would put "1" first, because it
    // lists a key that looks like a number before the others, whatever order the text had.
    expect(written).toBe(
      '{"\\r":1,"1":1,"\u0080":1,"\u00f6":1,"\u20ac":1,"\ud83d\ude00":2,"\ufb33":1}',
    );
  });

  it("DSOR-APR-02b: text that is not valid Unicode has no canonical form, and is refused", () => {
    expect(() => canonicalJson({ note: "half of a pair \ud800" })).toThrow(/not valid Unicode/);
    expect(() => canonicalJson({ ["\udc00"]: 1 })).toThrow(/not valid Unicode/);
  });

  it("DSOR-APR-02b: a number JSON cannot write has none either", () => {
    expect(() => canonicalJson({ amount: Number.NaN })).toThrow(/NaN/);
  });
});

describe("the fingerprint of a command", () => {
  const PAY_1009 = {
    invoice: "dsor://org_456/invoice/INV-1009",
    amount: { value: "2500.00", currency: "USD" },
  };
  const theSameReordered = {
    amount: { currency: "USD", value: "2500.00" },
    invoice: "dsor://org_456/invoice/INV-1009",
  };

  it("DSOR-APR-02b: the same request with its fields in another order has the same fingerprint", async () => {
    const one = await callOperation(SUPERVISOR, "payment.create", PAY_1009, {
      mode: "validate_only",
    });
    const two = await callOperation(SUPERVISOR, "payment.create", theSameReordered, {
      mode: "validate_only",
    });

    expect(hashOf(one)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashOf(two)).toBe(hashOf(one));
  });

  it("DSOR-IDM-01c: so sent again with its key, reordered, it is the same request, not a conflict", async () => {
    const key = { idempotencyKey: "canonical-reordered" };
    const first = await callOperation(SUPERVISOR, "payment.create", PAY_1009, key);
    const again = await callOperation(SUPERVISOR, "payment.create", theSameReordered, key);

    expect(again).toStrictEqual(first);
  });

  it("DSOR-APR-02b: a request with text that is not valid Unicode is refused at §21.6", async () => {
    const answer = await callOperation(
      SUPERVISOR,
      "payment.create",
      { ...PAY_1009, note: "half of a pair \ud800" },
      { idempotencyKey: "canonical-unicode" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(/not valid Unicode/);
  });
});
