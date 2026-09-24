// NEW IN STEP 04: every answer gets the same outer shape.
//
// Until now a refusal was a thrown TypeError with a sentence in it. A caller could read
// the sentence and could not act on it: nothing told them whether trying again might
// work. An *envelope* fixes that. Every error carries a code from a closed list and a
// retry class saying whether a retry could ever help.
//
// Rule DSOR-ERR-01a: every error MUST validate against error-envelope.schema.json,
// carrying a code from that table or a documented extension code, a retry class, and
// correlation identifiers.
// Rule DSOR-SCH-01: every artifact named in Appendix A MUST validate against its JSON
// Schema wherever it crosses an interface or is stored as evidence.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

// ajv-formats is CommonJS. Under nodenext the callable sits on `.default`, and TypeScript
// needs telling: Node runs the plain import fine, but `tsc` reports "This expression is
// not callable" at the call below. The cast answers that, and nothing else.
const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;

/** A retry class: whether trying the same thing again could ever help. */
export type Retry =
  | "safe_same_key"
  | "after_delay"
  | "after_state_refresh"
  | "after_reconciliation"
  | "per_item"
  | "never";

/**
 * Every error code, with its retry class, copied from the table in §28.
 *
 * This table is the point of the step. The schema checks that `retry` holds one of the
 * six allowed words; it does not check that it holds the RIGHT one. A `CONFLICT` with
 * retry `safe_same_key` validates cleanly, and an agent reading it would try to issue
 * the same invoice again for ever. So the retry class is looked up here, from the code,
 * and never taken from whoever is building the envelope.
 *
 * The specification's own notes on four rows are worth keeping in mind and are not
 * expressible here: AGENT_SUSPENDED and OPERATION_FROZEN need a human to lift them;
 * INTERNAL_ERROR is "never for commands"; and DEPENDENCY_TIMEOUT is retry-safe for
 * queries, and for commands only when the side effect provably did not occur
 * (DSOR-ERR-02). A table cannot say "provably". Step 37 is where that one bites.
 */
export const CODE_RETRY: Readonly<Record<string, Retry>> = Object.freeze({
  AUTHENTICATION_REQUIRED: "never",
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
  AGENT_SUSPENDED: "never",
  OPERATION_FROZEN: "never",
  APPROVAL_REQUIRED: "never",
  APPROVAL_EXPIRED: "never",
  APPROVAL_MISMATCH: "never",
  APPROVAL_INVALIDATED: "after_state_refresh",
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
  DEPENDENCY_TIMEOUT: "safe_same_key",
  UNSUPPORTED_CAPABILITY: "never",
  INTERNAL_ERROR: "never",
});

/** What a caller is told when something is refused. */
export interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly retry: Retry;
  readonly correlation: { readonly request_id: string };
}

/** What a caller is told when a command succeeded. */
export interface ResultEnvelope {
  readonly outcome: "COMMITTED";
  readonly proposal: string;
  readonly payload_hash: string;
  readonly semantics: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly correlation: { readonly request_id: string };
}

const read = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as object;

// Both envelope schemas are copied byte for byte from packages/spec/schemas/, beside
// common.schema.json which step 03 already brought in and which both of them reference.
//
// ajv-formats is new here. Without it ajv prints `unknown format "date-time" ignored`
// and then accepts `expires_at: "tomorrow"` — a validator that skips a check while
// warning about it in words nobody explains.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/error-envelope.schema.json"));
ajv.addSchema(read("./schemas/result-envelope.schema.json"));

const compiled = {
  error: ajv.getSchema("urn:dsor:schema:1.3:error-envelope"),
  result: ajv.getSchema("urn:dsor:schema:1.3:result-envelope"),
};

if (compiled.error === undefined || compiled.result === undefined) {
  throw new Error("an envelope schema did not compile");
}

const checks = { error: compiled.error, result: compiled.result };

/** Does this envelope match the specification's schema? */
export function validateEnvelope(kind: "error" | "result", envelope: unknown): boolean {
  return checks[kind](envelope) === true;
}

/** Every code the normative schema allows, read out of the schema itself. */
export function errorCodes(): string[] {
  const schema = read("./schemas/error-envelope.schema.json") as {
    properties: { code: { anyOf: { enum?: string[] }[] } };
  };
  const withEnum = schema.properties.code.anyOf.find((branch) => branch.enum !== undefined);

  return withEnum?.enum ?? [];
}

// Request ids come from a counter rather than a random id, so a test can say exactly
// which one it expects. A real deployment would use something unguessable.
let requestCount = 0;

/** The next request id. */
export function nextRequestId(): string {
  requestCount += 1;

  return `req_${requestCount}`;
}

/** Starts the counter again. For tests, so one test's ids do not depend on another's. */
export function resetRequestIds(): void {
  requestCount = 0;
}

let proposalCount = 0;

/**
 * Builds a refusal.
 *
 * The caller says what went wrong and in which words. It does not get to say whether a
 * retry is safe — that comes from the code. The envelope is checked against the schema
 * before it is handed back, so a refusal that would not validate never leaves this file.
 */
export function refusal(code: string, message: string, requestId?: string): ErrorEnvelope {
  const retry = CODE_RETRY[code];

  if (retry === undefined) {
    throw new TypeError(`${code} is not an error code from §28`);
  }

  const envelope: ErrorEnvelope = Object.freeze({
    code,
    message,
    retry,
    correlation: Object.freeze({ request_id: requestId ?? nextRequestId() }),
  });

  if (!validateEnvelope("error", envelope)) {
    throw new TypeError(`built an error envelope that does not validate: ${message}`);
  }

  return envelope;
}

/**
 * Builds the answer to a command that succeeded.
 *
 * `outcome: "COMMITTED"` is the only honest value for "the change happened", and the
 * schema then requires three companions. Two of them are placeholders this step is open
 * about:
 *
 * - `proposal` is an address, nothing more. The proposal *record*, with states and
 *   approvals, arrives in step 22.
 * - `payload_hash` is a fingerprint of the arguments, so the same request hashes the
 *   same. It is sha256 over `JSON.stringify`, which depends on key order; *canonical*
 *   JSON, where key order is settled, arrives in step 29.
 *
 * `semantics` is not a placeholder: it is copied from the operation's own contract.
 */
export function success(answer: {
  data: Readonly<Record<string, unknown>>;
  semantics: string;
  payload: Readonly<Record<string, unknown>>;
  requestId?: string;
}): ResultEnvelope {
  proposalCount += 1;

  const id = String(proposalCount).padStart(4, "0");
  const envelope: ResultEnvelope = Object.freeze({
    outcome: "COMMITTED" as const,
    proposal: `dsor://org_456/proposal/prop_${id}`,
    payload_hash: `sha256:${createHash("sha256").update(JSON.stringify(answer.payload)).digest("hex")}`,
    semantics: answer.semantics,
    data: answer.data,
    correlation: Object.freeze({ request_id: answer.requestId ?? nextRequestId() }),
  });

  if (!validateEnvelope("result", envelope)) {
    throw new TypeError("built a result envelope that does not validate");
  }

  return envelope;
}

/** Starts the proposal counter again. For tests. */
export function resetProposalIds(): void {
  proposalCount = 0;
}
