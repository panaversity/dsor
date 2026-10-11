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

/** STEP 19: how a slip may be used: with a person present, or with nobody (decision 129). */
export type IdentityMode = "on_behalf_of" | "unattended";

export interface Delegation {
  readonly id: string;
  readonly tenant: string;
  readonly delegator: string;
  readonly delegate: string;
  readonly permissions: readonly string[];
  /** STEP 19: the modes it may be used in, never none (DSOR-DEL-07, migration 015). */
  readonly modes: readonly IdentityMode[];
  /** Up to how much one payment may be, or `undefined` for no limit. */
  readonly perTransactionLimit: Money | undefined;
  /** STEP 24: up to how much in one day, or `undefined` for no daily limit (decision 140). */
  readonly dailyLimit: Money | undefined;
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
  readonly daily_value: string | null;
  readonly daily_currency: string | null;
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
            daily_limit_value::text AS daily_value, daily_limit_currency AS daily_currency,
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
    dailyLimit:
      row.daily_value === null || row.daily_currency === null
        ? undefined
        : money(row.daily_value, row.daily_currency),
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

/** NEW IN STEP 25: one slip by its id, whatever its status: who signed it, and where it stands. */
export async function slipNamed(
  tenant: string,
  id: string,
): Promise<{ readonly delegator: string; readonly status: DelegationStatus } | undefined> {
  const { rows } = await theDatabase(tenant).query<{ delegator: string; status: DelegationStatus }>(
    "SELECT delegator, status FROM dsor.delegations WHERE tenant = $1 AND id = $2",
    [tenant, id],
  );
  const row = rows[0];

  return row === undefined
    ? undefined
    : Object.freeze({ delegator: row.delegator, status: row.status });
}

/** NEW IN STEP 25: what revoking a slip did. */
export type Revoked =
  | { readonly kind: "revoked"; readonly cancelled: readonly string[] }
  /** It was not active when the statement ran: revoked, suspended or expired already. */
  | { readonly kind: "not_active" };

/**
 * NEW IN STEP 25: revoke an active slip, and cancel what was waiting under it (DSOR-DEL-04a,
 * DSOR-DEL-04c, decision 142).
 *
 * One statement: the slip becomes revoked, with who, when and why, and every proposal under it that
 * is waiting for approval or approved moves to CANCELLED, its cause naming the slip and who revoked
 * it. Both happen, or neither: there is no moment at which the slip is revoked and its approved
 * proposals are still waiting to run. A prepared proposal, READY, is left: §26.2 has no move from
 * READY to CANCELLED, and step 31's proposal.execute checks the slip again before anything runs.
 */
export async function revokeSlip(
  tenant: string,
  id: string,
  by: string,
  reason: string,
): Promise<Revoked> {
  const { rows } = await theDatabase(tenant).query<{ revoked: number; cancelled: string[] }>(
    `WITH revoked AS (
       UPDATE dsor.delegations
          SET status = 'revoked', revoked_by = $3, revoked_at = clock_timestamp(), revoked_reason = $4
        WHERE tenant = $1 AND id = $2 AND status = 'active'
        RETURNING id
     ),
     waiting AS (
       SELECT m.proposal, m.to_state
         FROM dsor.proposals p
         JOIN dsor.proposal_moves m ON m.tenant = p.tenant AND m.proposal = p.id
        WHERE p.tenant = $1
          AND (p.requester::jsonb ->> 'delegation') = $2
          AND m.to_state IN ('PENDING_APPROVAL', 'APPROVED')
          AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves n
                           WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                             AND n.from_state = m.to_state)
     ),
     cancelled AS (
       INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
       SELECT $1, w.proposal, w.to_state, 'CANCELLED', 'dsor', $2 || ' was revoked by ' || $3
         FROM waiting w
        WHERE EXISTS (SELECT 1 FROM revoked)
       RETURNING proposal
     )
     SELECT (SELECT count(*) FROM revoked)::int AS revoked,
            COALESCE((SELECT array_agg(proposal ORDER BY proposal) FROM cancelled), '{}') AS cancelled`,
    [tenant, id, by, reason],
  );
  const row = rows[0];

  return row === undefined || row.revoked !== 1
    ? Object.freeze({ kind: "not_active" })
    : Object.freeze({ kind: "revoked", cancelled: Object.freeze([...row.cancelled]) });
}
