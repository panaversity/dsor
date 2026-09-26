// NEW IN STEP 07: the checklist every call goes through, by claim (C1 to C5 in step 07's
// README). C6 is a reading check, done beside §21's diagram.
import { describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { handlers } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  BAD_ISSUE,
  CFO,
  GOOD_ISSUE,
  LOG_IN_FIRST,
  STARTING_ROLES,
  SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_SUPERVISOR,
  contract,
  correlationFor,
  inputsWith,
  notGranted,
  notValid,
  refusal,
  registry,
  rolesFile,
  shipped,
  shippedInputs,
  shippedRoles,
  shippedWith,
  source,
} from "./helpers.ts";

/** Calls an operation and records the numbers of the checklist's lines that ran, in order. */
function linesRun(
  on: Registry,
  request: RequestEnvelope,
  name: string,
  input: unknown,
): { answer: Answer; lines: number[] } {
  const lines: number[] = [];
  const answer = call(on, request, name, input, (line) => lines.push(line));
  return { answer, lines };
}

describe("C1: every call runs the lines of the checklist in §21's order", () => {
  it("DSOR-EXE-01a: invoice.issue, a command, runs lines ①, ⑤, and ⑥, in that order", () => {
    expect(linesRun(registry, SUPERVISOR, "invoice.issue", GOOD_ISSUE).lines).toStrictEqual([
      1, 5, 6,
    ]);
  });

  // No rule id: DSOR-EXE-01a is about commands. §21 says queries pass lines 1 to 6 too.
  // Found by the review: a query's code runs at line ⑨, and was not numbered.
  it("invoice.get, a query, runs lines ①, ⑤, ⑥, and ⑨, in that order", () => {
    const { answer, lines } = linesRun(registry, AGENT, "invoice.get", { id: "INV-1008" });
    expect(lines).toStrictEqual([1, 5, 6, 9]);
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
  });

  // The observer is optional. Without it, the answer is the same.
  it("a call with no observer gets the same answer", () => {
    expect(call(registry, AGENT, "invoice.get", { id: "INV-1008" })).toMatchObject({
      data: { id: "INV-1008" },
    });
  });
});

describe("C2: when two lines would refuse, the earlier one answers", () => {
  // The four rows of the table in step 07's README. Each row is one line further down the
  // checklist than the row before it.
  it("DSOR-EXE-01a: no login and a bad input: ① answers, and nothing after it runs", () => {
    const { answer, lines } = linesRun(registry, {}, "invoice.issue", BAD_ISSUE);
    expect(answer).toStrictEqual({
      code: "AUTHENTICATION_REQUIRED",
      message: LOG_IN_FIRST,
      retry: "never",
      correlation: correlationFor({}),
    });
    expect(lines).toStrictEqual([1]);
  });

  it("DSOR-EXE-01a: cfo_100, who may not issue, with a bad input: ⑤ answers before ⑥", () => {
    const { answer, lines } = linesRun(registry, CFO, "invoice.issue", BAD_ISSUE);
    expect(answer).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: notGranted("invoice.issue", "invoice:issue"),
      retry: "never",
      correlation: correlationFor(THE_CFO),
    });
    expect(lines).toStrictEqual([1, 5]);
  });

  it("DSOR-EXE-01a: user_123, who may issue, with a bad input: ⑥ answers before 'is it built?'", () => {
    const { answer, lines } = linesRun(registry, SUPERVISOR, "invoice.issue", BAD_ISSUE);
    expect(answer).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: expect.stringMatching(
        /^the input of "invoice.issue" is not valid: \/invoice must match pattern/,
      ),
      retry: "never",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(lines).toStrictEqual([1, 5, 6]);
  });

  it("DSOR-EXE-01a: user_123 with a good input passes every line, and hears 'not built yet'", () => {
    const { answer, lines } = linesRun(registry, SUPERVISOR, "invoice.issue", GOOD_ISSUE);
    expect(answer).toStrictEqual({
      code: "UNSUPPORTED_CAPABILITY",
      message: '"invoice.issue" is not built yet',
      retry: "never",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(lines).toStrictEqual([1, 5, 6]);
  });

  // No rule id: the same order for a query. Here the CFO role grants nothing at all.
  it("a query: cfo_100, who may not read, with a bad input, is denied, not told the input is bad", () => {
    const grantsNothing = buildRegistry(
      shipped,
      handlers,
      rolesFile({ ...STARTING_ROLES, CFO: [] }),
    );
    const { answer, lines } = linesRun(grantsNothing, CFO, "invoice.get", { id: 1008 });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(lines).toStrictEqual([1, 5]);
  });
});

describe("C3: line ⑥ checks the input against the operation's input schema", () => {
  it.each([
    ["no id", {}, "must have required property 'id'"],
    ["an id that is a number", { id: 1008 }, "/id must be string"],
    ["a list", ["INV-1008"], "must be object"],
    ["null", null, "must be object"],
    ["text", "INV-1008", "must be object"],
    // Step 05 accepted as_user and never used it. Now it is refused, as a bad input
    // (step 07's README, decision 3).
    [
      "as_user, a field the schema does not list",
      { id: "INV-1008", as_user: "cfo_100" },
      'must NOT have additional properties: "as_user"',
    ],
    // The agent names itself. It agrees with the login, and is still refused: the schema
    // does not list principal (step 07's README, decision 3).
    [
      "the agent's own id, in principal",
      { id: "INV-1008", principal: "accounts-payable-fte" },
      'must NOT have additional properties: "principal"',
    ],
  ])("invoice.get refuses %s with VALIDATION_FAILED", (_why, input, problem) => {
    expect(call(registry, AGENT, "invoice.get", input)).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.get", problem),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
  });

  it.each([
    ["an id, not a URI", { invoice: "INV-1008" }],
    ["a URI with no id", { invoice: "dsor://org_456/invoice/" }],
    ["a URI with a space in it", { invoice: "dsor://org_456/invoice/INV 1008" }],
    ["a number", { invoice: 1008 }],
    ["no invoice", {}],
    ["a good URI, and a field the schema does not list", { ...GOOD_ISSUE, amount: "0.00" }],
  ])("invoice.issue refuses %s with VALIDATION_FAILED", (_why, input) => {
    expect(call(registry, SUPERVISOR, "invoice.issue", input)).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  // Line ⑥ checks only the URI's shape, as the specification's resourceUri does. Step 02's
  // stricter tenant rule applies where the URI is read (step 07's README, decision 2).
  // Found by the review: what comes after line ⑥ for another company's URI is step 10's
  // to decide, so this test asserts only that line ⑥ lets it through.
  it("invoice.issue lets a URI with the right shape pass line ⑥, whatever its tenant", () => {
    const { answer, lines } = linesRun(registry, SUPERVISOR, "invoice.issue", {
      invoice: "dsor://acme/invoice/INV-1008",
    });
    expect(lines).toStrictEqual([1, 5, 6]);
    expect(answer).not.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  // Start-up never allows it, so only a registry built by hand can have an operation with
  // no check for its input. When the check is missing, the answer is no.
  it("an operation with no input check, in a registry built by hand, refuses every input", () => {
    const spy = vi.fn<Handler>(() => "ran");
    const handMade: Registry = {
      ...registryWithGet(spy),
      inputs: new Map(),
    };
    expect(call(handMade, AGENT, "invoice.get", { id: "INV-1008" })).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.get", "it has no input schema"),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // A field's name comes from the caller, so it may be anything, even something huge.
  it("a refusal shows only a short piece of a field's name", () => {
    const huge = "x".repeat(10_000);
    const answer = call(registry, AGENT, "invoice.get", { id: "INV-1008", [huge]: 1 });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(JSON.stringify(answer).length).toBeLessThan(500);
  });

  // Checking must never change what the caller sent: no default filled in, no text turned
  // into a number, no field quietly deleted.
  it("checking the input leaves it exactly as it was sent", () => {
    const spy = vi.fn<Handler>(() => "ran");
    const input = { id: "INV-1008" };
    call(registryWithGet(spy), AGENT, "invoice.get", input);
    expect(spy).toHaveBeenCalledWith({ id: "INV-1008" });
    expect(input).toStrictEqual({ id: "INV-1008" });
  });

  // Found by the review: ajv's useDefaults changes the input, and no test saw it.
  it("a default in an input schema is never filled in", () => {
    const withDefault = inputsWith(
      "InvoiceGetRequest.schema.json",
      JSON.stringify({
        type: "object",
        properties: { id: { type: "string" }, note: { type: "string", default: "filled in" } },
        required: ["id"],
        additionalProperties: false,
      }),
    );
    const spy = vi.fn<Handler>(() => "ran");
    const registry = buildRegistry(
      shipped,
      { ...handlers, "invoice.get": spy },
      shippedRoles,
      withDefault,
    );
    call(registry, AGENT, "invoice.get", { id: "INV-1008" });
    expect(spy).toHaveBeenCalledWith({ id: "INV-1008" });
  });

  // Found by the review: the check read the id once and the code read it again. A getter
  // can answer differently each time (step 07's README, decision 9).
  it("the code gets the very value line ⑥ checked, even from a getter that changes", () => {
    const spy = vi.fn<Handler>(() => "ran");
    let reads = 0;
    const input = {
      get id(): string {
        reads += 1;
        return reads === 1 ? "INV-1008" : "INV-9999";
      },
    };
    call(registryWithGet(spy), AGENT, "invoice.get", input);
    expect(spy).toHaveBeenCalledWith({ id: "INV-1008" });
  });

  it("an input that JSON cannot copy is refused with VALIDATION_FAILED", () => {
    const loop: Record<string, unknown> = { id: "INV-1008" };
    loop["self"] = loop;
    expect(call(registry, AGENT, "invoice.get", loop)).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.get", "it cannot be copied as JSON"),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
  });
});

describe("C4: start-up is refused for an input schema that is missing, broken, or not strict", () => {
  it("the shipped contracts and input schemas start", () => {
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, shippedInputs))).toBe("");
  });

  // Found by the review: the whole message, so a false second problem is seen too.
  it("an input schema file that is missing stops start-up, and is the one problem named", () => {
    const missing = inputsWith("InvoiceGetRequest.schema.json", undefined);
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, missing))).toBe(
      "the registry refused to start:\n" +
        "  invoice.get: its input schema InvoiceGetRequest has no file inputs/InvoiceGetRequest.schema.json",
    );
  });

  // Found by the review: a typo, or a schema that forgets the rule, let every field through.
  it.each([
    ["an object schema that does not refuse unlisted fields", '{ "type": "object" }'],
    ["true, which allows anything", "true"],
    ["a schema with no type", '{ "additionalProperties": false }'],
    [
      "additionalProperty, a typo",
      '{ "type": "object", "properties": { "id": { "type": "string" } }, "additionalProperty": false }',
    ],
  ])("%s stops start-up", (_why, text) => {
    const loose = inputsWith("InvoiceGetRequest.schema.json", text);
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, loose))).toMatch(
      'inputs/InvoiceGetRequest.schema.json: must refuse fields it does not list: its top level needs "type": "object" and "additionalProperties": false',
    );
  });

  it("a keyword ajv does not know, such as the typo minLenght, stops start-up", () => {
    const text = JSON.stringify({
      type: "object",
      properties: { id: { type: "string", minLenght: 1 } },
      required: ["id"],
      additionalProperties: false,
    });
    const typo = inputsWith("InvoiceGetRequest.schema.json", text);
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, typo))).toMatch(
      'inputs/InvoiceGetRequest.schema.json: not a valid JSON Schema: strict mode: unknown keyword: "minLenght"',
    );
  });

  // A file with a misspelled name would otherwise sit there, unused, and nobody would know.
  it("an input schema file that no contract names stops start-up", () => {
    const extra = inputsWith(
      "InvoiceListRequest.schema.json",
      '{ "type": "object", "additionalProperties": false }',
    );
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, extra))).toMatch(
      "inputs/InvoiceListRequest.schema.json: no contract names this input schema",
    );
  });

  // Found by the review: two contracts that share a broken schema had it named twice.
  it("a broken input schema that two contracts share is named once", () => {
    const twin = { ...contract("invoice.get"), id: "invoice.get_twin" };
    const sources = [...shipped, source(twin, "invoice.get_twin.json")];
    const withTwin = { ...handlers, "invoice.get_twin": handlers["invoice.get"]! };
    const broken = inputsWith("InvoiceGetRequest.schema.json", "{ type: object");
    const message = refusal(() => buildRegistry(sources, withTwin, shippedRoles, broken));
    expect(message.split("inputs/InvoiceGetRequest.schema.json: not valid JSON")).toHaveLength(2);
  });

  it("an input schema that is not a valid JSON Schema stops start-up", () => {
    const broken = inputsWith("InvoiceGetRequest.schema.json", '{ "type": "invoice" }');
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, broken))).toMatch(
      "inputs/InvoiceGetRequest.schema.json: not a valid JSON Schema",
    );
  });

  it("an input schema file that is not JSON stops start-up", () => {
    const broken = inputsWith("InvoiceGetRequest.schema.json", "{ type: object");
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, broken))).toMatch(
      "inputs/InvoiceGetRequest.schema.json: not valid JSON",
    );
  });

  // Step 03's lesson: JSON.parse keeps the second of two values, and says nothing.
  it("an input schema with a key written twice stops start-up", () => {
    const text =
      '{ "type": "object", "additionalProperties": false, "additionalProperties": true }';
    const twice = inputsWith("InvoiceGetRequest.schema.json", text);
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, twice))).toMatch(
      'inputs/InvoiceGetRequest.schema.json: "additionalProperties" is written twice in one object',
    );
  });

  it("a contract that names an input schema with no file stops start-up, with the others", () => {
    const renamed = { ...contract("invoice.get"), input: { schema: "InvoiceListRequest" } };
    const message = refusal(() =>
      buildRegistry(
        shippedWith(renamed),
        handlers,
        shippedRoles,
        inputsWith("InvoiceIssueRequest.schema.json", "[]"),
      ),
    );
    expect(message).toMatch("invoice.get: its input schema InvoiceListRequest has no file");
    expect(message).toMatch("inputs/InvoiceIssueRequest.schema.json: not a valid JSON Schema");
  });

  // Two contracts may share one input schema. It is read once.
  it("two contracts with one input schema start", () => {
    const twin = { ...contract("invoice.get"), id: "invoice.get_twin" };
    const sources = [...shipped, source(twin, "invoice.get_twin.json")];
    const withTwin = { ...handlers, "invoice.get_twin": handlers["invoice.get"]! };
    expect(refusal(() => buildRegistry(sources, withTwin, shippedRoles, shippedInputs))).toBe("");
  });
});

/** The shipped registry, with invoice.get's code replaced by the test's. */
function registryWithGet(handler: Handler): Registry {
  return buildRegistry(shipped, { ...handlers, "invoice.get": handler }, shippedRoles);
}

describe("C5: the code behind an operation is reached only through the checklist", () => {
  // The rows of C2 and C3, against code that records each time it runs. A refused call
  // never reaches it. Only a call that passed every line does.
  it.each([
    ["no login, and a bad input", {}, { id: 1008 }],
    ["a bad input", AGENT, { id: 1008 }],
    ["as_user in the input", AGENT, { id: "INV-1008", as_user: "cfo_100" }],
    [
      "the agent's own id in principal",
      AGENT,
      { id: "INV-1008", principal: "accounts-payable-fte" },
    ],
  ])("DSOR-OPR-04a: %s never reaches invoice.get's code", (_why, request, input) => {
    const spy = vi.fn<Handler>(() => "ran");
    expect(call(registryWithGet(spy), request, "invoice.get", input)).toHaveProperty("code");
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-OPR-04a: a caller who may not read never reaches invoice.get's code", () => {
    const spy = vi.fn<Handler>(() => "ran");
    const grantsNothing = buildRegistry(
      shipped,
      { ...handlers, "invoice.get": spy },
      rolesFile({ ...STARTING_ROLES, CFO: [] }),
    );
    expect(call(grantsNothing, CFO, "invoice.get", { id: "INV-1008" })).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-OPR-04a: a call that passes every line reaches the code, once", () => {
    const spy = vi.fn<Handler>(() => "ran");
    expect(call(registryWithGet(spy), AGENT, "invoice.get", { id: "INV-1008" })).toMatchObject({
      data: "ran",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
