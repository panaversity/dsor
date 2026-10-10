// NEW IN STEP 18: the permission slip, and the power an agent has under it (decision 127).
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

export interface Delegation {
  readonly id: string;
  readonly tenant: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly permissions: readonly string[];
  /** Up to how much one payment may be, or `undefined` for no limit. */
  readonly perTransactionLimit: Money | undefined;
  readonly status: DelegationStatus;
  /** When it stops counting, as an exact ISO time. */
  readonly expiresAt: string;
}

interface Row {
  readonly tenant: string;
  readonly id: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly permissions: readonly string[];
  readonly limit_value: string | null;
  readonly limit_currency: string | null;
  readonly status: DelegationStatus;
  readonly expires_at: string;
}

/**
 * The agent's active slip in one company, or `undefined` when it has none.
 *
 * "Active" is the slip's status. Whether it has expired is the caller's to ask, against the time of
 * the decision, so that an expired slip is refused for being expired and not for being absent.
 */
export async function activeSlipFor(
  tenant: string,
  delegate: string,
): Promise<Delegation | undefined> {
  const { rows } = await theDatabase(tenant).query<Row>(
    `SELECT tenant, id, delegator, delegate, permissions,
            per_transaction_limit_value::text AS limit_value,
            per_transaction_limit_currency AS limit_currency,
            status, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
       FROM dsor.delegations
      WHERE tenant = $1 AND delegate = $2 AND status = 'active'`,
    [tenant, delegate],
  );
  const row = rows[0];

  if (row === undefined) {
    return undefined;
  }

  return Object.freeze({
    id: row.id,
    tenant: row.tenant,
    delegator: row.delegator,
    delegate: row.delegate,
    permissions: Object.freeze([...row.permissions]),
    perTransactionLimit:
      row.limit_value === null || row.limit_currency === null
        ? undefined
        : money(row.limit_value, row.limit_currency),
    status: row.status,
    expiresAt: row.expires_at,
  });
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
        signerHoldsNow.includes(permission) && (scopes === undefined || scopes.includes(permission)),
    ),
  );
}
