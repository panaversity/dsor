// STEP 26: the rate service, which DSoR asks itself, never the request (decision 159).
//
// Rule DSOR-MON-03: a monetary threshold in a control or delegation MUST be compared only through
// the dsor_* money functions, which convert both operands to the threshold's currency using the
// tenant's rate source.
// Rule DSOR-MON-04: when an amount cannot be converted — unknown currency, no rate, or a rate older
// than max_rate_age — the comparison MUST resolve restrictively.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CannotConvert, exceeds, type RateOf } from "../src/exchange.ts";
import { money } from "../src/money.ts";
import {
  aRateService,
  MAX_RATE_AGE_MS,
  rateServiceOf,
  ratesOf,
  type RateService,
  useRateService,
} from "../src/rates.ts";

const NOW = Date.parse("2026-10-16T09:00:00Z");
const MINUTE = 60 * 1000;
const LIMIT = money("50000.00", "USD");
const BILL = money("2800000.00", "PKR");

/** A time `ms` before NOW, as the service writes it. */
const before = (ms: number): string => new Date(NOW - ms).toISOString();

/** Why a rate cannot be had, or undefined when it can. */
function whyNot(rates: RateOf, currency: string): string | undefined {
  try {
    rates(currency);
  } catch (error) {
    if (error instanceof CannotConvert) {
      expect(error.currency).toBe(currency);
      return error.message;
    }

    throw error;
  }

  return undefined;
}

afterEach(() => {
  useRateService("org_456", undefined);
  useRateService("org_789", undefined);
  vi.restoreAllMocks();
});

describe("DSOR-MON-03: each company's rate service", () => {
  it("DSOR-MON-03: a company has a rate service, which knows the story's rates", () => {
    const rates = ratesOf("org_456");

    expect(rateServiceOf("org_456")).not.toBeNull();
    expect(rates("USD")).toBe("1");
    expect(rates("PKR")).toBe("280");
    expect(rates("GBP")).toBe("0.80");
  });

  it("DSOR-MON-03: a bill is compared with a limit at the rate the service gives, whatever it is", () => {
    expect(exceeds(BILL, LIMIT, ratesOf("org_456"))).toBe(false);

    // A rupee ten times as strong: the same bill is 100,000.00 USD.
    useRateService("org_456", aRateService("org_456", { rates: { PKR: "28" } }));

    expect(exceeds(BILL, LIMIT, ratesOf("org_456"))).toBe(true);
  });

  it("DSOR-MON-03: one company's service is not another's", () => {
    useRateService("org_789", aRateService("org_789", { down: true }));

    expect(ratesOf("org_456")("PKR")).toBe("280");
    expect(whyNot(ratesOf("org_789"), "PKR")).toBe("org_789's rate service did not answer");
  });

  it("DSOR-MON-03: the service is asked only when a rate is needed, and once for all its rates", () => {
    let asked = 0;
    const plain = aRateService("org_456");

    useRateService("org_456", {
      latest: () => {
        asked += 1;
        return plain.latest();
      },
    });

    const rates = ratesOf("org_456");

    expect(exceeds(money("50000.01", "USD"), LIMIT, rates)).toBe(true);
    expect(asked).toBe(0);
    expect(exceeds(BILL, LIMIT, rates)).toBe(false);
    expect(exceeds(money("45000.00", "GBP"), LIMIT, rates)).toBe(true);
    expect(asked).toBe(1);
  });

  it("DSOR-MON-03: the rates are copied as they are read, so a sheet changed afterwards changes nothing", () => {
    const sheet = { rates: { USD: "1", PKR: "280" }, asOf: new Date().toISOString() };

    useRateService("org_456", { latest: () => sheet });

    const rates = ratesOf("org_456");

    expect(rates("PKR")).toBe("280");
    sheet.rates.PKR = "1";
    expect(rates("PKR")).toBe("280");
  });
});

describe("DSOR-MON-04: no usable rate, and the strict answer", () => {
  it("DSOR-MON-04: a currency the service has no rate for", () => {
    expect(whyNot(ratesOf("org_456"), "XXX")).toBe("there is no rate for XXX");
    expect(() => exceeds(money("100.00", "XXX"), LIMIT, ratesOf("org_456"))).toThrow(CannotConvert);
  });

  it("DSOR-MON-04: a company with no rate service", () => {
    useRateService("org_456", null);

    expect(whyNot(ratesOf("org_456"), "PKR")).toBe("org_456 has no rate service to ask");
  });

  it("DSOR-MON-04: a service that does not answer", () => {
    useRateService("org_456", aRateService("org_456", { down: true }));

    expect(whyNot(ratesOf("org_456"), "PKR")).toBe("org_456's rate service did not answer");
  });

  it("DSOR-MON-04: rates three days old are used, and rates one second older are not", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    useRateService("org_456", aRateService("org_456", { asOf: before(MAX_RATE_AGE_MS) }));
    expect(ratesOf("org_456")("PKR")).toBe("280");

    useRateService("org_456", aRateService("org_456", { asOf: before(MAX_RATE_AGE_MS + 1000) }));
    expect(whyNot(ratesOf("org_456"), "PKR")).toBe(
      "org_456's newest rates are more than three days old",
    );
  });

  it("DSOR-MON-04: three days, decision 159: Friday's rates still serve on Monday", () => {
    expect(MAX_RATE_AGE_MS).toBe(3 * 24 * 60 * MINUTE);

    // Published Friday at 16:00 in Frankfurt, asked Monday at 09:00 in Karachi.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-19T09:00:00+05:00"));
    useRateService("org_456", aRateService("org_456", { asOf: "2026-10-16T16:00:00+02:00" }));

    expect(ratesOf("org_456")("PKR")).toBe("280");
  });

  it("DSOR-MON-04: rates dated in the future, beyond the clocks' difference, are not used", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    useRateService("org_456", aRateService("org_456", { asOf: before(-1 * MINUTE) }));
    expect(ratesOf("org_456")("PKR")).toBe("280");

    useRateService("org_456", aRateService("org_456", { asOf: before(-10 * MINUTE) }));
    expect(whyNot(ratesOf("org_456"), "PKR")).toBe(
      "org_456's rate service gave rates this program cannot read",
    );
  });

  it("DSOR-MON-04: rates whose time this program cannot read are not used", () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    for (const asOf of [
      "yesterday",
      "2026-10-16T08:00:00",
      "2026-09-31T00:00:00Z",
      "2026-10-16",
      42,
      undefined,
    ]) {
      useRateService("org_456", {
        latest: () => ({ rates: { USD: "1", PKR: "280" }, asOf }) as never,
      });

      expect(whyNot(ratesOf("org_456"), "PKR"), String(asOf)).toBe(
        "org_456's rate service gave rates this program cannot read",
      );
    }
  });

  it("DSOR-MON-04: an answer that is not a list of rates is not used", () => {
    const asOf = new Date().toISOString();

    for (const answer of [
      null,
      "PKR 280",
      { asOf },
      { rates: "PKR 280", asOf },
      { rates: ["280"], asOf },
      { rates: { PKR: 280 }, asOf },
      Promise.resolve({ rates: { PKR: "280" }, asOf }),
    ]) {
      useRateService("org_456", { latest: () => answer as never });

      expect(whyNot(ratesOf("org_456"), "PKR"), JSON.stringify(answer)).toBe(
        "org_456's rate service gave rates this program cannot read",
      );
    }
  });

  it("DSOR-MON-04: an answer that throws while it is read is not used", () => {
    const asOf = new Date().toISOString();
    const trap = {
      get rates(): never {
        throw new Error("a getter that fails");
      },
      asOf,
    };

    useRateService("org_456", {
      latest: () => trap as unknown as ReturnType<RateService["latest"]>,
    });

    expect(whyNot(ratesOf("org_456"), "PKR")).toBe(
      "org_456's rate service gave rates this program cannot read",
    );
  });

  it("DSOR-MON-04: each currency asked of rates that cannot be used is refused, by its own name", () => {
    useRateService("org_456", aRateService("org_456", { down: true }));

    const rates = ratesOf("org_456");

    expect(whyNot(rates, "PKR")).toBe("org_456's rate service did not answer");
    expect(whyNot(rates, "GBP")).toBe("org_456's rate service did not answer");
  });
});
