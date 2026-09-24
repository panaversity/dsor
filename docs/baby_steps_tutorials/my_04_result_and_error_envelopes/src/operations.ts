// A caller names an operation instead of calling a function.
//
// NEW IN STEP 04: nothing here throws at a caller any more. Every refusal comes back as
// an error envelope with a code from §28 and a retry class, so a caller can act on the
// answer instead of reading a sentence. And invoice.issue — the command split out of
// step 03 — is carried out here, because a command is what makes an envelope worth
// having: "this invoice is already issued" needs a code, and a read's refusals are too
// thin to show why.
//
// Rule DSOR-OPR-01: every operation MUST have a contract.
// Rule DSOR-ERR-01a: every error MUST validate against error-envelope.schema.json.

import { refusal, success, type ErrorEnvelope, type ResultEnvelope } from "./envelopes.ts";
import { getInvoice, issueInvoice, TENANT, type Invoice } from "./invoice.ts";
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
  const given = args["invoice"];

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
): void {
  for (const id of contracts.keys()) {
    if (named[id] === undefined && !waiting.has(id)) {
      throw new TypeError(`${id} has a contract and no handler`);
    }
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
  }
}

// Start-up, not first request. This and the loadRegistry above it are the whole of
// "refused before anything runs".
//
// Wrapped so that deleting it cannot be silent. No test can watch a line at module scope
// run — by the time a test imports this file it already has — but a test can ask whether
// the constant exists, and it only exists if the check ran.
export const WIRING_CHECKED: boolean = ((): boolean => {
  assertPaired(registry, handlers);

  return true;
})();

/** The operations this program can answer to. */
export function operationIds(): string[] {
  return [...registry.keys()];
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

  return handler(args, contract);
}
