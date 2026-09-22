// The refusals. A rule with no refusal test is a rule nobody has.
//
// The cases below are the ones money() has to reject. Its two patterns come from the
// specification's own JSON Schema, packages/spec/schemas/common.schema.json.

import { describe, expect, it } from "vitest";
import { money } from "../src/money.ts";

describe("money", () => {
  it("DSOR-MON-01: builds a money object from a decimal string and a currency code", () => {
    expect(money("31400.00", "USD")).toEqual({ value: "31400.00", currency: "USD" });
    expect(money("0", "PKR")).toEqual({ value: "0", currency: "PKR" });
    expect(money("-12.5", "EUR")).toEqual({ value: "-12.5", currency: "EUR" });
  });

  it("DSOR-MON-01: a value that is not a decimal string is refused", () => {
    // Every one of these is a perfectly good `string`, so the compiler is happy.
    // Only this check stops them.
    expect(() => money("2,500 dollars-ish", "USD")).toThrow(TypeError);
    expect(() => money("2,500.00", "USD")).toThrow(TypeError); // a thousands comma
    expect(() => money("$31400.00", "USD")).toThrow(TypeError);
    expect(() => money("31400.", "USD")).toThrow(TypeError);
    expect(() => money("", "USD")).toThrow(TypeError);
    expect(() => money("1e5", "USD")).toThrow(TypeError);
  });

  it("DSOR-MON-01: a currency that is not an ISO 4217 code is refused", () => {
    expect(() => money("31400.00", "United States Dollars")).toThrow(TypeError);
    expect(() => money("31400.00", "usd")).toThrow(TypeError); // must be upper case
    expect(() => money("31400.00", "US")).toThrow(TypeError);
    expect(() => money("31400.00", "")).toThrow(TypeError);
  });

  it("DSOR-MON-01: the refusal says what was wrong", () => {
    expect(() => money("2,500 dollars-ish", "USD")).toThrow(/not a decimal amount/);
    expect(() => money("31400.00", "usd")).toThrow(/not an ISO 4217 currency code/);
  });

  // This test records a gap on purpose, so that nobody reads more into money() than
  // it does. The pattern checks the SHAPE of a currency code: three upper-case
  // letters. It does not check that the code is one ISO 4217 actually assigned.
  // "ZZZ" is not a currency, and money() accepts it.
  it("does not check the currency against the real ISO 4217 list", () => {
    expect(money("1.00", "ZZZ")).toEqual({ value: "1.00", currency: "ZZZ" });
  });
});
