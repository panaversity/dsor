// Money is an amount AND a currency, and the amount is text.
//
// Why text? Computers store decimals in binary, and some decimals have no exact
// binary form. So 0.1 + 0.2 is 0.30000000000000004, not 0.3. For money that is a
// missing cent nobody can explain. A decimal string holds exactly what we wrote.
//
// Rule DSOR-MON-01: a monetary amount MUST be represented as a money object with a
// decimal-string value and an ISO 4217 currency code.

/** An amount of money. Never a `number`. */
export interface Money {
  /**
   * A decimal written as text, such as "31400.00".
   *
   * `readonly` means nobody can change it after the object is built. Without it, a
   * caller who is handed this object could edit the stored amount in place.
   */
  readonly value: string;
  /** An ISO 4217 currency code, such as "USD". */
  readonly currency: string;
}

// These two patterns are copied from the specification's own JSON Schema, at
// packages/spec/schemas/common.schema.json. Copying them means this step refuses
// exactly what the normative schema refuses, and nothing more.
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;
const ISO_4217 = /^[A-Z]{3}$/;

/**
 * Builds a money object, or refuses.
 *
 * The `Money` type alone cannot do this job. TypeScript knows `value` is a `string`,
 * and "2,500 dollars-ish" is a string. Only a check at the moment the money is made
 * can tell a decimal amount from any other text, so DSOR-MON-01 needs both: the type
 * for the shape, and this function for the content.
 *
 * It throws rather than returning `undefined`, for the same reason `greet` throws on
 * an empty name in step 00. A caller asking for an invoice that may not exist is
 * asking a fair question. A caller building money out of nonsense has a bug, and a
 * bug should stop where it is made, not travel onward disguised as an amount.
 */
export function money(value: string, currency: string): Money {
  if (!DECIMAL.test(value)) {
    throw new TypeError(`not a decimal amount: ${JSON.stringify(value)}`);
  }
  if (!ISO_4217.test(currency)) {
    throw new TypeError(`not an ISO 4217 currency code: ${JSON.stringify(currency)}`);
  }
  // `readonly` above is a promise to the compiler, and the compiler is the only one
  // who hears it: Node deletes every type before it runs the file, so `readonly` is
  // gone at run time. Object.freeze is the run-time half of the same promise. In a
  // module, which is always strict mode, assigning to a frozen property throws.
  return Object.freeze({ value, currency });
}
