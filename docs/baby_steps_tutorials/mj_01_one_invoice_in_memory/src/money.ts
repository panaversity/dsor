// NEW IN STEP 01: money is an amount and a currency, and the amount is a decimal string.
// DSOR-MON-01 in specs/dsor/01-model.md, section 9.

/** An amount of money. `value` is digits written as text, never a `number`. */
export type Money = { value: string; currency: string };

// An optional minus sign, at least one digit, then optionally a dot and more digits.
// The pattern is the specification's own. Inside the dsor repository, `pnpm guard`
// checks that it still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/money/properties/value/pattern
const DECIMAL_STRING = /^-?[0-9]+(\.[0-9]+)?$/;

// The currency codes that Node lists as money. Each one is an ISO 4217 code. The schema
// asks only for three capital letters, so it would accept "ABC". Node's list leaves out
// a few ISO codes that are not money, such as XXX ("no currency"). We refuse more than
// the schema, never less.
const CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf("currency"));

/** Builds money, refusing anything that is not a decimal string and a listed currency. */
export function money(value: string, currency: string): Money {
  // Check the type first. `DECIMAL_STRING.test(31400)` is true, because `.test()`
  // turns the number into the text "31400" before it matches.
  if (typeof value !== "string" || !DECIMAL_STRING.test(value)) {
    throw new TypeError(`money value must be a decimal string, got ${describe(value)}`);
  }
  if (!CURRENCIES.has(currency)) {
    throw new TypeError(`money currency must be an ISO 4217 code, got ${describe(currency)}`);
  }
  return { value, currency };
}

// The refused input may be anything, even something huge. Show a short piece of it.
function describe(input: unknown): string {
  return typeof input === "string" ? JSON.stringify(input.slice(0, 40)) : typeof input;
}
