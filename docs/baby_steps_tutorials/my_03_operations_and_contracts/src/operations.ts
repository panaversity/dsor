// NEW IN STEP 03: a caller names an operation instead of calling a function.
//
// Before this step, code called getInvoice("INV-1008") directly. Now it names
// `invoice.get` and passes arguments, and the name is looked up in the registry. An
// operation with no contract cannot be called, which is the point: the contract is
// where every later rule attaches. Permissions read it in step 06, the pipeline reads
// it in step 07, controls read its risk level in step 27.
//
// Rule DSOR-OPR-01: every operation MUST have a contract.

import { getInvoice, issueInvoice, TENANT, type Invoice } from "./invoice.ts";
import { contractsFromDisk, loadRegistry, type OperationContract } from "./registry.ts";
import { parseUri } from "./uri.ts";

// Built once, when this module is first loaded. A contract that does not validate stops
// the program here, before any caller gets a turn. That is DSOR-OPR-02a.
const registry = loadRegistry(contractsFromDisk());

/**
 * What an operation answers with, for now.
 *
 * Both of this step's operations return one invoice, or `undefined` when there is no
 * such invoice. In step 04 this becomes a result envelope with an outcome, and the
 * refusals below stop being thrown errors and become error envelopes with a code.
 */
export type OperationResult = Invoice | undefined;

type Handler = (
  args: Readonly<Record<string, unknown>>,
  contract: OperationContract,
) => OperationResult;

/**
 * Reads the `invoice` argument as a canonical address and returns the invoice id.
 *
 * This is where step 02's promise is kept. An address carries an entity segment, and
 * until now nothing checked it against anything. An operation is named for the entity
 * it works on — `invoice.get` works on `invoice` — so the two must agree.
 */
function invoiceIdFrom(
  args: Readonly<Record<string, unknown>>,
  contract: OperationContract,
): string {
  const given = args["invoice"];

  if (typeof given !== "string") {
    throw new TypeError(`${contract.id} needs an invoice address, and got ${typeof given}`);
  }

  const { tenant, entity, id } = parseUri(given);
  const namedFor = contract.id.split(".")[0];

  // The address names a company, and this program serves exactly one. Reading the
  // tenant and then ignoring it would be worse than not parsing it: the caller asks for
  // org_999's invoice and quietly gets org_456's. Real multi-tenancy is step 10; the
  // point here is that a part of the address we read is a part we honour.
  if (tenant !== TENANT) {
    throw new TypeError(`${given} is for ${tenant}, and this program serves ${TENANT}`);
  }

  if (entity !== namedFor) {
    throw new TypeError(`${contract.id} is named for ${namedFor}, and ${given} names ${entity}`);
  }

  return id;
}

const handlers: Readonly<Record<string, Handler>> = {
  "invoice.get": (args, contract) => getInvoice(invoiceIdFrom(args, contract)),
  "invoice.issue": (args, contract) => issueInvoice(invoiceIdFrom(args, contract)),
};

/**
 * Checks the contracts and the handlers against each other.
 *
 * A contract with no handler is a promise nothing keeps. A handler with no contract is
 * an unnamed operation, which is the thing §7 exists to prevent. It takes both lists as
 * arguments rather than reading the module's own, so a test can hand it a mismatched
 * pair — and so it can run at start-up, below, rather than on the first request.
 */
export function assertPaired(
  contracts: ReadonlyMap<string, OperationContract>,
  named: Readonly<Record<string, Handler>>,
): void {
  for (const id of contracts.keys()) {
    if (named[id] === undefined) {
      throw new TypeError(`${id} has a contract and no handler`);
    }
  }

  for (const id of Object.keys(named)) {
    if (!contracts.has(id)) {
      throw new TypeError(`${id} has a handler and no contract`);
    }
  }
}

// Start-up, not first request. This line and the loadRegistry above it are the whole of
// "refused before anything runs".
assertPaired(registry, handlers);

/** The operations this program can answer to. */
export function operationIds(): string[] {
  return [...registry.keys()];
}

/**
 * Calls one operation by name.
 *
 * There is deliberately no caller, no permission check and no ordered checklist here.
 * Who is asking arrives in step 05, whether they may arrives in step 06, and the fixed
 * order of checks arrives in step 07. This is a lookup and a call, nothing more.
 */
export function callOperation(
  id: string,
  args: Readonly<Record<string, unknown>>,
): OperationResult {
  const contract = registry.get(id);
  const handler = handlers[id];

  if (contract === undefined || handler === undefined) {
    throw new TypeError(`${id} is not an operation this program has a contract for`);
  }

  return handler(args, contract);
}
