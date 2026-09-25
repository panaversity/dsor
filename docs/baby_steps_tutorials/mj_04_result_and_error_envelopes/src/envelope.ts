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

// SKELETON for the red tests: the table is empty until the code is written.
export const RETRY: Readonly<Record<ErrorCode, RetryClass>> = {} as Readonly<
  Record<ErrorCode, RetryClass>
>;

/** A refusal, as a handler throws it: a code from the table and a message for people. */
export class Refusal extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
