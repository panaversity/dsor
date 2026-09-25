// NEW IN STEP 04: every answer from call has one outer shape, an envelope.
// DSOR-ERR-01a in specs/dsor/03-execution.md, section 28.

/** What an error tells the caller about trying again. */
export type RetryClass =
  | "safe_same_key"
  | "after_delay"
  | "after_state_refresh"
  | "after_reconciliation"
  | "per_item"
  | "never";

/** One of the 32 codes in the §28 table. */
export type ErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "DELEGATION_REQUIRED"
  | "DELEGATION_EXPIRED"
  | "DELEGATION_REVOKED"
  | "TENANT_MISMATCH"
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "POLICY_DENIED"
  | "SOD_VIOLATION"
  | "LIMIT_EXCEEDED"
  | "AGENT_SUSPENDED"
  | "OPERATION_FROZEN"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_MISMATCH"
  | "APPROVAL_INVALIDATED"
  | "COOLING_OFF_ACTIVE"
  | "CONFLICT"
  | "STALE_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "RESOURCE_HELD"
  | "OUTCOME_UNKNOWN"
  | "FRESHNESS_UNSATISFIABLE"
  | "RATE_LIMITED"
  | "BATCH_PARTIAL"
  | "CONNECTOR_UNAVAILABLE"
  | "TRANSACTION_FAILED"
  | "EVIDENCE_STORE_UNAVAILABLE"
  | "DEPENDENCY_TIMEOUT"
  | "UNSUPPORTED_CAPABILITY"
  | "INTERNAL_ERROR";

/** The ids that tie an answer to one request. This step makes only the request_id. */
export type Correlation = { request_id: string };

/** A refusal, as the caller receives it. */
export type ErrorEnvelope = {
  code: ErrorCode;
  message: string;
  retry: RetryClass;
  correlation: Correlation;
};

/** A query's answer. This shape is the tutorial's decision 3, not the specification's. */
export type Success = { data: unknown; correlation: Correlation };

/** Everything call can return. */
export type Answer = Success | ErrorEnvelope;

// The §28 table, copied from the prose: every code, and the retry class the table gives
// it. The guard cannot watch prose, so a test types the table out again (README,
// decision 2). TypeScript refuses this table if a code is missing from it.
export const RETRY: Readonly<Record<ErrorCode, RetryClass>> = {
  AUTHENTICATION_REQUIRED: "never", // log in again
  AUTHORIZATION_DENIED: "never",
  DELEGATION_REQUIRED: "never",
  DELEGATION_EXPIRED: "never",
  DELEGATION_REVOKED: "never",
  TENANT_MISMATCH: "never",
  RESOURCE_NOT_FOUND: "never",
  VALIDATION_FAILED: "never",
  POLICY_DENIED: "never",
  SOD_VIOLATION: "never",
  LIMIT_EXCEEDED: "after_delay",
  AGENT_SUSPENDED: "never", // a human must lift it
  OPERATION_FROZEN: "never", // a human must lift it
  APPROVAL_REQUIRED: "never", // obtain the approval
  APPROVAL_EXPIRED: "never", // propose again
  APPROVAL_MISMATCH: "never", // propose again
  APPROVAL_INVALIDATED: "after_state_refresh", // propose again
  COOLING_OFF_ACTIVE: "after_delay",
  CONFLICT: "never",
  STALE_STATE: "after_state_refresh",
  IDEMPOTENCY_CONFLICT: "never",
  RESOURCE_HELD: "after_reconciliation",
  OUTCOME_UNKNOWN: "after_reconciliation",
  FRESHNESS_UNSATISFIABLE: "after_delay",
  RATE_LIMITED: "after_delay",
  BATCH_PARTIAL: "per_item",
  CONNECTOR_UNAVAILABLE: "safe_same_key",
  TRANSACTION_FAILED: "safe_same_key",
  EVIDENCE_STORE_UNAVAILABLE: "safe_same_key",
  // Only for a query, or a command that provably did not run (DSOR-ERR-02).
  DEPENDENCY_TIMEOUT: "safe_same_key",
  UNSUPPORTED_CAPABILITY: "never",
  // The table says "never for commands", and nothing about queries. This tutorial
  // chooses never for queries too (README, decision 8).
  INTERNAL_ERROR: "never",
};

/** A refusal, as a handler throws it: a code from the table and a message for people. */
export class Refusal extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// The only message INTERNAL_ERROR carries. A bug's own message can name internal details,
// so it never reaches the caller (README, decision 8).
const UNEXPECTED = "DSoR hit an unexpected error";

/** Turns whatever was thrown into an error envelope. Only a Refusal names its code. */
export function toEnvelope(thrown: unknown, correlation: Correlation): ErrorEnvelope {
  if (thrown instanceof Refusal) {
    // The retry class comes from the table, never from the code that refused.
    const { code, message } = thrown;
    return { code, message, retry: RETRY[code], correlation };
  }
  // Anything else is a bug, a TypeError too: JavaScript throws those for bugs as well as
  // for bad input, so the class cannot tell them apart (README, decision 5).
  return { code: "INTERNAL_ERROR", message: UNEXPECTED, retry: RETRY.INTERNAL_ERROR, correlation };
}
