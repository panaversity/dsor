// NEW IN STEP 04: every answer from call is an envelope, by claim (see the README).
import { describe, expect, it } from "vitest";
import { RETRY, Refusal, type Answer, type ErrorCode, type RetryClass } from "../src/envelope.ts";
import { handlers } from "../src/operations.ts";
import { buildRegistry, call, type Handler } from "../src/registry.ts";
import { SCHEMA_CODES, registryWith, schemaProblems, shipped } from "./helpers.ts";

const registry = buildRegistry(shipped, handlers);

/** Calls "test.run", an operation whose code is the handler the test wrote. */
function run(handler: Handler): Answer {
  return call(registryWith(handler), "test.run", {});
}

/** Calls "test.run", whose code refuses with this code. */
function refusedWith(code: ErrorCode): Answer {
  return run(() => {
    throw new Refusal(code, "refused on purpose");
  });
}

// "req_" and a random UUID (README, decision 4).
const REQUEST_ID = /^req_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Every refusal this step can give, and its code (README, decision 7). Each one is a
// function, so each test makes its own call.
const REFUSALS: [string, () => Answer, ErrorCode][] = [
  [
    "an operation with no contract",
    () => call(registry, "invoice.delete", {}),
    "UNSUPPORTED_CAPABILITY",
  ],
  [
    "invoice.issue, which has no code yet",
    () => call(registry, "invoice.issue", {}),
    "UNSUPPORTED_CAPABILITY",
  ],
  ["invoice.get without a text id", () => call(registry, "invoice.get", {}), "VALIDATION_FAILED"],
  [
    "invoice.get for INV-9999",
    () => call(registry, "invoice.get", { id: "INV-9999" }),
    "RESOURCE_NOT_FOUND",
  ],
  [
    "a bug in an operation's code",
    () =>
      run(() => {
        throw new Error("boom");
      }),
    "INTERNAL_ERROR",
  ],
];

describe("C1: every refusal is an error envelope that passes the real schema", () => {
  it.each(REFUSALS)(
    "DSOR-ERR-01a: %s is refused with an envelope that passes the schema",
    (_why, ask, code) => {
      const envelope = ask();
      expect(envelope).toMatchObject({ code, retry: "never" });
      expect(schemaProblems(envelope)).toEqual([]);
    },
  );
});

describe("C2: the code is one from the §28 table", () => {
  it("DSOR-ERR-01a: an envelope with a made-up code is refused by the schema", () => {
    const madeUp = {
      code: "NOT_FOUND",
      message: "no invoice",
      retry: "never",
      correlation: { request_id: "req_1" },
    };
    expect(schemaProblems(madeUp)).not.toEqual([]);
    // The same envelope with the table's code passes, so the refusal is for the code.
    expect(schemaProblems({ ...madeUp, code: "RESOURCE_NOT_FOUND" })).toEqual([]);
  });

  it("DSOR-ERR-01a: the table in src lists exactly the schema's 32 codes", () => {
    expect(SCHEMA_CODES).toHaveLength(32);
    expect(Object.keys(RETRY).sort()).toEqual([...SCHEMA_CODES].sort());
  });
});

// The §28 table, typed out again from the specification's prose. It is not imported from
// src, so a mistake made in src is not copied into the test.
const TABLE: [ErrorCode, RetryClass][] = [
  ["AUTHENTICATION_REQUIRED", "never"],
  ["AUTHORIZATION_DENIED", "never"],
  ["DELEGATION_REQUIRED", "never"],
  ["DELEGATION_EXPIRED", "never"],
  ["DELEGATION_REVOKED", "never"],
  ["TENANT_MISMATCH", "never"],
  ["RESOURCE_NOT_FOUND", "never"],
  ["VALIDATION_FAILED", "never"],
  ["POLICY_DENIED", "never"],
  ["SOD_VIOLATION", "never"],
  ["LIMIT_EXCEEDED", "after_delay"],
  ["AGENT_SUSPENDED", "never"],
  ["OPERATION_FROZEN", "never"],
  ["APPROVAL_REQUIRED", "never"],
  ["APPROVAL_EXPIRED", "never"],
  ["APPROVAL_MISMATCH", "never"],
  ["APPROVAL_INVALIDATED", "after_state_refresh"],
  ["COOLING_OFF_ACTIVE", "after_delay"],
  ["CONFLICT", "never"],
  ["STALE_STATE", "after_state_refresh"],
  ["IDEMPOTENCY_CONFLICT", "never"],
  ["RESOURCE_HELD", "after_reconciliation"],
  ["OUTCOME_UNKNOWN", "after_reconciliation"],
  ["FRESHNESS_UNSATISFIABLE", "after_delay"],
  ["RATE_LIMITED", "after_delay"],
  ["BATCH_PARTIAL", "per_item"],
  ["CONNECTOR_UNAVAILABLE", "safe_same_key"],
  ["TRANSACTION_FAILED", "safe_same_key"],
  ["EVIDENCE_STORE_UNAVAILABLE", "safe_same_key"],
  ["DEPENDENCY_TIMEOUT", "safe_same_key"],
  ["UNSUPPORTED_CAPABILITY", "never"],
  ["INTERNAL_ERROR", "never"],
];

describe("C3: every code carries the retry class the §28 table gives it", () => {
  // No rule id: this checks the test itself. A missing row would leave a code untested.
  it("the test's copy of the table has one row for each of the schema's codes", () => {
    expect(TABLE.map(([code]) => code).sort()).toEqual([...SCHEMA_CODES].sort());
  });

  // BATCH_PARTIAL is left out here. The schema also requires its items, which this step
  // cannot build, so its envelope is C5's test.
  it.each(TABLE.filter(([code]) => code !== "BATCH_PARTIAL"))(
    "DSOR-ERR-01a: %s is refused with retry class %s",
    (code, retry) => {
      const envelope = refusedWith(code);
      expect(envelope).toMatchObject({ code, retry });
      expect(schemaProblems(envelope)).toEqual([]);
    },
  );

  it("DSOR-ERR-01a: BATCH_PARTIAL has retry class per_item in the table", () => {
    expect(RETRY.BATCH_PARTIAL).toBe("per_item");
  });
});

describe("C4: every answer carries a request_id that DSoR made", () => {
  it("DSOR-COR-01b: a success carries a request_id that DSoR made", () => {
    const answer = call(registry, "invoice.get", { id: "INV-1008" });
    expect(answer.correlation.request_id).toMatch(REQUEST_ID);
  });

  it("DSOR-COR-01b: a refusal carries a request_id that DSoR made", () => {
    const answer = call(registry, "invoice.get", { id: "INV-9999" });
    expect(answer.correlation.request_id).toMatch(REQUEST_ID);
  });

  it("DSOR-COR-01b: two calls get two different request ids", () => {
    const first = call(registry, "invoice.get", { id: "INV-1008" });
    const second = call(registry, "invoice.get", { id: "INV-1008" });
    expect(first.correlation.request_id).not.toBe(second.correlation.request_id);
  });

  // The input holds the operation's arguments. A request_id there is one of them, not a
  // correlation identifier (README, decision 4). It has the right form, so code that
  // used any well-formed id it found would fail here too.
  it("DSOR-COR-01b: a request_id inside the input is not used", () => {
    const mine = "req_00000000-0000-4000-8000-000000000000";
    const answer = call(registry, "invoice.get", { id: "INV-1008", request_id: mine });
    expect(answer.correlation.request_id).toMatch(REQUEST_ID);
    expect(answer.correlation.request_id).not.toBe(mine);
  });
});

describe("C5: an error envelope is checked against the schema before it leaves call", () => {
  it.each([
    ["BATCH_PARTIAL, without the items the schema requires", "BATCH_PARTIAL"],
    ["a code the table does not list", "NOT_A_CODE"],
    ["an extension code this step has not documented", "X_MY_CODE"],
  ])("DSOR-SCH-01: %s never leaves call, and INTERNAL_ERROR does", (_why, code) => {
    // The cast lets the test throw a code that the types would refuse.
    const envelope = refusedWith(code as ErrorCode);
    expect(envelope).toMatchObject({ code: "INTERNAL_ERROR", retry: "never" });
    expect(schemaProblems(envelope)).toEqual([]);
  });
});

// No rule id: this shape is the tutorial's decision 3, and it does not meet DSOR-SCH-01.
describe("C6: a query's success is { data, correlation }", () => {
  it("invoice.get for INV-1008 answers with the invoice as its data", () => {
    expect(call(registry, "invoice.get", { id: "INV-1008" })).toStrictEqual({
      data: {
        id: "INV-1008",
        vendor_id: "VENDOR-44",
        amount: { value: "31400.00", currency: "USD" },
        open_amount: { value: "31400.00", currency: "USD" },
        status: "issued",
      },
      correlation: { request_id: expect.stringMatching(REQUEST_ID) },
    });
  });
});

// No rule id: C7 is the tutorial's own claim.
describe("C7: nothing a caller can cause makes call throw", () => {
  it.each(REFUSALS)("%s comes back as a value, not a throw", (_why, ask) => {
    expect(ask).not.toThrow();
  });

  // The input comes from outside the program, so it may be anything JSON can carry.
  it.each([
    ["null", null],
    ["a number", 1008],
    ["a text", "INV-1008"],
    ["an id that is a number", { id: 1008 }],
    ["a list", ["INV-1008"]],
  ])("invoice.get with %s as its input is refused with VALIDATION_FAILED", (_why, input) => {
    expect(call(registry, "invoice.get", input)).toMatchObject({
      code: "VALIDATION_FAILED",
      retry: "never",
    });
  });

  // JavaScript throws a TypeError for this bug: the same class a bad input threw in step
  // 03. So call cannot tell the two apart by the class (README, decision 5).
  it("a bug that throws a TypeError comes back as INTERNAL_ERROR, not VALIDATION_FAILED", () => {
    const envelope = run((input) => (input as { invoice: { id: string } }).invoice.id);
    expect(envelope).toMatchObject({ code: "INTERNAL_ERROR", retry: "never" });
    expect(schemaProblems(envelope)).toEqual([]);
  });

  it("a bug that throws something that is not an Error comes back as INTERNAL_ERROR", () => {
    const envelope = run(() => {
      throw "the ledger did not answer";
    });
    expect(envelope).toMatchObject({ code: "INTERNAL_ERROR", retry: "never" });
  });

  it("a bug's own message never reaches the caller", () => {
    const envelope = run(() => {
      throw new Error("ledger connection failed at 10.0.0.12:5432");
    });
    expect(JSON.stringify(envelope)).not.toContain("10.0.0.12");
  });
});
