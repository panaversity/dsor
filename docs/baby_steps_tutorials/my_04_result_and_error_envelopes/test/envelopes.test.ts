// NEW IN STEP 04: every answer has one outer shape, and every error carries a code
// and a retry class.
//
// The schema proves the shape. It does not prove the meaning: a CONFLICT with
// retry "safe_same_key" validates cleanly. So the retry class comes from a table
// copied out of §28, not from whoever is building the envelope, and these tests are
// what hold that table to the specification.

import { describe, expect, it } from "vitest";
import {
  CODE_RETRY,
  errorCodes,
  nextRequestId,
  refusal,
  resetRequestIds,
  success,
  validateEnvelope,
} from "../src/envelopes.ts";

describe("the error envelope", () => {
  it("DSOR-ERR-01a: a refusal validates against error-envelope.schema.json", () => {
    const envelope = refusal("RESOURCE_NOT_FOUND", "INV-9999 is not an invoice we hold");

    expect(validateEnvelope("error", envelope)).toBe(true);
    expect(envelope.code).toBe("RESOURCE_NOT_FOUND");
    expect(envelope.message).toBe("INV-9999 is not an invoice we hold");
  });

  it("DSOR-ERR-01a: a refusal carries a retry class and a request id", () => {
    const envelope = refusal("CONFLICT", "INV-1008 is already issued");

    expect(envelope.retry).toBe("never");
    expect(envelope.correlation.request_id).toMatch(/^req_\d+$/);
  });

  // The whole reason the table exists. A caller must not be able to choose its own
  // retry class, because the schema would accept a wrong one.
  it("DSOR-ERR-01a: the retry class comes from the code, not from the caller", () => {
    expect(refusal("CONFLICT", "x").retry).toBe("never");
    expect(refusal("RATE_LIMITED", "x").retry).toBe("after_delay");
    expect(refusal("STALE_STATE", "x").retry).toBe("after_state_refresh");
    expect(refusal("OUTCOME_UNKNOWN", "x").retry).toBe("after_reconciliation");
    expect(refusal("CONNECTOR_UNAVAILABLE", "x").retry).toBe("safe_same_key");
  });

  // BATCH_PARTIAL is in the table with the right class, and refusal() still cannot
  // build one: the schema requires an `items` array listing each item's outcome, and
  // this step has no batches. Step 41 is where batches arrive. The self-check catches
  // the attempt rather than letting a half-built envelope out.
  it("DSOR-ERR-01a: a code needing more than the table can give is refused at build time", () => {
    expect(CODE_RETRY["BATCH_PARTIAL"]).toBe("per_item");
    expect(() => refusal("BATCH_PARTIAL", "x")).toThrow(/does not validate/);
  });

  it("DSOR-ERR-01a: a code that is not in §28 at all is refused", () => {
    expect(() => refusal("MADE_UP_CODE", "x")).toThrow(/not an error code from §28/);
  });

  // Ten of the thirty-two rows happen to be pinned by a test that builds that particular
  // refusal. The other twenty-two could say anything the Retry type allows, and a wrong
  // row is a wrong instruction: retry an AUTHORIZATION_DENIED for ever, or give up on a
  // TRANSACTION_FAILED that a retry would have fixed. This pins the whole table to §28 in
  // one place, so a mistyped row cannot be silent.
  it("DSOR-ERR-01a: every row of the table is the retry class §28 gives that code", () => {
    expect(CODE_RETRY).toEqual({
      AUTHENTICATION_REQUIRED: "never",
      AUTHORIZATION_DENIED: "never",
      DELEGATION_REQUIRED: "never",
      DELEGATION_EXPIRED: "never",
      DELEGATION_REVOKED: "never",
      TENANT_MISMATCH: "never",
      RESOURCE_NOT_FOUND: "never",
      VALIDATION_FAILED: "never",
      POLICY_DENIED: "never",
      SOD_VIOLATION: "never",
      LIMIT_EXCEEDED: "after_delay",
      AGENT_SUSPENDED: "never",
      OPERATION_FROZEN: "never",
      APPROVAL_REQUIRED: "never",
      APPROVAL_EXPIRED: "never",
      APPROVAL_MISMATCH: "never",
      APPROVAL_INVALIDATED: "after_state_refresh",
      COOLING_OFF_ACTIVE: "after_delay",
      CONFLICT: "never",
      STALE_STATE: "after_state_refresh",
      IDEMPOTENCY_CONFLICT: "never",
      RESOURCE_HELD: "after_reconciliation",
      OUTCOME_UNKNOWN: "after_reconciliation",
      FRESHNESS_UNSATISFIABLE: "after_delay",
      RATE_LIMITED: "after_delay",
      BATCH_PARTIAL: "per_item",
      CONNECTOR_UNAVAILABLE: "safe_same_key",
      TRANSACTION_FAILED: "safe_same_key",
      EVIDENCE_STORE_UNAVAILABLE: "safe_same_key",
      DEPENDENCY_TIMEOUT: "safe_same_key",
      UNSUPPORTED_CAPABILITY: "never",
      INTERNAL_ERROR: "never",
    });
  });

  // If the specification adds a code and this step does not, refusal() would have no
  // retry class for it. This test reads the normative schema's own list and refuses to
  // let the table fall behind it.
  it("DSOR-ERR-01a: every code the schema allows has a retry class in the table", () => {
    const allowed = errorCodes();

    expect(allowed.length).toBe(32);

    for (const code of allowed) {
      expect(CODE_RETRY[code], `no retry class for ${code}`).toBeDefined();
    }

    // And nothing in the table that the schema does not allow.
    for (const code of Object.keys(CODE_RETRY)) {
      expect(allowed, `${code} is not a code the schema allows`).toContain(code);
    }
  });

  // No rule id: nothing in this step can produce an unknown outcome, so this proves what
  // the schema pins, not that DSOR-UNK-01b is met. That rule arrives in step 37.
  it("the schema pins three codes' retry classes, and only three", () => {
    const e = (code: string, retry: string) => ({
      code,
      message: "x",
      retry,
      correlation: { request_id: "req_1" },
    });

    // Pinned: the schema itself refuses the wrong class.
    expect(validateEnvelope("error", e("OUTCOME_UNKNOWN", "safe_same_key"))).toBe(false);
    expect(validateEnvelope("error", e("RESOURCE_HELD", "safe_same_key"))).toBe(false);
    expect(validateEnvelope("error", e("BATCH_PARTIAL", "never"))).toBe(false);

    // Not pinned: the schema has no opinion, and the table is the only thing that does.
    expect(validateEnvelope("error", e("CONFLICT", "safe_same_key"))).toBe(true);
    expect(validateEnvelope("error", e("RATE_LIMITED", "never"))).toBe(true);
    expect(CODE_RETRY["CONFLICT"]).toBe("never");
    expect(CODE_RETRY["RATE_LIMITED"]).toBe("after_delay");
  });

  // The table is the step's one real guarantee, so it must not be editable at run time.
  // `Readonly<...>` is erased before Node runs the file — the same lesson step 01 learned
  // about invoices — so Object.freeze is what actually holds it still.
  it("DSOR-ERR-01a: the table cannot be edited at run time", () => {
    expect(Object.isFrozen(CODE_RETRY)).toBe(true);
    expect(() => {
      // @ts-expect-error the table is readonly, so this assignment must not compile
      CODE_RETRY["CONFLICT"] = "safe_same_key";
    }).toThrow(TypeError);
    expect(refusal("CONFLICT", "x").retry).toBe("never");
  });

  it("DSOR-ERR-01a: an envelope handed to a caller cannot be edited", () => {
    const envelope = refusal("CONFLICT", "x");

    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.correlation)).toBe(true);
    expect(() => {
      // @ts-expect-error retry is readonly
      envelope.retry = "safe_same_key";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error the request id is readonly
      envelope.correlation.request_id = "req_someone_elses";
    }).toThrow(TypeError);
  });

  // ajv would otherwise print `unknown format "date-time" ignored` and accept anything
  // in a date field. This is what the extra dependency buys.
  it("DSOR-SCH-01: a date field that is not a date is refused", () => {
    const pending = {
      outcome: "PENDING_APPROVAL",
      proposal: "dsor://org_456/proposal/prop_0001",
      payload_hash: "sha256:abc",
      semantics: "atomic",
      requires: [{}],
      correlation: { request_id: "req_1" },
    };

    expect(validateEnvelope("result", { ...pending, expires_at: "2026-09-24T10:00:00Z" })).toBe(
      true,
    );
    expect(validateEnvelope("result", { ...pending, expires_at: "tomorrow" })).toBe(false);
  });

  it("a code the schema does not allow is refused", () => {
    expect(
      validateEnvelope("error", {
        code: "TOTALLY_MADE_UP",
        message: "x",
        retry: "never",
        correlation: { request_id: "req_1" },
      }),
    ).toBe(false);
  });

  it("DSOR-SCH-02: a field the schema does not know is refused", () => {
    expect(
      validateEnvelope("error", {
        code: "CONFLICT",
        message: "x",
        retry: "never",
        correlation: { request_id: "req_1" },
        hint: "try harder",
      }),
    ).toBe(false);
  });
});

describe("the result envelope", () => {
  it("DSOR-SCH-01: a committed command validates against result-envelope.schema.json", () => {
    const envelope = success({
      data: { id: "INV-1009" },
      semantics: "atomic",
      payload: { invoice: "dsor://org_456/invoice/INV-1009" },
    });

    expect(validateEnvelope("result", envelope)).toBe(true);
    expect(envelope.outcome).toBe("COMMITTED");
  });

  // COMMITTED is not free: the schema demands all three of these, which is why the
  // README explains what each one is and is not.
  it("DSOR-SCH-01: COMMITTED carries a proposal address, a payload hash, and semantics", () => {
    const envelope = success({
      data: { id: "INV-1009" },
      semantics: "atomic",
      payload: { invoice: "dsor://org_456/invoice/INV-1009" },
    });

    expect(envelope.proposal).toMatch(/^dsor:\/\/org_456\/proposal\/prop_\d+$/);
    expect(envelope.payload_hash).toMatch(/^sha256:[A-Za-z0-9+/=_-]+$/);
    expect(envelope.semantics).toBe("atomic");
  });

  it("DSOR-SCH-01: the same payload hashes the same, a different one does not", () => {
    const a = success({ data: {}, semantics: "atomic", payload: { invoice: "a" } });
    const b = success({ data: {}, semantics: "atomic", payload: { invoice: "a" } });
    const c = success({ data: {}, semantics: "atomic", payload: { invoice: "b" } });

    expect(a.payload_hash).toBe(b.payload_hash);
    expect(a.payload_hash).not.toBe(c.payload_hash);
  });

  it("DSOR-SCH-01: a result that would not validate never leaves the builder", () => {
    // The same self-check refusal() has. Without it, an envelope whose semantics is not
    // one of the five allowed words would be handed to a caller.
    expect(() => success({ data: {}, semantics: "instantly", payload: {} })).toThrow(
      /does not validate/,
    );
  });

  it("DSOR-ERR-01a: a result envelope cannot be edited either", () => {
    const envelope = success({ data: {}, semantics: "atomic", payload: {} });

    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.correlation)).toBe(true);
    expect(() => {
      // @ts-expect-error outcome is readonly
      envelope.outcome = "READY";
    }).toThrow(TypeError);
  });

  it("DSOR-SCH-01: a COMMITTED result without its three companions is refused", () => {
    expect(
      validateEnvelope("result", {
        outcome: "COMMITTED",
        correlation: { request_id: "req_1" },
      }),
    ).toBe(false);
  });
});

describe("request ids", () => {
  it("DSOR-COR-01b: every envelope gets a request id, and they do not repeat", () => {
    resetRequestIds();

    expect(nextRequestId()).toBe("req_1");
    expect(nextRequestId()).toBe("req_2");
    expect(refusal("CONFLICT", "x").correlation.request_id).toBe("req_3");
  });

  it("DSOR-COR-01b: a caller's own request id is kept, in either envelope", () => {
    expect(refusal("CONFLICT", "x", "req_from_caller").correlation.request_id).toBe(
      "req_from_caller",
    );
    expect(
      success({ data: {}, semantics: "atomic", payload: {}, requestId: "req_from_caller" })
        .correlation.request_id,
    ).toBe("req_from_caller");
  });

  it("nothing else is filled in, because nothing else is known yet", () => {
    // tenant_id waits for step 10, agent_id and principal_id for step 05, and
    // propagation through connectors and audit for step 40.
    expect(Object.keys(refusal("CONFLICT", "x").correlation)).toEqual(["request_id"]);
  });
});
