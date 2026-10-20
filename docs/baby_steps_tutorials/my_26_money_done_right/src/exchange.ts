// NEW IN STEP 26: two amounts compared exactly, in any two currencies (decision 159).
//
// Is 2,800,000.00 PKR more than 50,000.00 USD? Not as numbers: 2,800,000 is more than 50,000, and
// the bill is 10,000.00 USD. Both amounts must first be counted in one currency, at a rate. A rate
// says how many of a currency one unit of the rates' base buys: 280 rupees to one US dollar.
//
// Dividing 2,800,000 by 280 works here and fails elsewhere: 1,000,000 / 280 never ends, and
// JavaScript's numbers round. So nothing here divides to compare. "Is a above b?" is asked as "is
// a × (b's rate) above b × (a's rate)?", the same question with both sides multiplied by both rates.
// Exact decimals multiplied stay exact, so every answer is exact. Only `convertUp` divides, to book
// an amount against a day, and it rounds up.
//
// Rule DSOR-MON-02: monetary arithmetic and comparison MUST use decimal arithmetic.
// Rule DSOR-MON-04: when an amount cannot be converted — unknown currency, no rate, or a rate older
// than max_rate_age — the comparison MUST resolve restrictively.

import { DECIMAL, money, type Money } from "./money.ts";

/**
 * How many units of `currency` one unit of the rates' base buys, as decimal text. It throws
 * `CannotConvert` when it has no usable rate for that currency.
 */
export type RateOf = (currency: string) => string;

/** An amount that cannot be converted, and why. The caller decides restrictively (DSOR-MON-04). */
export class CannotConvert extends Error {
  readonly currency: string;

  constructor(currency: string, why: string) {
    super(why);
    this.currency = currency;
  }
}

/** An exact decimal: all its digits, and how many of them come after the point. */
interface Exact {
  readonly digits: bigint;
  readonly places: number;
}

/** "31400.50" is 3140050 with two places. A BigInt holds any number of digits, exactly. */
function exact(value: string): Exact {
  if (!DECIMAL.test(value)) {
    throw new TypeError(`not a decimal amount: ${JSON.stringify(value)}`);
  }

  const [whole = "", fraction = ""] = value.split(".");

  return { digits: BigInt(whole + fraction), places: fraction.length };
}

/** The same amount, written with more places: 3140050 with two places is 314005000 with four. */
function atPlaces(x: Exact, places: number): bigint {
  return x.digits * 10n ** BigInt(places - x.places);
}

function order(a: Exact, b: Exact): -1 | 0 | 1 {
  const places = Math.max(a.places, b.places);
  const left = atPlaces(a, places);
  const right = atPlaces(b, places);

  return left < right ? -1 : left > right ? 1 : 0;
}

function times(a: Exact, b: Exact): Exact {
  return { digits: a.digits * b.digits, places: a.places + b.places };
}

/** A rate, if it is a decimal above zero. A rate of zero would make every amount count as nothing. */
function rateFor(currency: string, rateOf: RateOf): Exact {
  const given: unknown = rateOf(currency);

  if (typeof given !== "string" || !DECIMAL.test(given)) {
    throw new CannotConvert(currency, `the rate for ${currency} is not a decimal`);
  }

  const rate = exact(given);

  if (rate.digits <= 0n) {
    throw new CannotConvert(currency, `the rate for ${currency} is not above zero`);
  }

  return rate;
}

/** -1, 0 or 1: `a` is below, equal to, or above `b`. A rate is asked for only if the currencies differ. */
export function compare(a: Money, b: Money, rateOf: RateOf): -1 | 0 | 1 {
  if (a.currency === b.currency) {
    return order(exact(a.value), exact(b.value));
  }

  const aRate = rateFor(a.currency, rateOf);
  const bRate = rateFor(b.currency, rateOf);

  // a / aRate against b / bRate, both multiplied by aRate × bRate, which is above zero.
  return order(times(exact(a.value), bRate), times(exact(b.value), aRate));
}

/** `a` is above `b`. Step 27 gives it to CEL as `dsor_exceeds`. */
export function exceeds(a: Money, b: Money, rateOf: RateOf): boolean {
  return compare(a, b, rateOf) === 1;
}

/** `a` is at least `b`. Step 27 gives it to CEL as `dsor_covers`. */
export function covers(a: Money, b: Money, rateOf: RateOf): boolean {
  return compare(a, b, rateOf) !== -1;
}

/** Digits and places as decimal text: 357143 with two places is "3571.43". */
function written(digits: bigint, places: number): string {
  const sign = digits < 0n ? "-" : "";
  const all = (digits < 0n ? -digits : digits).toString().padStart(places + 1, "0");
  const cut = all.length - places;

  return places === 0 ? sign + all : `${sign}${all.slice(0, cut)}.${all.slice(cut)}`;
}

/**
 * `a` in `currency`, rounded UP to the cent, to book against a limit in that currency (DSOR-MON-06,
 * decision 159). Up, so that a day can count a fraction of a cent too much, never too little.
 * An amount already in `currency` is returned as it is, and needs no rate.
 */
export function convertUp(a: Money, currency: string, rateOf: RateOf): Money {
  if (a.currency === currency) {
    return a;
  }

  const amount = exact(a.value);
  const from = rateFor(a.currency, rateOf);
  const to = rateFor(currency, rateOf);
  // cents = amount × to ÷ from × 100, as one fraction of whole numbers.
  const top = amount.digits * to.digits * 10n ** BigInt(from.places + 2);
  const bottom = from.digits * 10n ** BigInt(amount.places + to.places);
  // BigInt division drops the remainder, which rounds toward zero; a remainder above zero means up.
  const cents = top / bottom + (top % bottom > 0n ? 1n : 0n);

  return money(written(cents, 2), currency);
}

/** `a` + `b`, exactly. Both in one currency: two currencies are converted first, never added. */
export function plus(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new TypeError(`${a.currency} and ${b.currency} cannot be added without a rate`);
  }

  const x = exact(a.value);
  const y = exact(b.value);
  const places = Math.max(x.places, y.places);

  return money(written(atPlaces(x, places) + atPlaces(y, places), places), a.currency);
}
