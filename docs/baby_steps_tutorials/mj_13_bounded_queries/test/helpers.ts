// What the contract, registry, and envelope tests share. Not a test file itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import type { Answer, ErrorCode } from "../src/envelope.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import { Refusal } from "../src/envelope.ts";
import { memoryInvoices } from "../src/invoice.ts";
import { handlersFor } from "../src/operations.ts";
import { readRoles, type RoleSource } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import {
  buildRegistry,
  readContracts,
  type ContractSource,
  type Handler,
  type Registry,
} from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";

const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));

// The contracts this step ships, read from disk the way start-up reads them.
export const shipped: ContractSource[] = readContracts(CONTRACTS);

// The role table this step ships, read from disk the way start-up reads it.
const ROLES = fileURLToPath(new URL("../roles.json", import.meta.url));
export const shippedRoles: RoleSource = readRoles(ROLES);

// The input schemas this step ships, read from disk the way start-up reads
// them (step 07's README, decision 2).
const INPUTS = fileURLToPath(new URL("../inputs", import.meta.url));
export const shippedInputs: ContractSource[] = readContracts(INPUTS);

/** The shipped input schemas, with one file's text replaced, or removed. */
export function inputsWith(file: string, text: string | undefined): ContractSource[] {
  const others = shippedInputs.filter((s) => s.file !== file);
  return text === undefined ? others : [...others, { file, text }];
}

// An input for invoice.issue that passes line ⑥, and one that does not.
export const GOOD_ISSUE = { invoice: "dsor://org_456/invoice/INV-1008" };
export const BAD_ISSUE = { invoice: "INV-1008" };

/** The message when line ⑥ refuses an input. */
export function notValid(name: string, problem: string): string {
  return `the input of "${name}" is not valid: ${problem}`;
}

// What each role grants, typed out again from step 06's decision 6 rather
// than read from roles.json, so a mistake in the file is not copied into the tests.
export const STARTING_ROLES: Record<string, string[]> = {
  ap_agent: ["invoice:read"],
  ap_supervisor: ["invoice:read", "invoice:issue"],
  CFO: ["invoice:read"],
};

/** A role table as a file would hold it. */
export function rolesFile(table: unknown): RoleSource {
  return { file: "roles.json", text: JSON.stringify(table) };
}

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

// The login tokens DSoR gave, typed out again from step 05's decision 3
// rather than imported from src, so a mistake in src is not copied into the tests.
// Each names the company it works in (step 10's README, decision 1).
export const AGENT: RequestEnvelope = { token: "tok_7f3a", tenant: "org_456" };
export const SUPERVISOR: RequestEnvelope = { token: "tok_2c91", tenant: "org_456" };
export const CFO: RequestEnvelope = { token: "tok_d4e8", tenant: "org_456" };

// The accounting firm's agent, in each of its two companies, and
// org_789's own supervisor. Typed out again from step 10's README, decision 7.
export const FIRM_IN_456: RequestEnvelope = { token: "tok_9b52", tenant: "org_456" };
export const FIRM_IN_789: RequestEnvelope = { token: "tok_9b52", tenant: "org_789" };
export const USER_700: RequestEnvelope = { token: "tok_e1a7", tenant: "org_789" };

// The messages of step 10's refusals, typed out rather than imported.
export const BAD_TENANT = "a tenant must be an id like org_456, named in the request envelope";
export const NOT_A_MEMBER = "the caller may not work in the tenant it named";
export const FOREIGN_URI = "the arguments name a resource outside the active tenant";

/** The message when the envelope carries a field besides its three (step 10's decision 11). */
export function extraField(field: string): string {
  return `the request envelope may carry only token, tenant, and request_id, not "${field}"`;
}

// The name under which a record keeps the company a caller claimed (step 10's decision 6).
export const OUR_EXTENSIONS = "org.panaversity.steps";

/** The message when the arguments name a tenant other than the active one, in this place. */
export function otherTenant(place: string): string {
  return `the arguments name a tenant other than the active one, in ${place}`;
}

// The invoices of both companies, typed out again from step 10's README,
// decisions 5 and 10, rather than read from src or the migration. Each carries its company.
export const INV_1008_OF_456 = {
  tenant_id: "org_456",
  id: "INV-1008",
  vendor_id: "VENDOR-44",
  amount: { value: "31400.00", currency: "USD" },
  open_amount: { value: "31400.00", currency: "USD" },
  status: "issued",
};
export const INV_1008_OF_789 = {
  tenant_id: "org_789",
  id: "INV-1008",
  vendor_id: "VENDOR-77",
  amount: { value: "99000.00", currency: "USD" },
  open_amount: { value: "99000.00", currency: "USD" },
  status: "issued",
};
export const INV_2001_OF_789 = {
  tenant_id: "org_789",
  id: "INV-2001",
  vendor_id: "VENDOR-77",
  amount: { value: "12500.00", currency: "USD" },
  open_amount: { value: "12500.00", currency: "USD" },
  status: "issued",
};

/** An answer without its request id, so two answers can be compared word for word. */
export function withoutRequestId(answer: Answer): unknown {
  const { request_id: _made, ...rest } = answer.correlation;
  return { ...answer, correlation: rest };
}

// Who an answer names as its caller (step 05's README, decision 9). An
// answer given before DSoR knows who is calling names nobody.
export type Caller = { agent_id?: string; principal_id?: string };
export const THE_AGENT: Caller = { agent_id: "accounts-payable-fte" };
export const NOBODY: Caller = {};
// The two people, now that some calls are theirs to make.
export const THE_SUPERVISOR: Caller = { principal_id: "user_123" };
export const THE_CFO: Caller = { principal_id: "cfo_100" };
// The firm's agent, and org_789's supervisor.
export const THE_FIRM: Caller = { agent_id: "firm-ap-fte" };
export const THE_789_SUPERVISOR: Caller = { principal_id: "user_700" };

/** An answer's correlation: a request id DSoR made, and the caller. */
export function correlationFor(caller: Caller): Record<string, unknown> {
  return { request_id: expect.stringMatching(REQUEST_ID), ...caller };
}

/**
 * What an operation's code is handed as its company: the active one, with its invoices
 * (step 10's README, decision 13). Found by the Stage 2 review, and fixed from step 10 on.
 */
export function companyNamed(tenant: string): unknown {
  return expect.objectContaining({ tenant });
}

// The messages of step 05's refusals, typed out rather than imported.
export const LOG_IN_FIRST = "log in first: the call has no login token that DSoR gave";
// Well-formed, with no control characters (step 09's README, decision 16).
export const BAD_REQUEST_ID =
  "a request_id must be text of 1 to 128 characters, well-formed, with no control characters";

/** The message when the arguments name someone else in this place. */
export function notTheCaller(place: string): string {
  return `the arguments name someone other than the caller, in ${place}`;
}

/** The message when the caller does not hold the permission a call needs. */
export function notGranted(name: string, permission: string): string {
  return `"${name}" needs ${permission}, which the caller does not hold`;
}

/** A real registry: the shipped operations, plus "test.run", whose code the test writes. */
export function registryWith(handler: Handler): Registry {
  const testRun = { ...contract("invoice.get"), id: "test.run" };
  return buildRegistry(
    [...shipped, source(testRun, "test.run.json")],
    { ...handlers, "test.run": handler },
    // test.run needs invoice:read, as invoice.get does. The agent holds it.
    shippedRoles,
    shippedInputs,
    memoryInvoices(),
  );
}

/** A log for the tests that do not read it. Each test that reads one makes its own. */
export const log: MemoryLog = createLog();

// The shipped operations. They hold no store: the registry does (step 10's README, decision
// 13). Found by the Stage 2 review, and fixed from step 10 on.
export const handlers: Record<string, Handler> = handlersFor();

/**
 * The shipped operations, their code, and the role table, as start-up builds them, reading
 * the invoices in memory, so the unit tests need no database (step 09's README, decision 12).
 */
export const registry: Registry = buildRegistry(
  shipped,
  handlers,
  shippedRoles,
  shippedInputs,
  memoryInvoices(),
);

/** Calls "test.run", an operation whose code is the handler the test wrote. */
export function run(handler: Handler): Promise<Answer> {
  // As the agent, with its login token.
  // test.run takes invoice.get's input, and line ⑥ now checks it.
  return call(registryWith(handler), log, AGENT, "test.run", {
    invoice: "dsor://org_456/invoice/INV-1008",
  });
}

/** Calls "test.run", whose code refuses with this code. */
export function refusedWith(code: ErrorCode): Promise<Answer> {
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
// README, decision 1). Built with the role table too.
const issueHasCode = buildRegistry(
  shipped,
  { ...handlers, "invoice.issue": () => "issued" },
  shippedRoles,
);

// Every refusal this step can give: its code and its message (step 04's README, decision
// 7). Each one is a function, so each test makes its own call.
// Each also says who the answer names as its caller (step 05's README,
// decision 9). The first three are step 05's refusals.
export const REFUSALS: [string, () => Promise<Answer>, ErrorCode, string, Caller][] = [
  [
    "a call with no login",
    () => call(registry, log, {}, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }),
    "AUTHENTICATION_REQUIRED",
    LOG_IN_FIRST,
    NOBODY,
  ],
  [
    "a request id that is empty",
    () =>
      call(registry, log, { ...AGENT, request_id: "" }, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    "VALIDATION_FAILED",
    BAD_REQUEST_ID,
    THE_AGENT,
  ],
  [
    "the agent naming cfo_100 in its arguments",
    () =>
      call(registry, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
        principal: "cfo_100",
      }),
    "AUTHORIZATION_DENIED",
    notTheCaller("principal"),
    THE_AGENT,
  ],
  [
    "an operation with no contract",
    () => call(registry, log, AGENT, "invoice.delete", {}),
    "UNSUPPORTED_CAPABILITY",
    'no operation named "invoice.delete"',
    THE_AGENT,
  ],
  // The agent's one role grants invoice:read, and not invoice:issue.
  [
    "the agent calling invoice.issue, which no role of its grants",
    () => call(registry, log, AGENT, "invoice.issue", {}),
    "AUTHORIZATION_DENIED",
    notGranted("invoice.issue", "invoice:issue"),
    THE_AGENT,
  ],
  // user_123 holds invoice:issue, so these two calls get past the
  // permission check and hear that invoice.issue is not built yet (step 06's README, C5).
  [
    "invoice.issue, which has no code yet",
    // A good input, so the call also passes line ⑥.
    () => call(registry, log, SUPERVISOR, "invoice.issue", GOOD_ISSUE),
    "UNSUPPORTED_CAPABILITY",
    '"invoice.issue" is not built yet',
    THE_SUPERVISOR,
  ],
  [
    "invoice.issue given code, because it is a command",
    () => call(issueHasCode, log, SUPERVISOR, "invoice.issue", GOOD_ISSUE),
    "UNSUPPORTED_CAPABILITY",
    '"invoice.issue" is a command, and commands are not built yet',
    THE_SUPERVISOR,
  ],
  [
    // Refused by line ⑥, the input schema, and no longer by invoice.get's code.
    "invoice.get with no invoice",
    () => call(registry, log, AGENT, "invoice.get", {}),
    "VALIDATION_FAILED",
    notValid("invoice.get", "must have required property 'invoice'"),
    THE_AGENT,
  ],
  [
    "invoice.get for INV-9999",
    () => call(registry, log, AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" }),
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

// NEW IN STEP 13: so a test can type out a whole page on one line (step 13's README, C1).
/** The answer's page with each item cut down to "company/id", or the refusal as it is. */
export function idsOf(answer: Answer): unknown {
  if (!("data" in answer)) return answer;
  const { items, ...rest } = answer.data as { items: { tenant_id: string; id: string }[] };
  return { items: items.map(({ tenant_id, id }) => `${tenant_id}/${id}`), ...rest };
}

// NEW IN STEP 13: a caller that follows the cursor to the end (step 13's README, C3).
/** Every page `ask` gives, from the first, following next_cursor until a page has none. */
export async function walk(
  ask: (input: object) => Promise<unknown>,
  limit: number,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let cursor: string | undefined;
  // At most 20 pages, so a cursor that never ends cannot hang the test.
  for (let page = 0; page < 20; page++) {
    const answer = await ask(cursor === undefined ? { limit } : { limit, cursor });
    pages.push(answer);
    cursor = (answer as { next_cursor?: string }).next_cursor;
    if (cursor === undefined) break;
  }
  return pages;
}
