// What an error envelope holds, by step 04's claims (C1, C2, C3, C5 in step 04's README).
import { describe, expect, it } from "vitest";
import { RETRY, Refusal, type ErrorCode, type RetryClass } from "../src/envelope.ts";
import { REFUSALS, REQUEST_ID, SCHEMA_CODES, refusedWith, run, schemaProblems } from "./helpers.ts";

describe("C1: every refusal is an error envelope that passes the real schema", () => {
  // The whole envelope is compared, so no field the schema allows can slip in. Found by
  // the review: a stack trace in `cause`, and `retry_after_seconds: 0` on a refusal that
  // says `never`, passed every test.
  it.each(REFUSALS)(
    "DSOR-ERR-01a: %s is refused with an envelope that passes the schema",
    (_why, ask, code, message) => {
      const envelope = ask();
      expect(envelope).toStrictEqual({
        code,
        message,
        retry: "never",
        correlation: { request_id: expect.stringMatching(REQUEST_ID) },
      });
      expect(schemaProblems(envelope)).toEqual([]);
    },
  );
});

describe("C2: the code is one from the §28 table", () => {
  // No rule id: this checks the specification's schema, not this step's code (found by the
  // review). C5 sends a made-up code through call.
  it("an envelope with a made-up code is refused by the schema", () => {
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

  // Found by the review: code that let a Refusal carry its own retry class passed every
  // test. A handler names the code. Only the table gives the retry class.
  it("DSOR-ERR-01a: a Refusal that carries its own retry class still gets the table's", () => {
    const refusal = Object.assign(new Refusal("AUTHORIZATION_DENIED", "denied"), {
      retry: "safe_same_key",
    });
    const envelope = run(() => {
      throw refusal;
    });
    expect(envelope).toMatchObject({ code: "AUTHORIZATION_DENIED", retry: "never" });
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
