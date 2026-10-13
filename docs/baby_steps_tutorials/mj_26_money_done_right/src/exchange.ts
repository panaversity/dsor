// NEW IN STEP 26: money in two currencies, compared and converted with one sheet of rates
// (DSOR-MON-02 and DSOR-MON-03 in specs/dsor/01-model.md, section 9; step 26's README, decisions
// L5, D3, D9, and D10). A sheet says how much of each currency one unit of its base buys, as its
// source wrote it. Two amounts are compared by multiplying across, so nothing is divided and
// nothing is rounded: a ÷ rate of a ⋛ b ÷ rate of b is a × rate of b ⋛ b × rate of a. Only a
// booking, which is kept in the limit's currency, divides, and it rounds up (DSOR-MON-06; decision
// L6). Appendix B names these functions dsor_exceeds and dsor_covers in CEL, which step 27 builds.
import type { Money } from "./money.ts";

/** One sheet of rates, from one source, at one time. */
export type RateSheet = {
  source: string;
  base: string;
  published_at: string;
  // How much of each currency one unit of the base buys, as the source wrote it. The base's own
  // rate is "1" (decision D9).
  rates: Readonly<Record<string, string>>;
};

/** A decimal as one whole number, and how many of its digits come after the point. */
type Scaled = { digits: bigint; scale: number };

// not copied: a decimal with no sign. The specification's money pattern allows a minus, and no
// amount that this step converts, and no rate, is below zero. Anything else is no number here.
const DECIMAL = /^([0-9]+)(?:\.([0-9]+))?$/;

/** The decimal as a whole number and its scale, or none when it is not one. */
function scaled(text: string): Scaled | undefined {
  const match = DECIMAL.exec(text);
  if (match === null) return undefined;
  const fraction = match[2] ?? "";
  return { digits: BigInt(match[1]! + fraction), scale: fraction.length };
}

/** The sheet's rate for one currency, when it has one above zero. */
function rateOf(currency: string, sheet: RateSheet): Scaled | undefined {
  // Only the sheet's own lines: a line it inherits, such as one that a package with a bug wrote on
  // Object.prototype, is no rate of it.
  if (!Object.hasOwn(sheet.rates, currency)) return undefined;
  const rate = scaled(sheet.rates[currency]!);
  // A rate of zero would make every amount equal to nothing.
  return rate === undefined || rate.digits === 0n ? undefined : rate;
}

/** Two whole numbers, each with its own scale, brought to one scale and compared. */
function compareScaled(left: Scaled, right: Scaled): -1 | 0 | 1 {
  const scale = Math.max(left.scale, right.scale);
  const l = left.digits * 10n ** BigInt(scale - left.scale);
  const r = right.digits * 10n ** BigInt(scale - right.scale);
  return l < r ? -1 : l > r ? 1 : 0;
}

/** -1, 0, or 1: a against b, after conversion. None when the sheet cannot convert one of them. */
export function compareAcross(a: Money, b: Money, sheet: RateSheet): -1 | 0 | 1 | undefined {
  const av = scaled(a.value);
  const bv = scaled(b.value);
  if (av === undefined || bv === undefined) return undefined;
  // One currency needs no rate, so an old sheet never stops a bill in the limit's own currency
  // (decision D10).
  if (a.currency === b.currency) return compareScaled(av, bv);
  const ar = rateOf(a.currency, sheet);
  const br = rateOf(b.currency, sheet);
  if (ar === undefined || br === undefined) return undefined;
  // a ÷ ar against b ÷ br, multiplied across by ar × br: a × br against b × ar.
  return compareScaled(
    { digits: av.digits * br.digits, scale: av.scale + br.scale },
    { digits: bv.digits * ar.digits, scale: bv.scale + ar.scale },
  );
}

/** dsor_exceeds of Appendix B: a is more than b, after conversion. None when it cannot convert. */
export function exceeds(a: Money, b: Money, sheet: RateSheet): boolean | undefined {
  const compared = compareAcross(a, b, sheet);
  return compared === undefined ? undefined : compared === 1;
}

// A booking is kept to six places after the point, as step 24 keeps a day's total.
const SCALE = 6;

/**
 * The amount in another currency, rounded up at the sixth decimal place: a booking against a limit
 * in that currency (DSOR-MON-06). One currency is kept as it is. None when it cannot convert.
 */
export function convertUp(amount: Money, to: string, sheet: RateSheet): Money | undefined {
  const value = scaled(amount.value);
  if (value === undefined) return undefined;
  if (amount.currency === to) return { value: amount.value, currency: to };
  const from = rateOf(amount.currency, sheet);
  const into = rateOf(to, sheet);
  if (from === undefined || into === undefined) return undefined;
  // amount × into ÷ from, in millionths. The one division of this step.
  const top = value.digits * into.digits * 10n ** BigInt(from.scale + SCALE);
  const bottom = from.digits * 10n ** BigInt(value.scale + into.scale);
  // Up, never down: a booking may hold a millionth too much of the day, never a millionth too
  // little (step 26's README, decision L6).
  const millionths = (top + bottom - 1n) / bottom;
  return { value: decimalOf(millionths), currency: to };
}

/** Millionths as a decimal with two to six places after the point. */
function decimalOf(millionths: bigint): string {
  const text = millionths.toString().padStart(SCALE + 1, "0");
  const places = text.slice(-SCALE).replace(/0+$/, "").padEnd(2, "0");
  return `${text.slice(0, -SCALE)}.${places}`;
}
