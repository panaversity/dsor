// STEP 18: the permission slip, and the power an agent has under it (decision 127).
//
// A delegation is a slip a person signs for an agent: these permissions, up to this much per
// payment, until this date. DSoR keeps the slips in its own store and finds the one that applies
// itself, from the company and the agent; nothing in a request chooses it.
//
// The golden rule: the agent never has more power than the person who signed has *right now*. So
// the agent's power is computed at every decision, never stored: what the slip grants, cut down to
// what the signer holds at that moment, and to what the agent's login allows.
//
// Rule DSOR-DEL-01a: a state-changing command from an agent principal MUST be evaluated under an
// active delegation held in the DSoR control-plane store.
// Rule DSOR-DEL-01b: token claims and scopes MUST NOT widen a delegation.
// Rule DSOR-DEL-02: effective authority MUST be computed at decision time as the intersection of the
// delegator's current authority, the delegation's grants and constraints, and the token scopes.

import { money, type Money } from "./money.ts";
import { theDatabase } from "./store.ts";

export type DelegationStatus = "active" | "suspended" | "revoked" | "expired";

/** NEW IN STEP 19: how a slip may be used: with a person present, or with nobody (decision 129). */
export type IdentityMode = "on_behalf_of" | "unattended";

export interface Delegation {
  readonly id: string;
  readonly tenant: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly permissions: readonly string[];
  /** NEW IN STEP 19: the modes it may be used in, never none (DSOR-DEL-07, migration 015). */
  readonly modes: readonly IdentityMode[];
  /** Up to how much one payment may be, or `undefined` for no limit. */
  readonly perTransactionLimit: Money | undefined;
  readonly status: DelegationStatus;
  /**
   * When it stops counting, as an exact ISO time, or `undefined` when the store's value is no time
   * this program can write down. Migration 013 refuses `infinity`; `undefined` is for a store that
   * lets one in anyway, and it is refused as not in force (decision 128).
   */
  readonly expiresAt: string | undefined;
}

interface Row {
  readonly tenant: string;
  readonly id: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly permissions: readonly string[];
  readonly modes: readonly IdentityMode[];
  readonly limit_value: string | null;
  readonly limit_currency: string | null;
  readonly status: DelegationStatus;
  /** NULL for `infinity` and `-infinity`, which `to_char` cannot write as a date. */
  readonly expires_at: string | null;
}

/** What DSoR found when it looked for an agent's active slip in one company. */
export type SlipFound =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly slip: Delegation }
  | { readonly kind: "more_than_one"; readonly ids: readonly string[] };

/**
 * The agent's active slip in one company: none, one, or more than one.
 *
 * "Active" is the slip's status. Whether it has expired is the caller's to ask, against the time of
 * the decision, so that an expired slip is refused for being expired and not for being absent.
 *
 * More than one is said, never chosen between. Migration 013's index makes sure of one, and an owner
 * can drop an index: a review did, added a slip with no limit beside del_100, and DSoR took
 * whichever row came first (decision 128). So it reads up to two, and the caller refuses two.
 */
export async function activeSlipFor(tenant: string, delegate: string): Promise<SlipFound> {
  const { rows } = await theDatabase(tenant).query<Row>(
    `SELECT tenant, id, delegator, delegate, permissions, modes,
            per_transaction_limit_value::text AS limit_value,
            per_transaction_limit_currency AS limit_currency,
            status, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
       FROM dsor.delegations
      WHERE tenant = $1 AND delegate = $2 AND status = 'active'
      ORDER BY id
      LIMIT 2`,
    [tenant, delegate],
  );

  if (rows.length > 1) {
    return Object.freeze({
      kind: "more_than_one",
      ids: Object.freeze(rows.map((r) => r.id)),
    });
  }

  const row = rows[0];

  if (row === undefined) {
    return Object.freeze({ kind: "none" });
  }

  const slip: Delegation = Object.freeze({
    id: row.id,
    tenant: row.tenant,
    delegator: row.delegator,
    delegate: row.delegate,
    permissions: Object.freeze([...row.permissions]),
    modes: Object.freeze([...row.modes]),
    perTransactionLimit:
      row.limit_value === null || row.limit_currency === null
        ? undefined
        : money(row.limit_value, row.limit_currency),
    status: row.status,
    expiresAt: row.expires_at ?? undefined,
  });

  return Object.freeze({ kind: "one", slip });
}

/**
 * What the agent may do under a slip, at this moment.
 *
 * The slip's permissions, kept only where the signer holds them now, and, when the login carries
 * scopes, only where a scope names them too. Each of the three can only take away: a scope the slip
 * does not grant adds nothing, and neither does a permission the signer holds that the slip does not.
 */
export function effectiveAuthority(
  slip: Delegation,
  signerHoldsNow: readonly string[],
  scopes: readonly string[] | undefined,
): readonly string[] {
  return Object.freeze(
    slip.permissions.filter(
      (permission) =>
        signerHoldsNow.includes(permission) &&
        (scopes === undefined || scopes.includes(permission)),
    ),
  );
}
