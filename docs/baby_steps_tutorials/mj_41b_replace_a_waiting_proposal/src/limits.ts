// Limits on a permission slip, and the reservations that keep them. A slip may say
// how much its agent may spend in one payment and in one day. Line ⑩ compares the amount with the
// limit for one payment, and reserves it against the day's total in one step, keyed by the
// proposal, so two requests at the same moment can never both take the last room (DSOR-DEL-06a to
// DSOR-DEL-06e in specs/dsor/02-security.md, section 13.4; step 24's README, decisions 1 to 19).
// The program keeps the day's totals and the reservations in dsor.limit_counters and
// dsor.reservations (postgres.ts); the unit tests keep them in memory (memoryReservations below).
import { Refusal } from "./envelope.ts";
import { convertUp, exceeds, type Converted, type RateSheet } from "./exchange.ts";
import type { Money } from "./money.ts";
import type { MoneyPolicy } from "./policies.ts";
import type { RateStore } from "./rates.ts";
import type { Slip } from "./slips.ts";

/** What a slip lets its agent spend: at most `per_payment` in one call, and at most `daily` in one day. */
export type Limits = { per_payment?: Money; daily?: Money };

// The constraints line ③ accepts on a slip, because line ⑩ checks them. Line ③ refuses any other,
// as since step 18: a constraint that nothing checks is a promise nobody keeps (step 18's README,
// decision 6).
const CHECKED: readonly string[] = ["per_transaction_limit", "cumulative_limits"];

/** Every constraint of the slip that DSoR cannot check yet, in words. None means line ⑩ checks them all. */
export function uncheckedConstraints(slip: Slip): string[] {
  const unchecked = Object.keys(slip.constraints).filter((name) => !CHECKED.includes(name));
  const cumulative = slip.constraints["cumulative_limits"];
  if (Array.isArray(cumulative)) {
    // Only a limit over one day is built, and one of them: two would be two totals of one day
    // (step 24's README, decision 1).
    const windows = cumulative.map((limit) => String((limit as { window?: unknown }).window));
    for (const window of windows) {
      if (window !== "P1D") unchecked.push(`a cumulative limit over ${window}`);
    }
    if (windows.filter((window) => window === "P1D").length > 1) unchecked.push("two daily limits");
  }
  // And a limit DSoR cannot read exactly, such as a minus or more digits than it
  // compares. The schema accepts one, and every payment would then hear LIMIT_EXCEEDED. Found by
  // step 24's review (decision 19).
  const perPayment = slip.constraints["per_transaction_limit"] as { value?: unknown } | undefined;
  const amounts = [
    ...(perPayment === undefined ? [] : [perPayment]),
    ...(Array.isArray(cumulative)
      ? cumulative.map((limit) => (limit as { amount?: { value?: unknown } }).amount)
      : []),
  ];
  if (amounts.some((amount) => millionths(String(amount?.value)) === undefined)) {
    unchecked.push("a limit DSoR cannot read");
  }
  return unchecked;
}

/** The limits a slip carries, once line ③ has checked its constraints. None for a call under no slip. */
export function limitsOf(slip: Slip | undefined): Limits {
  if (slip === undefined) return {};
  // The slip passed the specification's schema at line ③, so each one is money when it is there.
  const perPayment = slip.constraints["per_transaction_limit"] as Money | undefined;
  const cumulative = slip.constraints["cumulative_limits"] as
    | { window: string; amount: Money }[]
    | undefined;
  const daily = cumulative?.find((limit) => limit.window === "P1D")?.amount;
  return {
    ...(perPayment === undefined ? {} : { per_payment: perPayment }),
    ...(daily === undefined ? {} : { daily }),
  };
}

// An amount as a whole number of millionths of its unit, so no float ever touches it. Six digits
// after the point are more than any currency uses. A value with more, or with a minus sign, is not
// read at all, so it fits no limit: a limit that cannot be checked refuses (step 24's README,
// decision 11).
const SCALE = 6;

/** The amount in millionths of its unit, or undefined when it cannot be read exactly. */
export function millionths(value: string): bigint | undefined {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if (match === null) return undefined;
  const fraction = match[2] ?? "";
  if (fraction.length > SCALE) return undefined;
  return BigInt(match[1]! + fraction.padEnd(SCALE, "0"));
}

// Amounts are added in millionths, so no float touches money (DSOR-MON-02), and written back with
//   as many decimal places as the most precise amount added, so 8,900.50 and 640.00 add to
//   9,540.50, never 9540.5.
/** The sum of amounts in one currency, written with the most decimal places any of them has. */
export function sumOf(amounts: Money[]): Money {
  const [first] = amounts;
  if (first === undefined) throw new Error("a sum of no amounts");
  let total = 0n;
  let places = 0;
  for (const amount of amounts) {
    const exact = millionths(amount.value);
    if (exact === undefined || amount.currency !== first.currency) {
      throw new Error(`an amount that cannot be added: ${JSON.stringify(amount)}`);
    }
    total += exact;
    places = Math.max(places, amount.value.split(".")[1]?.length ?? 0);
  }
  // Millionths read no minus sign, so a total is never below zero.
  const digits = total.toString().padStart(7, "0");
  const whole = digits.slice(0, -6);
  // The first `places` of the six digits after the point. Found by step 41's review, H3: a slice
  //   that ended at -6 + places ended at 0 for six places, and lost the whole fraction.
  const value = places === 0 ? whole : `${whole}.${digits.slice(-6).slice(0, places)}`;
  return { value, currency: first.currency };
}

/** True when the amount is at most the limit, in the same currency. Another currency is compared by checkLimits, with rates. */
export function within(amount: Money, limit: Money): boolean {
  const spent = millionths(amount.value);
  const allowed = millionths(limit.value);
  if (spent === undefined || allowed === undefined) return false;
  return amount.currency === limit.currency && spent <= allowed;
}

/** One reservation: what one proposal took from one slip's day, and where it stands. */
export type Reservation = {
  tenant: string;
  proposal: string;
  delegation: string;
  day: string;
  amount: Money;
  state: "held" | "committed" | "released";
};

// Both stores keep the day's total of each slip, in each currency, and one reservation for each
// proposal. A reservation is held until its proposal ends, then committed or released, once
// (DSOR-DEL-06a to DSOR-DEL-06d).
/** Where DSoR keeps the day's totals and the reservations. */
export type ReservationStore = {
  /**
   * Adds the amount to the slip's total for today and checks the limit, in one step, keyed by the
   * proposal. False, with nothing changed, when the total would pass the limit. A proposal that
   * reserved already adds nothing, and gets true (DSOR-DEL-06b).
   */
  reserve: (
    tenant: string,
    proposal: string,
    delegation: string,
    amount: Money,
    limit: Money,
  ) => Promise<boolean>;
  /** Whether the amount would fit under the limit today. Reserves nothing: for a dry run. */
  fits: (tenant: string, delegation: string, amount: Money, limit: Money) => Promise<boolean>;
  /** The proposal ended COMMITTED: its reservation stays counted. Nothing, when it holds none. */
  commit: (tenant: string, proposal: string) => Promise<void>;
  /** The proposal ended FAILED: its amount goes back to the day. Nothing, when it holds none. */
  release: (tenant: string, proposal: string) => Promise<void>;
  /** The reservation of one proposal, or none. */
  get: (tenant: string, proposal: string) => Promise<Reservation | undefined>;
};

/** The reservations in memory, for the tests, with every reservation and the day's total of a slip. */
export type MemoryReservations = ReservationStore & {
  all: () => Promise<Reservation[]>;
  used: (tenant: string, delegation: string, currency: string) => Promise<string>;
  // And the undo of one proposal's reservation, which memory's claims call after an
  //   accident in a call that made the proposal, as the database's rollback undoes the reservation
  //   with it (step 32's README, decision D14; step 32's review, finding M1).
  forget: (tenant: string, proposal: string) => Promise<void>;
  // NEW IN STEP 41b: and the undo of a booking given back: it counts in its day's total again, as
  //   the database's rollback takes the give-back away (step 41b's README, decision D7).
  restore: (tenant: string, proposal: string) => Promise<void>;
};

/** Reservations in memory, for the unit tests. The day is today in UTC, by this clock. */
export function memoryReservations(now: () => number = Date.now): MemoryReservations {
  // The day's totals, in millionths, by company, slip, day, and currency.
  const totals = new Map<string, bigint>();
  // One reservation for each proposal of each company, with its amount in millionths.
  const kept = new Map<string, Reservation & { spent: bigint }>();
  const today = (): string => new Date(now()).toISOString().slice(0, 10);
  const totalOf = (tenant: string, delegation: string, day: string, currency: string): string =>
    JSON.stringify([tenant, delegation, day, currency]);
  const keyOf = (tenant: string, proposal: string): string => JSON.stringify([tenant, proposal]);
  const shown = ({ spent: _spent, ...reservation }: Reservation & { spent: bigint }): Reservation =>
    structuredClone(reservation);
  return Object.freeze({
    reserve: async (
      tenant: string,
      proposal: string,
      delegation: string,
      amount: Money,
      limit: Money,
    ): Promise<boolean> => {
      if (kept.has(keyOf(tenant, proposal))) return true;
      const spent = millionths(amount.value);
      const allowed = millionths(limit.value);
      if (spent === undefined || allowed === undefined || amount.currency !== limit.currency) {
        return false;
      }
      const day = today();
      const total = totalOf(tenant, delegation, day, amount.currency);
      const used = totals.get(total) ?? 0n;
      // The check and the add, with nothing in between that another call could run in: one step,
      // as the database's one statement is.
      if (used + spent > allowed) return false;
      totals.set(total, used + spent);
      const reservation = { tenant, proposal, delegation, day, amount: { ...amount } };
      kept.set(keyOf(tenant, proposal), { ...reservation, state: "held", spent });
      return true;
    },
    fits: async (
      tenant: string,
      delegation: string,
      amount: Money,
      limit: Money,
    ): Promise<boolean> => {
      const spent = millionths(amount.value);
      const allowed = millionths(limit.value);
      if (spent === undefined || allowed === undefined || amount.currency !== limit.currency) {
        return false;
      }
      const used = totals.get(totalOf(tenant, delegation, today(), amount.currency)) ?? 0n;
      return used + spent <= allowed;
    },
    commit: async (tenant: string, proposal: string): Promise<void> => {
      const reservation = kept.get(keyOf(tenant, proposal));
      if (reservation?.state === "held") reservation.state = "committed";
    },
    release: async (tenant: string, proposal: string): Promise<void> => {
      const reservation = kept.get(keyOf(tenant, proposal));
      if (reservation?.state !== "held") return;
      const { delegation, day, amount, spent } = reservation;
      const total = totalOf(tenant, delegation, day, amount.currency);
      totals.set(total, (totals.get(total) ?? 0n) - spent);
      reservation.state = "released";
    },
    get: async (tenant: string, proposal: string): Promise<Reservation | undefined> => {
      const reservation = kept.get(keyOf(tenant, proposal));
      return reservation === undefined ? undefined : shown(reservation);
    },
    all: async (): Promise<Reservation[]> => [...kept.values()].map(shown),
    forget: async (tenant: string, proposal: string): Promise<void> => {
      const reservation = kept.get(keyOf(tenant, proposal));
      if (reservation === undefined) return;
      // A held or committed reservation counts in its day's total; a released one does not.
      if (reservation.state !== "released") {
        const { delegation, day, amount, spent } = reservation;
        const total = totalOf(tenant, delegation, day, amount.currency);
        totals.set(total, (totals.get(total) ?? 0n) - spent);
      }
      kept.delete(keyOf(tenant, proposal));
    },
    // No limit is checked: the amount was counted until this claim gave it back a moment ago.
    //   Memory has no lock on the day's total, so a call in between could book that room too;
    //   the database's row lock keeps it until the claim ends (step 41b's README, "Left open").
    restore: async (tenant: string, proposal: string): Promise<void> => {
      const reservation = kept.get(keyOf(tenant, proposal));
      if (reservation?.state !== "released") return;
      const { delegation, day, amount, spent } = reservation;
      const total = totalOf(tenant, delegation, day, amount.currency);
      totals.set(total, (totals.get(total) ?? 0n) + spent);
      reservation.state = "held";
    },
    used: async (tenant: string, delegation: string, currency: string): Promise<string> => {
      const used = totals.get(totalOf(tenant, delegation, today(), currency)) ?? 0n;
      const text = used.toString().padStart(SCALE + 1, "0");
      return `${text.slice(0, -SCALE)}.${text.slice(-SCALE, -SCALE + 2)}`;
    },
  });
}

// A store for a call that makes no claim, such as a query. Any reservation is a bug.
/** A store that holds no reservation, and makes none. */
export const NO_RESERVATIONS: ReservationStore = Object.freeze({
  reserve: async (): Promise<never> => {
    throw new Error("this call reserves nothing");
  },
  fits: async (): Promise<never> => {
    throw new Error("this call reserves nothing");
  },
  commit: async (): Promise<never> => {
    throw new Error("this call reserves nothing");
  },
  release: async (): Promise<never> => {
    throw new Error("this call reserves nothing");
  },
  get: async () => undefined,
});

/** What line ⑩ needs to know about one call. */
export type LimitCheck = {
  operation: string;
  tenant: string;
  // The slip the call runs under, when it runs under one, and the limits it carries.
  slip: string | undefined;
  limits: Limits;
  // What the command spends, as line ⑨ read it. None when it spends nothing.
  spends: Money | undefined;
  // The proposal to reserve for, in execute and propose_only modes. A dry run has none, so the
  // day's limit is checked only.
  reserveFor?: string;
  // Or, in a dry run of a release, the proposal whose booking is made already. Its
  //   amount is in the day's total, so a held booking fits, as the release finds it again and books
  //   nothing more (step 31's README, decisions D4 and D13).
  booked?: string;
  store: ReservationStore;
  // The company's sheets of rates and its money policy, for an amount in another
  // currency than a limit, and who to tell which rates a conversion used, for its decision's
  // record (step 26's README, decisions L3, L7, and D4).
  rates: RateStore;
  policy: MoneyPolicy | undefined;
  converted?: (conversion: Conversion) => void;
  // And who to tell which currency had no usable rate, and why, for the decision's record only
  // (step 26's review, finding H1).
  unconvertible?: (cause: Unconvertible) => void;
  // And who to tell of each amount converted, and the currency it went into, for
  //   the decision's bundle (DSOR-MON-05; step 33's README, D6).
  noted?: (one: Converted) => void;
};

/** What a conversion used, for its decision's record: the sheet, and its rates for the currencies converted (decision L7). */
export type Conversion = {
  source: string;
  published_at: string;
  base: string;
  rates: Record<string, string>;
};

/** Which currency had no usable rate, and why, for the decision's record only (decision D7). */
export type Unconvertible = { currency: string; why: string };

/** The sheet line ⑩ may convert with, or which currency has no usable rate, and why (decisions D4, D5, D7). */
async function usableSheet(
  check: LimitCheck,
  currencies: string[],
): Promise<{ sheet: RateSheet } | { currency: string; why: string }> {
  const { tenant, rates, policy } = check;
  const [own = ""] = currencies;
  // Start-up refused a company where a login works and no policy is. None is a bug, and the answer
  // is no.
  if (policy === undefined) return { currency: own, why: `${tenant} has no money policy` };
  const source = policy.rate_source;
  const newest = await rates.newest(tenant, source, policy.maxAgeMs);
  if (newest === undefined) return { currency: own, why: `${tenant} has no sheet of ${source}` };
  // Too old by the store's clock: the database's, on the database (decision D5).
  if (!newest.fresh) {
    const why = `the newest sheet of ${source} is older than ${policy.max_rate_age}`;
    return { currency: own, why };
  }
  // Both rates from the newest sheet, never one from an older sheet (decision D4).
  const missing = currencies.find((currency) => !Object.hasOwn(newest.sheet.rates, currency));
  if (missing !== undefined) {
    return { currency: missing, why: `the newest sheet of ${source} has no ${missing}` };
  }
  return { sheet: newest.sheet };
}

/**
 * Line ⑩'s limits: refuses a call that would pass the slip's limit for one payment, or for one day,
 * with LIMIT_EXCEEDED. In execute mode the day's limit is checked by the reservation itself.
 */
export async function checkLimits(check: LimitCheck): Promise<void> {
  const { operation, tenant, slip, limits, spends, reserveFor, store } = check;
  if (slip === undefined || spends === undefined) return;
  // A slip with no limits has none to pass, whatever the amount.
  if (limits.per_payment === undefined && limits.daily === undefined) return;
  // The words name the slip and the limit, never an amount: an agent's clearance may hide the
  // amounts (DSOR-CLS-02a), and the refusal must not show them. So the message is public.
  const name = JSON.stringify(operation);
  const forOnePayment = `${name} would pass slip ${slip}'s limit for one payment`;
  const forOneDay = `${name} would pass slip ${slip}'s limit for one day`;
  // An amount that cannot be read to six places fits no limit, in any currency, as
  // in the limit's own (step 24's README, decision 11; step 26's README, decision D17). Found by
  // step 26's review: in another currency, 0.0000000 EUR was converted to a booking of nothing.
  if (millionths(spends.value) === undefined) {
    const words = limits.per_payment === undefined ? forOneDay : forOnePayment;
    throw new Refusal("LIMIT_EXCEEDED", words, "public");
  }
  // A limit in another currency than the amount is compared through one sheet of
  // rates, read once for the whole check: the newest of the company's source. One currency needs
  // none, so an old sheet never stops a payment in the limit's own (DSOR-MON-03; step 26's README,
  // decisions D4 and D10).
  const others = [limits.per_payment, limits.daily]
    .filter((limit): limit is Money => limit !== undefined && limit.currency !== spends.currency)
    .map((limit) => limit.currency);
  const usable =
    others.length === 0 ? undefined : await usableSheet(check, [spends.currency, ...others]);
  const sheet = usable !== undefined && "sheet" in usable ? usable.sheet : undefined;
  if (sheet !== undefined) {
    // The decision's record names the sheet and the rates it used, a refusal's too (decision L7).
    const used = [spends.currency, ...others];
    const rates = Object.fromEntries(used.map((currency) => [currency, sheet.rates[currency]!]));
    const { source, published_at, base } = sheet;
    check.converted?.({ source, published_at, base, rates });
  }
  // With no usable rate the limit counts as exceeded (DSOR-MON-04; decision D7). The words say only
  // that. The currency they could name is the bill's, which an agent's clearance may hide
  // (DSOR-CLS-02a), and the cause names the company's money policy, which no label covers
  // (DSOR-CLS-01). The decision's record names both. Changed by step 26's review, finding H1: the
  // words named the bill's currency (step 26's README, decision D7).
  const noRate = (words: string): string => {
    if (usable === undefined || !("why" in usable)) return words;
    check.unconvertible?.({ currency: usable.currency, why: usable.why });
    return `${words}: no usable rate`;
  };
  if (limits.per_payment !== undefined) {
    const limit = limits.per_payment;
    // Exactly, by multiplying across: no division, so no rounding (DSOR-MON-02; decision L5). A
    // rate that cannot be used, such as a zero, which only a store with no CHECK can hold, fits no
    // limit.
    const across =
      limit.currency === spends.currency || sheet === undefined
        ? undefined
        : exceeds(spends, limit, sheet);
    // The amount, converted into the limit's currency, for the bundle (step 33's README, D6).
    if (across !== undefined) check.noted?.({ from: { ...spends }, to: limit.currency });
    const over =
      limit.currency === spends.currency
        ? !within(spends, limit)
        : sheet === undefined
          ? undefined
          : (across ?? true);
    if (over === undefined) throw new Refusal("LIMIT_EXCEEDED", noRate(forOnePayment), "public");
    if (over) throw new Refusal("LIMIT_EXCEEDED", forOnePayment, "public");
  }
  // An amount of nothing, such as a paid invoice's 0.00, takes nothing from the day.
  // Found by step 24's review: the database refused a reservation of nothing as an accident
  // (decision 18).
  if (limits.daily === undefined || millionths(spends.value) === 0n) return;
  // The booking is converted into the limit's own currency when it is taken,
  // rounded up at the sixth decimal place, so the day keeps one total, in the limit's currency
  // (DSOR-MON-06; decision L6).
  const daily = limits.daily;
  const booking =
    daily.currency === spends.currency
      ? spends
      : sheet === undefined
        ? undefined
        : convertUp(spends, daily.currency, sheet);
  if (booking === undefined) throw new Refusal("LIMIT_EXCEEDED", noRate(forOneDay), "public");
  // A release finds its proposal's booking again, and books nothing more (step 31's README, D4),
  //   in its claim by the proposal's id, and in its dry run by the booking named.
  //   Changed in step 33: the claim looks for its booking too, so a release that books nothing names
  //   no booking's conversion. Found by step 33's review, finding 3: the bundle named a conversion
  //   at Wednesday's rate, and the booking kept Tuesday's.
  const own = check.booked ?? reserveFor;
  const held = own === undefined ? undefined : await store.get(tenant, own);
  // The booking, converted into the limit's currency, for the bundle, when this call books it or
  //   checks the day with it (step 33's README, D6).
  if (held?.state !== "held" && daily.currency !== spends.currency)
    check.noted?.({ from: { ...spends }, to: daily.currency });
  const fits =
    held?.state === "held"
      ? true
      : reserveFor === undefined
        ? await store.fits(tenant, slip, booking, daily)
        : await store.reserve(tenant, reserveFor, slip, booking, daily);
  if (!fits) throw new Refusal("LIMIT_EXCEEDED", forOneDay, "public");
}

/**
 * Line ⑩'s limit for one day, for a run: every line's amount, each converted into
 * the limit's currency as one draft's booking is, added up, and booked once, in one step, keyed by
 * the run. So the day's room is checked against the whole run at once (DSOR-BAT-02b; step 41's
 * README, claim C4). The limit for one payment is each line's own, checked at its own line ⑩.
 */
export async function checkRunDay(
  check: Omit<LimitCheck, "spends"> & { amounts: Money[] },
): Promise<void> {
  const { operation, tenant, slip, limits, amounts, reserveFor, store } = check;
  const daily = limits.daily;
  if (slip === undefined || daily === undefined || amounts.length === 0) return;
  const forOneDay = `${JSON.stringify(operation)} would pass slip ${slip}'s limit for one day`;
  if (amounts.some((amount) => millionths(amount.value) === undefined)) {
    throw new Refusal("LIMIT_EXCEEDED", forOneDay, "public");
  }
  const others = [...new Set(amounts.map((a) => a.currency))].filter((c) => c !== daily.currency);
  // The sheet is read as one draft's is: the newest of the company's source, once.
  const asOne = { ...check, spends: amounts[0]! };
  const usable =
    others.length === 0 ? undefined : await usableSheet(asOne, [...others, daily.currency]);
  const sheet = usable !== undefined && "sheet" in usable ? usable.sheet : undefined;
  if (others.length > 0 && sheet === undefined) {
    if (usable !== undefined && "why" in usable) check.unconvertible?.(usable);
    throw new Refusal("LIMIT_EXCEEDED", `${forOneDay}: no usable rate`, "public");
  }
  if (sheet !== undefined) {
    const used = [...others, daily.currency];
    const rates = Object.fromEntries(used.map((currency) => [currency, sheet.rates[currency]!]));
    const { source, published_at, base } = sheet;
    check.converted?.({ source, published_at, base, rates });
  }
  const bookings: Money[] = [];
  for (const amount of amounts) {
    if (amount.currency === daily.currency) {
      bookings.push(amount);
      continue;
    }
    const converted = convertUp(amount, daily.currency, sheet!);
    if (converted === undefined) throw new Refusal("LIMIT_EXCEEDED", forOneDay, "public");
    check.noted?.({ from: { ...amount }, to: daily.currency });
    bookings.push(converted);
  }
  const total = sumOf(bookings);
  // A run of nothing to pay takes nothing from the day, as one draft of nothing does.
  if (millionths(total.value) === 0n) return;
  // A release finds its run's booking again, and books nothing more; its dry run counts it once.
  const own = check.booked ?? reserveFor;
  const held = own === undefined ? undefined : await store.get(tenant, own);
  const fits =
    held?.state === "held"
      ? true
      : reserveFor === undefined
        ? await store.fits(tenant, slip, total, daily)
        : await store.reserve(tenant, reserveFor, slip, total, daily);
  if (!fits) throw new Refusal("LIMIT_EXCEEDED", forOneDay, "public");
}
