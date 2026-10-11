// NEW IN STEP 20: the idempotency key, claimed with one INSERT (decision 131).
//
// Networks fail and clients retry. Without this, a retried "pay 2,500.00" is a second payment. The
// caller names each logical request with a key, and DSoR claims the key the first time it sees it,
// keeping the request's fingerprint beside it. The same key and the same request again: the answer
// it was given, and nothing runs. The same key and a different request: refused.
//
// Rule DSOR-IDM-01b: the key MUST be claimed by an atomic insert scoped to (tenant, calling
// principal, operation, key) that stores the payload hash.
// Rule DSOR-IDM-01c: a request whose key is already claimed with the same payload hash MUST return
// the recorded status or result without re-execution.
// Rule DSOR-IDM-01d: a request whose key is already claimed with a different payload hash MUST be
// refused with IDEMPOTENCY_CONFLICT.

import { theDatabase } from "./store.ts";

/** One claim: one company, one caller, one operation, one key. */
export interface Claim {
  readonly tenant: string;
  readonly principal: string;
  readonly operation: string;
  readonly key: string;
}

/** What a request found when it went to claim its key. */
export type Claimed =
  /** It is the one: carry on. */
  | { readonly kind: "claimed" }
  /** The key was used for a different request. */
  | { readonly kind: "another_request" }
  /** The same request was answered before, and this is the answer. */
  | { readonly kind: "answered"; readonly answer: unknown }
  /** The same request is still being carried out. */
  | { readonly kind: "in_flight" };

/** A key: 1 to 128 letters, digits, dots, underscores, colons or dashes. */
export const KEY: RegExp = /^[A-Za-z0-9._:-]{1,128}$/;

/** What a released claim holds: nothing ran, and the same request may take the key back. */
const RELEASED = '{"released": true}';

const WHERE = "tenant = $1 AND principal = $2 AND operation = $3 AND key = $4";

/**
 * Claim a key for one request, or say why not.
 *
 * One INSERT decides. Two requests with the same key that arrive together both reach it, and the
 * primary key lets exactly one in; the other's INSERT does nothing and returns no row. Checking for
 * the key first and inserting it after is the mistake §22 names: both checks pass, and both run.
 */
export async function claimKey(claim: Claim, payloadHash: string): Promise<Claimed> {
  const db = theDatabase(claim.tenant);
  const by = [claim.tenant, claim.principal, claim.operation, claim.key, payloadHash];

  const { rows: inserted } = await db.query(
    `INSERT INTO dsor.idempotency_keys (tenant, principal, operation, key, payload_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant, principal, operation, key) DO NOTHING
     RETURNING key`,
    by,
  );

  if (inserted.length === 1) {
    return Object.freeze({ kind: "claimed" });
  }

  // Taken already. A claim released because nothing ran is taken back by the same request, in one
  // UPDATE, so that of two retries only one gets it.
  const { rows: retaken } = await db.query(
    `UPDATE dsor.idempotency_keys SET answer = NULL, claimed_at = now()
      WHERE ${WHERE} AND payload_hash = $5 AND answer = '${RELEASED}'
      RETURNING key`,
    by,
  );

  if (retaken.length === 1) {
    return Object.freeze({ kind: "claimed" });
  }

  const { rows } = await db.query<{ payload_hash: string; answer: string | null }>(
    `SELECT payload_hash, answer FROM dsor.idempotency_keys WHERE ${WHERE}`,
    by.slice(0, 4),
  );
  const found = rows[0];

  // There is no deleting a claim, so a key that was taken a moment ago and is gone now means the
  // store cannot be trusted, and the caller is told so.
  if (found === undefined) {
    throw new Error(`the claim on ${claim.key} was there, and then it was not`);
  }

  if (found.payload_hash !== payloadHash) {
    return Object.freeze({ kind: "another_request" });
  }

  if (found.answer === null || found.answer === RELEASED) {
    return Object.freeze({ kind: "in_flight" });
  }

  return Object.freeze({ kind: "answered" as const, answer: JSON.parse(found.answer) as unknown });
}

/**
 * Write a claimed request's answer on its claim: kept, to be given to the same request again, or
 * released, when nothing ran and the answer itself invites the same key again.
 */
export async function settleKey(claim: Claim, answer: unknown, releases: boolean): Promise<void> {
  await theDatabase(claim.tenant).query(
    `UPDATE dsor.idempotency_keys SET answer = $5 WHERE ${WHERE} AND answer IS NULL`,
    [
      claim.tenant,
      claim.principal,
      claim.operation,
      claim.key,
      releases ? RELEASED : JSON.stringify(answer),
    ],
  );
}
