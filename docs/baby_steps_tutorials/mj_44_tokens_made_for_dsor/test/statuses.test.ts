// Step 42: the HTTP status of each answer. The body is always call()'s answer; the status comes
// from one table, chosen by the retry class (step 42's README, claim C6, decisions D4 and A3).
import { describe, expect, it } from "vitest";
import { RETRY, type Answer, type ErrorCode } from "../src/envelope.ts";
import { REPEATED, STATUS, statusOf } from "../src/statuses.ts";
import { SCHEMA_CODES } from "./helpers.ts";

const correlation = { request_id: "req_1" };

describe("C6: one status for each answer", () => {
  it("Step 42, D4: every code of §28 has exactly one status, and the table has no other code", () => {
    expect(Object.keys(STATUS).sort()).toStrictEqual([...SCHEMA_CODES].sort());
    expect(Object.keys(STATUS).sort()).toStrictEqual(Object.keys(RETRY).sort());
  });

  it("Step 42, D4: a status retry libraries repeat by themselves goes only to a code whose retry is safe, except INTERNAL_ERROR (A3)", () => {
    const repeated = Object.entries(STATUS).filter(([, status]) => REPEATED.includes(status));
    const unsafe = repeated
      .map(([code]) => code as ErrorCode)
      .filter((code) => !["safe_same_key", "after_delay"].includes(RETRY[code]));
    expect(unsafe).toStrictEqual(["INTERNAL_ERROR"]);
  });

  it("Step 42, D4: OUTCOME_UNKNOWN and RESOURCE_HELD are 409, which no library repeats by itself", () => {
    expect([STATUS.OUTCOME_UNKNOWN, STATUS.RESOURCE_HELD]).toStrictEqual([409, 409]);
    expect(REPEATED).not.toContain(409);
  });

  it("Step 42, D4: each kind of refusal has its own status", () => {
    expect({
      AUTHENTICATION_REQUIRED: STATUS.AUTHENTICATION_REQUIRED,
      AUTHORIZATION_DENIED: STATUS.AUTHORIZATION_DENIED,
      RESOURCE_NOT_FOUND: STATUS.RESOURCE_NOT_FOUND,
      UNSUPPORTED_CAPABILITY: STATUS.UNSUPPORTED_CAPABILITY,
      VALIDATION_FAILED: STATUS.VALIDATION_FAILED,
      LIMIT_EXCEEDED: STATUS.LIMIT_EXCEEDED,
      EVIDENCE_STORE_UNAVAILABLE: STATUS.EVIDENCE_STORE_UNAVAILABLE,
      DEPENDENCY_TIMEOUT: STATUS.DEPENDENCY_TIMEOUT,
      INTERNAL_ERROR: STATUS.INTERNAL_ERROR,
    }).toStrictEqual({
      AUTHENTICATION_REQUIRED: 401,
      AUTHORIZATION_DENIED: 403,
      RESOURCE_NOT_FOUND: 404,
      UNSUPPORTED_CAPABILITY: 404,
      VALIDATION_FAILED: 422,
      LIMIT_EXCEEDED: 429,
      EVIDENCE_STORE_UNAVAILABLE: 503,
      DEPENDENCY_TIMEOUT: 504,
      INTERNAL_ERROR: 500,
    });
  });

  it("Step 42, D4: a result is 200, and a result that waits is 202, since waiting is not an error", () => {
    const results: [Answer, number][] = [
      [{ data: {}, classification: "public", freshness: {} as never, correlation }, 200],
      [{ outcome: "VALIDATED", decision: "ALLOW", correlation }, 200],
      [{ outcome: "COMMITTED", correlation } as unknown as Answer, 200],
      [{ outcome: "READY", correlation } as unknown as Answer, 202],
      [{ outcome: "PENDING_APPROVAL", correlation } as unknown as Answer, 202],
    ];
    for (const [answer, status] of results) expect(statusOf(answer)).toBe(status);
  });

  it("Step 42, D4: an error's status is its code's", () => {
    const refused = {
      code: "OUTCOME_UNKNOWN",
      message: "",
      retry: "after_reconciliation",
      correlation,
    };
    expect(statusOf(refused as Answer)).toBe(409);
  });
});
