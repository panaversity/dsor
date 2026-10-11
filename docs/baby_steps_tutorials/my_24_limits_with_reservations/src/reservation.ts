// NEW IN STEP 24: reservations against a slip's daily limit (decision 140).
//
// A daily limit is a running total, and the common mistake §13.4 names is reading the total,
// checking it in the code, and then writing it: between the read and the write, another payment
// slips in. Here the total is never read before it is written. Each reservation adds its amount to
// the day's total in one statement that adds it only if the total stays within the limit, and
// writes the reservation, keyed by its proposal, in the same statement. Like booking the last hotel
// room: of two requests, only one can have it.
//
// Rule DSOR-DEL-06a: cumulative limits MUST be enforced with atomic reserve, commit, and release
// operations in the control-plane store.
// Rule DSOR-DEL-06b: a reservation MUST be keyed by proposal id, so that re-evaluating the same
// proposal never reserves twice.

import type { Money } from "./money.ts";
import { theDatabase } from "./store.ts";

/** What happened when an amount was to be reserved. */
export type Reserved =
  | { readonly kind: "reserved" }
  /** The day's total would pass the limit: nothing was reserved, and the total did not move. */
  | { readonly kind: "over" }
  /** This proposal has a reservation already, still held, and it was not made twice. */
  | { readonly kind: "already" }
  /**
   * NEW IN STEP 24, decision 141: this proposal's reservation was settled, committed or released,
   * and it is not booked again. Only a held one is "already".
   */
  | { readonly kind: "settled" };

// "Today", on the database's clock, in UTC: one clock for every server, and the day a total is for
// is the day PostgreSQL says it is, not whichever server's clock asked.
const TODAY = "(now() AT TIME ZONE 'UTC')::date";

/**
 * Reserve an amount for a proposal against its slip's daily limit, in one statement.
 *
 * The amount and the limit are in the same currency, or the amount is over: this compares
 * numbers, so one in another currency is refused here too, restrictively (DSOR-MON-04), and the
 * day's total is always in the limit's currency (decision 141).
 *
 * The day's first reservation inserts the total, if the amount alone is within the limit; any later
 * one adds to it, if the sum stays within. PostgreSQL locks the total's row for the second of two
 * requests that arrive together, and checks the sum again on the row as the first left it, so the
 * check and the addition cannot be separated. The reservation is written from the same statement's
 * result: no total moved, no reservation; a reservation for this proposal already there, and the
 * whole statement is undone, its addition included.
 */
export async function reserve(
  tenant: string,
  proposal: string,
  delegation: string,
  amount: Money,
  limit: Money,
): Promise<Reserved> {
  try {
    const { rows } = await theDatabase(tenant).query(
      `WITH booked AS (
         INSERT INTO dsor.day_totals AS t (tenant, delegation, day, used_value, currency)
         SELECT $1, $3, ${TODAY}, $4::numeric, $7
          WHERE $4::numeric <= $6::numeric AND $5::text = $7::text
         ON CONFLICT (tenant, delegation, day) DO UPDATE
            SET used_value = t.used_value + EXCLUDED.used_value
          WHERE t.used_value + EXCLUDED.used_value <= $6::numeric AND t.currency = EXCLUDED.currency
         RETURNING t.tenant, t.delegation, t.day
       )
       INSERT INTO dsor.reservations (tenant, proposal, delegation, day, amount_value, amount_currency)
       SELECT tenant, $2, delegation, day, $4::numeric, $5 FROM booked
       RETURNING proposal`,
      [tenant, proposal, delegation, amount.value, amount.currency, limit.value, limit.currency],
    );

    return Object.freeze({ kind: rows.length === 1 ? "reserved" : "over" });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== "23505") {
      throw error;
    }
  }

  // A reservation for this proposal is there already: its primary key refused the second, and the
  // statement, the total's addition with it, was undone (DSOR-DEL-06b). Decision 141: "already" only
  // if it is still held; a settled one is said, so that nothing carries on as if it were booked.
  const { rows: found } = await theDatabase(tenant).query<{ state: string }>(
    "SELECT state FROM dsor.reservations WHERE tenant = $1 AND proposal = $2",
    [tenant, proposal],
  );

  return Object.freeze({ kind: found[0]?.state === "held" ? "already" : "settled" });
}

/**
 * Settle a proposal's reservation, if it has one and it is still held: committed keeps its amount
 * on the day; released gives it back. One statement, so the reservation and the total never
 * disagree. A settled reservation is never changed again: the restrictive policy of migration 022
 * hides it from every UPDATE, so this does nothing to it.
 *
 * NEW IN STEP 24, decision 141: and only when the proposal's history holds the move that says so,
 * asked in the same statement: committed with a move into COMMITTED, released with one into FAILED
 * or DENIED. A review measured a reservation released for a proposal whose move to FAILED was never
 * written, left EXECUTING, whose end nobody knew. Without the move, the reservation stays held, and
 * its amount counts against the day: the limit errs toward refusing.
 */
export async function settleReservation(
  tenant: string,
  proposal: string,
  to: "committed" | "released",
): Promise<void> {
  await theDatabase(tenant).query(
    `WITH settled AS (
       UPDATE dsor.reservations SET state = $3
        WHERE tenant = $1 AND proposal = $2 AND state = 'held'
          AND EXISTS (SELECT 1 FROM dsor.proposal_moves m
                       WHERE m.tenant = $1 AND m.proposal = $2 AND m.to_state = ANY ($4::text[]))
        RETURNING delegation, day, amount_value
     )
     UPDATE dsor.day_totals t SET used_value = t.used_value - s.amount_value
       FROM settled s
      WHERE $3 = 'released' AND t.tenant = $1 AND t.delegation = s.delegation AND t.day = s.day`,
    [tenant, proposal, to, to === "committed" ? ["COMMITTED"] : ["FAILED", "DENIED"]],
  );
}

/** How much a slip has reserved today, as text: "0.00" when nothing yet. */
export async function usedToday(tenant: string, delegation: string): Promise<string> {
  const { rows } = await theDatabase(tenant).query<{ used: string }>(
    `SELECT used_value::text AS used FROM dsor.day_totals
      WHERE tenant = $1 AND delegation = $2 AND day = ${TODAY}`,
    [tenant, delegation],
  );

  return rows[0]?.used ?? "0.00";
}
