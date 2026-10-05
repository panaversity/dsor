// What the contract, registry, and envelope tests share. Not a test file itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect } from "vitest";
import type { Answer, ErrorCode } from "../src/envelope.ts";
import type { Freshness } from "../src/freshness.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import { Refusal } from "../src/envelope.ts";
import { memoryInvoices, type InvoiceStore } from "../src/invoice.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { readClassifications, type ClassificationSource } from "../src/labels.ts";
import { handlersFor } from "../src/operations.ts";
import { readRoles, type RoleTableSource } from "../src/permissions.ts";
import {
  fakeDirectory,
  type Directories,
  type FakeDirectory,
  type Person,
} from "../src/directory.ts";
import { call } from "../src/pipeline.ts";
import { memorySlips, NO_SLIPS, type SlipStore } from "../src/slips.ts";
import { logins, type Principal } from "../src/principals.ts";
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
export const shippedRoles: RoleTableSource = readRoles(ROLES);

// The input schemas this step ships, read from disk the way start-up reads
// them (step 07's README, decision 2).
const INPUTS = fileURLToPath(new URL("../inputs", import.meta.url));
export const shippedInputs: ContractSource[] = readContracts(INPUTS);

// The labels this step ships, read from disk the way start-up reads them (step 14's README,
// decision 1). A registry with a store of invoices names them first: the store is the last
// thing buildRegistry takes (step 10's README, decision 13).
export const shippedLabels: ClassificationSource = readClassifications();

/**
 * The shipped labels, with these kinds added, or these fields added to a kind the file has.
 * Found by the Stage 2 review, for its tests of labels at every depth (step 14's README,
 * decisions 1 and 7).
 */
export function labelsWith(changes: Record<string, Record<string, string>>): ClassificationSource {
  const table = JSON.parse(shippedLabels.text) as Record<string, Record<string, string>>;
  for (const [kind, fields] of Object.entries(changes)) table[kind] = { ...table[kind], ...fields };
  return { file: shippedLabels.file, text: JSON.stringify(table) };
}

/**
 * Runs `run` with one more principal in DSoR's table of logins, then takes it out again,
 * however `run` ends. The table holds two agents, both internal, so a test of another
 * clearance plants its own agent. Found by the Stage 2 review (step 14's README, decision 2).
 */
export async function withPlanted<T>(
  token: string,
  principal: Principal,
  run: () => T | Promise<T>,
): Promise<T> {
  const table = logins as Map<string, Principal>;
  table.set(token, principal);
  try {
    return await run();
  } finally {
    table.delete(token);
  }
}

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
// Step 17's decision 6 adds the payment permissions: the agent may create, the supervisor
// may create and cancel, and the CFO neither.
// Step 18 removes ap_agent: an agent holds no role (step 18's README, decision 11).
// NEW IN STEP 19: ap_clerk, which may only read invoices: the job user_123 moves to in the
// directory, in step 19's story (step 19's README, outcome 2).
export const STARTING_ROLES: Record<string, string[]> = {
  ap_supervisor: ["invoice:read", "invoice:issue", "payment:create", "payment:cancel"],
  CFO: ["invoice:read"],
  ap_clerk: ["invoice:read"],
};

/** A role table as a file would hold it. */
export function rolesFile(table: unknown): RoleTableSource {
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

/**
 * An answer without what each call makes anew, so two answers can be compared word for word:
 * its request id, and the time of its read.
 */
// And the time of the read, which each call's read has of its own (step 15's
// README, decision 2). Found while building step 15: the cross-tenant suite's in-company
// pair named two answers that differed only by a millisecond. Renamed from withoutRequestId.
export function forComparing(answer: Answer): unknown {
  const { request_id: _made, ...rest } = answer.correlation;
  if (!("freshness" in answer)) return { ...answer, correlation: rest };
  const { observed_at: _read, ...label } = answer.freshness;
  return { ...answer, freshness: label, correlation: rest };
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
// Test.run returns an Invoice, as invoice.get does, unless the test names
// another kind for its output (step 14's README, decision 1). And the shipped labels, unless
// the test gives others. Found by the Stage 2 review.
// The code reads INV-1008 once before it runs, so code that answers with
// data the test made is not refused for reading nothing (afterARead below).
export function registryWith(
  handler: Handler,
  output = "Invoice",
  labels: ClassificationSource = shippedLabels,
): Registry {
  return registryRunning(afterARead(handler), output, labels);
}

// For the tests of what the code reads. And the invoices in memory, unless
// the test plants a store of its own under the bound store (step 15's README, decisions 5
// and 8).
/** The same registry, with the code exactly as the test wrote it: it reads what it reads. */
export function registryRunning(
  handler: Handler,
  output = "Invoice",
  labels: ClassificationSource = shippedLabels,
  store: InvoiceStore = memoryInvoices(),
): Registry {
  const testRun = { ...contract("invoice.get"), id: "test.run", output: { schema: output } };
  return buildRegistry(
    [...shipped, source(testRun, "test.run.json")],
    { ...handlers, "test.run": handler },
    // test.run needs invoice:read, as invoice.get does. The agent holds it.
    shippedRoles,
    shippedInputs,
    labels,
    store,
    undefined,
    // The slips, so the agents call as before (step 18's README, decision 2).
    testSlips(),
    // NEW IN STEP 19: and the directories, so each signer is found (step 19's README,
    // decision 2).
    storyDirectories(),
  );
}

// The story's three slips, typed out again from step 18's README and
// migration 010 rather than read from src. Each runs until 2099, so no test stops working
// when a date passes (step 18's README, decision 12). firm-ap-fte has one slip in each
// company, with the power its roles gave it before (decisions 2 and 11).
/** A slip of the story, in the specification's shape, as a test may change it. */
export type StorySlip = {
  id: string;
  tenant: string;
  delegator: string;
  delegate: string;
  modes: string[];
  permissions: string[];
  constraints: Record<string, unknown>;
  subdelegation: { allowed: boolean };
  status: string;
  expires_at: string;
};
export const DEL_100: StorySlip = {
  id: "del_100",
  tenant: "org_456",
  delegator: "user_123",
  delegate: "accounts-payable-fte",
  modes: ["unattended"],
  permissions: ["invoice:read", "payment:create"],
  constraints: {},
  subdelegation: { allowed: false },
  status: "active",
  expires_at: "2099-12-31T23:59:59Z",
};
export const DEL_101: StorySlip = { ...DEL_100, id: "del_101", delegate: "firm-ap-fte" };
export const DEL_102: StorySlip = {
  ...DEL_100,
  id: "del_102",
  tenant: "org_789",
  delegator: "user_700",
  delegate: "firm-ap-fte",
  permissions: ["invoice:read", "invoice:issue", "payment:create", "payment:cancel"],
};
export const STORY_SLIPS: readonly StorySlip[] = [DEL_100, DEL_101, DEL_102];

/** The story's slips, in a store of their own. */
export function storySlips(): SlipStore {
  return memorySlips(STORY_SLIPS);
}

// intake-fte is the agent that the tests of steps 14 and 15 plant, to try clearances and
// types of caller. It works in org_456 under a slip from user_123, as accounts-payable-fte
// does. Only the tests know it, so migration 010 does not write its slip.
export const INTAKE_SLIP: StorySlip = { ...DEL_100, id: "del_190", delegate: "intake-fte" };

// What a record of the agent's gains once line ③ found del_100: the slip, and the person who
// signed it (step 18's README, decision 8). NEW IN STEP 19: and where her authority came from,
// as of a time that each test's clock decides (step 19's README, decision 7).
export const UNDER_DEL_100: {
  delegation: string;
  identity: {
    mode: "unattended";
    subject: string;
    actor_chain: string[];
    subject_authority: { source: "role_source"; as_of: unknown };
  };
} = {
  delegation: "del_100",
  identity: {
    mode: "unattended",
    subject: "user_123",
    actor_chain: ["accounts-payable-fte"],
    subject_authority: { source: "role_source", as_of: expect.any(String) },
  },
};

// NEW IN STEP 19: the story's people in each company's directory, typed out again from step
// 19's README rather than read from src. Everyone holds the job that DSoR's login table gives
// them, so a test that does not change a directory behaves as in step 18 (step 19's README,
// decision 2).
/** What each company's directory holds about the story's people. */
export const STORY_PEOPLE: Record<string, Record<string, Person>> = {
  org_456: {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  },
  org_789: { user_700: { status: "active", roles: ["ap_supervisor"] } },
};

/** The story's two directories, new and on, so a test may switch or change its own. */
export function storyDirectories(): Map<string, FakeDirectory> {
  return new Map(
    Object.entries(STORY_PEOPLE).map(([tenant, people]) => [tenant, fakeDirectory(tenant, people)]),
  );
}

/** The slips the shared test registries hold: the story's three, and intake-fte's. */
export function testSlips(): SlipStore {
  return memorySlips([...STORY_SLIPS, INTAKE_SLIP]);
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
  shippedLabels,
  memoryInvoices(),
  // And payments in memory, which the commands write (step 17's README,
  // outcome 1). One list for every test that uses this registry.
  memoryPayments(),
  // And the slips (step 18's README, decision 2).
  testSlips(),
  // NEW IN STEP 19: and the directories (step 19's README, decision 2).
  storyDirectories(),
);

/**
 * The shipped operations, writing payments into the list the test holds, so the test can
 * look at every row a call wrote, or did not write (step 17's README, C5). Other contracts
 * or other code, when the test gives them.
 */
export function paymentRegistry(
  rows: Payment[],
  sources: ContractSource[] = shipped,
  code: Record<string, Handler> = handlers,
  // The slips, unless the test gives others.
  slips: SlipStore = testSlips(),
  // NEW IN STEP 19: and the directories, unless the test gives others.
  directories: Directories = storyDirectories(),
): Registry {
  return buildRegistry(
    sources,
    code,
    shippedRoles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(),
    memoryPayments(rows),
    slips,
    directories,
  );
}

/** The shipped operations, with these slips, this role table, these payments, and these directories. */
export function slipRegistry(
  slips: SlipStore = storySlips(),
  roles: RoleTableSource = shippedRoles,
  rows: Payment[] = [],
  // NEW IN STEP 19: the story's directories, unless the test gives others.
  directories: Directories = storyDirectories(),
): Registry {
  return buildRegistry(
    shipped,
    handlers,
    roles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(),
    memoryPayments(rows),
    slips,
    directories,
  );
}

// The refusal at line ③, typed out rather than imported. Since step 18 it names the agent
// and the company where it holds no slip (step 18's README, decision 5).
/** The message when an agent calls with no person's slip in this company. */
export function needsDelegation(
  name: string,
  agent = "accounts-payable-fte",
  tenant = "org_456",
): string {
  return `"${name}" needs a slip: ${agent} holds no person's slip in ${tenant}`;
}

// PAY-901, the running example's draft: INV-1008's open amount and vendor, typed out again
// from step 17's README, outcome 2, rather than made from src.
export const PAY_901_DRAFT = {
  tenant_id: "org_456",
  id: "PAY-901",
  invoice_id: "INV-1008",
  vendor_id: "VENDOR-44",
  amount: { value: "31400.00", currency: "USD" },
  status: "draft",
};

// A query whose code read nothing is refused, because its label would be
// invented (step 15's README, decision 6). Planted code that answers with data the test made
// reads INV-1008 of its company first, so the tests of earlier steps test what they did.
/** The handler, after one read of INV-1008 through the company it is given. */
export function afterARead(handler: Handler): Handler {
  return async (input, company) => {
    await company.invoices.get("INV-1008");
    return handler(input, company);
  };
}

/** Calls "test.run", an operation whose code is the handler the test wrote. */
export function run(handler: Handler): Promise<Answer> {
  // As the agent, with its login token.
  // test.run takes invoice.get's input, and line ⑥ now checks it.
  return call(registryWith(handler), log, AGENT, "test.run", {
    invoice: "dsor://org_456/invoice/INV-1008",
  });
}

// An agent's answer is masked and a person's is not, so a test says who
// asks (step 14's README, decision 5).
/** Calls "test.run" as this caller. Its code is the handler, and its output this kind. */
export function runAs(
  who: RequestEnvelope,
  handler: Handler,
  output = "Invoice",
  labels: ClassificationSource = shippedLabels,
): Promise<Answer> {
  return call(registryWith(handler, output, labels), log, who, "test.run", {
    invoice: "dsor://org_456/invoice/INV-1008",
  });
}

// What an agent with clearance internal sees of each company's INV-1008,
// typed out again rather than made from src (step 14's README, outcome 1).
export const MASKED_1008_OF_456 = {
  tenant_id: "org_456",
  id: "INV-1008",
  vendor_id: "VENDOR-44",
  status: "issued",
};
export const MASKED_1008_OF_789 = {
  tenant_id: "org_789",
  id: "INV-1008",
  vendor_id: "VENDOR-77",
  status: "issued",
};

// An invoice's answer with a field that classifications.json does not
// name. Only internal fields beside it and no amount, so only the planted field can make
// a person's answer confidential (step 14's README, C1).
export const PLANTED = {
  tenant_id: "org_456",
  id: "INV-1008",
  status: "issued",
  vendor_bank_account: "PK36SCBL0000001123456702",
};
// The same answer as an agent with clearance internal sees it.
export const PLANTED_MASKED = { tenant_id: "org_456", id: "INV-1008", status: "issued" };

/** One entry of an answer's redactions: this field, left out for the caller's clearance. */
export function omitted(field: string): { field: string; reason: string; treatment: string } {
  return { field, reason: "clearance", treatment: "omitted" };
}

// What an agent with clearance internal is told was left out of an invoice
// (step 14's README, C3).
export const MASKED_REDACTIONS: { field: string; reason: string; treatment: string }[] = [
  omitted("amount"),
  omitted("open_amount"),
];

/** Calls "test.run", whose code refuses with this code. */
export function refusedWith(code: ErrorCode): Promise<Answer> {
  return run(() => {
    throw new Refusal(code, "refused on purpose");
  });
}

// "req_" and a random UUID (step 04's README, decision 4).
export const REQUEST_ID: RegExp =
  /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The label of a read from memory: current, a time, and memory (step 15's
// README, decision 2). Typed out again rather than imported from src.
export const FROM_MEMORY: { mode: string; observed_at: unknown; connector: string } = {
  mode: "current",
  observed_at: expect.any(String),
  connector: "memory",
};
// One such label, with a time, for a fake DSoR's answers.
export const A_MEMORY_READ: Freshness = {
  mode: "current",
  observed_at: "2026-10-01T09:00:00.000Z",
  connector: "memory",
};

// The one message a bug's envelope carries, typed out again rather than imported from src.
export const UNEXPECTED = "DSoR hit an unexpected error";

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
  // cfo_100's one role grants invoice:read, and not invoice:issue. Until step 16 the agent
  // made this call. Since step 17 an agent's command stops at line ③, before line ⑤ looks
  // at a role (step 17's README, decision 5).
  [
    "cfo_100 calling invoice.issue, which no role of theirs grants",
    () => call(registry, log, CFO, "invoice.issue", {}),
    "AUTHORIZATION_DENIED",
    notGranted("invoice.issue", "invoice:issue"),
    THE_CFO,
  ],
  // The agent's command, with no slip in the store. Since step 18 the shared registry holds
  // the story's slips, so this one holds none, and only line ③ refuses it.
  [
    "the agent calling payment.create, which no delegation covers",
    () => call(slipRegistry(NO_SLIPS), log, AGENT, "payment.create", {}),
    "DELEGATION_REQUIRED",
    needsDelegation("payment.create"),
    THE_AGENT,
  ],
  // user_123 holds invoice:issue, so this call gets past the permission check and hears that
  // invoice.issue is not built yet (step 06's README, C5). Until step 16 a second call, with
  // code for invoice.issue, heard that commands were not built yet. Since step 17 a command
  // with code runs (step 17's README, outcome 8), so that refusal is gone.
  [
    "invoice.issue, which has no code yet",
    // A good input, so the call also passes line ⑥.
    () => call(registry, log, SUPERVISOR, "invoice.issue", GOOD_ISSUE),
    "UNSUPPORTED_CAPABILITY",
    '"invoice.issue" is not built yet',
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

// So a test can type out a whole page on one line (step 13's README, C1).
/** The answer's page with each item cut down to "company/id", or the refusal as it is. */
export function idsOf(answer: Answer): unknown {
  if (!("data" in answer)) return answer;
  const { items, ...rest } = answer.data as { items: { tenant_id: string; id: string }[] };
  return { items: items.map(({ tenant_id, id }) => `${tenant_id}/${id}`), ...rest };
}

// A caller that follows the cursor to the end (step 13's README, C3).
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
