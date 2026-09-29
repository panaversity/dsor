// A caller names an operation instead of calling a function.
//
// NEW IN STEP 04: nothing here throws at a caller. Every refusal comes back as an error envelope
// with a code from §28 and a retry class, so a caller can act on the answer instead of reading a
// sentence.
//
// That sentence is only true because of the guard at the top of callOperation, and it was not
// true when this step was first written: an argument that could not be turned into JSON let the
// invoice be issued and *then* threw. An audit caught the claim before it caught the bug. The
// comment beside the guard says what it is for. And invoice.issue — the command split out of
// step 03 — is carried out here, because a command is what makes an envelope worth
// having: "this invoice is already issued" needs a code, and a read's refusals are too
// thin to show why.
//
// Rule DSOR-OPR-01: every operation MUST have a contract.
// Rule DSOR-ERR-01a: every error MUST validate against error-envelope.schema.json.

import { refusal, success, type ErrorEnvelope, type ResultEnvelope } from "./envelopes.ts";
import { getInvoice, issueInvoice, type Invoice } from "./invoice.ts";
import { TENANT } from "./tenant.ts";
import { contractsFromDisk, loadRegistry, type OperationContract } from "./registry.ts";
import { parseUri } from "./uri.ts";

// Built once, when this module is first loaded. A contract that does not validate stops
// the program here, before any caller gets a turn. That is DSOR-OPR-02a.
const registry = loadRegistry(contractsFromDisk());

/**
 * What an operation answers with.
 *
 * NEW IN STEP 04, and the shape is deliberately lopsided. A refusal always comes back
 * in an error envelope. A command's success comes back in a result envelope. A *query's*
 * success does not — there is no outcome value in result-envelope.schema.json that means
 * "here is the data you asked for", so a read keeps handing back the invoice. The README
 * explains the gap rather than papering over it.
 */
export type OperationAnswer =
  | { readonly kind: "data"; readonly invoice: Invoice }
  | { readonly kind: "result"; readonly envelope: ResultEnvelope }
  | { readonly kind: "error"; readonly envelope: ErrorEnvelope };

type Handler = (
  args: Readonly<Record<string, unknown>>,
  contract: OperationContract,
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
      ),
    };
  }

  let parsed;

  try {
    parsed = parseUri(given);
  } catch (error) {
    return { refused: refusal("VALIDATION_FAILED", (error as Error).message) };
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
      ),
    };
  }

  if (parsed.entity !== namedFor) {
    return {
      refused: refusal(
        "VALIDATION_FAILED",
        `${contract.id} is named for ${namedFor}, and ${given} names ${parsed.entity}`,
      ),
    };
  }

  return { id: parsed.id };
}

const handlers: Readonly<Record<string, Handler>> = {
  "invoice.get": (args, contract) => {
    const read = invoiceIdFrom(args, contract);

    if ("refused" in read) {
      return { kind: "error", envelope: read.refused };
    }

    const invoice = getInvoice(read.id);

    // Step 03 answered `undefined` here and left the caller to work out why. An absent
    // invoice is still an ordinary answer, and now it says so in a way a caller can act
    // on: RESOURCE_NOT_FOUND, retry never.
    if (invoice === undefined) {
      return {
        kind: "error",
        envelope: refusal("RESOURCE_NOT_FOUND", `${read.id} is not an invoice we hold`),
      };
    }

    return { kind: "data", invoice };
  },

  "invoice.issue": (args, contract) => {
    const read = invoiceIdFrom(args, contract);

    if ("refused" in read) {
      return { kind: "error", envelope: read.refused };
    }

    const outcome = issueInvoice(read.id);

    if (outcome.kind === "not_found") {
      return {
        kind: "error",
        envelope: refusal("RESOURCE_NOT_FOUND", `${read.id} is not an invoice we hold`),
      };
    }

    // CONFLICT, and never retryable. A business rule says no, and asking again with the
    // same request cannot change that — only a human changing the invoice could.
    if (outcome.kind === "not_draft") {
      return {
        kind: "error",
        envelope: refusal(
          "CONFLICT",
          `${read.id} is ${outcome.status}, and only a draft invoice can be issued`,
        ),
      };
    }

    return {
      kind: "result",
      envelope: success({
        data: outcome.invoice as unknown as Record<string, unknown>,
        semantics: contract.execution?.semantics ?? "atomic",
        payload: args,
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
 * Calls one operation by name.
 *
 * There is deliberately no caller, no permission check and no ordered checklist here. Who
 * is asking arrives in step 05, whether they may in step 06, and the fixed order of
 * checks in step 07. This is a lookup, a call, and an envelope.
 */
export function callOperation(
  id: string,
  args: Readonly<Record<string, unknown>>,
): OperationAnswer {
  // NEW IN STEP 04, and it is here because of what this step *promises*. "Every refusal comes
  // back as an envelope" is not true if a path can throw instead, and one could: the arguments
  // belong to the caller, and `success()` fingerprints them **after** the invoice has been
  // issued. So an argument that cannot be turned into JSON — a circular object, a BigInt, a
  // getter that throws — used to let the change happen and then throw on the way out. The caller
  // got a crash for a command that had succeeded, with no envelope and no code.
  //
  // Two things fix it, and both belong before anything runs:
  //
  // The arguments are copied **once**, here, and nothing below looks at the original again. A
  // property can be a *getter*, so reading it twice can give two answers — and these arguments
  // were read twice, once to choose the invoice and once to fingerprint the receipt. A caller
  // could make the receipt describe a request that never happened. `{ ...args }` runs every
  // getter exactly once.
  //
  // And if the copy cannot be written down, nothing runs at all. Writing it down *before* doing
  // it is a rule of its own, DSOR-EXE-03a, and step 08 builds the real version.
  let given: Readonly<Record<string, unknown>>;

  try {
    given = Object.freeze({ ...args });
    JSON.stringify(given);
  } catch {
    return {
      kind: "error",
      envelope: refusal(
        "VALIDATION_FAILED",
        `${id} was given arguments that cannot be written down`,
      ),
    };
  }

  const contract = registry.get(id);
  const handler = handlers[id];

  // UNSUPPORTED_CAPABILITY, retry never. The caller asked for something this system does
  // not offer; asking again will not make it appear.
  if (contract === undefined || handler === undefined) {
    return {
      kind: "error",
      envelope: refusal(
        "UNSUPPORTED_CAPABILITY",
        `${id} is not an operation: this program has no contract for it`,
      ),
    };
  }

  return handler(given, contract);
}
