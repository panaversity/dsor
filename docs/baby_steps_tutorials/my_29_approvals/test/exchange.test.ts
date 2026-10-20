// STEP 26: two amounts compared exactly, in any two currencies (decision 159).
//
// Rule DSOR-MON-02: monetary arithmetic and comparison MUST use decimal arithmetic.
// Rule DSOR-MON-03: a monetary threshold in a control or delegation MUST be compared only through
// the dsor_* money functions, which convert both operands to the threshold's currency using the
// tenant's rate source.
// Rule DSOR-MON-04: when an amount cannot be converted — unknown currency, no rate, or a rate older
// than max_rate_age — the comparison MUST resolve restrictively.
// Rule DSOR-MON-06: a cumulative limit MUST accumulate in the limit's own currency, converting each
// reservation at the rate in force when the reservation is taken.

import { describe, expect, it } from "vitest";
import {
  CannotConvert,
  compare,
  convertUp,
  covers,
  exceeds,
  plus,
  type RateOf,
} from "../src/exchange.ts";
import { money } from "../src/money.ts";

/** Rates as a test pins them: how many of each currency one US dollar buys. */
function sheet(rates: Readonly<Record<string, string>>): RateOf {
  return (currency) => {
    const rate = Object.hasOwn(rates, currency) ? rates[currency] : undefined;

    if (rate === undefined) {
      throw new CannotConvert(currency, `there is no rate for ${currency}`);
    }

    return rate;
  };
}

/** The story's rates: 280 rupees, and 0.80 pounds, to one dollar. */
const STORY = sheet({ USD: "1", PKR: "280", GBP: "0.80" });

/** Rates that are never there, for amounts that should need none. */
const NO_RATES: RateOf = (currency) => {
  throw new CannotConvert(currency, "this test gives no rates");
};

const LIMIT = money("50000.00", "USD");

describe("DSOR-MON-02: amounts are compared exactly", () => {
  it("DSOR-MON-02: a payment exactly at the limit is not above it, where JavaScript's numbers say it is", () => {
    const rates = sheet({ USD: "1", PKR: "281.15" });
    const atTheLimit = money("14057500.00", "PKR");

    // 281.15 rupees to the dollar: 14,057,500.00 PKR is 50,000.00 USD exactly. Divided as numbers,
    // it is a hair more, and a payment that is exactly at the limit would be refused.
    expect(14057500 / 281.15).toBe(50000.00000000001);
    expect(compare(atTheLimit, LIMIT, rates)).toBe(0);
    expect(exceeds(atTheLimit, LIMIT, rates)).toBe(false);
  });

  it("DSOR-MON-02: one hundredth of a rupee more than the limit is above it", () => {
    const rates = sheet({ USD: "1", PKR: "281.15" });

    expect(exceeds(money("14057500.01", "PKR"), LIMIT, rates)).toBe(true);
  });

  it("DSOR-MON-02: 0.10 and 0.20 make exactly 0.30", () => {
    expect(0.1 + 0.2).not.toBe(0.3);

    const sum = plus(money("0.10", "USD"), money("0.20", "USD"));

    expect(sum).toEqual({ value: "0.30", currency: "USD" });
    expect(compare(sum, money("0.3", "USD"), NO_RATES)).toBe(0);
  });

  it("DSOR-MON-02: a value is compared by its amount, whatever its number of decimals", () => {
    expect(compare(money("31400.5", "USD"), money("31400.50", "USD"), NO_RATES)).toBe(0);
    expect(compare(money("31400.501", "USD"), money("31400.50", "USD"), NO_RATES)).toBe(1);
    expect(compare(money("31400", "USD"), money("31400.01", "USD"), NO_RATES)).toBe(-1);
  });

  it("DSOR-MON-02: the largest amounts a payment may hold are still told apart by one cent", () => {
    // A JavaScript number cannot tell these two apart: both are 10000000000000000.
    expect(Number("9999999999999999.99")).toBe(Number("9999999999999999.98"));

    const larger = money("9999999999999999.99", "PKR");
    const smaller = money("9999999999999999.98", "PKR");

    expect(compare(larger, smaller, NO_RATES)).toBe(1);
    expect(exceeds(larger, money("35714285714285.71", "USD"), STORY)).toBe(true);
  });
});

describe("DSOR-MON-03: an amount and a limit in two currencies", () => {
  it("DSOR-MON-03: 2,800,000.00 PKR is 10,000.00 USD, under a limit of 50,000.00 USD", () => {
    const bill = money("2800000.00", "PKR");

    expect(exceeds(bill, LIMIT, STORY)).toBe(false);
    expect(compare(bill, money("10000.00", "USD"), STORY)).toBe(0);
  });

  it("DSOR-MON-03: 45,000.00 GBP is above 50,000.00 USD, though 45,000 is less than 50,000", () => {
    const bill = money("45000.00", "GBP");

    // As numbers, the bill is under the limit, which is the hole.
    expect(Number(bill.value) > Number(LIMIT.value)).toBe(false);
    // At 0.80 pounds to the dollar it is 56,250.00 USD.
    expect(exceeds(bill, LIMIT, STORY)).toBe(true);
    expect(compare(bill, money("56250.00", "USD"), STORY)).toBe(0);
  });

  it("DSOR-MON-03: the specification's own cases: 50,000,000.00 PKR is above 25,000 USD, 6,000,000.00 PKR is not", () => {
    const threshold = money("25000", "USD");

    expect(exceeds(money("50000000.00", "PKR"), threshold, STORY)).toBe(true);
    expect(exceeds(money("6000000.00", "PKR"), threshold, STORY)).toBe(false);
    expect(exceeds(money("25000.00", "USD"), threshold, STORY)).toBe(false);
    expect(exceeds(money("25000.01", "USD"), threshold, STORY)).toBe(true);
  });

  it("DSOR-MON-03: exceeds asks 'above', and covers asks 'at least'", () => {
    const tenThousand = money("10000.00", "USD");
    const bill = money("2800000.00", "PKR");

    expect(exceeds(bill, tenThousand, STORY)).toBe(false);
    expect(covers(bill, tenThousand, STORY)).toBe(true);
    expect(covers(tenThousand, bill, STORY)).toBe(true);
    expect(covers(money("2799999.99", "PKR"), tenThousand, STORY)).toBe(false);
  });

  it("DSOR-MON-03: two amounts in one currency need no rate", () => {
    expect(exceeds(money("50000.01", "USD"), LIMIT, NO_RATES)).toBe(true);
    expect(exceeds(money("50000.00", "USD"), LIMIT, NO_RATES)).toBe(false);
    expect(exceeds(money("2800000.00", "PKR"), money("2800000.00", "PKR"), NO_RATES)).toBe(false);
  });

  it("DSOR-MON-03: two currencies, neither of them the dollar, are compared through it", () => {
    // 1,000,000.00 PKR is 3,571.428571... USD, and that is 2,857.142857... GBP.
    const rupees = money("1000000.00", "PKR");

    expect(exceeds(rupees, money("2857.14", "GBP"), STORY)).toBe(true);
    expect(exceeds(rupees, money("2857.15", "GBP"), STORY)).toBe(false);
  });
});

describe("DSOR-MON-04: an amount that cannot be converted", () => {
  it("DSOR-MON-04: an amount in a currency with no rate cannot be compared", () => {
    expect(() => exceeds(money("100.00", "XXX"), LIMIT, STORY)).toThrow(CannotConvert);
    expect(() => covers(LIMIT, money("100.00", "XXX"), STORY)).toThrow(CannotConvert);
  });

  it("DSOR-MON-04: a limit in a currency with no rate cannot be compared either", () => {
    expect(() => exceeds(money("100.00", "PKR"), money("50000.00", "XXX"), STORY)).toThrow(
      CannotConvert,
    );
  });

  it("DSOR-MON-04: a rate of zero is no rate", () => {
    // With the dollar at zero, every amount in dollars would count as nothing.
    const brokenDollar = sheet({ USD: "0", PKR: "280" });
    const brokenRupee = sheet({ USD: "1", PKR: "0.00" });

    expect(() => exceeds(money("50000000.00", "PKR"), LIMIT, brokenDollar)).toThrow(CannotConvert);
    expect(() => exceeds(money("50000000.00", "PKR"), LIMIT, brokenRupee)).toThrow(CannotConvert);
  });

  it("DSOR-MON-04: a rate below zero, or one that is not a decimal, is no rate", () => {
    for (const rate of ["-280", "280 PKR", "", "2.8e2", "Infinity", "NaN", " 280"]) {
      expect(
        () => exceeds(money("100.00", "PKR"), LIMIT, sheet({ USD: "1", PKR: rate })),
        rate,
      ).toThrow(CannotConvert);
    }
  });

  it("DSOR-MON-04: a rate that is not text at all is no rate", () => {
    const oddly = ((currency: string) => (currency === "PKR" ? 280 : "1")) as unknown as RateOf;

    expect(() => exceeds(money("100.00", "PKR"), LIMIT, oddly)).toThrow(CannotConvert);
  });

  it("DSOR-MON-04: the refusal names the currency and says why", () => {
    let caught: unknown;

    try {
      exceeds(money("100.00", "XXX"), LIMIT, STORY);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CannotConvert);
    expect((caught as CannotConvert).currency).toBe("XXX");
    expect((caught as CannotConvert).message).toBe("there is no rate for XXX");
  });
});

describe("DSOR-MON-06: a payment booked against a limit in another currency", () => {
  it("DSOR-MON-06: 2,800,000.00 PKR books exactly 10,000.00 USD", () => {
    expect(convertUp(money("2800000.00", "PKR"), "USD", STORY)).toEqual({
      value: "10000.00",
      currency: "USD",
    });
  });

  it("DSOR-MON-06: 1,000,000.00 PKR books 3,571.43 USD, rounded up and never down", () => {
    // 3,571.428571...: down would count a fraction of a cent too little against the day.
    expect(convertUp(money("1000000.00", "PKR"), "USD", STORY)).toEqual({
      value: "3571.43",
      currency: "USD",
    });
  });

  it("DSOR-MON-06: one hundredth of a rupee books one cent, never nothing", () => {
    expect(convertUp(money("0.01", "PKR"), "USD", STORY)).toEqual({
      value: "0.01",
      currency: "USD",
    });
  });

  it("DSOR-MON-06: pounds book in dollars too: 45,000.00 GBP is 56,250.00 USD", () => {
    expect(convertUp(money("45000.00", "GBP"), "USD", STORY)).toEqual({
      value: "56250.00",
      currency: "USD",
    });
  });

  it("DSOR-MON-06: an amount already in the limit's currency books as it is, with no rate", () => {
    const amount = money("31400.00", "USD");

    expect(convertUp(amount, "USD", NO_RATES)).toBe(amount);
  });

  it("DSOR-MON-06: an amount that cannot be converted books nothing", () => {
    expect(() => convertUp(money("100.00", "XXX"), "USD", STORY)).toThrow(CannotConvert);
    expect(() => convertUp(money("100.00", "PKR"), "USD", sheet({ USD: "1", PKR: "0" }))).toThrow(
      CannotConvert,
    );
  });

  it("DSOR-MON-06: what is booked is added up exactly", () => {
    const first = convertUp(money("1000000.00", "PKR"), "USD", STORY);
    const second = convertUp(money("1000000.00", "PKR"), "USD", STORY);

    expect(plus(first, second)).toEqual({ value: "7142.86", currency: "USD" });
  });

  it("DSOR-MON-06: two amounts in two currencies are never added without converting", () => {
    expect(() => plus(money("1.00", "USD"), money("1.00", "PKR"))).toThrow(TypeError);
  });
});
