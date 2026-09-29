// NEW IN STEP 08: the decision is written down before the answer goes back.
//
// audit.test.ts is about what a record IS. This file is about when one gets written, which is the
// step's actual claim: every decision, before the response, and that includes every "no".
//
// The failure it prevents has a shape worth keeping in mind. An agent with no permission calls
// invoice.issue two hundred times, learning which invoices exist from the difference between
// AUTHORIZATION_DENIED and RESOURCE_NOT_FOUND. Every one of those is refused, so if refusals are not
// recorded, the whole probe leaves nothing behind. §21 puts it plainly: denied and failed attempts
// are evidence, and they are often the most useful evidence.

import { describe, expect, it } from "vitest";
import {
  countedWithoutARecord,
  forgetTheLog,
  resetClock,
  setClock,
  theLog,
  verifyChain,
} from "../src/audit.ts";
import { resetProposalIds, resetRequestIds } from "../src/envelopes.ts";
import { getInvoice, resetInvoices } from "../src/invoice.ts";
import { callOperation, makeDoor, PIPELINE } from "../src/operations.ts";
import { assertPipeline, type Context, type Stage } from "../src/pipeline.ts";

const SUPERVISOR = { loggedInAs: "user_123" } as const;
const CFO = { loggedInAs: "cfo_100" } as const;
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

/** A clean slate: an empty log, a counter at zero, and request ids starting again at one. */
function fresh(): void {
  forgetTheLog();
  resetRequestIds();
  resetProposalIds();
  resetClock();
  resetInvoices();
}

describe("the decision is written down first", () => {
  it("DSOR-EXE-02: an allowed call is recorded, from what DSoR established", () => {
    fresh();

    const answer = callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(answer.kind).toBe("data");
    expect(theLog()).toHaveLength(1);

    const record = theLog()[0]!;

    expect(record.authorization).toBe("ALLOW");
    expect(record.result).toBe("ALLOWED");
    expect(record.identity.subject).toBe("user_123");

    // The operation comes from the contract that was resolved, with its version — not from the
    // string the caller sent. `invoice.get@1` is the schema's operationRef shape.
    expect(record.operation).toBe("invoice.get@1");
    expect(record.correlation.request_id).toBe("req_1");
  });

  // The one that matters most, and the one a careless implementation skips.
  it("DSOR-EXE-02: a refusal is recorded, with the code and the reason for the DENY", () => {
    fresh();

    const answer = callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(theLog()).toHaveLength(1);

    const record = theLog()[0]!;

    expect(record.authorization).toBe("DENY");
    expect(record.result).toBe("AUTHORIZATION_DENIED");
    expect(record.reason).toContain("cfo_100 may not call invoice.issue");
    expect(record.identity.subject).toBe("cfo_100");
    expect(record.operation).toBe("invoice.issue@1");

    // And the CFO's refusal did not issue the invoice, so the record is about a decision only.
    expect(getInvoice("INV-1009")?.status).toBe("draft");
  });

  // Why the request id had to be repaired first. Without this the record and the answer are two
  // unrelated pieces of paper.
  it("DSOR-EXE-02: the record and the answer name the same request", () => {
    fresh();

    const refused = callOperation(CFO, "invoice.issue", { invoice: INV_1009 });
    const issued = callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (refused.kind !== "error" || issued.kind !== "result") {
      throw new Error(`expected a refusal then a result, got ${refused.kind} then ${issued.kind}`);
    }

    expect(theLog()).toHaveLength(2);
    expect(theLog()[0]!.correlation.request_id).toBe(refused.envelope.correlation.request_id);
    expect(theLog()[1]!.correlation.request_id).toBe(issued.envelope.correlation.request_id);

    // Two requests, two ids, two records. Nothing shared by accident.
    expect(theLog()[0]!.correlation.request_id).not.toBe(theLog()[1]!.correlation.request_id);
  });

  it("DSOR-EXE-02: every refusal made during the decision is recorded as a DENY", () => {
    const refusedWhileDeciding = [
      { login: SUPERVISOR, id: "invoice.destroy", args: {}, code: "UNSUPPORTED_CAPABILITY" },
      { login: CFO, id: "invoice.issue", args: { invoice: INV_1009 }, code: "AUTHORIZATION_DENIED" },
    ];

    for (const { login, id, args, code } of refusedWhileDeciding) {
      fresh();

      const answer = callOperation(login, id, args);
      const where = `${login.loggedInAs} calling ${id}`;

      if (answer.kind !== "error") {
        throw new Error(`${where}: expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code, where).toBe(code);
      expect(theLog(), where).toHaveLength(1);
      expect(theLog()[0]!.authorization, where).toBe("DENY");
      expect(theLog()[0]!.result, where).toBe(code);
    }
  });

  /**
   * The gap this step leaves, written as a test rather than a sentence in the README.
   *
   * A record says what was **decided**, not what **happened**. §21 separates the two: step 11
   * records the decision, and step 15 finalizes the outcome as COMMITTED, FAILED or
   * OUTCOME_UNKNOWN. This step has step 11 and no step 15.
   *
   * So a call that is authorized and then fails while executing is on the record as ALLOW, and the
   * caller is told VALIDATION_FAILED. Both are true and the record is incomplete. Writing this test
   * the other way round — asserting DENY — is what I did first, and it failed, which is how the gap
   * got found rather than shipped.
   *
   * There is a second reason these refusals arrive late, and it is step 04's, not step 08's: the
   * `validate the input` stage only checks that the arguments can be written down. It does not check
   * them against the contract's input schema, so a missing `invoice` is not caught at §21.6 where it
   * belongs — it is caught inside the handler.
   */
  it("DSOR-EXE-02: a call that fails while executing is recorded as the ALLOW it was", () => {
    const refusedWhileExecuting = [
      { id: "invoice.get", args: {}, code: "VALIDATION_FAILED" },
      {
        id: "invoice.get",
        args: { invoice: "dsor://org_999/invoice/INV-1008" },
        code: "TENANT_MISMATCH",
      },
      {
        id: "invoice.issue",
        args: { invoice: INV_1008 },
        code: "CONFLICT",
      },
    ];

    for (const { id, args, code } of refusedWhileExecuting) {
      fresh();

      const answer = callOperation(SUPERVISOR, id, args);
      const where = `user_123 calling ${id} with ${JSON.stringify(args)}`;

      if (answer.kind !== "error") {
        throw new Error(`${where}: expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code, where).toBe(code);

      // Recorded, and recorded as an ALLOW — because the decision was to allow it.
      expect(theLog(), where).toHaveLength(1);
      expect(theLog()[0]!.authorization, where).toBe("ALLOW");
      expect(theLog()[0]!.result, where).toBe("ALLOWED");

      // Which means the record and the answer disagree about how this went. That is the limit: the
      // outcome needs §21.15, and the step that brings it is where this stops being true.
      expect(theLog()[0]!.result, where).not.toBe(answer.envelope.code);
    }
  });

  // The operationRef trap. A caller asks for an operation that does not exist, so there is no
  // contract and no version — and `operation` in the schema must look like `invoice.get@1`. Putting
  // the caller's string there would make the record unwritable, which would turn a misspelling into
  // EVIDENCE_STORE_UNAVAILABLE.
  it("DSOR-EXE-02: an unknown operation is recorded without an operation field", () => {
    fresh();

    callOperation(SUPERVISOR, "not an operation at all", {});

    const record = theLog()[0]!;

    expect(record.operation).toBeUndefined();
    expect(record.result).toBe("UNSUPPORTED_CAPABILITY");
    expect(record.reason).toContain("not an operation at all");
    expect(verifyChain(theLog())).toBe(true);
  });

  it("DSOR-EXE-02: a caller who never logged in is counted, and writes no record", () => {
    fresh();

    for (let i = 0; i < 5; i += 1) {
      expect(callOperation(undefined, "invoice.get", { invoice: INV_1008 }).kind).toBe("error");
    }

    expect(theLog()).toHaveLength(0);
    expect(countedWithoutARecord()).toBe(5);
  });

  // "Before the response" made into something a test can see. A stage placed after the recording
  // throws, so the caller gets no answer at all — and the record is already there. This is §21's own
  // warning: write the log in a `finally` at the end and a crash in between leaves nothing.
  it("DSOR-EXE-02: the record is already written when a later stage crashes", () => {
    fresh();

    const explode: Stage = Object.freeze({
      at: 14,
      name: "execute",
      applies: "both",
      evenAfterARefusal: false,
      run: (_context: Context) => {
        throw new Error("the power went out");
      },
    });

    const door = makeDoor([...PIPELINE, explode]);

    expect(() => door(SUPERVISOR, "invoice.get", { invoice: INV_1008 })).toThrow(/power went out/);

    // No answer reached the caller, and the decision is on the record anyway.
    expect(theLog()).toHaveLength(1);
    expect(theLog()[0]!.operation).toBe("invoice.get@1");
    expect(theLog()[0]!.authorization).toBe("ALLOW");
  });

  // Fault injection through the seam that already exists. A clock that returns nonsense makes the
  // record fail its schema, which is the closest this step can get to "the store is down".
  it("DSOR-EXE-02: if the decision cannot be written, nothing is carried out", () => {
    fresh();
    expect(getInvoice("INV-1009")?.status).toBe("draft");

    setClock(() => "the day before yesterday");

    const answer = callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");

    // Retry `safe_same_key`, because the request provably never ran — which is the next assertion.
    expect(answer.envelope.retry).toBe("safe_same_key");
    expect(theLog()).toHaveLength(0);
    expect(getInvoice("INV-1009")?.status).toBe("draft");

    resetClock();

    // And with the clock working, the same request goes through. So the refusal was about the
    // evidence and not about the request.
    expect(callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 }).kind).toBe("result");
    expect(theLog()).toHaveLength(1);
  });

  /**
   * The case that survived a mutation, which is how it got written.
   *
   * A denial that cannot be recorded must not be reported as a denial. Answering
   * AUTHORIZATION_DENIED would be answering without having written the decision down, which is the
   * one thing DSOR-EXE-02 forbids — and the caller would have no way to know the refusal went
   * unrecorded. So the refusal from the recording stage **replaces** the earlier one.
   *
   * Changing the walker to keep the first refusal instead of the last left all 196 tests passing,
   * because every test about a failed record used a call that was otherwise allowed. This is the
   * missing half.
   */
  it("DSOR-EXE-02: a denial that cannot be recorded is not reported as a denial", () => {
    fresh();
    setClock(() => "the day before yesterday");

    const answer = callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    // Not AUTHORIZATION_DENIED, though that is what the authorize stage said.
    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(theLog()).toHaveLength(0);

    resetClock();

    // With the clock working, the same call is refused the way it should be, and recorded.
    const again = callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    expect(again.kind === "error" && again.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(theLog()).toHaveLength(1);
    expect(theLog()[0]!.result).toBe("AUTHORIZATION_DENIED");
  });

  // The guard that stops a later step reintroducing the hole by accident. A `record the decision`
  // stage added with the flag off records every success and silently drops every denial — and not
  // one test about an answer would notice.
  it("DSOR-EXE-02: a recording stage that skips refusals stops the program", () => {
    const halfHearted = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({ ...stage, evenAfterARefusal: false })
        : stage,
    );

    expect(() => assertPipeline(halfHearted)).toThrow(/must run even after a refusal/);
    expect(() => makeDoor(halfHearted)).toThrow(/must run even after a refusal/);
  });

  it("DSOR-EXE-02: a stage that runs after a refusal may not sit before the recording", () => {
    const tooEager = PIPELINE.map((stage) =>
      stage.name === "authorize" ? Object.freeze({ ...stage, evenAfterARefusal: true }) : stage,
    );

    expect(() => assertPipeline(tooEager)).toThrow(/before the decision is recorded/);
  });

  // The chain holds across a real run of mixed answers, which is the property step 39 will move into
  // a database.
  it("DSOR-AUD-01: a run of allows and denials leaves one verifiable chain", () => {
    fresh();

    callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });
    callOperation(CFO, "invoice.issue", { invoice: INV_1009 });
    callOperation(undefined, "invoice.get", { invoice: INV_1008 });
    callOperation(SUPERVISOR, "invoice.destroy", {});
    callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    // Four records, not five: the caller with no login was counted instead.
    expect(theLog()).toHaveLength(4);
    expect(countedWithoutARecord()).toBe(1);
    expect(verifyChain(theLog())).toBe(true);
    expect(theLog().map((record) => record.authorization)).toEqual([
      "ALLOW",
      "DENY",
      "DENY",
      "ALLOW",
    ]);
  });
});
