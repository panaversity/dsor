// NEW IN STEP 08: the decision is written down, and the writing is hard to change quietly.
//
// Until now the program decided and answered. Nothing was kept. A month later, asked "who let
// user_123 read INV-1008, and under what authority", the honest answer was: nobody knows. An
// operation that refused and an operation that never ran look identical afterwards.
//
// So every decision becomes a record. Two things make a record worth having, and neither is
// obvious:
//
//   1. It is written by DSoR, from what DSoR decided — never from anything the caller said. The
//      caller supplies the request id and the subject it already authenticated as; it does not
//      supply the time, the sequence, or the hashes.
//   2. It is *linked*. Each record carries the hash of the record before it, so the records form a
//      chain. Editing one record leaves every hash after it disagreeing. That does not make an
//      edit impossible — this log is an array in memory, and step 39 is where a real database and
//      an audit role with no UPDATE privilege make it impossible. It makes an edit **detectable**,
//      which is the part that belongs to the record's shape rather than to the store.
//
// Rule DSOR-AUD-01: DSoR MUST write an append-only audit record for each decision, with the fields
// audit-record.schema.json requires.
// Rule DSOR-SCH-01: every artifact named in Appendix A MUST validate against its JSON Schema
// wherever it crosses an interface or is stored as evidence.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { TENANT } from "./tenant.ts";

// ajv-formats is CommonJS; under nodenext the callable sits on `.default`. Same cast, same reason,
// as in envelopes.ts — `at` is a `date-time`, and without the formats plugin ajv prints
// `unknown format "date-time" ignored` and then accepts `at: "yesterday"`.
const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;

const read = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as object;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/audit-record.schema.json"));

const check = ajv.getSchema("urn:dsor:schema:1.3:audit-record");

if (check === undefined) {
  throw new Error("the audit record schema did not compile");
}

const validate = check;

/** True once the specification's own audit schema has compiled. Read by a test. */
export const AUDIT_SCHEMA_CHECKED: boolean = true;

/** What kind of thing the record is about. The schema's own list; this step writes `decision`. */
export type AuditKind =
  | "decision"
  | "proposal_transition"
  | "classified_read"
  | "control_change"
  | "operational_control"
  | "delegation_change"
  | "reconciliation"
  | "policy_change";

/** One audit record, as audit-record.schema.json describes it. */
export interface AuditRecord {
  readonly record_id: string;
  readonly chain: string;
  readonly sequence: number;
  readonly previous_hash: string;
  readonly record_hash: string;
  readonly at: string;
  readonly tenant: string;
  readonly kind: AuditKind;
  readonly identity: {
    readonly mode: "direct" | "on_behalf_of" | "unattended";
    readonly subject: string;
    readonly actor_chain: readonly string[];
    readonly subject_authority: { readonly source: "token" | "role_source"; readonly as_of: string };
  };
  readonly operation?: string;
  readonly payload_hash?: string;
  readonly authorization?: "ALLOW" | "DENY";
  readonly result: string;
  readonly reason?: string;
  readonly correlation: {
    readonly request_id: string;
    readonly tenant_id?: string;
    readonly principal_id?: string;
  };
}

/**
 * What a caller of `audit` may say about a decision.
 *
 * Read the list for what is *not* here: no time, no sequence, no hash, no chain. Those are the
 * fields that make the record trustworthy, so the caller does not get to set them. `subject` is
 * `string | undefined` on purpose — see `audit`.
 */
export interface DecisionToRecord {
  readonly kind: AuditKind;
  /** Who DSoR authenticated, or `undefined` when nobody logged in. */
  readonly subject: string | undefined;
  readonly requestId: string;
  readonly result: string;
  readonly operation?: string;
  readonly authorization?: "ALLOW" | "DENY";
  readonly payloadHash?: string;
  readonly reason?: string;
}

/** The chain this deployment appends to. One per tenant, which is one, until step 10. */
const CHAIN = `audit:${TENANT}`;

/** What the first record points at, since it has nothing before it. */
const GENESIS = `sha256:${"0".repeat(64)}`;

/**
 * The clock, behind a seam.
 *
 * `now()` reads the real clock. A test may hand it a fixed one so that a record's `at` can be
 * asserted exactly, and so the README's example output does not change every time it is run. The
 * seam exists for the test; the default is real, and no production path calls `setClock`.
 */
const realClock = (): string => new Date().toISOString();

let clock: () => string = realClock;

/** The time, as the schema's `date-time` wants it. */
export function now(): string {
  return clock();
}

/** Point the clock at a fixed time. Tests only. */
export function setClock(fixed: () => string): void {
  clock = fixed;
}

/**
 * Give the real clock back.
 *
 * `realClock` is a name and not a second copy of `new Date().toISOString()`. It was two copies, and
 * that hid a hole: breaking the clock on purpose to check a test would catch it changed only the
 * initial value, and `resetClock` handed the real clock straight back. The test passed and proved
 * nothing. A guard written twice is a guard that can be half-broken.
 */
export function resetClock(): void {
  clock = realClock;
}

const log: AuditRecord[] = [];
let unauthenticated = 0;

/**
 * JSON with the keys in a fixed order, so the same record always hashes to the same thing.
 *
 * Without this the hash would depend on the order the fields happened to be assigned in, and a
 * later step that reorders two lines would make every existing record fail verification. The
 * replacer rebuilds each object with its keys sorted, and `JSON.stringify` then emits them in that
 * order.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key: string, held: unknown) => {
    if (held === null || typeof held !== "object" || Array.isArray(held)) {
      return held;
    }

    const entries = Object.entries(held as Record<string, unknown>);

    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return Object.fromEntries(entries);
  });
}

/** The hash of everything in a record except the hash itself. */
function hashOf(body: Record<string, unknown>): string {
  const without: Record<string, unknown> = { ...body };

  delete without.record_hash;

  return `sha256:${createHash("sha256").update(canonical(without)).digest("hex")}`;
}

/**
 * Writes one record, and returns it — or returns nothing, and says why.
 *
 * Nothing is returned when no principal was authenticated. §29 says an unauthenticated refusal is
 * counted rather than recorded, and the reason is a real attack: a caller with no credentials at
 * all can send a million requests, and a log that records each of them fills the evidence store
 * with the attacker's noise until the records that matter cannot be written. So those are counted.
 *
 * The decision to count rather than record is made **here**, not by the caller. A caller that
 * chose would be a caller that could choose wrong.
 *
 * A record that the schema refuses is a bug in this function, so it throws and the log does not
 * grow. §21.11's rule is the other half, and it lands in the pipeline: if the evidence cannot be
 * written, the command does not run.
 */
export function audit(decision: DecisionToRecord): AuditRecord | undefined {
  if (decision.subject === undefined) {
    unauthenticated += 1;

    return undefined;
  }

  const at = now();
  const sequence = log.length;
  const previous = log[sequence - 1]?.record_hash ?? GENESIS;

  const body: Record<string, unknown> = {
    record_id: `${CHAIN}:${sequence}`,
    chain: CHAIN,
    sequence,
    previous_hash: previous,
    at,
    tenant: TENANT,
    kind: decision.kind,
    identity: {
      // `direct`, with an empty actor chain, because that is what is true today: a person calls
      // and nothing acts on anyone's behalf. Step 42 brings delegation, and with it
      // `on_behalf_of` and a chain with an agent in it. `role_source` and not `token`, because
      // step 06's roles come from a table this program owns, not from a signed token.
      mode: "direct",
      subject: decision.subject,
      actor_chain: [],
      subject_authority: { source: "role_source", as_of: at },
    },
    result: decision.result,
    correlation: {
      request_id: decision.requestId,
      tenant_id: TENANT,
      principal_id: decision.subject,
    },
  };

  // Only the fields that have a value. The schema sets `additionalProperties: false`, so a field
  // is either right or absent; there is no room for a placeholder.
  if (decision.operation !== undefined) {
    body.operation = decision.operation;
  }

  if (decision.authorization !== undefined) {
    body.authorization = decision.authorization;
  }

  if (decision.payloadHash !== undefined) {
    body.payload_hash = decision.payloadHash;
  }

  if (decision.reason !== undefined) {
    body.reason = decision.reason;
  }

  body.record_hash = hashOf(body);

  if (validate(body) !== true) {
    throw new TypeError(
      `this audit record does not match audit-record.schema.json: ${ajv.errorsText(validate.errors)}`,
    );
  }

  // Frozen, and frozen deeply enough to matter: `readonly` is erased before Node runs, so without
  // this a caller who is handed a record can edit it.
  const written = Object.freeze({
    ...body,
    identity: Object.freeze({
      ...(body.identity as Record<string, unknown>),
      actor_chain: Object.freeze([] as string[]),
      subject_authority: Object.freeze({ source: "role_source", as_of: at }),
    }),
    correlation: Object.freeze({ ...(body.correlation as Record<string, unknown>) }),
  }) as AuditRecord;

  log.push(written);

  return written;
}

/** Every record written so far, oldest first. A copy, and frozen, so a reader cannot append. */
export function theLog(): readonly AuditRecord[] {
  return Object.freeze([...log]);
}

/** How many decisions were counted instead of recorded, because nobody had logged in. */
export function countedWithoutARecord(): number {
  return unauthenticated;
}

/** Empties the log and the counter. Tests only; there is no erasing an audit log in DSoR. */
export function forgetTheLog(): void {
  log.length = 0;
  unauthenticated = 0;
}

/** Does this record match the specification's schema? */
export function validateAuditRecord(record: unknown): boolean {
  return validate(record) === true;
}

/**
 * Does this run of records still agree with itself, read from the first one?
 *
 * Exactly two things are checked, and each catches an edit the other cannot:
 *
 *   - `record_hash` matches the record's own contents, so no field can be rewritten. This is the
 *     one that catches an edit to the *last* record, where there is no link after it to break.
 *   - `previous_hash` matches the record before, so no record can be removed, inserted, reordered,
 *     or spliced in from a different history. This is the one that catches a record that is
 *     perfectly valid in itself and simply does not belong here.
 *
 * It started with four checks and two of them were removed, which taught the rule that made the
 * other two trustworthy. There was a check that `sequence` matched the position, and a check that
 * `chain` was this chain. Both were mutated away with all tests still passing — because
 * **`sequence` and `chain` are inside the record, so they are inside the hash.** Changing either
 * one breaks `record_hash` before `verifyChain` ever looks at it.
 *
 * So the rule is: a field of the record needs no check of its own. Only a record's *relationship to
 * its neighbours* does, because that is the one thing the record's own hash cannot cover. Two
 * checks, one for the contents and one for the link, and every one of them is killable by a test.
 * A check no test can kill is not protecting anything — step 07 removed `stagesFor` for the same
 * reason.
 *
 * Two limits, both real:
 *
 *   - A whole chain recomputed from the beginning verifies cleanly. Someone who can rewrite every
 *     record can rewrite every hash. Catching that needs something outside the chain: a store that
 *     refuses an UPDATE (step 39), or a signature. The chain makes a *quiet* edit impossible, not
 *     an editor powerless.
 *   - It reads from sequence zero, so it verifies a whole log and not a page from the middle of one.
 *     Step 10 brings a second tenant and a second chain, and that is when telling one chain from
 *     another starts to be work a test can prove.
 */
export function verifyChain(records: readonly AuditRecord[]): boolean {
  let previous = GENESIS;

  for (const record of records) {
    if (record.previous_hash !== previous) {
      return false;
    }

    if (record.record_hash !== hashOf(record as unknown as Record<string, unknown>)) {
      return false;
    }

    previous = record.record_hash;
  }

  return true;
}
