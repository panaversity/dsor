// The checklist every call goes through, by claim (C1 to C5 in step 07's
// README). C6 is a reading check, done beside §21's diagram.
import { describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  BAD_ISSUE,
  CFO,
  GOOD_ISSUE,
  LOG_IN_FIRST,
  MASKED_1008_OF_456,
  NOT_A_MEMBER,
  STARTING_ROLES,
  SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_SUPERVISOR,
  companyNamed,
  contract,
  correlationFor,
  handlers,
  inputsWith,
  log,
  notGranted,
  notTheCaller,
  notValid,
  otherTenant,
  refusal,
  registry,
  rolesFile,
  shipped,
  shippedInputs,
  shippedRoles,
  shippedWith,
  source,
} from "./helpers.ts";

// JSON text for a list nested 100,000 levels deep. JSON.parse reads it, but JSON.stringify
// stops at about 7,700 levels, so a copy made through JSON text fails.
const DEEP = "[".repeat(100_000) + "]".repeat(100_000);

// The agent's answer when the code answers MASKED_1008_OF_456: nothing above its clearance,
// so nothing withheld, and the label internal (step 14's README, decisions 4 and 5).
const ANSWERED = {
  data: MASKED_1008_OF_456,
  classification: "internal",
  correlation: correlationFor(THE_AGENT),
};

/** Calls an operation and records the numbers of the checklist's lines that ran, in order. */
async function linesRun(
  on: Registry,
  request: RequestEnvelope,
  name: string,
  input: unknown,
): Promise<{ answer: Answer; lines: number[] }> {
  const lines: number[] = [];
  const answer = await call(on, log, request, name, input, (line) => lines.push(line));
  return { answer, lines };
}

describe("C1: every call runs the lines of the checklist in §21's order", () => {
  // Every call now ends at line ⑪, where its decision is recorded, the
  // refusals too (step 08's README, decision 1).
  it("DSOR-EXE-01a: invoice.issue, a command, runs lines ①, ②, ⑤, ⑥, and ⑪, in that order", async () => {
    expect((await linesRun(registry, SUPERVISOR, "invoice.issue", GOOD_ISSUE)).lines).toStrictEqual(
      [1, 2, 5, 6, 11],
    );
  });

  // No rule id: DSOR-EXE-01a is about commands. §21 says queries pass lines 1 to 6 too.
  // Found by the review: a query's code runs at line ⑨, and was not numbered.
  it("invoice.get, a query, runs lines ①, ②, ⑤, ⑥, ⑨, and ⑪, in that order", async () => {
    const { answer, lines } = await linesRun(registry, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(lines).toStrictEqual([1, 2, 5, 6, 9, 11]);
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
  });

  // The observer is optional. Without it, the answer is the same.
  it("a call with no observer gets the same answer", async () => {
    expect(
      await call(registry, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toMatchObject({
      data: { id: "INV-1008" },
    });
  });
});

describe("C2: when two lines would refuse, the earlier one answers", () => {
  // The four rows of the table in step 07's README. Each row is one line further down the
  // checklist than the row before it. After the line that refuses, only
  // line ⑪ runs, and records the refusal.
  it("DSOR-EXE-01a: no login and a bad input: ① answers, and only ⑪ runs after it", async () => {
    const { answer, lines } = await linesRun(registry, {}, "invoice.issue", BAD_ISSUE);
    expect(answer).toStrictEqual({
      code: "AUTHENTICATION_REQUIRED",
      message: LOG_IN_FIRST,
      retry: "never",
      correlation: correlationFor({}),
    });
    expect(lines).toStrictEqual([1, 11]);
  });

  it("DSOR-EXE-01a: cfo_100, who may not issue, with a bad input: ⑤ answers before ⑥", async () => {
    const { answer, lines } = await linesRun(registry, CFO, "invoice.issue", BAD_ISSUE);
    expect(answer).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: notGranted("invoice.issue", "invoice:issue"),
      retry: "never",
      correlation: correlationFor(THE_CFO),
    });
    expect(lines).toStrictEqual([1, 2, 5, 11]);
  });

  it("DSOR-EXE-01a: user_123, who may issue, with a bad input: ⑥ answers before 'is it built?'", async () => {
    const { answer, lines } = await linesRun(registry, SUPERVISOR, "invoice.issue", BAD_ISSUE);
    expect(answer).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: expect.stringMatching(
        /^the input of "invoice.issue" is not valid: \/invoice must match pattern/,
      ),
      retry: "never",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(lines).toStrictEqual([1, 2, 5, 6, 11]);
  });

  it("DSOR-EXE-01a: user_123 with a good input passes every line, and hears 'not built yet'", async () => {
    const { answer, lines } = await linesRun(registry, SUPERVISOR, "invoice.issue", GOOD_ISSUE);
    expect(answer).toStrictEqual({
      code: "UNSUPPORTED_CAPABILITY",
      message: '"invoice.issue" is not built yet',
      retry: "never",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(lines).toStrictEqual([1, 2, 5, 6, 11]);
  });

  // No rule id: the same order for a query. Here the CFO role grants nothing at all.
  it("a query: cfo_100, who may not read, with a bad input, is denied, not told the input is bad", async () => {
    const grantsNothing = buildRegistry(
      shipped,
      handlers,
      rolesFile({ ...STARTING_ROLES, CFO: [] }),
    );
    const { answer, lines } = await linesRun(grantsNothing, CFO, "invoice.get", { invoice: 1008 });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(lines).toStrictEqual([1, 2, 5, 11]);
  });
});

describe("C3: line ⑥ checks the input against the operation's input schema", () => {
  it.each([
    ["no invoice", {}, "must have required property 'invoice'"],
    ["an invoice that is a number", { invoice: 1008 }, "/invoice must be string"],
    ["a list", ["INV-1008"], "must be object"],
    ["null", null, "must be object"],
    ["text", "INV-1008", "must be object"],
    // JSON leaves these out, and the copy is undefined: not an input it cannot copy. Found by
    // a hostile pass on the Stage 2 review's fix: a NOT_JSON that was undefined passed every
    // test (step 07's README, decision 9).
    ["nothing at all", undefined, "must be object"],
    ["a function", () => "INV-1008", "must be object"],
    // Step 05 accepted as_user and never used it. Now it is refused, as a bad input
    // (step 07's README, decision 3).
    [
      "as_user, a field the schema does not list",
      { invoice: "dsor://org_456/invoice/INV-1008", as_user: "cfo_100" },
      'must NOT have additional properties: "as_user"',
    ],
    // The agent names itself. It agrees with the login, and is still refused: the schema
    // does not list principal (step 07's README, decision 3).
    [
      "the agent's own id, in principal",
      { invoice: "dsor://org_456/invoice/INV-1008", principal: "accounts-payable-fte" },
      'must NOT have additional properties: "principal"',
    ],
  ])("invoice.get refuses %s with VALIDATION_FAILED", async (_why, input, problem) => {
    expect(await call(registry, log, AGENT, "invoice.get", input)).toStrictEqual({
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
  ])("invoice.issue refuses %s with VALIDATION_FAILED", async (_why, input) => {
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", input)).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  // Line ⑥ checks only the URI's shape, as the specification's resourceUri does. Step 02's
  // stricter tenant rule applies where the URI is read (step 07's README, decision 2).
  // Found by the review: what comes after line ⑥ for another company's URI is step 10's
  // to decide, so this test asserts only that line ⑥ lets it through.
  it("invoice.issue lets a URI with the right shape pass line ⑥, whatever its tenant", async () => {
    const { answer, lines } = await linesRun(registry, SUPERVISOR, "invoice.issue", {
      invoice: "dsor://acme/invoice/INV-1008",
    });
    expect(lines).toStrictEqual([1, 2, 5, 6, 11]);
    expect(answer).not.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  // Start-up never allows it, so only a registry built by hand can have an operation with
  // no check for its input. When the check is missing, the answer is no.
  it("an operation with no input check, in a registry built by hand, refuses every input", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    const handMade: Registry = {
      ...registryWithGet(spy),
      inputs: new Map(),
    };
    expect(
      await call(handMade, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: notValid("invoice.get", "it has no input schema"),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // A field's name comes from the caller, so it may be anything, even something huge.
  it("a refusal shows only a short piece of a field's name", async () => {
    const huge = "x".repeat(10_000);
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
      [huge]: 1,
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(JSON.stringify(answer).length).toBeLessThan(500);
  });

  // Checking must never change what the caller sent: no default filled in, no text turned
  // into a number, no field quietly deleted.
  it("checking the input leaves it exactly as it was sent", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    const input = { invoice: "dsor://org_456/invoice/INV-1008" };
    await call(registryWithGet(spy), log, AGENT, "invoice.get", input);
    // And the active company, which line ② checked. From the Stage 2 review,
    // with its invoices bound to it (step 10's README, decision 13).
    expect(spy).toHaveBeenCalledWith(
      { invoice: "dsor://org_456/invoice/INV-1008" },
      companyNamed("org_456"),
    );
    expect(input).toStrictEqual({ invoice: "dsor://org_456/invoice/INV-1008" });
  });

  // Found by the review: ajv's useDefaults changes the input, and no test saw it.
  it("a default in an input schema is never filled in", async () => {
    const withDefault = inputsWith(
      "InvoiceGetRequest.schema.json",
      JSON.stringify({
        type: "object",
        properties: { invoice: { type: "string" }, note: { type: "string", default: "filled in" } },
        required: ["invoice"],
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
    await call(registry, log, AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" });
    expect(spy).toHaveBeenCalledWith(
      { invoice: "dsor://org_456/invoice/INV-1008" },
      companyNamed("org_456"),
    );
  });

  // Found by the review: the check read the URI once and the code read it again. A getter
  // can answer differently each time (step 07's README, decision 9).
  it("the code gets the very value line ⑥ checked, even from a getter that changes", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    let reads = 0;
    const input = {
      get invoice(): string {
        reads += 1;
        return reads === 1 ? "dsor://org_456/invoice/INV-1008" : "dsor://org_456/invoice/INV-9999";
      },
    };
    await call(registryWithGet(spy), log, AGENT, "invoice.get", input);
    expect(spy).toHaveBeenCalledWith(
      { invoice: "dsor://org_456/invoice/INV-1008" },
      companyNamed("org_456"),
    );
  });

  // Line ① read the input itself, and line ⑥ then made its own copy. So an input could show
  // the caller to line ① and cfo_100 to the code. Now line ① makes the one copy, and line ①,
  // line ⑥, and the code all read it (step 07's README, decision 9). Found by the Stage 2
  // review, and fixed from step 07 on.
  it("DSOR-SRC-02b: a principal that reads as the caller first, then as cfo_100, reaches the code as the caller", async () => {
    const spy = vi.fn<Handler>(() => ({ ...MASKED_1008_OF_456 }));
    const { input, reads } = changesAfterOneRead("principal", "accounts-payable-fte", "cfo_100");
    const answer = await call(registryListing("principal", spy), log, AGENT, "invoice.get", input);
    // The code gets exactly the values the checks saw.
    expect(spy).toHaveBeenCalledWith(
      { invoice: "dsor://org_456/invoice/INV-1008", principal: "accounts-payable-fte" },
      companyNamed("org_456"),
    );
    // In step 14 the code answers with an invoice the agent may see whole, because text is
    // not a record (step 14's README, decision 3). So the call is answered with data.
    expect(answer).toStrictEqual(ANSWERED);
    // The input, as the caller sent it, is read once: to make the copy.
    expect(reads()).toBe(1);
  });

  it("DSOR-SRC-02b: a principal that reads as cfo_100 first, then as the caller, is refused before the code runs", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    const { input, reads } = changesAfterOneRead("principal", "cfo_100", "accounts-payable-fte");
    expect(
      await call(registryListing("principal", spy), log, AGENT, "invoice.get", input),
    ).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: notTheCaller("principal"),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(reads()).toBe(1);
  });

  // Line ② read the input itself too, to check the companies it names. So an input could
  // show org_456 to line ② and org_789 to the code. It reads line ①'s copy now (step 07's
  // README, decision 9). Found by the Stage 2 review, and fixed from step 07 on.
  it("DSOR-SRC-02b: a tenant_id that reads as org_456 first, then as org_789, reaches the code as org_456", async () => {
    const spy = vi.fn<Handler>(() => ({ ...MASKED_1008_OF_456 }));
    const { input, reads } = changesAfterOneRead("tenant_id", "org_456", "org_789");
    const answer = await call(registryListing("tenant_id", spy), log, AGENT, "invoice.get", input);
    expect(spy).toHaveBeenCalledWith(
      { invoice: "dsor://org_456/invoice/INV-1008", tenant_id: "org_456" },
      companyNamed("org_456"),
    );
    // In step 14 the code answers with an invoice the agent may see whole, because text is
    // not a record (step 14's README, decision 3). So the call is answered with data.
    expect(answer).toStrictEqual(ANSWERED);
    expect(reads()).toBe(1);
  });

  it("DSOR-SRC-02b: a tenant_id that reads as org_789 first, then as org_456, is refused before the code runs", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    const { input, reads } = changesAfterOneRead("tenant_id", "org_789", "org_456");
    expect(
      await call(registryListing("tenant_id", spy), log, AGENT, "invoice.get", input),
    ).toStrictEqual({
      code: "TENANT_MISMATCH",
      message: otherTenant("tenant_id"),
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(reads()).toBe(1);
  });

  // The tests above count the reads of one field only. Here every field is counted: the copy
  // reads each one once, and nothing else reads the input as it was sent (step 07's README,
  // decision 9). Found by the Stage 2 review, and fixed from step 07 on.
  it("step 07's decision 9: an input JSON can copy is read once, by the copy, and by nothing else", async () => {
    const reads: Record<string, number> = {};
    const input = new Proxy(
      { invoice: "dsor://org_456/invoice/INV-1008" },
      {
        get: (target, key) => {
          reads[String(key)] = (reads[String(key)] ?? 0) + 1;
          return Reflect.get(target, key);
        },
      },
    );
    expect(await call(registry, log, AGENT, "invoice.get", input)).toMatchObject({
      data: { id: "INV-1008" },
    });
    // JSON asks once whether the input has a toJSON of its own, then reads each field once.
    expect(reads).toStrictEqual({ toJSON: 1, invoice: 1 });
  });

  // The copy is made inside line ①, after the login is found. An input that JSON cannot copy
  // is refused at the end of line ②, with line ⑥'s message, once the principals and the
  // companies it names are checked. Lines ⑤ and ⑥ never run (step 07's README, decision 9).
  // Found by the Stage 2 review, and fixed from step 07 on.
  it.each([
    ["contains itself", selfContaining()],
    ["holds a BigInt", { invoice: "dsor://org_456/invoice/INV-1008", count: 1n }],
    // JSON can carry these three: JSON.parse reads them, and only JSON.stringify fails.
    [
      "is nested too deep to write out, though JSON can carry it",
      JSON.parse(`{"invoice":"dsor://org_456/invoice/INV-1008","pad":${DEEP}}`) as unknown,
    ],
    // The principal it names is the caller, so the check on the input as sent passes.
    [
      "names the caller, and is nested too deep to write out",
      JSON.parse(
        `{"invoice":"dsor://org_456/invoice/INV-1008","principal":"accounts-payable-fte","pad":${DEEP}}`,
      ) as unknown,
    ],
    // The company it names is the active one, so the check on the input as sent passes.
    [
      "names the active company, and is nested too deep to write out",
      JSON.parse(
        `{"invoice":"dsor://org_456/invoice/INV-1008","tenant_id":"org_456","pad":${DEEP}}`,
      ) as unknown,
    ],
  ])(
    "step 07's decision 9: an input that %s is refused with VALIDATION_FAILED, at line ②",
    async (_why, input) => {
      const { answer, lines } = await linesRun(registry, AGENT, "invoice.get", input);
      expect(answer).toStrictEqual({
        code: "VALIDATION_FAILED",
        message: notValid("invoice.get", "it cannot be copied as JSON"),
        retry: "never",
        correlation: correlationFor(THE_AGENT),
      });
      expect(lines).toStrictEqual([1, 2, 11]);
    },
  );

  // Line ② finds the company first, as for any input, so a caller who is no member of the
  // company it names hears that (step 07's README, decision 9). Found by a hostile pass on
  // the Stage 2 review's fix: refusing such an input before the membership check passed
  // every test.
  it("DSOR-IDN-03a: a stranger to org_789 hears that it is no member, even with an input JSON cannot copy", async () => {
    const stranger = { ...AGENT, tenant: "org_789" };
    const input = { invoice: "dsor://org_456/invoice/INV-1008", count: 1n };
    const { answer, lines } = await linesRun(registry, stranger, "invoice.get", input);
    expect(answer).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: NOT_A_MEMBER,
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(lines).toStrictEqual([1, 2, 11]);
  });

  // When the copy fails, line ① checks the principals on the input as sent before the call
  // goes on. So an attempt to act as cfo_100 is refused as one, and is not hidden behind a
  // bad input (step 07's README, decision 9). Found by the Stage 2 review, and fixed from
  // step 07 on.
  it.each([
    [
      "too deep to copy, sent as plain JSON",
      JSON.parse(
        `{"invoice":"dsor://org_456/invoice/INV-1008","principal":"cfo_100","pad":${DEEP}}`,
      ) as unknown,
    ],
    ["that contains itself", selfContaining({ principal: "cfo_100" })],
  ])(
    "DSOR-SRC-02b: cfo_100 named in an input %s is refused with AUTHORIZATION_DENIED, at line ①",
    async (_why, input) => {
      const { answer, lines } = await linesRun(registry, AGENT, "invoice.get", input);
      expect(answer).toStrictEqual({
        code: "AUTHORIZATION_DENIED",
        message: notTheCaller("principal"),
        retry: "never",
        correlation: correlationFor(THE_AGENT),
      });
      expect(lines).toStrictEqual([1, 11]);
    },
  );

  // The same for a company: line ② checks the companies the input names, on the input as
  // sent, before it refuses an input JSON cannot copy. So an attempt to reach org_789 is
  // refused as one (step 07's README, decision 9). Found by the Stage 2 review, and fixed
  // from step 07 on.
  it.each([
    [
      "too deep to copy, sent as plain JSON",
      JSON.parse(
        `{"invoice":"dsor://org_456/invoice/INV-1008","tenant_id":"org_789","pad":${DEEP}}`,
      ) as unknown,
    ],
    ["that contains itself", selfContaining({ tenant_id: "org_789" })],
  ])(
    "DSOR-SRC-02b: org_789 named in an input %s is refused with TENANT_MISMATCH, at line ②",
    async (_why, input) => {
      const { answer, lines } = await linesRun(registry, AGENT, "invoice.get", input);
      expect(answer).toStrictEqual({
        code: "TENANT_MISMATCH",
        message: otherTenant("tenant_id"),
        retry: "never",
        correlation: correlationFor(THE_AGENT),
      });
      expect(lines).toStrictEqual([1, 2, 11]);
    },
  );
});

describe("C4: start-up is refused for an input schema that is missing, broken, or not strict", () => {
  it("the shipped contracts and input schemas start", async () => {
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, shippedInputs))).toBe("");
  });

  // Found by the review: the whole message, so a false second problem is seen too.
  it("an input schema file that is missing stops start-up, and is the one problem named", async () => {
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
  ])("%s stops start-up", async (_why, text) => {
    const loose = inputsWith("InvoiceGetRequest.schema.json", text);
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, loose))).toMatch(
      'inputs/InvoiceGetRequest.schema.json: must refuse fields it does not list: its top level needs "type": "object" and "additionalProperties": false',
    );
  });

  it("a keyword ajv does not know, such as the typo minLenght, stops start-up", async () => {
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
  // InvoiceListRequest is a real schema now, so the name nobody uses is
  // InvoiceSearchRequest.
  it("an input schema file that no contract names stops start-up", async () => {
    const extra = inputsWith(
      "InvoiceSearchRequest.schema.json",
      '{ "type": "object", "additionalProperties": false }',
    );
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, extra))).toMatch(
      "inputs/InvoiceSearchRequest.schema.json: no contract names this input schema",
    );
  });

  // Found by the review: two contracts that share a broken schema had it named twice.
  it("a broken input schema that two contracts share is named once", async () => {
    const twin = { ...contract("invoice.get"), id: "invoice.get_twin" };
    const sources = [...shipped, source(twin, "invoice.get_twin.json")];
    const withTwin = { ...handlers, "invoice.get_twin": handlers["invoice.get"]! };
    const broken = inputsWith("InvoiceGetRequest.schema.json", "{ type: object");
    const message = refusal(() => buildRegistry(sources, withTwin, shippedRoles, broken));
    expect(message.split("inputs/InvoiceGetRequest.schema.json: not valid JSON")).toHaveLength(2);
  });

  it("an input schema that is not a valid JSON Schema stops start-up", async () => {
    const broken = inputsWith("InvoiceGetRequest.schema.json", '{ "type": "invoice" }');
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, broken))).toMatch(
      "inputs/InvoiceGetRequest.schema.json: not a valid JSON Schema",
    );
  });

  it("an input schema file that is not JSON stops start-up", async () => {
    const broken = inputsWith("InvoiceGetRequest.schema.json", "{ type: object");
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, broken))).toMatch(
      "inputs/InvoiceGetRequest.schema.json: not valid JSON",
    );
  });

  // Step 03's lesson: JSON.parse keeps the second of two values, and says nothing.
  it("an input schema with a key written twice stops start-up", async () => {
    const text =
      '{ "type": "object", "additionalProperties": false, "additionalProperties": true }';
    const twice = inputsWith("InvoiceGetRequest.schema.json", text);
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, twice))).toMatch(
      'inputs/InvoiceGetRequest.schema.json: "additionalProperties" is written twice in one object',
    );
  });

  it("a contract that names an input schema with no file stops start-up, with the others", async () => {
    // InvoiceSearchRequest, because InvoiceListRequest has a file now.
    const renamed = { ...contract("invoice.get"), input: { schema: "InvoiceSearchRequest" } };
    const message = refusal(() =>
      buildRegistry(
        shippedWith(renamed),
        handlers,
        shippedRoles,
        inputsWith("InvoiceIssueRequest.schema.json", "[]"),
      ),
    );
    expect(message).toMatch("invoice.get: its input schema InvoiceSearchRequest has no file");
    expect(message).toMatch("inputs/InvoiceIssueRequest.schema.json: not a valid JSON Schema");
  });

  // Two contracts may share one input schema. It is read once.
  it("two contracts with one input schema start", async () => {
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

/**
 * The same, with an input schema for invoice.get that lists one more text field. No shipped
 * schema lists a principal or a company, so line ⑥ would refuse it before a test of lines ①
 * and ② could see it.
 */
function registryListing(field: string, handler: Handler): Registry {
  const schema = {
    type: "object",
    properties: { invoice: { type: "string" }, [field]: { type: "string" } },
    required: ["invoice"],
    additionalProperties: false,
  };
  const inputs = inputsWith("InvoiceGetRequest.schema.json", JSON.stringify(schema));
  return buildRegistry(shipped, { ...handlers, "invoice.get": handler }, shippedRoles, inputs);
}

/** An input whose field reads as `first` the first time, and as `later` every time after. */
function changesAfterOneRead(field: string, first: string, later: string) {
  let reads = 0;
  const input = {
    invoice: "dsor://org_456/invoice/INV-1008",
    get [field](): string {
      reads += 1;
      return reads === 1 ? first : later;
    },
  };
  // How many times the field has been read so far.
  return { input, reads: () => reads };
}

/** An input that contains itself, beside any fields given. JSON cannot write it out. */
function selfContaining(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const input: Record<string, unknown> = { invoice: "dsor://org_456/invoice/INV-1008", ...fields };
  input["self"] = input;
  return input;
}

describe("C5: the code behind an operation is reached only through the checklist", () => {
  // The rows of C2 and C3, against code that records each time it runs. A refused call
  // never reaches it. Only a call that passed every line does.
  it.each([
    ["no login, and a bad input", {}, { invoice: 1008 }],
    ["a bad input", AGENT, { invoice: 1008 }],
    [
      "as_user in the input",
      AGENT,
      { invoice: "dsor://org_456/invoice/INV-1008", as_user: "cfo_100" },
    ],
    [
      "the agent's own id in principal",
      AGENT,
      { invoice: "dsor://org_456/invoice/INV-1008", principal: "accounts-payable-fte" },
    ],
  ])("DSOR-OPR-04a: %s never reaches invoice.get's code", async (_why, request, input) => {
    const spy = vi.fn<Handler>(() => "ran");
    expect(await call(registryWithGet(spy), log, request, "invoice.get", input)).toHaveProperty(
      "code",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-OPR-04a: a caller who may not read never reaches invoice.get's code", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    const grantsNothing = buildRegistry(
      shipped,
      { ...handlers, "invoice.get": spy },
      rolesFile({ ...STARTING_ROLES, CFO: [] }),
    );
    expect(
      await call(grantsNothing, log, CFO, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-OPR-04a: a call that passes every line reaches the code, once", async () => {
    // The code returns an invoice, the kind its contract names. An agent is
    // refused anything else (step 14's README, decision 3).
    const ran = { tenant_id: "org_456", id: "INV-1008", status: "issued" };
    const spy = vi.fn<Handler>(() => ran);
    expect(
      await call(registryWithGet(spy), log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toMatchObject({
      data: ran,
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
