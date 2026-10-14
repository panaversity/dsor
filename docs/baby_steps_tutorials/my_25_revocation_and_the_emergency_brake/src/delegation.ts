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
// NEW IN STEP 25, decision 157: a revocation's moves to CANCELLED have their records too.
import { recordInsertIf, recordTogether } from "./audit.ts";
import { type Asked, type ProposalState, transition } from "./proposal.ts";

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
   * lets one in anyway (decision 128), and for a time before the year 1, which `to_char` writes
   * without its era, so that 4000 BC would read as the year 4000 (decision 149). Either way it is
   * refused as not in force.
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
  /**
   * NULL for `infinity` and `-infinity`, which `to_char` cannot write as a date, and for a time
   * before the year 1, which it writes without its era (decision 149).
   */
  readonly expires_at: string | null;
}

/** What DSoR found when it looked for an agent's active slip in one company. */
export type SlipFound =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly slip: Delegation }
  | { readonly kind: "more_than_one"; readonly ids: readonly string[] }
  /**
   * Decision 149: one slip, read, that cannot be used, and the words that say why. With its signer,
   * because DSoR found it, and the refusal is recorded under it (decision 130).
   */
  | {
      readonly kind: "broken";
      readonly id: string;
      readonly delegator: string;
      readonly why: string;
    };

/**
 * Decision 149: a limit from the store, as money; `undefined` for no limit; or, for a limit that is
 * not an amount, the words that say so. Migration 013's check, `> 0`, lets 'NaN' in, because
 * PostgreSQL sorts NaN above every number, and `money` refuses it. Migration 022's check on the
 * daily limit is the same.
 */
function limitFrom(
  name: string,
  value: string | null,
  currency: string | null,
): Money | undefined | string {
  if (value === null || currency === null) {
    return undefined;
  }

  try {
    return money(value, currency);
  } catch {
    return `its ${name}, ${value} ${currency}, is not an amount`;
  }
}

/**
 * The agent's active slip in one company: none, one, more than one, or one that cannot be used.
 *
 * "Active" is the slip's status. Whether it has expired is the caller's to ask, against the time of
 * the decision, so that an expired slip is refused for being expired and not for being absent.
 *
 * More than one is said, never chosen between. Migration 013's index makes sure of one, and an owner
 * can drop an index: a review did, added a slip with no limit beside del_100, and DSoR took
 * whichever row came first (decision 128). So it reads up to two, and the caller refuses two.
 */
export async function activeSlipFor(tenant: string, delegate: string): Promise<SlipFound> {
  // Decision 149: the expiry is written out only from the year 1 on. `to_char` writes a year without
  // its era, so a slip that expired in 4000 BC came back as 4000-01-01, far in the future, and a
  // review's agent paid under it. Before the year 1 the answer is NULL, which the delegation stage
  // refuses as no time this program can read.
  const { rows } = await theDatabase(tenant).query<Row>(
    `SELECT tenant, id, delegator, delegate, permissions, modes,
            per_transaction_limit_value::text AS limit_value,
            per_transaction_limit_currency AS limit_currency,
            daily_limit_value::text AS daily_value, daily_limit_currency AS daily_currency,
            status,
            CASE WHEN expires_at >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
                 THEN to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            END AS expires_at
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

  // Decision 149: a slip whose limit is not an amount was read, and it is broken. `money` threw here,
  // and the stage refused the command as a slip that "could not be read, safe to send again", which
  // no retry could change. It is said instead, and the stage refuses it for what it is.
  const perTransactionLimit = limitFrom("limit per payment", row.limit_value, row.limit_currency);
  const dailyLimit = limitFrom("daily limit", row.daily_value, row.daily_currency);

  if (typeof perTransactionLimit === "string") {
    return Object.freeze({
      kind: "broken",
      id: row.id,
      delegator: row.delegator,
      why: perTransactionLimit,
    });
  }

  if (typeof dailyLimit === "string") {
    return Object.freeze({
      kind: "broken",
      id: row.id,
      delegator: row.delegator,
      why: dailyLimit,
    });
  }

  const slip: Delegation = Object.freeze({
    id: row.id,
    tenant: row.tenant,
    delegator: row.delegator,
    delegate: row.delegate,
    permissions: Object.freeze([...row.permissions]),
    modes: Object.freeze([...row.modes]),
    perTransactionLimit,
    dailyLimit,
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
  /** It had ended when the statement ran, revoked or expired already: nothing was changed. */
  | { readonly kind: "ended" }
  /** Decision 156: `by` did not sign it, or there is no such slip: nothing was changed. */
  | { readonly kind: "not_theirs" }
  /**
   * NEW IN STEP 25, decision 157: what waits under the slip was different each time it was read,
   * up to `LOOKS_AT_WHAT_WAITS` times, so nothing was changed.
   */
  | { readonly kind: "changed" };

/**
 * NEW IN STEP 25, decision 157: the proposals waiting under a slip, for approval or approved, with
 * the operation and payload hash the records of their moves carry. One text, for the read and for
 * the statement that checks what it read: a second copy could drift from the first (lesson 17).
 * `$1` is the company, and `$2` the slip.
 */
const WAITING_UNDER_A_SLIP = `
  SELECT m.proposal, m.to_state, p.operation, p.payload_hash
    FROM dsor.proposals p
    JOIN dsor.proposal_moves m ON m.tenant = p.tenant AND m.proposal = p.id
   WHERE p.tenant = $1
     AND (p.requester::jsonb ->> 'delegation') = $2
     AND m.to_state IN ('PENDING_APPROVAL', 'APPROVED')
     AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves n
                      WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                        AND n.from_state = m.to_state)`;

/**
 * NEW IN STEP 25, decision 157: how many times a revocation reads what waits before it gives up.
 * Nothing can wait for approval before step 29, so only a test makes this matter yet.
 */
export const LOOKS_AT_WHAT_WAITS: number = 5;

/**
 * NEW IN STEP 25: revoke an active slip, and cancel what was waiting under it (DSOR-DEL-04a,
 * DSOR-DEL-04c, decision 142).
 *
 * Decision 156: or a suspended one. DSOR-DEL-04a makes no exception for a slip's status, and a slip
 * suspended today can be made active tomorrow; its signer must be able to tear it up first.
 *
 * Decision 156: and only by the person who signed it, asked again in the statement. §21.9 asks
 * first, and decides what the caller is told; this holds for a door built without §21.9, or a read
 * there that failed open. A tenant administrator, who may revoke anyone's slip, will need a way of
 * their own.
 *
 * One statement: the slip becomes revoked, with who, when and why, and every proposal under it that
 * is waiting for approval or approved moves to CANCELLED, its cause naming the slip and who revoked
 * it. Both happen, or neither: there is no moment at which the slip is revoked and its approved
 * proposals are still waiting to run. A prepared proposal, READY, is left: §26.2 has no move from
 * READY to CANCELLED, and step 31's proposal.execute checks the slip again before anything runs.
 *
 * NEW IN STEP 25, decision 157: and each move to CANCELLED has its record in the log, in the name of
 * the request that revoked, `asked`, written by the same statement. A record's hash is made here, in
 * the program, so what waits is read first, and the statement revokes only if what waits is still
 * what was read: a proposal that started waiting in between has no record ready, and would be left
 * waiting under a revoked slip. If it changed, nothing is written, and it is read again, at most
 * `LOOKS_AT_WHAT_WAITS` times: then the answer is that it kept changing, and nothing was revoked.
 *
 * One moment was left, found by a review. The statement reads what waits as its snapshot saw it,
 * and PostgreSQL holds only the slip's row while it runs: a move into waiting that committed after
 * that snapshot, and before this statement committed, was not seen, and its proposal waited under a
 * revoked slip. STEP 22, decision 158: the company's turn at its log closes it. Every move is
 * written with its record in the company's turn, and so is this statement, so no move commits while
 * it runs, and at READ COMMITTED it reads every move committed before its turn began. A writer that
 * does not take turns, a person at the database, is what is left: step 29's move into waiting can
 * still lock the slip's row first, `FOR SHARE`.
 */
export async function revokeSlip(
  tenant: string,
  id: string,
  by: string,
  reason: string,
  asked: Asked,
): Promise<Revoked> {
  const cause = `${id} was revoked by ${by}`;

  for (let looks = 1; looks <= LOOKS_AT_WHAT_WAITS; looks += 1) {
    const { rows: waiting } = await theDatabase(tenant).query<{
      proposal: string;
      to_state: ProposalState;
      operation: string;
      payload_hash: string;
    }>(`${WAITING_UNDER_A_SLIP} ORDER BY m.proposal`, [tenant, id]);
    // What was read, as the statement reads it again: each proposal and the state it waits in.
    const read = waiting.map((w) => `${w.proposal} ${w.to_state}`);
    const { rows } = await recordTogether<{
      revoked: number;
      same: boolean;
      theirs: boolean;
      ended: boolean;
      cancelled: string[];
    }>(
      tenant,
      waiting.map((w) =>
        transition(
          { ...asked, operation: w.operation, payloadHash: w.payload_hash },
          tenant,
          w.proposal,
          w.to_state,
          "CANCELLED",
          "dsor",
          cause,
        ),
      ),
      (records) => {
        const params: unknown[] = [tenant, id, by, reason, read];
        // Nothing waiting: no moves and no records, and no parameter for them, because PostgreSQL
        // refuses a parameter the statement never uses.
        let cancelling = "";
        let cancelled = "'{}'::text[]";

        if (waiting.length > 0) {
          params.push(cause);

          const moves = waiting.map((w, i) => {
            params.push(w.proposal, w.to_state, records[i]?.record_id);

            const at = params.length;

            return `($${at - 2}, $${at - 1}, $${at})`;
          });

          cancelling = `,
            cancelled AS (
              INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
              SELECT $1, v.proposal, v.from_state, 'CANCELLED', 'dsor', $6, v.record
                FROM (VALUES ${moves.join(", ")}) AS v (proposal, from_state, record)
               WHERE EXISTS (SELECT 1 FROM revoked)
              RETURNING proposal
            ),
            ${records
              .map(
                (written, i) =>
                  `r${i} AS (${recordInsertIf("EXISTS (SELECT 1 FROM cancelled)", written, params)})`,
              )
              .join(",\n")}`;
          cancelled =
            "COALESCE((SELECT array_agg(proposal ORDER BY proposal) FROM cancelled), '{}')";
        }

        return {
          sql: `WITH waiting AS (${WAITING_UNDER_A_SLIP}),
                still AS (
                  SELECT COALESCE(array_agg(proposal || ' ' || to_state), '{}') AS waiting_now
                    FROM waiting
                ),
                same AS (
                  SELECT (SELECT waiting_now FROM still) @> $5::text[]
                     AND (SELECT waiting_now FROM still) <@ $5::text[] AS ok
                ),
                revoked AS (
                  UPDATE dsor.delegations
                     SET status = 'revoked', revoked_by = $3, revoked_at = clock_timestamp(),
                         revoked_reason = $4
                   WHERE tenant = $1 AND id = $2 AND status IN ('active', 'suspended')
                     AND delegator = $3 AND (SELECT ok FROM same)
                  RETURNING id
                )${cancelling}
                SELECT (SELECT count(*) FROM revoked)::int AS revoked,
                       (SELECT ok FROM same) AS same,
                       EXISTS (SELECT 1 FROM dsor.delegations
                                WHERE tenant = $1 AND id = $2 AND delegator = $3) AS theirs,
                       EXISTS (SELECT 1 FROM dsor.delegations
                                WHERE tenant = $1 AND id = $2
                                  AND status NOT IN ('active', 'suspended')) AS ended,
                       ${cancelled} AS cancelled`,
          params,
        };
      },
    );
    const row = rows?.[0];

    // The reply was lost, and the first record was found written: the statement committed, and
    // a record is written only beside its move, and a move only beside the revocation.
    if (rows === undefined || row?.revoked === 1) {
      return Object.freeze({
        kind: "revoked",
        cancelled: Object.freeze(
          row === undefined ? waiting.map((w) => w.proposal) : [...row.cancelled],
        ),
      });
    }

    if (row?.theirs !== true) {
      return Object.freeze({ kind: "not_theirs" });
    }

    // Revoked nothing, though the slip is the signer's: it had ended, or what waits changed. Found
    // by a review: asked in the statement, and no longer read off "what waits is the same", so a
    // slip that has ended is told so at once, however often what waits under it changes.
    if (row.ended) {
      return Object.freeze({ kind: "ended" });
    }
  }

  return Object.freeze({ kind: "changed" });
}
