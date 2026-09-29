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
        undefined,
        askedBy,
      ),
    };
  }

  let parsed;

  try {
    parsed = parseUri(given);
  } catch (error) {
    return { refused: refusal("VALIDATION_FAILED", (error as Error).message, undefined, askedBy) };
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
        undefined,
        askedBy,
      ),
    };
  }

  if (parsed.entity !== namedFor) {
    return {
      refused: refusal(
        "VALIDATION_FAILED",
        `${contract.id} is named for ${namedFor}, and ${given} names ${parsed.entity}`,
        undefined,
        askedBy,
      ),
    };
  }

  return { id: parsed.id };
}

const handlers: Readonly<Record<string, Handler>> = {
  "invoice.get": (args, contract, askedBy) => {
    const read = invoiceIdFrom(args, contract, askedBy);

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
          undefined,
          askedBy,
        ),
      };
    }

    return { kind: "data", askedBy, invoice };
  },

  "invoice.issue": (args, contract, askedBy, hash) => {
    const read = invoiceIdFrom(args, contract, askedBy);

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
          undefined,
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
          undefined,
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
const refuse = (askedBy: string, code: string, message: string): StageResult =>
  Object.freeze({
    kind: "refused" as const,
    answer: Object.freeze({
      kind: "error" as const,
      askedBy,
      envelope: refusal(code, message, undefined, askedBy === "(nobody)" ? undefined : askedBy),
    }),
  });

const carryOn = (context: Context): StageResult => ({ kind: "carry_on", context });

/** §21.1 — who is asking. Nothing else is looked at until this answers. */
const authenticate: Stage["run"] = (context) => {
  const who = principalFrom(context.login);

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
  const contract = registry.get(context.id);

  if (contract === undefined || handlers[context.id] === undefined) {
    return refuse(
      context.principal?.id ?? "(nobody)",
      "UNSUPPORTED_CAPABILITY",
      `${context.id} is not an operation: this program has no contract for it`,
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
    );
  }

  if (!holds(principal, contract.authorization.permission)) {
    return refuse(
      principal.id,
      "AUTHORIZATION_DENIED",
      `${principal.id} may not call ${context.id}`,
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
      `${context.id} was given arguments that cannot be written down`,
    );
  }
};

const stage = (
  at: number | null,
  name: string,
  applies: Stage["applies"],
  run: Stage["run"],
): Stage => Object.freeze({ at, name, applies, run });

/** The checklist, in order. Later steps add lines; they never reorder them. */
export const PIPELINE: readonly Stage[] = Object.freeze([
  stage(1, "authenticate", "both", authenticate),
  stage(null, "resolve the operation", "both", resolveTheOperation),
  stage(5, "authorize", "both", authorize),
  stage(6, "validate the input", "both", validateTheInput),
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
) => OperationAnswer;

/**
 * Builds a door from a checklist.
 *
 * The list is checked **as the door is built**, not on the first request and not by trusting
 * whoever built it. A door whose order cannot be trusted should not exist, because the order is
 * the guarantee.
 */
export function makeDoor(stages: readonly Stage[]): Door {
  assertPipeline(stages);

  return (login, id, args) => {
    const walked = runPipeline(stages, { login, id, args });

    if (walked.kind === "refused") {
      return walked.answer;
    }

    const { principal, contract, given, payloadHash: hash } = walked.context;
    const handler = contract === undefined ? undefined : handlers[contract.id];

    // Every one of these is filled by a stage, and `assertPipeline` refuses a list that is missing
    // the stage which fills it. What it cannot refuse is a stage that says it carried on without
    // doing its job — so if the walk ends without something the execution needs, that is a bug in
    // this program rather than anything the caller did, which is what INTERNAL_ERROR means. Retry
    // `never`: asking again cannot fix a broken pipeline.
    if (
      principal === undefined ||
      contract === undefined ||
      given === undefined ||
      hash === undefined ||
      handler === undefined
    ) {
      const askedBy = principal?.id ?? "(nobody)";

      return Object.freeze({
        kind: "error",
        askedBy,
        envelope: refusal(
          "INTERNAL_ERROR",
          `${id} finished the pipeline without everything a call needs`,
          undefined,
          principal === undefined ? undefined : askedBy,
        ),
      });
    }

    // §21.14 — execute. The only thing that happens after every check has said yes.
    return Object.freeze(handler(given, contract, principal.id, hash));
  };
}

/**
 * The one door this program has.
 *
 * NEW IN STEP 07: this is no longer a function whose *shape* is the order of the checks. It is a
 * door built from the checklist in `PIPELINE`, and the order lives there where a test can read it.
 */
export const callOperation: Door = makeDoor(PIPELINE);
