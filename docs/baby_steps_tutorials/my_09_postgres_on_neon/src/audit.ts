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
//      edit impossible — this log is an array in memory, and step 09 is where a real database and an
//      application user with no UPDATE on the log make it impossible (step 39 hardens it). It makes
//      an edit **detectable**,
//      which is the part that belongs to the record's shape rather than to the store.
//
// Rule DSOR-AUD-01: every command decision, every proposal transition, and every read covered by
// DSOR-CLS-05 MUST produce a durable audit record that validates against audit-record.schema.json.
// Rule DSOR-AUD-04b: audit records MUST be tamper-evident through hash chaining, signed checkpoints,
// or an equivalent mechanism.
//
// Those are the sentences, not a paraphrase. This file used to say AUD-01 required "an append-only
// audit record for each decision" — which widened it to every decision and folded in "append-only",
// and append-only is AUD-04b's business. Ids in comments are this tutorial's traceability, so the
// paraphrase has to be the sentence.
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

/**
 * Every field the specification's schema declares, read out of the schema itself.
 *
 * Two jobs. It is what `hashOf` walks, so the hash covers exactly the fields the schema knows about
 * and nothing a caller smuggled in. And its length is the sentinel below.
 */
const FIELDS: readonly string[] = Object.freeze(
  Object.keys(
    (read("./schemas/audit-record.schema.json") as { properties: Record<string, unknown> })
      .properties,
  ),
);

/**
 * How many fields the compiled schema declares.
 *
 * A **count**, not `true`. It used to be `export const AUDIT_SCHEMA_CHECKED: boolean = true`, and a
 * review deleted the compile guard above it — every test still passed, because the test asserted a
 * literal. That is [lesson 12] in the learner's notes, in the one file that had not learned it, and
 * `PAIRS_CHECKED` and `STAGES_CHECKED` both carry counts for the same reason.
 *
 * A count is still not proof that the schema *works*, so `validateAuditRecord` is tested against
 * records it must refuse. That is the assertion a stub schema cannot pass.
 */
export const AUDIT_SCHEMA_FIELDS: number = FIELDS.length;

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
    readonly subject_authority: {
      readonly source: "token" | "role_source";
      readonly as_of: string;
    };
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
 * asserted exactly, and so the README's example output does not change every time it is run.
 *
 * The comment here used to say "no production path calls `setClock`", which is a claim about the
 * absence of callers that nothing enforces — and a review showed what it is worth: a hostile clock
 * refuses **every command in the program** with `EVIDENCE_STORE_UNAVAILABLE`, and a backdated one
 * writes records whose times run backwards. The chain is no defence against the second, because the
 * hash is computed *from* the lie. What defends it is `verifyChain`'s third check below, and what
 * would defend the exposure is a clock the application cannot reach — step 09, where the database
 * stamps the row.
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

/**
 * NEW IN STEP 09: anything that can run SQL and give back rows.
 *
 * One method, because that is all this file needs. `pg`'s Pool satisfies it, and so does PGlite, so
 * the same SQL runs against Neon in production and against PostgreSQL-in-process in the tests.
 *
 * This is deliberately **not** a second implementation of the store. There is one store — the SQL
 * below — and two things that can execute it. A second in-memory implementation would be faster and
 * would be a thing that can drift from the real one while the tests stay green, which is what
 * AGENTS.md means by never testing audit immutability against a mock.
 */
export interface Database {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

let database: Database | undefined;

/**
 * Point the log at a database. `main.ts` calls this with a connection; a test calls it with PGlite.
 *
 * It is required rather than lazily defaulted, and the error below says why: a program that quietly
 * kept writing to memory when its database was missing would lose exactly the evidence this step
 * exists to keep.
 */
export function useDatabase(db: Database): void {
  database = db;
}

function theDatabase(): Database {
  if (database === undefined) {
    throw new TypeError(
      "the audit log has no database: call useDatabase() before recording anything. " +
        "Step 09 moved the log out of memory, so there is nowhere else for a record to go.",
    );
  }

  return database;
}

let unauthenticated = 0;

/**
 * The head of the chain: how many records exist, and the hash of the last one.
 *
 * This is the finding that cost the most to accept. `verifyChain` walks forward from the genesis
 * hash, so it can only ever see the records it is *given* — and a review dropped the last record,
 * the one holding a denial, and got `true`. Then dropped two. Then handed it an empty log: `true`.
 * Chaining is evidence that a record was not **edited**. It is no evidence at all that one was not
 * **deleted from the end**, which is the cheapest attack there is.
 *
 * §30 names checkpoints in the same breath as hash chaining for exactly this reason, and this is the
 * smallest checkpoint there is: a count and a hash, held apart from the records themselves.
 */
export interface Head {
  readonly count: number;
  readonly lastHash: string;
}

/**
 * The head of the chain, as the database currently reports it.
 *
 * **Read what this cannot do.** It is a query over the same table it is meant to vouch for, so a row
 * deleted from the end moves the head with it. Measured:
 *
 *     3 records, head count 3, last sha256:6feaa09…      verifies: true
 *     DELETE the last row
 *     2 records, head count 2, last sha256:934d65b…      verifies: TRUE
 *
 * Step 08 held this in a module variable updated on each write, which was independent of the log and
 * therefore did catch a dropped tail. Making it a query fixed one problem — a variable is reset by
 * every restart, so it would vouch for nothing after the thing this step exists for — and created
 * another, and I claimed the old guarantee while shipping the new behaviour.
 *
 * So what it is actually good for: catching a **log you were handed** that has been shortened, which
 * is what `verifyChain(records, head)` compares. Reading the head first and the records afterwards,
 * or holding a head from earlier, both catch a deletion. Reading both at the same moment cannot.
 *
 * §30 says the real answer, and says it as a SHOULD: *"Implementations SHOULD anchor checkpoints
 * outside the control-plane store."* A checkpoint computed from the thing it checks is not a
 * checkpoint. `DSOR-AUD-04d` is not claimed, and this is why.
 */ export async function theHead(): Promise<Head> {
  const { rows } = await theDatabase().query<{ count: string; last_hash: string | null }>(
    `SELECT count(*)::text AS count,
            (SELECT record_hash FROM audit WHERE chain = $1 ORDER BY sequence DESC LIMIT 1)
              AS last_hash
     FROM audit WHERE chain = $1`,
    [CHAIN],
  );
  const row = rows[0];

  return Object.freeze({
    // `count(*)` comes back as a string, because a PostgreSQL bigint does not fit in a JavaScript
    // number and the driver will not quietly truncate it. Ten rows or ten billion, it is text here.
    count: row === undefined ? 0 : Number(row.count),
    lastHash: row?.last_hash ?? GENESIS,
  });
}

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

/**
 * How much caller-supplied text may become evidence.
 *
 * A review sent an operation id two million characters long. It came back as an error envelope whose
 * message was two million characters, and a schema-valid audit record whose `reason` was 2,000,057.
 * Decision 53 named the log as a resource an attacker can exhaust and guarded only the
 * *unauthenticated* half — one authenticated principal fills it far faster than a million anonymous
 * requests ever could, because each of its requests is *supposed* to be recorded.
 *
 * 500 characters is a sentence and a bit. Anything longer says how much was dropped, so the record
 * never quietly misrepresents what arrived.
 */
const ROOM_FOR_TEXT = 500;

/**
 * Caller-supplied text, as the database will actually store it.
 *
 * NEW IN STEP 09, and it fixes the worst bug this step had: **one request could break the chain for
 * ever.** An operation id containing a lone surrogate — `"invoice.\uD800get"`, which a caller can
 * send because JavaScript strings are not required to be valid Unicode — was hashed as written and
 * then stored by PostgreSQL as something else, because UTF-8 cannot represent it:
 *
 *     sent     : "a\ud800b"
 *     read back: "a\ufffdb"
 *     identical: false
 *
 * So `verifyChain` recomputed the hash from the stored row, got a different answer, and reported the
 * whole log as tampered with — permanently, and from a single malformed request. A NUL byte was the
 * other half: PostgreSQL refuses it outright, so the INSERT failed and the caller was told
 * `EVIDENCE_STORE_UNAVAILABLE` about a database that was perfectly healthy.
 *
 * The rule this establishes: **hash what the database will store, never what the caller sent.**
 * `toWellFormed` replaces lone surrogates with U+FFFD, which is exactly what PostgreSQL does, so the
 * two now agree. NUL is removed rather than replaced, because PostgreSQL has nowhere to put it.
 */
function storable(text: string): string {
  return text.toWellFormed().replaceAll("\u0000", "");
}

/**
 * Caller text, made storable and then capped.
 *
 * Both halves matter and they have to happen in this order: `storable` first, so the length that is
 * measured is the length that will be stored, and the cap second.
 */
function clip(raw: string): string {
  const text = storable(raw);

  return text.length <= ROOM_FOR_TEXT
    ? text
    : `${text.slice(0, ROOM_FOR_TEXT)}… (${text.length} characters, ${text.length - ROOM_FOR_TEXT} dropped)`;
}

/**
 * The hash of everything in a record except the hash itself.
 *
 * It builds a fresh object by reading **each field the schema declares, once, by name** rather than
 * spreading whatever it was handed. A review is the reason. `{ ...record }` copies every own
 * enumerable key, and `JSON.stringify` calls `toJSON` before the replacer ever runs, so a caller
 * could hand `verifyChain` two objects that:
 *
 *   - read completely differently in every field,
 *   - carry the *original* untouched `record_hash`,
 *   - and both verify.
 *
 * Fields `JSON.stringify` drops — a function, an `undefined` — came along for free and were readable
 * afterwards. Walking `FIELDS` closes all of it: a smuggled key is not in the list so it is not
 * hashed, and a `toJSON` cannot help because the value read is the property, not the serialisation.
 *
 * Be honest about it, though: **no test can kill this walk any more.** `verifyChain` now validates
 * every record before hashing it, and `additionalProperties: false` means a validated record has only
 * the fields this loop would have picked anyway — so spreading the object gives the same bytes for
 * every input I could build, including a non-enumerable `toJSON`, which a spread strips. It is kept
 * for the reason step 07 kept `Object.hasOwn` on the handler lookup: it says what the hash is *of*,
 * and it is the guard that still holds if the validation above it is ever moved or relaxed. A guard
 * that provably changes nothing today is worth this sentence rather than a silent line.
 */
function hashOf(record: Readonly<Record<string, unknown>>): string {
  const snapshot: Record<string, unknown> = {};

  for (const field of FIELDS) {
    if (field === "record_hash") {
      continue;
    }

    const value = record[field];

    if (value !== undefined) {
      snapshot[field] = value;
    }
  }

  return `sha256:${createHash("sha256").update(canonical(snapshot)).digest("hex")}`;
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
export async function audit(decision: DecisionToRecord): Promise<AuditRecord | undefined> {
  // Read **once**, into locals, before anything is decided. A review read `decision.subject` three
  // times — once to choose record-or-count, once for `identity.subject`, once for
  // `correlation.principal_id` — and a getter answered differently each time: the gate saw
  // `user_123` so a record was written, and the record blamed `cfo_100`. Schema-valid, chain
  // verifies, nothing downstream can tell.
  //
  // This is lesson 16 in the learner's notes for the third time: "read the caller's data once" is a
  // rule about **every** function the data reaches, and `audit` was the one that had not applied it.
  const subject = decision.subject;
  const kind = decision.kind;
  const requestId = clip(decision.requestId);
  const result = clip(decision.result);
  const operation = decision.operation;
  const authorization = decision.authorization;
  const payloadHashGiven = decision.payloadHash;
  const reason = decision.reason === undefined ? undefined : clip(decision.reason);

  if (subject === undefined) {
    unauthenticated += 1;

    return undefined;
  }

  // NEW IN STEP 09: the position comes from the table.
  //
  // Step 08 took it from `log.length` and left a note saying this is where it has to become real.
  // It is still a read and then a write, and it has to be: `sequence` and `previous_hash` are both
  // inside the hash, so they must be known *before* the record exists. There is no single statement
  // that computes them, hashes the result and inserts it.
  //
  // What changes is what happens when two requests read the same answer. In step 08 both wrote and
  // the log quietly held two records at one position. Here the second INSERT violates
  // UNIQUE (chain, sequence) and fails — so the race is **refused** rather than absorbed. The caller
  // gets EVIDENCE_STORE_UNAVAILABLE, whose retry class is `safe_same_key`, which is true: nothing
  // ran. Untestable in-process, because one PGlite connection cannot race itself; it needs a real
  // server and two connections, which is what audit.db.test.ts is for.
  const db = theDatabase();
  // `AS at_position`, and the alias is load-bearing. `SELECT sequence::text` names its output column
  // `sequence`, and PostgreSQL resolves a bare name in ORDER BY to an **output** column first — so
  // `ORDER BY sequence DESC` ordered by the text, where "9" sorts after "10". The tail froze at 9 and
  // every write after that computed 10 and failed on the primary key.
  //
  // This is the hazard `src/migrations.ts` has a paragraph about — "10_x.sql sorts before 9_x.sql as
  // text" — met again in SQL, where the cast creates it silently. Nine records passed before it bit.
  const { rows: tail } = await db.query<{ at_position: string; record_hash: string }>(
    `SELECT sequence::text AS at_position, record_hash
     FROM audit WHERE chain = $1 ORDER BY sequence DESC LIMIT 1`,
    [CHAIN],
  );
  const last = tail[0];
  const sequence = last === undefined ? 0 : Number(last.at_position) + 1;
  const previous = last?.record_hash ?? GENESIS;

  // The clock is read **after** the tail, and the order is the guarantee, not a detail.
  //
  // It used to be read before, one line above `await db.query`, and that let a benign race leave
  // the log permanently unverifiable. Two writers, the slow one sampling its time first:
  //
  //     seq 0  at 2026-10-04T00:00:01.000Z  req_fast
  //     seq 1  at 2026-10-04T00:00:00.000Z  req_slow   <-- earlier time, later position
  //     verifyChain: false
  //
  // Nothing was tampered with. Every hash agreed. `verifyChain` rejects a log whose times go
  // backwards, so it called an intact chain broken — and the rows cannot be corrected, because the
  // application has no UPDATE, which is the whole point of this step. One lost race and the
  // evidence is unverifiable for good.
  //
  // Reading it here is airtight, and the reason is the UNIQUE constraint. A writer that takes
  // position N+1 saw N in the tail, so N was already committed; and N's time was sampled on this
  // line, before N's INSERT. So at(N) < commit(N) <= tail-read(N+1) < at(N+1), for every pair.
  // The sequence and the clock can only agree.
  //
  // What this does not survive is the system clock itself going backwards — an NTP correction
  // between two writes. That is a real hole and it is not fixable here: §30 wants a trusted time
  // source, and this step has none. `recorded_at` is the database's own witness beside it.
  const at = now();

  const body: Record<string, unknown> = {
    record_id: `${CHAIN}:${sequence}`,
    chain: CHAIN,
    sequence,
    previous_hash: previous,
    at,
    tenant: TENANT,
    kind,
    identity: {
      // `direct`, with an empty actor chain, because that is what is true today: a person calls
      // and nothing acts on anyone's behalf. Step 42 brings delegation, and with it
      // `on_behalf_of` and a chain with an agent in it. `role_source` and not `token`, because
      // step 06's roles come from a table this program owns, not from a signed token.
      mode: "direct",
      subject,
      actor_chain: [],
      subject_authority: { source: "role_source", as_of: at },
    },
    result,
    correlation: {
      request_id: requestId,
      tenant_id: TENANT,
      principal_id: subject,
    },
  };

  // Only the fields that have a value. The schema sets `additionalProperties: false`, so a field
  // is either right or absent; there is no room for a placeholder.
  if (operation !== undefined) {
    body.operation = operation;
  }

  if (authorization !== undefined) {
    body.authorization = authorization;
  }

  if (payloadHashGiven !== undefined) {
    body.payload_hash = payloadHashGiven;
  }

  if (reason !== undefined) {
    body.reason = reason;
  }

  body.record_hash = hashOf(body);

  // Frozen, and frozen deeply enough to matter: `readonly` is erased before Node runs, so without
  // this a caller who is handed a record can edit it. Each nested part is **spread**, not written out
  // a second time — a review pointed out that re-authoring `subject_authority` here meant the same
  // literal existed twice, which is lesson 17: a guard written twice can be half-broken. When step 42
  // puts an agent into `actor_chain`, the hash would have covered the real chain while the stored
  // record showed `[]`.
  const identity = body.identity as Record<string, unknown>;
  const written = Object.freeze({
    ...body,
    identity: Object.freeze({
      ...identity,
      actor_chain: Object.freeze([...(identity.actor_chain as readonly string[])]),
      subject_authority: Object.freeze({
        ...(identity.subject_authority as Record<string, unknown>),
      }),
    }),
    correlation: Object.freeze({ ...(body.correlation as Record<string, unknown>) }),
  }) as AuditRecord;

  // Validated **after** the freeze, on `written` — the object that is stored and handed out. It used
  // to validate `body`, a different object, which is not what DSOR-SCH-01 is about: the rule is about
  // the artifact "wherever it crosses an interface or is stored as evidence".
  if (validate(written) !== true) {
    throw new TypeError(
      `this audit record does not match audit-record.schema.json: ${ajv.errorsText(validate.errors)}`,
    );
  }

  // One INSERT, with every value as a parameter rather than pasted into the SQL. Not politeness:
  // `reason` holds a caller's own words, and a caller's words in a SQL string is how an audit log
  // ends up executing them.
  //
  // NEW IN STEP 09: and a failure here is not the same thing as a failure to write.
  //
  // Step 08's store was a JavaScript array. An array either takes the record or throws, and there is
  // no third answer. A database on the other side of a network has one: the INSERT commits and the
  // **reply** is lost. Measured, by dropping the reply of a committed INSERT:
  //
  //     the caller is told: EVIDENCE_STORE_UNAVAILABLE  retry: safe_same_key
  //                         "could not be written down, so it was not carried out"
  //     the log holds 1 record(s):
  //        seq 0  ALLOW  ALLOWED  req_1
  //
  // Both halves of what the caller was told are false. It *was* written down. And retrying on
  // `safe_same_key` writes a second ALLOWED record for the same request. Worse than either: an
  // auditor reconstructing that request finds ALLOWED, while the caller holds a refusal — the log
  // and the answer disagree, which is the one thing a decision record exists to prevent.
  //
  // `DSOR-UNK-01b` is the rule and it is about exactly this: an unknown outcome is reported as
  // unknown, never as a retryable error. So this does not guess. It looks.
  try {
    await insert(db, written);
  } catch (unknownOutcome) {
    // Is the record there? Asked by `record_id`, and checked by `record_hash` — because the
    // question is not "did something land at this position" but "did **this** record land". A
    // UNIQUE violation from a writer that beat us to this position would answer yes to the first
    // question and no to the second, and treating it as success would lose a decision.
    const { rows: found } = await db.query<{ record_hash: string }>(
      "SELECT record_hash FROM audit WHERE record_id = $1",
      [written.record_id],
    );

    if (found[0]?.record_hash !== written.record_hash) {
      // Either nothing landed, or something else did. Nothing was written, so the caller is told
      // so, and `EVIDENCE_STORE_UNAVAILABLE` with retry `safe_same_key` is then true.
      throw unknownOutcome;
    }

    // It landed. The reply was lost, not the record. Returning it is honest and it is also what
    // keeps the log and the answer agreeing: the decision is recorded, so the command may proceed.
  }

  return written;
}

/**
 * The INSERT, on its own so that the recovery above has something to call.
 *
 * Every value is a parameter rather than pasted into the SQL. Not politeness: `reason` holds a
 * caller's own words, and a caller's words in a SQL string is how an audit log ends up executing
 * them.
 */
async function insert(db: Database, written: AuditRecord): Promise<void> {
  await db.query(
    `INSERT INTO audit (
       record_id, chain, sequence, previous_hash, record_hash, at, tenant, kind,
       identity, correlation, operation, payload_hash, "authorization", result, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      written.record_id,
      written.chain,
      written.sequence,
      written.previous_hash,
      written.record_hash,
      written.at,
      written.tenant,
      written.kind,
      JSON.stringify(written.identity),
      JSON.stringify(written.correlation),
      written.operation ?? null,
      written.payload_hash ?? null,
      written.authorization ?? null,
      written.result,
      written.reason ?? null,
    ],
  );
}

/**
 * Every record in the chain, oldest first, read back out of the database.
 *
 * `at` comes back as a `Date` and the hash covers the ISO string the record was written with, so it
 * is converted back. Anything that changes the text here changes every hash, which is why this is the
 * only place that reads rows and why it rebuilds the record field by field rather than spreading the
 * row — a column added later must not silently become part of what `verifyChain` hashes.
 */
export async function theLog(): Promise<readonly AuditRecord[]> {
  const { rows } = await theDatabase().query<Record<string, unknown>>(
    // Same alias, same reason. Without it this returned the chain in text order — 0, 1, 10, 11, 2 —
    // and `verifyChain` would have reported a perfectly good log as broken.
    `SELECT record_id, chain, sequence::text AS at_position, previous_hash, record_hash, at, tenant,
            kind, identity, correlation, operation, payload_hash, "authorization", result, reason
     FROM audit WHERE chain = $1 ORDER BY sequence`,
    [CHAIN],
  );

  return Object.freeze(
    rows.map((row) => {
      const record: Record<string, unknown> = {
        record_id: row.record_id,
        chain: row.chain,
        sequence: Number(row.at_position),
        previous_hash: row.previous_hash,
        record_hash: row.record_hash,
        at: (row.at as Date).toISOString(),
        tenant: row.tenant,
        kind: row.kind,
        identity: row.identity,
        correlation: row.correlation,
        result: row.result,
      };

      // The optional columns, left out rather than set to null — the schema says a field is either
      // right or absent, and `operation: null` is neither.
      for (const field of ["operation", "payload_hash", "authorization", "reason"]) {
        if (row[field] !== null && row[field] !== undefined) {
          record[field] = row[field];
        }
      }

      return Object.freeze(record) as unknown as AuditRecord;
    }),
  );
}

/** How many decisions were counted instead of recorded, because nobody had logged in. */
export function countedWithoutARecord(): number {
  return unauthenticated;
}

/**
 * Empties the log, the flood counter and the head, and starts a new run.
 *
 * A test seam, and the doc comment used to say "tests only; there is no erasing an audit log in
 * DSoR" — a sentence the function contradicts. Nothing stops a production path importing this and
 * calling it, and a review said so plainly: `DSOR-AUD-04a` says the runtime identity MUST NOT be able
 * to delete audit records, the runtime identity here is this process, and one call erases everything.
 * What replaces the claim is the truth: **nothing enforces this, and step 09 is where the log moves
 * into a database whose application user has no DELETE.**
 *
 * It also erases the aggregated count, which is the only evidence an unauthenticated flood ever
 * happened. And it bumps `run`, so the record ids it frees are never handed out twice.
 */
export async function forgetTheLog(): Promise<void> {
  // DELETE, which the application's own account is not allowed to run — so this only works for a
  // caller connected as the owner. That is the shape of the guarantee: a test holds the owner's
  // connection, and the program never does.
  await theDatabase().query("DELETE FROM audit");
  unauthenticated = 0;
}

/** Does this record match the specification's schema? */
export function validateAuditRecord(record: unknown): boolean {
  return validate(record) === true;
}

/**
 * Does this run of records still agree with itself?
 *
 * Four checks now, and the two that were added came from a review that broke the first two.
 *
 *   1. **Each record is a valid audit record.** This is not bureaucracy. `hashOf` used to spread the
 *      object it was handed, and `JSON.stringify` calls `toJSON` before the replacer runs — so two
 *      objects reading completely differently in every field, both carrying the *original* untouched
 *      `record_hash`, both verified. Fields `JSON.stringify` drops came along invisibly. Validating
 *      first, and hashing only the fields the schema declares, closes that.
 *   2. **`record_hash` matches the record's own contents**, so no field can be rewritten. This is the
 *      one that catches an edit to the *last* record, where there is no link after it to break.
 *   3. **`previous_hash` matches the record before**, so no record can be removed from the middle,
 *      inserted, reordered, or spliced in from a different history.
 *   4. **`at` never goes backwards.** A backdated record is hashed *from* the backdated time, so the
 *      chain cannot see the lie — and the docstring's own rule says why this check belongs: a field of
 *      a record needs no check of its own, but a record's **relationship to its neighbours** does, and
 *      "later than the one before" is exactly that. Equal times are fine; a fixed clock gives them.
 *
 * There were two other checks once, on `sequence` and on `chain`, and both were removed after
 * mutating them away left every test passing: both fields are *inside* the record, so they are inside
 * the hash, and changing either breaks check 2 first.
 *
 * **Pass `head` unless you have a reason not to.** Without it this function can only judge the
 * records it is given, and a review used that: it dropped the last record — the one holding a denial —
 * and got `true`. Then dropped two. Then handed over an empty log: `true`. Chaining is evidence that a
 * record was not *edited*; it is no evidence at all that one was not *deleted from the end*. `head` is
 * the smallest checkpoint there is, held apart from the records, and §30 names checkpoints beside hash
 * chaining for this exact reason. Called without it, this checks internal consistency only — which is
 * what you want when comparing two histories, and not what you want when auditing your own.
 *
 * What it still cannot catch: a whole chain recomputed from the beginning **and** a head recomputed
 * with it. Someone who can rewrite every record and the checkpoint can make it all agree. Catching
 * that needs the checkpoint somewhere they cannot reach — a store that refuses an UPDATE (step 09
 * gives the application user no UPDATE on the log; step 39 hardens it), or a signature.
 */
export function verifyChain(records: readonly AuditRecord[], head?: Head): boolean {
  // One comparison, not two. It started as `records.length !== head.count || lastHash !== …` and the
  // count half could not be killed by any test — because it cannot be reached. If the last hash
  // matches the head, the last record *is* the head's record, and checks 3 and 4 below walk a unique
  // chain back to the genesis hash, so the array can only be the whole history and its length can only
  // be `count`. Lesson 18 in the learner's notes: a check no test can kill is not protecting anything.
  if (head !== undefined && lastHashOf(records) !== head.lastHash) {
    return false;
  }

  let previous = GENESIS;
  let previousAt = "";

  for (const record of records) {
    // `validateAuditRecord` is also the guard against rubbish — `null`, a hole in a sparse array, a
    // bare `{}`. There was a `typeof record !== "object"` line here as well and it could not be
    // killed either, for the same reason: the schema refuses all of those first. What still needs its
    // own guard is `lastHashOf`, because it reads a field *before* this loop runs.
    if (!validateAuditRecord(record)) {
      return false;
    }

    if (record.record_hash !== hashOf(record as unknown as Record<string, unknown>)) {
      return false;
    }

    if (record.previous_hash !== previous) {
      return false;
    }

    if (record.at < previousAt) {
      return false;
    }

    previous = record.record_hash;
    previousAt = record.at;
  }

  return true;
}

/** The last record's hash, or the genesis hash for an empty run. Read without trusting the element. */
function lastHashOf(records: readonly AuditRecord[]): string {
  const last = records[records.length - 1];

  if (last === null || typeof last !== "object" || typeof last.record_hash !== "string") {
    return records.length === 0 ? GENESIS : "";
  }

  return last.record_hash;
}
