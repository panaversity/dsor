// The HTTP status of each answer. The body is always call()'s answer, unchanged;
//   the status is one number in front of it, from one table. The table follows each code's retry
//   class, so a caller's tools never repeat what DSoR says not to (step 42's README, claim C6,
//   decisions D4 and A3).
import type { Answer, ErrorCode } from "./envelope.ts";

// The statuses that common HTTP retry libraries send again by themselves. Only a code whose retry
//   class is safe_same_key or after_delay gets one, with one exception below (decision D4).
export const REPEATED: readonly number[] = [408, 413, 429, 500, 502, 503, 504];

/** One status for each code of §28. */
export const STATUS: Readonly<Record<ErrorCode, number>> = {
  AUTHENTICATION_REQUIRED: 401,
  AUTHORIZATION_DENIED: 403,
  DELEGATION_REQUIRED: 403,
  DELEGATION_EXPIRED: 403,
  DELEGATION_REVOKED: 403,
  TENANT_MISMATCH: 403,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  POLICY_DENIED: 403,
  SOD_VIOLATION: 403,
  LIMIT_EXCEEDED: 429,
  AGENT_SUSPENDED: 403,
  OPERATION_FROZEN: 403,
  APPROVAL_REQUIRED: 403,
  APPROVAL_EXPIRED: 409,
  APPROVAL_MISMATCH: 409,
  APPROVAL_INVALIDATED: 409,
  COOLING_OFF_ACTIVE: 429,
  CONFLICT: 409,
  STALE_STATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  // Not a status a library repeats: a retry waits for reconciliation (decision D4).
  RESOURCE_HELD: 409,
  OUTCOME_UNKNOWN: 409,
  FRESHNESS_UNSATISFIABLE: 503,
  RATE_LIMITED: 429,
  // Never made: a run is all or nothing (step 41).
  BATCH_PARTIAL: 409,
  CONNECTOR_UNAVAILABLE: 503,
  TRANSACTION_FAILED: 503,
  EVIDENCE_STORE_UNAVAILABLE: 503,
  DEPENDENCY_TIMEOUT: 504,
  // An unknown route lands here (decision A2).
  UNSUPPORTED_CAPABILITY: 404,
  // The one exception to the rule: 500 is what every tool reads as a server fault, and the body
  //   still says retry: never (decision A3, Claude Code's).
  INTERNAL_ERROR: 500,
};

/** The status of an answer: its code's for an error, 202 for one that waits, 200 for the rest. */
export function statusOf(answer: Answer): number {
  if ("code" in answer) return STATUS[answer.code];
  // Waiting is a result, not an error (§28).
  if (
    "outcome" in answer &&
    (answer.outcome === "READY" || answer.outcome === "PENDING_APPROVAL")
  ) {
    return 202;
  }
  return 200;
}
