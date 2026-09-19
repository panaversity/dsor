// A reference for the spec's examples, not the implementation.
//
// It shows the two rules of §9 that beginners most often break:
//   DSOR-MON-02  money is compared with exact decimal arithmetic, never floats
//   DSOR-MON-04  an amount that cannot be converted makes the comparison fail restrictively
//
// Rates are "units of this currency per one unit of the control currency", as
// decimal strings, exactly as a control's test vector pins them.

export interface Money {
  value: string;
  currency: string;
}

export type Rates = Readonly<Record<string, string>>;

export class UnconvertibleAmount extends Error {
  constructor(currency: string) {
    super(`no exchange rate for ${currency}`);
    this.name = "UnconvertibleAmount";
  }
}

interface Scaled {
  digits: bigint;
  scale: number;
}

function parseDecimal(text: string): Scaled {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new TypeError(`not a decimal string: ${text}`);
  const fraction = m[3] ?? "";
  const digits = BigInt(`${m[2]}${fraction}`);
  return { digits: m[1] === "-" ? -digits : digits, scale: fraction.length };
}

function rateOf(currency: string, rates: Rates): Scaled {
  const rate = rates[currency];
  if (rate === undefined) throw new UnconvertibleAmount(currency);
  return parseDecimal(rate);
}

/**
 * Compares `a` with `b` after conversion. Returns -1, 0, or 1.
 *
 * a / rateA ⋛ b / rateB  is evaluated as  a × rateB ⋛ b × rateA,
 * which needs no division and therefore no rounding.
 */
export function compareMoney(a: Money, b: Money, rates: Rates): -1 | 0 | 1 {
  const av = parseDecimal(a.value);
  const bv = parseDecimal(b.value);
  const ar = rateOf(a.currency, rates);
  const br = rateOf(b.currency, rates);
  const left = av.digits * br.digits;
  const leftScale = av.scale + br.scale;
  const right = bv.digits * ar.digits;
  const rightScale = bv.scale + ar.scale;
  const scale = Math.max(leftScale, rightScale);
  const l = left * 10n ** BigInt(scale - leftScale);
  const r = right * 10n ** BigInt(scale - rightScale);
  return l < r ? -1 : l > r ? 1 : 0;
}

/** `dsor_exceeds(a, b)` of Appendix B: a > b. */
export function exceeds(a: Money, b: Money, rates: Rates): boolean {
  return compareMoney(a, b, rates) === 1;
}

/** `dsor_covers(a, b)` of Appendix B: a >= b. */
export function covers(a: Money, b: Money, rates: Rates): boolean {
  return compareMoney(a, b, rates) !== -1;
}
