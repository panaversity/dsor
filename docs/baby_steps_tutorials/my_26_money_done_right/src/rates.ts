// NEW IN STEP 26: the rate service, which says how many of each currency one US dollar buys
// (decision 159).
//
// DSoR never takes a rate from the request. An agent that says a dollar buys a million rupees could
// make any bill look small. So DSoR asks the company's rate service itself, each time it compares
// two currencies. A service can be down, and its rates can be old. DSoR does not guess then: the
// amount cannot be converted, and the strict answer wins.
//
// This one is a fake, built like step 19's directory: one per company, which a test or the demo can
// change, make old, or switch off. A real one is a bank's published rates, such as the European
// Central Bank's daily reference rates in the specification's reference profile. What DSoR asks of
// it is the same.
//
// Rule DSOR-MON-03: a monetary threshold in a control or delegation MUST be compared only through
// the dsor_* money functions, which convert both operands to the threshold's currency using the
// tenant's rate source.
// Rule DSOR-MON-04: when an amount cannot be converted — unknown currency, no rate, or a rate older
// than max_rate_age — the comparison MUST resolve restrictively.

import { CLOCK_SKEW_MS, isARecordTime, WITH_ITS_ZONE } from "./authority.ts";
import { CannotConvert, type RateOf } from "./exchange.ts";

/** The tenant policy's `max_rate_age`, P3D, for every company in this step (decision 159). */
export const MAX_RATE_AGE_MS: number = 3 * 24 * 60 * 60 * 1000;

/** What a rate service publishes: how many of each currency one US dollar buys, and when. */
export interface RateSheet {
  readonly rates: Readonly<Record<string, string>>;
  /** When the rates were published, as an exact ISO time with its zone. */
  readonly asOf: string;
}

/** One company's rate service. `latest` throws when the service cannot be reached. */
export interface RateService {
  readonly latest: () => RateSheet;
}

/** How a fake rate service behaves. Everything left out is the plain case. */
export interface FakeRates {
  /** Every ask throws, as a service that cannot be reached does. */
  readonly down?: boolean;
  /** When the rates were published. Left out, the moment they are asked for. */
  readonly asOf?: string;
  /** Rates beside the story's, or in place of some of them. */
  readonly rates?: Readonly<Record<string, string>>;
}

/** The story's rates: one US dollar buys 280 Pakistani rupees, or 0.80 British pounds. */
const STORY_RATES = Object.freeze({ USD: "1", PKR: "280", GBP: "0.80" });

/** A fake rate service for one company, with the story's rates unless `fake` says otherwise. */
export function aRateService(tenant: string, fake: FakeRates = {}): RateService {
  return Object.freeze({
    latest: (): RateSheet => {
      if (fake.down === true) {
        throw new Error(`the rate service of ${tenant} did not answer`);
      }

      return Object.freeze({
        rates: Object.freeze({ ...STORY_RATES, ...fake.rates }),
        // Date.now, not a bare `new Date()`, so that a test that sets the clock sets this too.
        asOf: fake.asOf ?? new Date(Date.now()).toISOString(),
      });
    },
  });
}

/** Each company's rate service, where a test or the demo has set one: `null` is none at all. */
const configured = new Map<string, RateService | null>();

/** Give one company another rate service, `null` for none, or `undefined` for its own fake again. */
export function useRateService(tenant: string, service: RateService | null | undefined): void {
  if (service === undefined) {
    configured.delete(tenant);
  } else {
    configured.set(tenant, service);
  }
}

/** The rate service one company has, or `null` for a company that has none. */
export function rateServiceOf(tenant: string): RateService | null {
  const set = configured.get(tenant);

  return set === undefined ? aRateService(tenant) : set;
}

/** The rates read from a company's service, or why there are none to use. */
type Read = { readonly rates: Readonly<Record<string, string>> } | { readonly why: string };

function readTheRates(tenant: string): Read {
  const service = rateServiceOf(tenant);

  if (service === null) {
    return { why: `${tenant} has no rate service to ask` };
  }

  let answer: unknown;

  try {
    answer = service.latest();
  } catch {
    return { why: `${tenant}'s rate service did not answer` };
  }

  const cannotRead = { why: `${tenant}'s rate service gave rates this program cannot read` };

  // Copied first, then checked, and each field read once: what is checked is what is used, as step
  // 19 learned of the directory's answers (decisions 130 and 150).
  let rates: Record<string, unknown> | undefined;
  let asOf: unknown;

  try {
    const given = (answer ?? {}) as { readonly rates?: unknown; readonly asOf?: unknown };
    const listed = given.rates;

    rates =
      listed !== null && typeof listed === "object" && !Array.isArray(listed)
        ? { ...listed }
        : undefined;
    asOf = given.asOf;
  } catch {
    return cannotRead;
  }

  if (
    rates === undefined ||
    !Object.values(rates).every((rate) => typeof rate === "string") ||
    typeof asOf !== "string" ||
    !WITH_ITS_ZONE.test(asOf) ||
    !isARecordTime(asOf)
  ) {
    return cannotRead;
  }

  const age = Date.now() - Date.parse(asOf);

  // From the future beyond the clocks' difference is a time nobody can trust (decision 130).
  if (Number.isNaN(age) || age < -CLOCK_SKEW_MS) {
    return cannotRead;
  }

  if (age > MAX_RATE_AGE_MS) {
    return { why: `${tenant}'s newest rates are more than three days old` };
  }

  return { rates: Object.freeze(rates as Record<string, string>) };
}

/**
 * The rates one company converts with, as `exchange.ts` asks for them.
 *
 * The service is asked the first time a rate is needed, and only once, so both currencies of a
 * comparison come from one sheet. Two amounts in one currency need no rate, and never ask. Throws
 * `CannotConvert`, for the caller to resolve restrictively, for a company with no service, a
 * service that does not answer, rates this program cannot read, rates more than three days old,
 * and a currency the rates do not include.
 */
export function ratesOf(tenant: string): RateOf {
  let read: Read | undefined;

  return (currency) => {
    read ??= readTheRates(tenant);

    if ("why" in read) {
      throw new CannotConvert(currency, read.why);
    }

    const rate = Object.hasOwn(read.rates, currency) ? read.rates[currency] : undefined;

    if (rate === undefined) {
      throw new CannotConvert(currency, `there is no rate for ${currency}`);
    }

    return rate;
  };
}
