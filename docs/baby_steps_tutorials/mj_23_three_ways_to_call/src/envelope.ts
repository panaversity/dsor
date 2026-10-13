// Every answer from call has one outer shape, an envelope.
// DSOR-ERR-01a in specs/dsor/03-execution.md, section 28.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Freshness } from "./freshness.ts";
import type { Label } from "./labels.ts";
import type { Redaction } from "./masking.ts";
import type { Semantics } from "./semantics.ts";

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

// An answer also names its caller, once known (step 05's README, decision 9).
/** The ids that tie an answer to one request, and to its caller. */
export type Correlation = { request_id: string; agent_id?: string; principal_id?: string };

/** A refusal, as the caller receives it. */
export type ErrorEnvelope = {
  code: ErrorCode;
  message: string;
  retry: RetryClass;
  // The proposal of a command that the code refused, which ended FAILED (step 22's
  // README, decision 5).
  proposal?: string;
  correlation: Correlation;
};

// Its label, always, and what was withheld, only when something was, with
// the result envelope's names and shapes (step 14's README, decision 4).
/** A query's answer. This shape is step 04's decision 3, not the specification's. */
export type Success = {
  data: unknown;
  classification: Label;
  redactions?: Redaction[];
  // How fresh the data is, from the store that read it (DSOR-FRS-01a; step
  // 15's README, decision 1).
  freshness: Freshness;
  correlation: Correlation;
};

// A command's answer. Its data, its label, what was withheld, and the
// semantics its contract declares (DSOR-EXE-05b). No freshness: a write is not a read.
// And the outcome word, the proposal, and the payload hash, so the answer has the
// specification's shape, result-envelope.schema.json (DSOR-SCH-01; step 22's README, decision 5).
// Step 17's decision 2 waited for the proposal.
/** A command's answer. */
export type CommandSuccess = {
  outcome: "COMMITTED";
  proposal: string;
  payload_hash: string;
  data: unknown;
  classification: Label;
  redactions?: Redaction[];
  semantics: Semantics;
  correlation: Correlation;
};

// NEW IN STEP 23: a command called in propose_only mode. Its proposal waits READY, and no code ran,
// so the answer carries no data: the outcome, the proposal, the request's fingerprint, and the
// semantics its contract declares, as result-envelope.schema.json asks of READY (step 23's README,
// decision 9).
/** A propose_only call's answer. */
export type Prepared = {
  outcome: "READY";
  proposal: string;
  payload_hash: string;
  semantics: Semantics;
  correlation: Correlation;
};

// NEW IN STEP 23: a dry run that every check allowed. A dry run that a check refuses gets the error
// envelope the real call would get, so this answer always says ALLOW (step 23's README, decisions 3
// and 9).
/** A validate_only call's answer. */
export type Validated = { outcome: "VALIDATED"; decision: "ALLOW"; correlation: Correlation };

/** Everything call can return. */
export type Answer = Success | CommandSuccess | Prepared | Validated | ErrorEnvelope;

// The §28 table, typed out from the prose: every code, and the retry class the table
// gives it. The guard cannot watch prose, so a test types the table out again (step 04's
// README, decision 2). TypeScript refuses this table if a code is missing from it.
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
  // chooses never for queries too (step 04's README, decision 8).
  INTERNAL_ERROR: "never",
};

/** A refusal, as a handler throws it: a code from the table and a message for people. */
export class Refusal extends Error {
  readonly code: ErrorCode;
  // How sensitive the message is. A message is text that may hold company
  // data, so it is confidential unless the code that refuses says otherwise (step 14's
  // README, decision 8).
  readonly label: Label;

  constructor(code: ErrorCode, message: string, label: Label = "confidential") {
    super(message);
    this.code = code;
    this.label = label;
  }
}

// The specification's own schema, copied byte for byte (step 04's README, decision 6). strict is
// off for the reason registry.ts gives. The options that change data while checking it
// stay off, as they are by default, so the check can never repair what it checks.
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
const ajv = new Ajv2020({ strict: false });
ajv.addSchema(loadSchema("common.schema.json"));
const passesSchema = ajv.compile(loadSchema("error-envelope.schema.json"));

/** Turns whatever was thrown into an error envelope that passes its schema. */
export function toEnvelope(
  thrown: unknown,
  correlation: Correlation,
  // The proposal that the refusal ended FAILED. Only the checklist gives it, from
  // the claim, never the thrown value: code cannot name a proposal in a refusal of its own. Found
  // by step 22's review: a Refusal that carried a proposal let any code name another company's
  // (step 22's README, decision 5).
  proposal?: string,
): ErrorEnvelope {
  // A thrown value can run code of its own whenever DSoR looks at it, as a Proxy does,
  // and that code can throw. Then it is a bug too, and gets the same envelope. Found by
  // step 08's review, and fixed from step 04 on.
  try {
    // Anything that is not a Refusal is a bug, even a TypeError. Our checks threw TypeError
    // for bad input in step 03, and JavaScript throws it for bugs, so the class cannot tell
    // them apart (step 04's README, decision 5).
    if (!(thrown instanceof Refusal)) return unexpected(correlation);
    // The retry class comes from the table, never from the code that refused.
    const { code, message } = thrown;
    // With the call's proposal, when the checklist names one.
    const named = proposal === undefined ? {} : { proposal };
    const envelope = { code, message, retry: RETRY[code], ...named, correlation };
    // DSOR-SCH-01. An envelope that fails its schema never leaves call. The
    // fixed INTERNAL_ERROR envelope goes out in its place (step 04's README, decision 8).
    return passesSchema(envelope) ? envelope : unexpected(correlation);
  } catch {
    return unexpected(correlation);
  }
}

// The error envelope for a bug. It is built from fixed parts, so it passes the schema,
// and the tests check that it does. Its message is fixed: a bug's own message can name
// internal details, so it never reaches the caller (step 04's README, decision 8).
function unexpected(correlation: Correlation): ErrorEnvelope {
  const message = "DSoR hit an unexpected error";
  return { code: "INTERNAL_ERROR", message, retry: RETRY.INTERNAL_ERROR, correlation };
}
