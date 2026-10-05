// A caller names an operation instead of calling a function.
//
// nothing here throws at a caller any more. Every refusal comes back as
// an error envelope with a code from §28 and a retry class, so a caller can act on the
// answer instead of reading a sentence. And invoice.issue — the command split out of
// step 03 — is carried out here, because a command is what makes an envelope worth
// having: "this invoice is already issued" needs a code, and a read's refusals are too
// thin to show why.
//
// Rule DSOR-OPR-01: every operation MUST have a contract.
// Rule DSOR-ERR-01a: every error MUST validate against error-envelope.schema.json.

import {
  nextRequestId,
  payloadHash,
  refusal,
  success,
  type ErrorEnvelope,
  type ResultEnvelope,
} from "./envelopes.ts";
// Every call says who is asking, and NEW IN STEP 06 every call is checked against what that
// caller may do.
import { principalFrom, type Login } from "./login.ts";
import { getInvoice, issueInvoice, type Invoice } from "./invoice.ts";
import { TENANT } from "./tenant.ts";
import { contractsFromDisk, loadRegistry, type OperationContract } from "./registry.ts";
import { holds } from "./permissions.ts";
import {
  assertPipeline,
  runPipeline,
  type Context,
  type Stage,
  type StageResult,
} from "./pipeline.ts";
import { parseUri } from "./uri.ts";
// NEW IN STEP 08: the log. operations.ts is where the pipeline lives, so it is where the stage that
// writes a record lives too.
import { audit, OutcomeUnknown } from "./audit.ts";

// Built once, when this module is first loaded. A contract that does not validate stops
// the program here, before any caller gets a turn. That is DSOR-OPR-02a.
const registry = loadRegistry(contractsFromDisk());

/**
 * What an operation answers with.
 *
 * The shape is deliberately lopsided. A refusal always comes back
 * in an error envelope. A command's success comes back in a result envelope. A *query's*
 * success does not — there is no outcome value in result-envelope.schema.json that means
 * "here is the data you asked for", so a read keeps handing back the invoice. The README
 * explains the gap rather than papering over it.
 */
export type OperationAnswer =
  | { readonly kind: "data"; readonly askedBy: string; readonly invoice: Invoice }
  | { readonly kind: "result"; readonly askedBy: string; readonly envelope: ResultEnvelope }
  | { readonly kind: "error"; readonly askedBy: string; readonly envelope: ErrorEnvelope };

type Handler = (
  args: Readonly<Record<string, unknown>>,
  contract: OperationContract,
  askedBy: string,
  hash: string,
  requestId: string,
) => OperationAnswer;

/** Contracts that describe an operation this step does not carry out yet. */
const NOT_YET_IMPLEMENTED: ReadonlySet<string> = new Set<string>();

/**
 * Reads the `invoice` argument as a canonical address and returns the invoice id, or the
 * refusal that stopped it.
 *
 * Every refusal here is `VALIDATION_FAILED` or `TENANT_MISMATCH`, and both are `never`
 * retryable: asking again with the same bad address cannot start working.
 */
function invoiceIdFrom(
  args: Readonly<Record<string, unknown>>,
  contract: OperationContract,
  askedBy: string,
  requestId: string,
): { readonly id: string } | { readonly refused: ErrorEnvelope } {
  // The caller's **own** `invoice`, not one inherited from a prototype. A name an object merely
  // inherits is a name nobody in this program chose — the same reason the login reads its field
  // this way, and the same reason step 06 looks a role up with Object.hasOwn.
  const given = Object.hasOwn(args, "invoice") ? args["invoice"] : undefined;

  if (typeof given !== "string") {
    return {
      refused: refusal(
        "VALIDATION_FAILED",
        `${contract.id} needs an invoice address, and got ${typeof given}`,
        requestId,
        askedBy,
      ),
    };
  }

  let parsed;

  try {
    parsed = parseUri(given);
  } catch (error) {
    return { refused: refusal("VALIDATION_FAILED", (error as Error).message, requestId, askedBy) };
  }

  const namedFor = contract.id.split(".")[0];

  // The address names a company, and this program serves exactly one. Reading the tenant
  // and then ignoring it would be worse than not parsing it: the caller asks for
  // org_999's invoice and quietly gets org_456's. Real multi-tenancy is step 10.
  if (parsed.tenant !== TENANT) {
    return {
      refused: refusal(
        "TENANT_MISMATCH",
        `${given} is for ${parsed.tenant}, and this program serves ${TENANT}`,
        requestId,
        askedBy,
      ),
    };
  }

  if (parsed.entity !== namedFor) {
    return {
      refused: refusal(
        "VALIDATION_FAILED",
        `${contract.id} is named for ${namedFor}, and ${given} names ${parsed.entity}`,
        requestId,
        askedBy,
      ),
    };
  }

  return { id: parsed.id };
}

const handlers: Readonly<Record<string, Handler>> = {
  "invoice.get": (args, contract, askedBy, _hash, requestId) => {
    const read = invoiceIdFrom(args, contract, askedBy, requestId);

    if ("refused" in read) {
      return { kind: "error", askedBy, envelope: read.refused };
    }

    const invoice = getInvoice(read.id);

    // Step 03 answered `undefined` here and left the caller to work out why. An absent
    // invoice is still an ordinary answer, and now it says so in a way a caller can act
    // on: RESOURCE_NOT_FOUND, retry never.
    if (invoice === undefined) {
      return {
        kind: "error",
        askedBy,
        envelope: refusal(
          "RESOURCE_NOT_FOUND",
          `${read.id} is not an invoice we hold`,
          requestId,
          askedBy,
        ),
      };
    }

    return { kind: "data", askedBy, invoice };
  },

  "invoice.issue": (args, contract, askedBy, hash, requestId) => {
    const read = invoiceIdFrom(args, contract, askedBy, requestId);

    if ("refused" in read) {
      return { kind: "error", askedBy, envelope: read.refused };
    }

    const outcome = issueInvoice(read.id);

    if (outcome.kind === "not_found") {
      return {
        kind: "error",
        askedBy,
        envelope: refusal(
          "RESOURCE_NOT_FOUND",
          `${read.id} is not an invoice we hold`,
          requestId,
          askedBy,
        ),
      };
    }

    // CONFLICT, and never retryable. A business rule says no, and asking again with the
    // same request cannot change that — only a human changing the invoice could.
    if (outcome.kind === "not_draft") {
      return {
        kind: "error",
        askedBy,
        envelope: refusal(
          "CONFLICT",
          `${read.id} is ${outcome.status}, and only a draft invoice can be issued`,
          requestId,
          askedBy,
        ),
      };
    }

    return {
      kind: "result",
      askedBy,
      envelope: success({
        data: outcome.invoice as unknown as Record<string, unknown>,
        semantics: contract.execution?.semantics ?? "atomic",
        payloadHash: hash,
        principalId: askedBy,
        requestId,
      }),
    };
  },
};

/**
 * Checks the contracts and the handlers against each other.
 *
 * A contract with no handler is a promise nothing keeps. A handler with no contract is an
 * unnamed operation, which is the thing §7 exists to prevent. It takes both lists as
 * arguments rather than reading the module's own, so a test can hand it a mismatched pair
 * — and so it can run at start-up, below, rather than on the first request.
 */
export function assertPaired(
  contracts: ReadonlyMap<string, OperationContract>,
  named: Readonly<Record<string, Handler>>,
  waiting: ReadonlySet<string> = NOT_YET_IMPLEMENTED,
): number {
  let checked = 0;

  for (const id of contracts.keys()) {
    if (named[id] === undefined && !waiting.has(id)) {
      throw new TypeError(`${id} has a contract and no handler`);
    }

    checked += 1;
  }

  for (const id of Object.keys(named)) {
    if (!contracts.has(id)) {
      throw new TypeError(`${id} has a handler and no contract`);
    }
  }

  // The waiting list cannot rot. An id here with no contract would be a note about
  // nothing; an id here that also has a handler means someone forgot to cross it off.
  // That is what made step 04 take invoice.issue off the list: it could not be forgotten.
  for (const id of waiting) {
    if (!contracts.has(id)) {
      throw new TypeError(`${id} is waiting for a handler and has no contract`);
    }

    if (named[id] !== undefined) {
      throw new TypeError(`${id} has a handler, so take it off the waiting list`);
    }

    checked += 1;
  }

  return checked;
}

// Start-up, not first request. This and the loadRegistry above it are the whole of
// "refused before anything runs".
//
// The constant holds **how many** pairs the check looked at, not `true`. A boolean was not
// enough: no test can watch a line at module scope run, and deleting the call while leaving
// `return true` behind kept every test green. A count has to come from walking the lists. It is
// still not a proof — hardcoding today's number would pass — but it moves the mistake from
// "delete a line" to "delete a line and keep a number right as the lists change".
export const PAIRS_CHECKED: number = assertPaired(registry, handlers);

// NEW IN STEP 07: the checklist.
//
// Each of these four did exactly this before, in this order, inside callOperation. What changed is
// that the order is now a value: something a test can read, a later step can add a line to, and a
// second door can be handed. See src/pipeline.ts for why that matters.
//
// The number on each is its place in §21's list of seventeen. `resolve the operation` has none,
// because §21 begins after the operation is known — there is no checklist to run for an operation
// that does not exist.

/** A refusal, wrapped as a stage's answer. */
/**
 * The operation the caller named, as text that is safe to put in a message.
 *
 * One job: it may not be text at all. `Door`'s types are erased before Node runs, so `id` can be a
 * `Symbol`, and `${aSymbol}` **throws**. `resolveTheOperation` already knew that and guarded its own
 * message; `recordTheDecision`, the one stage that still runs *after* that guard has fired,
 * interpolated `context.id` anyway. A review sent a Symbol with the evidence store failing and got a
 * stack trace where an envelope was owed — [lesson 13](../../my_notes/lessons.md), a fix belongs
 * everywhere its shape lives, so four sites now share this one function.
 *
 * It does **not** cap the length. It used to, and then a fuzz run found two *other* caller strings
 * reaching a message at full length — so the cap moved to `refusal()` in `envelopes.ts`, which every
 * error envelope is built by. Capping here as well would be the same rule written twice, with two
 * different wordings, which is [lesson 17](../../my_notes/lessons.md).
 */
function nameOf(id: unknown): string {
  if (typeof id !== "string") {
    return "an operation named by something that is not text";
  }

  return id;
}

const refuse = (askedBy: string, code: string, message: string, requestId: string): StageResult =>
  Object.freeze({
    kind: "refused" as const,
    answer: Object.freeze({
      kind: "error" as const,
      askedBy,
      envelope: refusal(code, message, requestId, askedBy === "(nobody)" ? undefined : askedBy),
    }),
  });

const carryOn = (context: Context): StageResult => ({ kind: "carry_on", context });

/** §21.1 — who is asking. Nothing else is looked at until this answers. */
const authenticate: Stage["run"] = (context) => {
  const who = principalFrom(context.login, context.requestId);

  if ("refused" in who) {
    return Object.freeze({
      kind: "refused" as const,
      answer: Object.freeze({ kind: "error" as const, askedBy: "(nobody)", envelope: who.refused }),
    });
  }

  return carryOn({ ...context, principal: who.principal });
};

/** Not in §21, which assumes it: is this an operation this program has a contract for? */
const resolveTheOperation: Stage["run"] = (context) => {
  // `typeof` first, because everything below puts the id in a message and `${}` on a Symbol throws
  // — a raw TypeError at a caller who is owed an envelope.
  //
  // `Object.hasOwn` on `handlers` because it is a plain object, so `handlers["toString"]` finds a
  // function on Object.prototype: the same lookup that let a role named `toString` grant permissions
  // in step 06. Be honest about it though — no test can kill this one. `registry` is a **Map**, and
  // a Map has no prototype keys, so `registry.get("toString")` already returns nothing and the
  // `contract === undefined` half refuses first. It is here for the day the registry stops being a
  // Map, and because the two halves should agree about what an id is. A guard that provably changes
  // nothing today is worth a sentence rather than a silent line.
  if (typeof context.id !== "string") {
    return refuse(
      context.principal?.id ?? "(nobody)",
      "UNSUPPORTED_CAPABILITY",
      "an operation is named by text, and this is not text",
      context.requestId,
    );
  }

  const contract = registry.get(context.id);

  if (contract === undefined || !Object.hasOwn(handlers, context.id)) {
    return refuse(
      context.principal?.id ?? "(nobody)",
      "UNSUPPORTED_CAPABILITY",
      `${nameOf(context.id)} is not an operation: this program has no contract for it`,
      context.requestId,
    );
  }

  return carryOn({ ...context, contract });
};

/** §21.5 — may you? Deny by default: the permission comes from the operation's own contract. */
const authorize: Stage["run"] = (context) => {
  const { principal, contract } = context;

  if (principal === undefined || contract === undefined) {
    return refuse(
      principal?.id ?? "(nobody)",
      "INTERNAL_ERROR",
      "the pipeline reached authorize without a principal and a contract",
      context.requestId,
    );
  }

  if (!holds(principal, contract.authorization.permission)) {
    return refuse(
      principal.id,
      "AUTHORIZATION_DENIED",
      `${principal.id} may not call ${nameOf(context.id)}`,
      context.requestId,
    );
  }

  return carryOn(context);
};

/**
 * §21.6 — validate and canonicalize the input; compute the payload hash.
 *
 * Only partly, and the README says so. What is here is the copy-once and the can-it-be-written-down
 * check from step 04. Canonical JSON, where key order is settled, is step 29.
 */
const validateTheInput: Stage["run"] = (context) => {
  const askedBy = context.principal?.id ?? "(nobody)";

  try {
    const given = Object.freeze({ ...context.args });

    // Written down **once**, and the text is kept. Nothing below reads the caller's object again:
    // a second read can answer differently, and it used to.
    const written = JSON.stringify(given);

    return carryOn({ ...context, given, payloadHash: payloadHash(written) });
  } catch {
    return refuse(
      askedBy,
      "VALIDATION_FAILED",
      `${nameOf(context.id)} was given arguments that cannot be written down`,
      context.requestId,
    );
  }
};

/**
 * §21.11 — record the decision. Always, including a DENY.
 *
 * This is the step. Everything above decides; this writes down what was decided, and it runs before
 * the answer leaves the door. That is the **ordering** half of `DSOR-EXE-02`, and this comment used to
 * claim it was "the whole of" the rule. It is not, on two counts:
 *
 *   - *"controls evaluated"* — nothing evaluates a control until step 27, so the schema's `controls`
 *     array is absent rather than empty.
 *   - *"durably"* — the log is an array in one process. A restart loses every record, which is the
 *     exact failure §21's "Why it matters" describes. Step 09 puts it in PostgreSQL.
 *
 * `src/login.ts` names an unmet rule the same way for `DSOR-IDN-02a`, and that comment is the model.
 *
 * Four things about it are worth more than the code:
 *
 *   - It runs **after a refusal too**, which is why `Stage` gained a flag. The common mistake §21
 *     names is writing the log at the end, in a `finally`: too late, and it misses the crash.
 *     Skipping it on a refusal is the same mistake wearing a different hat, and it is worse, because
 *     a probe that is refused a hundred times is exactly the evidence you want.
 *   - It reads what it records from the **context**, never from the arguments. The subject is the
 *     principal `authenticate` resolved; the operation is the contract `resolve the operation`
 *     found; the payload hash is the one `validate the input` computed from text it wrote down once.
 *     `DSOR-MOD-03` in one sentence: evidence comes from what DSoR established, not from what the
 *     caller said.
 *   - The caller's own operation id never reaches the record. `operation` is an `operationRef` in
 *     the schema — `invoice.get@1`, with a version — so a request for `"invoice.destroy"` has no
 *     valid value to put there and the field is left out. Putting the caller's string in would make
 *     the record unwritable, and an unwritable record turns a merely misspelled request into
 *     `EVIDENCE_STORE_UNAVAILABLE`. The requested id goes in `reason`, which is free text.
 *   - An unauthenticated caller leaves no record, only a count. `audit` decides that, not this
 *     stage — see decision 53 and §29.
 */
const recordTheDecision: Stage["run"] = async (context) => {
  const { principal, contract, refusal: refused } = context;
  const denial = refused?.kind === "error" ? refused.envelope : undefined;

  // The completeness check lives **here**, before the record is written, and it used to live in the
  // door after the walk. A review measured what that cost:
  //
  //   authenticate lazied       -> INTERNAL_ERROR, 0 records
  //   validate the input lazied -> INTERNAL_ERROR, and a record saying ALLOW / ALLOWED
  //
  // The second is a record that lies by omission: the caller was told the call failed and nothing on
  // the record says it never ran. Checking before the recording means the refusal is the thing that
  // gets recorded, which is what DSOR-EXE-02 asks for.
  //
  // Only when nothing has refused. A genuine DENY at §21.5 skips §21.6, so `given` is *supposed* to
  // be missing then.
  const missing =
    denial !== undefined
      ? undefined
      : principal === undefined
        ? "a principal"
        : contract === undefined
          ? "a contract"
          : context.given === undefined
            ? "its arguments"
            : context.payloadHash === undefined
              ? "a payload hash"
              : Object.hasOwn(handlers, contract.id)
                ? undefined
                : "any code to carry it out";

  const shortfall =
    missing === undefined
      ? undefined
      : refusal(
          "INTERNAL_ERROR",
          `${nameOf(context.id)} reached §21.11 without ${missing}`,
          context.requestId,
          principal?.id,
        );

  const outcome = denial ?? shortfall;

  let written;

  try {
    written = await audit({
      kind: "decision",
      subject: principal?.id,
      requestId: context.requestId,
      // The decision, not the outcome. Whether the invoice was actually issued is §21.15's business,
      // and it has not happened yet — it cannot have, because this line runs first.
      authorization: outcome === undefined ? "ALLOW" : "DENY",
      result: outcome === undefined ? "ALLOWED" : outcome.code,
      reason: outcome === undefined ? undefined : outcome.message,
      ...(contract === undefined ? {} : { operation: `${contract.id}@${contract.version}` }),
      ...(context.payloadHash === undefined ? {} : { payloadHash: context.payloadHash }),
    });
  } catch (failure) {
    // NEW IN STEP 09: the answer a step-08 array could never give. The write may have happened and
    // the store could not be asked whether it did. That is not a failure and it is not a success,
    // and `DSOR-UNK-01b` says it must be reported as neither: `OUTCOME_UNKNOWN`, whose retry class
    // is `after_reconciliation` — a retry is not safe, because the decision may already be on
    // record, and it is not forbidden, because it may not be. Somebody has to look first.
    if (failure instanceof OutcomeUnknown) {
      return refuse(
        principal?.id ?? "(nobody)",
        "OUTCOME_UNKNOWN",
        `the decision about ${nameOf(context.id)} may or may not have been recorded, so it was ` +
          `not carried out; reconcile before trying again`,
        context.requestId,
      );
    }

    // The decision could not be written, so there is no honouring DSOR-EXE-02 by answering. The
    // caller is told that instead, and because this stage sits before anything executes, nothing
    // has happened yet. `EVIDENCE_STORE_UNAVAILABLE` is the §28 code for it, retry
    // `safe_same_key`: the request never ran, so sending it again is safe.
    //
    // NEW IN STEP 09: and "could not be written" is now a true statement, where it used to be a
    // guess. A database can commit an INSERT and lose the reply, which arrives here as an error
    // from a write that actually happened — so this used to tell the caller the decision was not
    // recorded while the record sat in the table saying ALLOWED. `audit` resolves that itself: it
    // goes and looks for its own record by id and hash, and only throws when the record genuinely
    // is not there. By the time this line runs, nothing was written.
    //
    // This is the decision-record half of DSOR-EXE-03b. The other half is about the *intent* record
    // and lands in step 36, along with DSOR-EXE-03a.
    return refuse(
      principal?.id ?? "(nobody)",
      "EVIDENCE_STORE_UNAVAILABLE",
      `the decision about ${nameOf(context.id)} could not be written down, so it was not carried out`,
      context.requestId,
    );
  }

  // A shortfall is this program's bug, not the caller's, so it is reported as INTERNAL_ERROR with
  // retry `never` — asking again cannot fix a broken pipeline. It is recorded first, above, whenever
  // there is a principal to attribute it to. When there is not — a pipeline so broken that
  // `authenticate` never ran — there is no subject, and the schema requires one, so `audit` counts it
  // instead. Inventing a subject to fill the field would be worse than counting. What stops that case
  // arising is `assertPipeline` at start-up rather than anything here.
  if (shortfall !== undefined) {
    return Object.freeze({
      kind: "refused" as const,
      answer: Object.freeze({
        kind: "error" as const,
        askedBy: principal?.id ?? "(nobody)",
        envelope: shortfall,
      }),
    });
  }

  // The receipt. `written` is the record `audit` kept, and the door will not execute without its id.
  // On this path a record always exists — the shortfall check above refuses when there is no
  // principal, and a principal is the only reason `audit` counts instead of recording — so an absent
  // id here means the stage did not do its job, and the door says so rather than carrying on.
  return carryOn({ ...context, recorded: written?.record_id });
};

const stage = (
  at: number | null,
  name: string,
  applies: Stage["applies"],
  run: Stage["run"],
): Stage => Object.freeze({ at, name, applies, run, evenAfterARefusal: false });

/**
 * A stage that runs even when something has already refused.
 *
 * A second helper rather than a fifth argument, so the list below reads as what it is. Today §21.11
 * is the only one; §21.16 and §21.17 join it when the decision bundle arrives.
 */
const alsoAfterARefusal = (
  at: number | null,
  name: string,
  applies: Stage["applies"],
  run: Stage["run"],
): Stage => Object.freeze({ at, name, applies, run, evenAfterARefusal: true });

/** The checklist, in order. Later steps add lines; they never reorder them. */
export const PIPELINE: readonly Stage[] = Object.freeze([
  stage(1, "authenticate", "both", authenticate),
  stage(null, "resolve the operation", "both", resolveTheOperation),
  stage(5, "authorize", "both", authorize),
  stage(6, "validate the input", "both", validateTheInput),
  // NEW IN STEP 08. §21.11, and the only stage in the list that runs after a refusal.
  alsoAfterARefusal(11, "record the decision", "both", recordTheDecision),
]);

// Start-up, not first request, and a count rather than `true` — lesson 12. A list whose order
// cannot be trusted is not something to find out about on a request, because the order is the
// guarantee.
export const STAGES_CHECKED: number = assertPipeline(PIPELINE);

/** The operations this program can answer to. */
export function operationIds(): string[] {
  return [...registry.keys()];
}

/**
 * The operations that have code behind them.
 *
 * Exported so a test can compare the two lists. assertPaired runs at module load and no
 * test can watch that line execute, but a test can check the state it guarantees: these
 * two lists, matching.
 */
export function handlerIds(): string[] {
  return Object.keys(handlers);
}

/**
 * A door: something that turns a request into an answer.
 *
 * `DSOR-OPR-04a` says every interface MUST invoke the same DSoR pipeline. A door is how an
 * interface gets one — and it is *given* the list rather than choosing it, so the HTTP server in
 * step 42 is handed the same `PIPELINE` this one is.
 */
export type Door = (
  login: Login | undefined,
  id: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<OperationAnswer>;

/**
 * Builds a door from a checklist.
 *
 * The list is checked **as the door is built**, not on the first request and not by trusting
 * whoever built it. A door whose order cannot be trusted should not exist, because the order is
 * the guarantee.
 *
 * What the check cannot see is what a stage *does*. `REQUIRED` is a list of names, so a stage
 * called `authorize` that returns `carry_on` without asking anything satisfies it — a review built
 * exactly that door. There is no way to check a function's meaning from a list, so the honest
 * answer is to say so here rather than imply the check is stronger than it is. What guards that
 * instead is the behaviour tests: a door whose `authorize` does nothing lets cfo_100 issue an
 * invoice, and `deny-by-default.test.ts` is where that is caught.
 */
export function makeDoor(stages: readonly Stage[]): Door {
  // A frozen **copy**, checked, and it is the copy the door walks. A review checked the array it was
  // handed and then kept walking the caller's live reference: `const door = makeDoor(list)` followed
  // by `list.length = 2` gave a door with no authorize, no validate and no recording, and
  // `list[2] = aNoOpAuthorize` let cfo_100 issue an invoice. `PIPELINE` itself is frozen so
  // `callOperation` was never exposed — but `makeDoor` is exported precisely so step 42's HTTP server
  // can build its own door, and "register a stage" is an obvious shape for that.
  const checked = Object.freeze([...stages]);

  assertPipeline(checked);

  return async (login, id, args) => {
    // NEW IN STEP 08: one id for this request, minted here — before the first stage, because the
    // request exists before any answer does. Every refusal and every success below is handed this
    // same id, so the record step 08 writes and the answer the caller reads name the same request.
    // It used to be minted inside whichever envelope was built first, which made it the name of an
    // answer rather than of a request.
    const requestId = nextRequestId();
    const walked = await runPipeline(checked, { login, id, args, requestId });

    if (walked.kind === "refused") {
      return walked.answer;
    }

    // `walked.context.requestId`, not the closure's `requestId`. They are the same value today, and a
    // review pointed out that there were two *sources* — every stage's refusal reads the context,
    // every handler's envelope read the closure — so the day a stage legitimately rewrites the id
    // (DSOR-COR-01b implies a caller may one day supply one) they would drift apart silently.
    const {
      principal,
      contract,
      given,
      payloadHash: hash,
      requestId: id_,
      recorded,
    } = walked.context;
    const handler =
      contract !== undefined && Object.hasOwn(handlers, contract.id)
        ? handlers[contract.id]
        : undefined;

    // NEW IN STEP 08: nothing executes without the receipt from §21.11.
    //
    // The first five clauses are a type guard. A systematic mutation sweep showed they were also
    // *unreachable*: flipping every `||` here to `&&` changed no test, because every way of arriving
    // short is caught earlier — `authenticate` and `resolve the operation` by `authorize`,
    // `validate the input` by §21.11's own completeness check.
    //
    // `recorded === undefined` is the sixth clause and it is the one that earns its place. A door
    // built with a **no-op** `record the decision` passes every check `assertPipeline` can make — the
    // name is there, the flag is on, it applies to both kinds — and used to issue an invoice, answer
    // `COMMITTED`, and write nothing at all. A list check cannot see what a function does. A receipt
    // can: the stage leaves its record id in the context, and this refuses without one.
    //
    // So the rule is: **if there is no evidence, nothing happens.** That is `DSOR-EXE-03b`'s decision
    // branch, and it now holds even when the stage that writes the evidence has been replaced.
    if (
      principal === undefined ||
      contract === undefined ||
      given === undefined ||
      hash === undefined ||
      handler === undefined ||
      recorded === undefined
    ) {
      // Named inside the block, not computed above it. Both existed for a while — a ternary chain
      // that picked the name, *and* these clauses for the narrowing — and a mutation sweep found the
      // duplication by flipping each copy with no test failing. One `if`, and the name is worked out
      // only on the path that needs it.
      const absent =
        principal === undefined
          ? "a principal"
          : contract === undefined
            ? "a contract"
            : given === undefined
              ? "its arguments"
              : hash === undefined
                ? "a payload hash"
                : handler === undefined
                  ? "any code to carry it out"
                  : "a record of the decision";
      const askedBy = principal?.id ?? "(nobody)";

      return Object.freeze({
        kind: "error",
        askedBy,
        envelope: refusal(
          "INTERNAL_ERROR",
          `${nameOf(id)} finished the pipeline without ${absent}`,
          id_,
          principal === undefined ? undefined : askedBy,
        ),
      });
    }

    // §21.14 — execute. The only thing that happens after every check has said yes.
    return Object.freeze(handler(given, contract, principal.id, hash, id_));
  };
}

/**
 * The one door this program has.
 *
 * NEW IN STEP 07: this is no longer a function whose *shape* is the order of the checks. It is a
 * door built from the checklist in `PIPELINE`, and the order lives there where a test can read it.
 */
export const callOperation: Door = makeDoor(PIPELINE);
