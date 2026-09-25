// What the contract, registry, and envelope tests share. Not a test file itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { handlers } from "../src/operations.ts";
import {
  buildRegistry,
  readContracts,
  type ContractSource,
  type Handler,
  type Registry,
} from "../src/registry.ts";

const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));

// The contracts this step ships, read from disk the way start-up reads them.
export const shipped: ContractSource[] = readContracts(CONTRACTS);

/** The shipped contract with this id, as a plain object the test may change. */
export function contract(id: string): Record<string, unknown> {
  const source = shipped.find((s) => (JSON.parse(s.text) as { id: string }).id === id);
  if (!source) throw new Error(`no shipped contract ${id}`);
  return JSON.parse(source.text) as Record<string, unknown>;
}

/** A contract as a file would hold it. */
export function source(data: unknown, file = "test.json"): ContractSource {
  return { file, text: JSON.stringify(data) };
}

/** The shipped contracts, with one of them replaced. */
export function shippedWith(changed: Record<string, unknown>): ContractSource[] {
  return shipped.map((s) =>
    (JSON.parse(s.text) as { id: string }).id === changed["id"] ? source(changed, s.file) : s,
  );
}

/** The message a refusal carried, or "" when nothing was refused. */
export function refusal(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

/** A copy of the contract with one field removed. */
export function without(data: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...data };
  delete copy[field];
  return copy;
}

// NEW IN STEP 04: the tests' own check for error envelopes. It is built here from the
// schema file, not imported from src, so a broken check in src cannot pass its own work.
type EnvelopeSchema = { properties: { code: { anyOf: [{ enum: string[] }, unknown] } } };
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(loadSchema("common.schema.json"));
const envelopeSchema = loadSchema("error-envelope.schema.json") as EnvelopeSchema;
const checkEnvelope = ajv.compile(envelopeSchema);

/** Every problem the schema finds in an error envelope. None means it passes. */
export function schemaProblems(envelope: unknown): string[] {
  if (checkEnvelope(envelope)) return [];
  return (checkEnvelope.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/** The codes the error envelope's schema lists: the §28 table's codes. */
export const SCHEMA_CODES: string[] = envelopeSchema.properties.code.anyOf[0].enum;

/** A real registry: the shipped operations, plus "test.run", whose code the test writes. */
export function registryWith(handler: Handler): Registry {
  const testRun = { ...contract("invoice.get"), id: "test.run" };
  return buildRegistry([...shipped, source(testRun, "test.run.json")], {
    ...handlers,
    "test.run": handler,
  });
}
