// Limits on a permission slip, and the reservations that keep them. A slip may say
// how much its agent may spend in one payment and in one day. Line ⑩ compares the amount with the
// limit for one payment, and reserves it against the day's total in one step, keyed by the
// proposal, so two requests at the same moment can never both take the last room (DSOR-DEL-06a to
// DSOR-DEL-06e in specs/dsor/02-security.md, section 13.4; step 24's README, decisions 1 to 19).
// The program keeps the day's totals and the reservations in dsor.limit_counters and
// dsor.reservations (postgres.ts); the unit tests keep them in memory (memoryReservations below).
import { Refusal } from "./envelope.ts";
import type { Money } from "./money.ts";
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

/** True when the amount is at most the limit, in the same currency. Another currency is never within it before step 26. */
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
  store: ReservationStore;
};

/**
 * Line ⑩'s limits: refuses a call that would pass the slip's limit for one payment, or for one day,
 * with LIMIT_EXCEEDED. In execute mode the day's limit is checked by the reservation itself.
 */
export async function checkLimits(check: LimitCheck): Promise<void> {
  const { operation, tenant, slip, limits, spends, reserveFor, store } = check;
  if (slip === undefined || spends === undefined) return;
  // The words name the slip and the limit, never an amount: an agent's clearance may hide the
  // amounts (DSOR-CLS-02a), and the refusal must not show them. So the message is public.
  const name = JSON.stringify(operation);
  if (limits.per_payment !== undefined && !within(spends, limits.per_payment)) {
    const why = `${name} would pass slip ${slip}'s limit for one payment`;
    throw new Refusal("LIMIT_EXCEEDED", why, "public");
  }
  // An amount of nothing, such as a paid invoice's 0.00, takes nothing from the day.
  // Found by step 24's review: the database refused a reservation of nothing as an accident
  // (decision 18).
  if (limits.daily === undefined || millionths(spends.value) === 0n) return;
  const fits =
    reserveFor === undefined
      ? await store.fits(tenant, slip, spends, limits.daily)
      : await store.reserve(tenant, reserveFor, slip, spends, limits.daily);
  if (!fits) {
    throw new Refusal(
      "LIMIT_EXCEEDED",
      `${name} would pass slip ${slip}'s limit for one day`,
      "public",
    );
  }
}
