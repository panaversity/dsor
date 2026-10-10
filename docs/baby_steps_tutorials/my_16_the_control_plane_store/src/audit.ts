// STEP 08: the decision is written down, and the writing is hard to change quietly.
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

import { createHash, randomUUID } from "node:crypto";
import { theDatabase, type Statements } from "./store.ts";
import { isKnownTenant } from "./tenant.ts";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

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
  /** STEP 14: the rows a read returned, by address — the resource scope of DSOR-CLS-05. */
  readonly resources?: readonly string[];
  /**
   * STEP 14: how many rows a read returned, in the field the schema has for it. It was under
   * `extensions` until decision 109, because a comment here said the schema had no such field.
   */
  readonly row_count?: number;
  readonly correlation: {
    readonly request_id: string;
    readonly tenant_id?: string;
    readonly principal_id?: string;
    /** STEP 09: a fresh UUID per attempt, so no two records can ever hash to the same bytes. */
    readonly trace_id?: string;
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
  /**
   * STEP 10: the company this decision belongs to — the one the request resolved to.
   * `undefined` when it resolved to none, in which case the decision is counted, not recorded,
   * exactly as when nobody was logged in. `recordTheDecision` in operations.ts decides which
   * companies a no-company refusal is written to; this function writes one record in one chain.
   */
  readonly tenant: string | undefined;
  readonly requestId: string;
  readonly result: string;
  readonly operation?: string;
  readonly authorization?: "ALLOW" | "DENY";
  readonly payloadHash?: string;
  readonly reason?: string;
  /** STEP 14: for a `classified_read`, the addresses of the rows that left. */
  readonly resources?: readonly string[];
  /** STEP 14: for a `classified_read`, how many rows left — the record's `row_count`. */
  readonly rowCount?: number;
}

/**
 * STEP 10: the chain a company's decisions join. One per company, named after it.
 *
 * Step 08's chain was named after a constant and every record joined it. With two companies in one
 * table that would make org_456's hashes depend on org_789's records, and §14 says audit partitions
 * are keyed by tenant. So each company has its own chain, its own sequence from 0, its own genesis
 * and its own head — and nothing in one ever links to the other, because the chain name is inside
 * every record's hash.
 */
function chainOf(tenant: string): string {
  return `audit:${tenant}`;
}

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

// STEP 10: the database handle lives in store.ts now, because the invoices have rows too and
// they must be the same rows this log is in. Re-exported, so everything that learned to call
// `useDatabase` from here in step 09 still can.
export { useDatabase, type Database } from "./store.ts";

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
 */ export async function theHead(tenant: string): Promise<Head> {
  const { rows } = await theDatabase(tenant).query<{ count: string; last_hash: string | null }>(
    `SELECT count(*)::text AS count,
            (SELECT record_hash FROM dsor.audit WHERE chain = $1 ORDER BY sequence DESC LIMIT 1)
              AS last_hash
     FROM dsor.audit WHERE chain = $1`,
    [chainOf(tenant)],
  );
  const row = rows[0];

  // An aggregate without GROUP BY always returns one row, so this branch is unreachable from a
  // working PostgreSQL — which is exactly why it used to be wrong. It returned `{ count: 0, lastHash:
  // GENESIS }`, the head of an EMPTY log, so a driver that answered nothing would have made an empty
  // array verify as the whole history. A check no test can reach must at least fail closed.
  if (row === undefined) {
    throw new Error("the database did not answer the head query; refusing to invent an empty log");
  }

  return Object.freeze({
    // `count(*)` comes back as a string, because a PostgreSQL bigint does not fit in a JavaScript
    // number and the driver will not quietly truncate it. Ten rows or ten billion, it is text here.
    count: Number(row.count),
    lastHash: row.last_hash ?? GENESIS,
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
 * STEP 09, and it fixes the worst bug this step had: **one request could break the chain for
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
  const tenant = decision.tenant;
  const kind = decision.kind;
  const requestId = clip(decision.requestId);
  const result = clip(decision.result);
  const operation = decision.operation;
  const authorization = decision.authorization;
  const payloadHashGiven = decision.payloadHash;
  const reason = decision.reason === undefined ? undefined : clip(decision.reason);
  const resources = decision.resources === undefined ? undefined : [...decision.resources];
  const rowCount = decision.rowCount;

  // No subject, or no company: counted, not recorded. The second is new in step 10, and it is rare
  // by construction — `recordTheDecision` writes a no-company refusal to every company the caller
  // belongs to, so this line is reached only by a principal who belongs to none.
  if (subject === undefined || tenant === undefined) {
    unauthenticated += 1;

    return undefined;
  }

  // A chain is named after a company this program serves, and nothing else. The only caller is
  // `recordTheDecision`, whose tenant comes from memberships validated at load — so this is a bug
  // check, not a refusal, and it throws like a record the schema rejects.
  if (!isKnownTenant(tenant)) {
    throw new TypeError(`${tenant} is not a company this program serves; no record was written`);
  }

  const chain = chainOf(tenant);

  // STEP 09: the position comes from the table.
  //
  // Step 08 took it from `log.length` and left a note saying this is where it has to become real.
  // It is still a read and then a write, and it has to be: `sequence` and `previous_hash` are both
  // inside the hash, so they must be known *before* the record exists. There is no single statement
  // that computes them, hashes the result and inserts it.
  //
  // What changes is what happens when two requests read the same answer. In step 08 both wrote and
  // the log quietly held two records at one position. Here the second INSERT fails — so the race is
  // **refused** rather than absorbed. The caller gets EVIDENCE_STORE_UNAVAILABLE, whose retry class
  // is `safe_same_key`, which is true: nothing ran.
  //
  // Which constraint refuses it, measured rather than assumed: for the program's own rows it is
  // `audit_pkey`, because `record_id` is `${chain}:${sequence}` and so two writers at one position
  // collide on the primary key as well, and PostgreSQL names the primary key first. This comment
  // used to say `UNIQUE (chain, sequence)`, and that constraint earns its place differently — it is
  // what keeps the ordering argument below true if the shape of `record_id` ever changes, and it is
  // what `audit.db.test.ts` races three *distinct* ids against.
  //
  // "Untestable in-process" was the claim here once, because one PGlite connection cannot race
  // itself. The interleaving does not need real concurrency, only control over the order, and
  // `audit-race.test.ts` holds one writer at this read while another commits. What does need a real
  // server is the constraint under genuine parallelism, and that is still `audit.db.test.ts`.
  // STEP 11: for this chain's company, and every statement below says so to PostgreSQL.
  const db = theDatabase(tenant);
  // `AS at_position`, and the alias is load-bearing. `SELECT sequence::text` names its output column
  // `sequence`, and PostgreSQL resolves a bare name in ORDER BY to an **output** column first — so
  // `ORDER BY sequence DESC` ordered by the text, where "9" sorts after "10". The tail froze at 9 and
  // every write after that computed 10 and failed on the primary key.
  //
  // This is the hazard `src/migrations.ts` has a paragraph about — "10_x.sql sorts before 9_x.sql as
  // text" — met again in SQL, where the cast creates it silently. Nine records passed before it bit.
  const { rows: tail } = await db.query<{ at_position: string; record_hash: string }>(
    `SELECT sequence::text AS at_position, record_hash
     FROM dsor.audit WHERE chain = $1 ORDER BY sequence DESC LIMIT 1`,
    [chain],
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
  // Nothing was tampered with. Every hash agreed. At the time `verifyChain` also rejected a log whose
  // times went backwards, so it called an intact chain broken — and the rows cannot be corrected,
  // because the application has no UPDATE. That check is gone now (decision 87), but the reason to
  // read the clock here stands on its own: a log whose times contradict its order is evidence that
  // lies about the order of events, whether or not anything rejects it.
  //
  // Reading it here is airtight, and the reason is the UNIQUE constraint. A writer that takes
  // position N+1 saw N in the tail, so N was already committed; and N's time was sampled on this
  // line, before N's INSERT. So at(N) < commit(N) <= tail-read(N+1) < at(N+1), for every pair.
  // The sequence and the clock can only agree.
  //
  // What this does not survive is the clock itself going backwards — an NTP correction between two
  // writes, or two instances of this program on one database with skewed clocks, since the argument
  // above needs ONE clock. Neither is fixable here: §30 wants a trusted time source, and this step
  // has none. `recorded_at` is the database's own witness beside it — and since decision 87 a
  // backwards time is recorded faithfully and verifies, rather than bricking the chain.
  //
  // Normalised to the exact string the database will hand back, which is the rule `storable` sets
  // for text and `at` was exempt from. `theLog` rebuilds `at` with `Date.prototype.toISOString`, so a
  // clock that emits any other valid RFC 3339 spelling — `…T00:00:00Z` with no milliseconds, or
  // `+00:00` — produced a record whose hash could never match what was read back:
  //
  //     wrote at=2026-10-04T00:00:00Z  read back=2026-10-04T00:00:00.000Z  verifyChain=false
  //
  // A hostile review found it. The trusted time source §30 asks for is exactly the kind of clock
  // that would have hit it.
  const told = now();
  const instant = Date.parse(told);

  // A clock that returns something that is not a time is a broken clock, and the record is not
  // written. Without this line the failure was a bare RangeError from `toISOString`, which the
  // pipeline reported as the *store* being unavailable — true about the outcome, wrong about the cause.
  if (Number.isNaN(instant)) {
    throw new TypeError(
      `the clock returned ${JSON.stringify(told)}, which is not a time; no record was written`,
    );
  }

  const at = new Date(instant).toISOString();

  const body: Record<string, unknown> = {
    record_id: `${chain}:${sequence}`,
    chain,
    sequence,
    previous_hash: previous,
    at,
    tenant,
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
      tenant_id: tenant,
      principal_id: subject,
      // A fresh id for THIS attempt, and it is inside the hash. A refusal fanned out to two
      // employers' logs is two records with two trace ids for one request — this slot is borrowed
      // as a per-attempt nonce, and it must move the day DSOR-COR-01a's propagated trace id lands. Two writers for the same request,
      // subject, operation, result and millisecond used to produce byte-identical records, and the
      // lost-reply recovery below then could not tell "my INSERT committed" from "someone else wrote
      // the same bytes" — a hostile review measured two receipts for one row. With this, equal hashes
      // mean one attempt. The schema already has the slot (`correlation.trace_id`).
      trace_id: randomUUID(),
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

  // STEP 14: inside the hash like everything else, so a record of a read that names fewer
  // rows than it returned is a record that does not verify.
  if (resources !== undefined) {
    body.resources = resources;
  }

  if (rowCount !== undefined) {
    body.row_count = rowCount;
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
  // STEP 09: and a failure here is not the same thing as a failure to write.
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
  // unknown, never as a retryable error. So this does not guess. It looks — and when it cannot
  // look, it says so, with `OutcomeUnknown`, which the pipeline turns into `OUTCOME_UNKNOWN`.
  try {
    await insert(db, written);
  } catch (failure) {
    // A unique violation is PostgreSQL *telling* us the INSERT did not commit: the position is
    // taken. Nothing to look for, and the caller may safely be told the write failed.
    if (isUniqueViolation(failure)) {
      throw failure;
    }

    // Two kinds of failure, and they mean different things. A **server** error carries a SQLSTATE:
    // the server received the statement and refused it, so the row is not there and never will be.
    // Anything else is a **connection** that went quiet — a reply lost, a socket reset, a timeout —
    // and nobody on this side knows what the server did with the statement. It may have committed.
    // It may still be running. A review found the first version treating both the same.
    const theServerDecided = isServerError(failure);

    // Is the record there? Asked by `record_id`, and checked by `record_hash`.
    //
    // On the connection that just failed, which is usually a connection that is gone. So this read
    // can fail too, and the first version let that error escape and become
    // `EVIDENCE_STORE_UNAVAILABLE` with retry `safe_same_key` — the exact pre-fix behaviour, on the
    // exact case that happens when a server restarts. Here the honest answer is that nobody knows,
    // and the retry class that says so is `after_reconciliation`, which does not permit a fresh
    // attempt.
    let found: { record_hash: string } | undefined;

    try {
      const { rows } = await db.query<{ record_hash: string }>(
        "SELECT record_hash FROM dsor.audit WHERE record_id = $1",
        [written.record_id],
      );

      found = rows[0];
    } catch (cannotLook) {
      throw new OutcomeUnknown(
        `the decision ${written.record_id} may or may not have been recorded: the write failed ` +
          `and the store could not be asked`,
        cannotLook,
      );
    }

    // Four outcomes, in the order that makes each one a true statement.
    //
    // Mine is there: the reply was lost, not the record. Equal hashes mean THIS attempt, because
    // `correlation.trace_id` is a fresh UUID per attempt and is inside the hash — without it a
    // byte-identical record from another writer passed this test and two decisions became one row.
    if (found !== undefined && found.record_hash === written.record_hash) {
      // Returning it keeps the log and the answer agreeing: the decision is recorded, so the
      // command may proceed. Falls through to `return written`.
    } else if (found !== undefined) {
      // Someone else's row holds my position. Mine cannot commit now — the primary key will refuse
      // it even if the statement is still in flight — so "nothing was written" is true, and
      // `EVIDENCE_STORE_UNAVAILABLE` with retry `safe_same_key` is the right answer.
      throw failure;
    } else if (theServerDecided) {
      // Not there, and the server said no. Definitive. Same answer.
      throw failure;
    } else {
      // Not there, and the server never answered. The statement may still be executing on a
      // connection we no longer hold, and the row may land after this line. "Not found" is a
      // snapshot, not a proof — a hostile review pointed at exactly this window. Unknown.
      throw new OutcomeUnknown(
        `the decision ${written.record_id} may or may not have been recorded: the connection ` +
          `failed before the server answered, and the record is not there yet`,
        failure,
      );
    }
  }

  return written;
}

/**
 * STEP 09: the third answer a database can give.
 *
 * A write succeeded, failed, or **nobody knows** — the reply was lost and the follow-up question
 * could not be asked either. This is that third one, as a type the pipeline can tell apart from a
 * failure. It carries the error that stopped the question being asked, so the cause is not thrown
 * away on the way to the envelope.
 */
export class OutcomeUnknown extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "OutcomeUnknown";
  }
}

/**
 * Did the **server** raise this? A SQLSTATE is five characters, digits and capitals, with at least
 * one digit; `pg` and PGlite put one on every error the server itself produced. A connection that
 * dropped carries a Node errno (`ECONNRESET`, `EPIPE`) or no code at all, and Node's errno names
 * are letters only — so one digit is the tell. Measured 2026-10-04 against both.
 */
function isServerError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;

  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && /[0-9]/.test(code);
}

/** PostgreSQL's own word for "that row is already there": SQLSTATE 23505, from `pg` and PGlite alike. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null && typeof error === "object" && (error as { code?: unknown }).code === "23505"
  );
}

/**
 * The INSERT, on its own so that the recovery above has something to call.
 *
 * Every value is a parameter rather than pasted into the SQL. Not politeness: `reason` holds a
 * caller's own words, and a caller's words in a SQL string is how an audit log ends up executing
 * them.
 */
async function insert(db: Statements, written: AuditRecord): Promise<void> {
  await db.query(
    `INSERT INTO dsor.audit (
       record_id, chain, sequence, previous_hash, record_hash, at, tenant, kind,
       identity, correlation, operation, payload_hash, "authorization", result, reason,
       resources, row_count
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
      // STEP 14. The addresses as JSON text, like identity and correlation; the count as
      // the whole number it is (migration 007, decision 109).
      written.resources === undefined ? null : JSON.stringify(written.resources),
      written.row_count ?? null,
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
export async function theLog(tenant: string): Promise<readonly AuditRecord[]> {
  const { rows } = await theDatabase(tenant).query<Record<string, unknown>>(
    // Same alias, same reason. Without it this returned the chain in text order — 0, 1, 10, 11, 2 —
    // and `verifyChain` would have reported a perfectly good log as broken.
    `SELECT record_id, chain, sequence::text AS at_position, previous_hash, record_hash,
            to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
            tenant, kind, identity, correlation, operation, payload_hash, "authorization", result,
            reason, resources, row_count
     FROM dsor.audit WHERE chain = $1 ORDER BY sequence`,
    [chainOf(tenant)],
  );

  return Object.freeze(
    rows.map((row) => {
      const record: Record<string, unknown> = {
        record_id: row.record_id,
        chain: row.chain,
        sequence: Number(row.at_position),
        previous_hash: row.previous_hash,
        record_hash: row.record_hash,
        // As text, formed by PostgreSQL, in the one spelling `audit` hashes. This was
        // `(row.at as Date).toISOString()` and it put the driver's date parser inside the hash path:
        // PGlite parses a timestamp with `new Date(string)`, and V8 reads `0001-01-01 …` as 2001 —
        // so a record with a schema-valid year below 0100 could never verify again. `pg` would have
        // got it right, which means the two routes disagreed about the same row. `to_char` is the
        // same on both.
        at: row.at as string,
        tenant: row.tenant,
        kind: row.kind,
        identity: row.identity,
        correlation: row.correlation,
        result: row.result,
      };

      // The optional columns, left out rather than set to null — the schema says a field is either
      // right or absent, and `operation: null` is neither.
      for (const field of [
        "operation",
        "payload_hash",
        "authorization",
        "reason",
        "resources",
        "row_count",
      ]) {
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
 * Empties one company's log and its head, zeroes the flood counter for everyone, and starts a new run.
 *
 * A test seam, and the doc comment used to say "tests only; there is no erasing an audit log in
 * DSoR" — a sentence the function contradicts. Nothing stops a production path importing this and
 * calling it, and a review said so plainly: `DSOR-AUD-04a` says the runtime identity MUST NOT be able
 * to delete audit records, the runtime identity here is this process, and one call erases everything.
 * What replaced the claim was the truth, and then step 09 made it enforced: the log lives in a
 * database whose application account has no DELETE, so this runs only for the owner — which, since
 * step 11, is a connection the test support steps up to for exactly this call.
 *
 * It also erases the aggregated count, which is the only evidence an unauthenticated flood ever
 * happened. And it bumps `run`, so the record ids it frees are never handed out twice.
 */
export async function forgetTheLog(tenant: string): Promise<void> {
  // DELETE, which the application's own account is not allowed to run — so this only works for a
  // caller connected as the owner. That is the shape of the guarantee: a test holds the owner's
  // connection, and the program never does.
  //
  // This chain only. `theHead` and `theLog` filter by `chain`, and so must the eraser, or step 10's
  // second tenant finds its history gone the first time a test for the first tenant cleans up.
  await theDatabase(tenant).query("DELETE FROM dsor.audit WHERE chain = $1", [chainOf(tenant)]);
  // Process-wide on purpose, while the DELETE above is per chain: §29's flood counter counts
  // refusals that have no subject or no company, so there is no tenant to key it by, and any
  // company's eraser zeroes it for all.
  unauthenticated = 0;
}

/** Does this record match the specification's schema? */
export function validateAuditRecord(record: unknown): boolean {
  return validate(record) === true;
}

/**
 * Does this run of records still agree with itself?
 *
 * Three checks. There were four, and the fourth was removed on purpose — see below.
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
 *
 * **The fourth check, "`at` never goes backwards", was removed (decision 87).** It was never about
 * tampering: a changed `at` breaks check 2, because `at` is inside the hash. What it caught was an
 * honestly recorded earlier time — and that has two causes, neither of them an attack. One is a
 * backdated clock, which `recorded_at` already witnesses (see `001_audit.sql`). The other is two
 * instances of this program on one database with clocks a few seconds apart, which is the normal
 * shape of a deployment, and for which the check turned an intact chain into one that could never
 * verify again, because nothing can UPDATE the rows. A tamper-evidence check that cries wolf on an
 * honest record, permanently, is a check that will be switched off the first time it fires in
 * production. The hash chain already pins the order; the times are evidence, not a rule.
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

    previous = record.record_hash;
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
