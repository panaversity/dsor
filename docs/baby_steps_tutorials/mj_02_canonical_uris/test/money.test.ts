// The tests for money, the refusals first among them.
import { describe, expect, it } from "vitest";
import { money } from "../src/money.ts";

// The schema's own currency pattern. Inside the dsor repository, `pnpm guard` checks
// that it still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/money/properties/currency/pattern
const SCHEMA_CURRENCY = /^[A-Z]{3}$/;

describe("money", () => {
  it("DSOR-MON-01: money is a decimal-string value and an ISO 4217 currency", () => {
    // As a number, 31400.00 would print as 31400. The string keeps both zeros.
    expect(money("31400.00", "USD")).toEqual({ value: "31400.00", currency: "USD" });
  });

  // The schema allows a minus sign and any number of decimal places. A stricter
  // pattern would pass every other test here, so these pin what must be accepted.
  it.each([
    ["zero", "0"],
    ["a negative amount", "-12.50"],
    ["one decimal place", "1.5"],
  ])("DSOR-MON-01: a decimal string the schema allows is accepted: %s", (_why, value) => {
    expect(money(value, "USD")).toEqual({ value, currency: "USD" });
  });

  // Test the "no" as carefully as the "yes".
  it("DSOR-MON-01: a number is refused, even one that slipped past the types", () => {
    // TypeScript stops `money(31400, "USD")` before it runs. Data from outside the
    // program has no types, so the function checks at run time as well.
    expect(() => money(31400 as unknown as string, "USD")).toThrow(TypeError);
  });

  it.each([
    ["an empty string", ""],
    ["no digit before the dot", ".50"],
    ["a thousands comma", "31,400.00"],
    ["scientific notation", "3.14e4"],
    ["a space around the digits", " 31400.00"],
    ["a trailing dot", "31400."],
    ["a second line after the digits", "31400.00\n1"],
  ])("DSOR-MON-01: a value that is not a decimal string is refused: %s", (_why, value) => {
    expect(() => money(value, "USD")).toThrow(TypeError);
  });

  it.each([
    ["lowercase", "usd"],
    ["three letters that are not a currency", "ABC"],
    ["XXX, the ISO code for 'no currency'", "XXX"],
    ["a currency symbol", "$"],
    ["empty", ""],
    ["a space around the code", " USD"],
    ["the number ISO gives the US dollar", 840 as unknown as string],
  ])("DSOR-MON-01: a currency Node does not list as money is refused: %s", (_why, currency) => {
    expect(() => money("31400.00", currency)).toThrow(TypeError);
  });

  it("DSOR-MON-01: the refusal says what was wrong", () => {
    expect(() => money("3.14e4", "USD")).toThrow(/value must be a decimal string/);
    expect(() => money("31400.00", "usd")).toThrow(/currency must be an ISO 4217 code/);
  });

  it("DSOR-MON-01: a real currency other than USD is accepted", () => {
    expect(money("50000000.00", "PKR")).toEqual({ value: "50000000.00", currency: "PKR" });
  });

  it("DSOR-MON-01: every currency we accept, the schema accepts too", () => {
    // We may refuse more than the schema, never less. This checks Node's list.
    for (const code of Intl.supportedValuesOf("currency")) {
      expect(code).toMatch(SCHEMA_CURRENCY);
    }
  });
});

// Why the value is a string. This test has no rule id: it proves something about
// JavaScript, not about our code, and it passes from the start.
describe("the float bug", () => {
  it("0.1 + 0.2 is not 0.3 when money is a number", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(0.1 + 0.2).toBe(0.30000000000000004);
  });

  it("three fees of 0.10 added to INV-1008's 31400 do not make 31400.30", () => {
    expect(31400 + 0.1 + 0.1 + 0.1).not.toBe(31400.3);
    expect(31400 + 0.1 + 0.1 + 0.1).toBe(31400.299999999996);
  });
});
