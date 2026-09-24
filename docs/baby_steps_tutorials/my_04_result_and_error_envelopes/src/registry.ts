// the spec sheet is a document, and a bad one stops the program.
//
// An operation is a named thing a caller can do: `invoice.get`, `invoice.issue`. Its
// *contract* is a document describing it — does it read or change, which permission it
// needs, how risky it is, whether it can be undone. The contracts live in
// src/contracts/ as JSON, because a spec sheet is data, not code.
//
// The registry loads them all when the program starts and refuses a bad one there and
// then. Refusing later, on the first request that happens to use it, would mean a
// broken contract could sit unnoticed for months.
//
// Rule DSOR-OPR-01: every operation MUST have a contract that validates against
// operation-contract.schema.json.
// Rule DSOR-OPR-02a: the registry MUST reject a contract that omits a mandatory field.
// Rule DSOR-OPR-02b: the registry MUST NOT infer a default for risk level, execution
// semantics, effect, or idempotency.

import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

/**
 * The parts of a contract this step actually reads.
 *
 * The schema knows every field; this type names only what our code touches, so it does
 * not pretend to understand the rest. The optional fields are optional because the
 * schema requires them for a command and not for a query.
 */
export interface OperationContract {
  readonly id: string;
  readonly version: number;
  readonly kind: "query" | "command";
  readonly effect: "read" | "additive" | "mutating" | "destructive";
  readonly authorization: { readonly permission: string };
  readonly risk: { readonly level: "low" | "medium" | "high" | "critical" };
  readonly audit: { readonly level: "minimal" | "standard" | "full" };
  readonly idempotency?: { readonly required: boolean };
  readonly execution?: { readonly semantics: string };
}

/** One contract document, with where it came from, so a refusal can say which file. */
export interface ContractDocument {
  readonly where: string;
  readonly document: unknown;
  /**
   * The operation this file is supposed to describe.
   *
   * Without it, two contract files could swap their `id` fields and every handler would
   * quietly run against the wrong spec sheet: `invoice.get` carrying a command's risk
   * level and permission, `invoice.issue` carrying a query's. Nothing would crash.
   */
  readonly expectedId?: string;
}

const read = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as object;

// Both schema files are copied byte for byte from packages/spec/schemas/. They are the
// specification's own, not a version of our own making: DSOR-OPR-01 names
// operation-contract.schema.json, so checking against anything else would not be that
// rule. The step keeps its own copies because a step has to run outside this repository.
//
// operation-contract.schema.json refers to common.schema.json eleven times, to seven of
// its definitions, so both have to be registered. ajv resolves those references when the schema is fetched, not
// when it is added, so registering them in either order works — and forgetting `common`
// gives "can't resolve reference urn:dsor:schema:1.3:common#/$defs/operationId".
//
// `strict: false` is what packages/spec uses, and it is needed: under `strict: true`
// thirteen of the specification's fourteen schemas refuse to compile, because the
// if/then blocks declare `required` without repeating `type`. It has a cost, and the
// README's Break it section shows it: a misspelled keyword is silently ignored.
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/operation-contract.schema.json"));

const compiled = ajv.getSchema("urn:dsor:schema:1.3:operation-contract");

if (compiled === undefined) {
  throw new Error("the operation-contract schema did not compile");
}

// Assigned to a second name on purpose. TypeScript narrows `compiled` here, but that
// narrowing does not reach inside the functions below, so they would still see
// "possibly undefined". Copying it into a const captures the narrowed type. Writing
// `compiled!` everywhere would silence the question instead of answering it.
const checkContract = compiled;

/**
 * Checks one contract document, or refuses it.
 *
 * `where` is only for the message. A refusal that does not say which file is wrong
 * sends the reader looking through all of them.
 */
export function validateContract(document: unknown, where: string): OperationContract {
  if (checkContract(document) !== true) {
    const problems = (checkContract.errors ?? [])
      .map((e) => `${e.instancePath === "" ? "(root)" : e.instancePath} ${e.message ?? ""}`)
      .join("; ");

    throw new TypeError(`${where} is not a valid operation contract: ${problems}`);
  }

  // Frozen for the same reason step 02's parsed addresses are: `readonly` above is
  // erased before Node runs the file, so it stops nothing at run time.
  //
  // All the way down, not just the top level. `risk`, `audit` and `authorization` are
  // objects of their own, and callOperation hands the whole contract to a handler — so a
  // shallow freeze would let anything downstream lower the risk level or blank the audit
  // level for the rest of the run.
  return deepFreeze(document) as OperationContract;
}

/** Freezes an object and everything inside it. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const inner of Object.values(value)) {
    deepFreeze(inner);
  }

  return Object.freeze(value);
}

/**
 * Builds the registry, or refuses to build at all.
 *
 * Every contract is checked here, as the registry is made. That is what "refused at
 * start-up" means, and it is why this takes documents rather than reading the files
 * itself: a test can hand it a broken one without a broken file on disk.
 */
export function loadRegistry(
  documents: readonly ContractDocument[],
): ReadonlyMap<string, OperationContract> {
  const registry = new Map<string, OperationContract>();

  for (const { where, document, expectedId } of documents) {
    const contract = validateContract(document, where);

    if (expectedId !== undefined && contract.id !== expectedId) {
      throw new TypeError(`${where} should describe ${expectedId}, and declares ${contract.id}`);
    }

    if (registry.has(contract.id)) {
      throw new TypeError(`${where} declares ${contract.id}, which another contract already has`);
    }

    registry.set(contract.id, contract);
  }

  return registry;
}

/** Reads every contract file that ships with this step. */
export function contractsFromDisk(): readonly ContractDocument[] {
  // Named one by one rather than by listing the folder, so that adding a contract is a
  // visible edit here. A step that scanned a directory could pick up a stray file.
  return ["invoice.get", "invoice.issue"].map((id) => ({
    where: `src/contracts/${id}.json`,
    expectedId: id,
    document: read(`./contracts/${id}.json`),
  }));
}
