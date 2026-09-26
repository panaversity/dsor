// What the contract, registry, and envelope tests share. Not a test file itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import type { Answer, ErrorCode } from "../src/envelope.ts";
import { Refusal } from "../src/envelope.ts";
import { handlers } from "../src/operations.ts";
import {
  buildRegistry,
  call,
  readContracts,
  type ContractSource,
  type Handler,
  type Registry,
} from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";

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

// The tests' own check for error envelopes. It is built here from the
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

// NEW IN STEP 05: the login tokens DSoR gave, typed out again from step 05's decision 3
// rather than imported from src, so a mistake in src is not copied into the tests.
export const AGENT: RequestEnvelope = { token: "tok_7f3a" };
export const SUPERVISOR: RequestEnvelope = { token: "tok_2c91" };
export const CFO: RequestEnvelope = { token: "tok_d4e8" };

// NEW IN STEP 05: who an answer names as its caller (step 05's README, decision 9). An
// answer given before DSoR knows who is calling names nobody.
export type Caller = { agent_id?: string; principal_id?: string };
export const THE_AGENT: Caller = { agent_id: "accounts-payable-fte" };
export const NOBODY: Caller = {};

/** NEW IN STEP 05: an answer's correlation: a request id DSoR made, and the caller. */
export function correlationFor(caller: Caller): Record<string, unknown> {
  return { request_id: expect.stringMatching(REQUEST_ID), ...caller };
}

// NEW IN STEP 05: the messages of this step's refusals, typed out rather than imported.
export const LOG_IN_FIRST = "log in first: the call has no login token that DSoR gave";
export const BAD_REQUEST_ID = "a request_id must be text of 1 to 128 characters";

/** NEW IN STEP 05: the message when the arguments name someone else in this place. */
export function notTheCaller(place: string): string {
  return `the arguments name someone other than the caller, in ${place}`;
}

/** A real registry: the shipped operations, plus "test.run", whose code the test writes. */
export function registryWith(handler: Handler): Registry {
  const testRun = { ...contract("invoice.get"), id: "test.run" };
  return buildRegistry([...shipped, source(testRun, "test.run.json")], {
    ...handlers,
    "test.run": handler,
  });
}

/** The shipped operations and their code, as start-up builds them. */
export const registry: Registry = buildRegistry(shipped, handlers);

/** Calls "test.run", an operation whose code is the handler the test wrote. */
export function run(handler: Handler): Answer {
  // NEW IN STEP 05: as the agent, with its login token.
  return call(registryWith(handler), AGENT, "test.run", {});
}

/** Calls "test.run", whose code refuses with this code. */
export function refusedWith(code: ErrorCode): Answer {
  return run(() => {
    throw new Refusal(code, "refused on purpose");
  });
}

// "req_" and a random UUID (step 04's README, decision 4).
export const REQUEST_ID: RegExp =
  /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The one message a bug's envelope carries, typed out again rather than imported from src.
export const UNEXPECTED = "DSoR hit an unexpected error";

// invoice.issue with code. A command must be refused before its code runs (step 04's
// README, decision 1).
const issueHasCode = buildRegistry(shipped, { ...handlers, "invoice.issue": () => "issued" });

// Every refusal this step can give: its code and its message (step 04's README, decision
// 7). Each one is a function, so each test makes its own call.
// NEW IN STEP 05: each also says who the answer names as its caller (step 05's README,
// decision 9). The first three are this step's refusals.
export const REFUSALS: [string, () => Answer, ErrorCode, string, Caller][] = [
  [
    "a call with no login",
    () => call(registry, {}, "invoice.get", { id: "INV-1008" }),
    "AUTHENTICATION_REQUIRED",
    LOG_IN_FIRST,
    NOBODY,
  ],
  [
    "a request id that is empty",
    () => call(registry, { ...AGENT, request_id: "" }, "invoice.get", { id: "INV-1008" }),
    "VALIDATION_FAILED",
    BAD_REQUEST_ID,
    THE_AGENT,
  ],
  [
    "the agent naming cfo_100 in its arguments",
    () => call(registry, AGENT, "invoice.get", { id: "INV-1008", principal: "cfo_100" }),
    "AUTHORIZATION_DENIED",
    notTheCaller("principal"),
    THE_AGENT,
  ],
  [
    "an operation with no contract",
    () => call(registry, AGENT, "invoice.delete", {}),
    "UNSUPPORTED_CAPABILITY",
    'no operation named "invoice.delete"',
    THE_AGENT,
  ],
  [
    "invoice.issue, which has no code yet",
    () => call(registry, AGENT, "invoice.issue", {}),
    "UNSUPPORTED_CAPABILITY",
    '"invoice.issue" is not built yet',
    THE_AGENT,
  ],
  [
    "invoice.issue given code, because it is a command",
    () => call(issueHasCode, AGENT, "invoice.issue", {}),
    "UNSUPPORTED_CAPABILITY",
    '"invoice.issue" is a command, and commands are not built yet',
    THE_AGENT,
  ],
  [
    "invoice.get without a text id",
    () => call(registry, AGENT, "invoice.get", {}),
    "VALIDATION_FAILED",
    "invoice.get needs { id: string }",
    THE_AGENT,
  ],
  [
    "invoice.get for INV-9999",
    () => call(registry, AGENT, "invoice.get", { id: "INV-9999" }),
    "RESOURCE_NOT_FOUND",
    'no invoice "INV-9999"',
    THE_AGENT,
  ],
  [
    "a bug in an operation's code",
    () =>
      run(() => {
        throw new Error("boom");
      }),
    "INTERNAL_ERROR",
    UNEXPECTED,
    THE_AGENT,
  ],
];
