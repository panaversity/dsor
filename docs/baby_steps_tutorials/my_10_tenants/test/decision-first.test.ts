// STEP 08: the decision is written down before the answer goes back.
//
// audit.test.ts is about what a record IS. This file is about when one gets written, which is the
// step's actual claim: every decision, before the response, and that includes every "no".
//
// The failure it prevents has a shape worth keeping in mind. An agent with no permission calls
// invoice.issue two hundred times, learning which invoices exist from the difference between
// AUTHORIZATION_DENIED and RESOURCE_NOT_FOUND. Every one of those is refused, so if refusals are not
// recorded, the whole probe leaves nothing behind. §21 puts it plainly: denied and failed attempts
// are evidence, and they are often the most useful evidence.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countedWithoutARecord,
  forgetTheLog,
  resetClock,
  setClock,
  theHead,
  theLog,
  validateAuditRecord,
  verifyChain,
} from "../src/audit.ts";
import { resetProposalIds, resetRequestIds } from "../src/envelopes.ts";
import { getInvoice, resetInvoices } from "../src/invoice.ts";
import { callOperation, makeDoor, PIPELINE } from "../src/operations.ts";
import { assertPipeline, type Context, type Stage } from "../src/pipeline.ts";
import { aDatabase } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" } as const;
const CFO = { loggedInAs: "cfo_100" } as const;
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

/** A clean slate: an empty log, a counter at zero, and request ids starting again at one. */
async function fresh(): Promise<void> {
  await forgetTheLog();
  resetRequestIds();
  resetProposalIds();
  resetClock();
  resetInvoices();
}

// STEP 09: the log lives in a database, so these tests need one. A single PGlite for the
// whole file — creating one costs about 350ms, and one per test would turn this suite into minutes.
let db: Awaited<ReturnType<typeof aDatabase>>;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("the decision is written down first", () => {
  it("DSOR-EXE-02: an allowed call is recorded, from what DSoR established", async () => {
    await fresh();

    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(answer.kind).toBe("data");
    expect(await theLog()).toHaveLength(1);

    const record = (await theLog())[0]!;

    expect(record.authorization).toBe("ALLOW");
    expect(record.result).toBe("ALLOWED");
    expect(record.identity.subject).toBe("user_123");

    // The operation comes from the contract that was resolved, with its version — not from the
    // string the caller sent. `invoice.get@1` is the schema's operationRef shape.
    expect(record.operation).toBe("invoice.get@1");
    expect(record.correlation.request_id).toBe("req_1");
  });

  // The one that matters most, and the one a careless implementation skips.
  it("DSOR-EXE-02: a refusal is recorded, with the code and the reason for the DENY", async () => {
    await fresh();

    const answer = await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(await theLog()).toHaveLength(1);

    const record = (await theLog())[0]!;

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
  it("DSOR-COR-01a: the record and the answer name the same request", async () => {
    await fresh();

    const refused = await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });
    const issued = await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (refused.kind !== "error" || issued.kind !== "result") {
      throw new Error(`expected a refusal then a result, got ${refused.kind} then ${issued.kind}`);
    }

    expect(await theLog()).toHaveLength(2);
    expect((await theLog())[0]!.correlation.request_id).toBe(
      refused.envelope.correlation.request_id,
    );
    expect((await theLog())[1]!.correlation.request_id).toBe(
      issued.envelope.correlation.request_id,
    );

    // Two requests, two ids, two records. Nothing shared by accident.
    expect((await theLog())[0]!.correlation.request_id).not.toBe(
      (await theLog())[1]!.correlation.request_id,
    );
  });

  it("DSOR-EXE-02: every refusal made during the decision is recorded as a DENY", async () => {
    const refusedWhileDeciding = [
      { login: SUPERVISOR, id: "invoice.destroy", args: {}, code: "UNSUPPORTED_CAPABILITY" },
      {
        login: CFO,
        id: "invoice.issue",
        args: { invoice: INV_1009 },
        code: "AUTHORIZATION_DENIED",
      },
    ];

    for (const { login, id, args, code } of refusedWhileDeciding) {
      await fresh();

      const answer = await callOperation(login, id, args);
      const where = `${login.loggedInAs} calling ${id}`;

      if (answer.kind !== "error") {
        throw new Error(`${where}: expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code, where).toBe(code);
      expect(await theLog(), where).toHaveLength(1);
      expect((await theLog())[0]!.authorization, where).toBe("DENY");
      expect((await theLog())[0]!.result, where).toBe(code);
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
  it("DSOR-EXE-02: a call that fails while executing is recorded as the ALLOW it was", async () => {
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
      await fresh();

      const answer = await callOperation(SUPERVISOR, id, args);
      const where = `user_123 calling ${id} with ${JSON.stringify(args)}`;

      if (answer.kind !== "error") {
        throw new Error(`${where}: expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code, where).toBe(code);

      // Recorded, and recorded as an ALLOW — because the decision was to allow it.
      expect(await theLog(), where).toHaveLength(1);
      expect((await theLog())[0]!.authorization, where).toBe("ALLOW");
      expect((await theLog())[0]!.result, where).toBe("ALLOWED");

      // Which means the record and the answer disagree about how this went. That is the limit: the
      // outcome needs §21.15, and the step that brings it is where this stops being true.
      expect((await theLog())[0]!.result, where).not.toBe(answer.envelope.code);
    }
  });

  // The operationRef trap. A caller asks for an operation that does not exist, so there is no
  // contract and no version — and `operation` in the schema must look like `invoice.get@1`. Putting
  // the caller's string there would make the record unwritable, which would turn a misspelling into
  // EVIDENCE_STORE_UNAVAILABLE.
  it("DSOR-EXE-02: an unknown operation is recorded without an operation field", async () => {
    await fresh();

    await callOperation(SUPERVISOR, "not an operation at all", {});

    const record = (await theLog())[0]!;

    expect(record.operation).toBeUndefined();
    expect(record.result).toBe("UNSUPPORTED_CAPABILITY");
    expect(record.reason).toContain("not an operation at all");
    expect(verifyChain(await theLog())).toBe(true);
  });

  it("DSOR-EXE-02: a caller who never logged in is counted, and writes no record", async () => {
    await fresh();

    for (let i = 0; i < 5; i += 1) {
      expect((await callOperation(undefined, "invoice.get", { invoice: INV_1008 })).kind).toBe(
        "error",
      );
    }

    expect(await theLog()).toHaveLength(0);
    expect(countedWithoutARecord()).toBe(5);
  });

  // "Before the response" made into something a test can see. A stage placed after the recording
  // throws, so the caller gets no answer at all — and the record is already there. This is §21's own
  // warning: write the log in a `finally` at the end and a crash in between leaves nothing.
  it("DSOR-EXE-02: the record is already written when a later stage crashes", async () => {
    await fresh();

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

    // `.rejects`, not `.toThrow`. STEP 09 and a real change: the door is async now, so a stage
    // that throws produces a **rejected promise** rather than throwing where the caller stands. The
    // guarantee under test is unchanged — the record is already written — but the shape a caller has
    // to catch is not, and a test that still said `.toThrow` would pass by never running its body.
    await expect(door(SUPERVISOR, "invoice.get", { invoice: INV_1008 })).rejects.toThrow(
      /power went out/,
    );

    // No answer reached the caller, and the decision is on the record anyway.
    expect(await theLog()).toHaveLength(1);
    expect((await theLog())[0]!.operation).toBe("invoice.get@1");
    expect((await theLog())[0]!.authorization).toBe("ALLOW");
  });

  // Fault injection through the seam that already exists. A clock that returns nonsense makes the
  // record fail its schema, which is the closest this step can get to "the store is down".
  it("DSOR-EXE-03b: if the decision cannot be written, nothing is carried out", async () => {
    await fresh();
    expect(getInvoice("INV-1009")?.status).toBe("draft");

    setClock(() => "the day before yesterday");

    const answer = await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");

    // Retry `safe_same_key`, because the request provably never ran — which is the next assertion.
    expect(answer.envelope.retry).toBe("safe_same_key");
    expect(await theLog()).toHaveLength(0);
    expect(getInvoice("INV-1009")?.status).toBe("draft");

    resetClock();

    // And with the clock working, the same request goes through. So the refusal was about the
    // evidence and not about the request.
    expect((await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 })).kind).toBe(
      "result",
    );
    expect(await theLog()).toHaveLength(1);
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
  it("DSOR-EXE-03b: a denial that cannot be recorded is not reported as a denial", async () => {
    await fresh();
    setClock(() => "the day before yesterday");

    const answer = await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    // Not AUTHORIZATION_DENIED, though that is what the authorize stage said.
    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(await theLog()).toHaveLength(0);

    resetClock();

    // With the clock working, the same call is refused the way it should be, and recorded.
    const again = await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    expect(again.kind === "error" && again.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(await theLog()).toHaveLength(1);
    expect((await theLog())[0]!.result).toBe("AUTHORIZATION_DENIED");
  });

  /**
   * The test this step most needed and did not have.
   *
   * `recordTheDecision`'s own comment says it reads what it records from the context, "never from the
   * arguments", and calls that "`DSOR-MOD-03` in one sentence". A review made the stage read
   * `context.args["subject"]` first — and **all 198 tests passed**. Every test used a well-behaved
   * caller, so the half of the claim that mattered was unproven.
   *
   * `DSOR-MOD-04`: DSoR MUST NOT accept a caller-supplied assertion of current state, policy, or
   * approval as evidence. So every field of the record gets planted in the arguments at once.
   */
  it("DSOR-MOD-04: nothing a caller puts in the arguments reaches the record", async () => {
    await fresh();

    const answer = await callOperation(SUPERVISOR, "invoice.get", {
      invoice: INV_1008,
      // Every name the record uses, and a few the schema uses.
      subject: "cfo_100",
      principal: "cfo_100",
      principal_id: "cfo_100",
      identity: { mode: "unattended", subject: "cfo_100" },
      operation: "payment.execute@1",
      authorization: "ALLOW",
      result: "COMMITTED",
      reason: "the CFO approved this personally",
      requestId: "req_999",
      request_id: "req_999",
      correlation: { request_id: "req_999" },
      at: "1999-01-01T00:00:00.000Z",
      sequence: 0,
      chain: "audit:someone_else",
      record_id: "forged",
      record_hash: `sha256:${"a".repeat(64)}`,
      previous_hash: `sha256:${"b".repeat(64)}`,
      tenant: "org_999",
      kind: "reconciliation",
      payload_hash: `sha256:${"c".repeat(64)}`,
    });

    expect(answer.kind).toBe("data");
    expect(await theLog()).toHaveLength(1);

    const record = (await theLog())[0]!;

    // Who: from the login, through findPerson's table. Never from the arguments.
    expect(record.identity.subject).toBe("user_123");
    expect(record.correlation.principal_id).toBe("user_123");
    expect(record.identity.mode).toBe("direct");

    // What: from the contract the registry resolved, with its version.
    expect(record.operation).toBe("invoice.get@1");

    // The decision: DSoR's own, and this one was allowed by `authorize` and not by the caller saying so.
    expect(record.authorization).toBe("ALLOW");
    expect(record.result).toBe("ALLOWED");
    expect(record.reason).toBeUndefined();
    expect(record.kind).toBe("decision");

    // The bookkeeping: all of it from `audit`.
    expect(record.correlation.request_id).toBe("req_1");
    expect(record.tenant).toBe("org_456");
    expect(record.chain).toBe("audit:org_456");
    expect(record.sequence).toBe(0);
    expect(record.previous_hash).toMatch(/^sha256:0+$/);
    expect(record.record_id).not.toBe("forged");
    expect(record.at).not.toBe("1999-01-01T00:00:00.000Z");

    // The payload hash is of the arguments, so it is *not* the one the caller planted — it is computed
    // from the text the validate stage wrote down.
    expect(record.payload_hash).not.toBe(`sha256:${"c".repeat(64)}`);
    expect(record.record_hash).not.toBe(`sha256:${"a".repeat(64)}`);

    expect(verifyChain(await theLog(), await theHead())).toBe(true);
  });

  // The payload hash is real: it is of these arguments and no others. A review pointed out that a
  // constant fingerprint on every record passed the whole suite.
  it("DSOR-EXE-02: the record's payload hash is of the arguments, and the answer carries the same one", async () => {
    await fresh();

    const issued = await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (issued.kind !== "result") {
      throw new Error(`expected a result, got ${issued.kind}`);
    }

    expect((await theLog())[0]!.payload_hash).toBe(issued.envelope.payload_hash);

    // Different arguments, different fingerprint.
    const other = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(other.kind).toBe("data");
    expect((await theLog())[1]!.payload_hash).not.toBe((await theLog())[0]!.payload_hash);
  });

  // The §21.6 refusal, which is the only decision-stage refusal that arrives with no payload hash.
  it("DSOR-EXE-02: a refusal at validate is recorded, with no payload hash", async () => {
    await fresh();

    const cycle: Record<string, unknown> = { invoice: INV_1008 };

    cycle.itself = cycle;

    const answer = await callOperation(SUPERVISOR, "invoice.get", cycle);

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(await theLog()).toHaveLength(1);
    expect((await theLog())[0]!.authorization).toBe("DENY");
    expect((await theLog())[0]!.result).toBe("VALIDATION_FAILED");
    expect((await theLog())[0]!.payload_hash).toBeUndefined();
    expect((await theLog())[0]!.operation).toBe("invoice.get@1");
  });

  /**
   * A stage that says it carried on without doing its job, and what the record says about it.
   *
   * A review measured the old behaviour: with `validate the input` lazied the caller got
   * `INTERNAL_ERROR` and the record said `ALLOW` / `ALLOWED` — a record that lies by omission, because
   * nothing on it says the call never ran. The check moved from the door into the stage that records,
   * so the refusal is now the thing that gets recorded.
   */
  it("DSOR-EXE-02: a call answered INTERNAL_ERROR is on the record as a DENY", async () => {
    // Two stages, and two different guards catch them — which is worth knowing. Lazying
    // `resolve the operation` is caught by `authorize`, which refuses without a contract; lazying
    // `validate the input` gets past every check and is caught by §21.11's own completeness check.
    // Either way the caller gets INTERNAL_ERROR and the record says so.
    for (const [lazied, why] of [
      ["resolve the operation", /reached authorize without/],
      ["validate the input", /reached §21.11 without/],
    ] as const) {
      await fresh();

      const list = PIPELINE.map((stage) =>
        stage.name === lazied
          ? Object.freeze({
              ...stage,
              run: (context: Context) => ({ kind: "carry_on" as const, context }),
            })
          : stage,
      );

      const answer = await makeDoor(list)(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

      expect(answer.kind === "error" && answer.envelope.code, lazied).toBe("INTERNAL_ERROR");
      expect(await theLog(), lazied).toHaveLength(1);
      expect((await theLog())[0]!.authorization, lazied).toBe("DENY");
      expect((await theLog())[0]!.result, lazied).toBe("INTERNAL_ERROR");
      expect((await theLog())[0]!.reason, lazied).toMatch(why);

      // And nothing was carried out.
      expect(getInvoice("INV-1009")?.status, lazied).toBe("draft");
    }
  });

  // Lesson 13 again. `resolveTheOperation` guards `${id}` on a Symbol; the one stage that runs after
  // it did not, so an evidence failure came back as a stack trace instead of an envelope.
  it("DSOR-ERR-01a: an operation named by something that is not text still gets an envelope", async () => {
    await fresh();
    setClock(() => "the day before yesterday");

    const answer = await callOperation(SUPERVISOR, Symbol("invoice.get") as unknown as string, {});

    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    resetClock();

    // And with the clock working, the same request is refused as an unknown operation, and recorded.
    const again = await callOperation(SUPERVISOR, Symbol("invoice.get") as unknown as string, {});

    expect(again.kind === "error" && again.envelope.code).toBe("UNSUPPORTED_CAPABILITY");
    expect(await theLog()).toHaveLength(1);
    expect((await theLog())[0]!.reason).toMatch(/not text/);
  });

  /**
   * Found by fuzzing, not by reading. A harness sent 20,412 hostile calls and checked invariants after
   * each one; two envelopes came back with the caller's own text in them at full length — 200,026
   * characters from an invoice id and 100,036 from a login name.
   *
   * Step 08 had already capped the **operation** id, in `nameOf`. That is exactly the trap
   * [lesson 13](../../my_notes/lessons.md) describes: four different sites put caller text into a
   * message, and capping them one at a time is how you miss the fifth. The cap now lives in
   * `refusal()`, which every error envelope in this program is built by.
   */
  it("DSOR-ERR-01a: no caller can choose how long an error message is", async () => {
    const huge = "x".repeat(200_000);
    const cases = [
      // the login name, which reaches AUTHENTICATION_REQUIRED
      { login: { loggedInAs: huge }, id: "invoice.get", args: { invoice: INV_1008 } },
      // the invoice id, which reaches RESOURCE_NOT_FOUND
      {
        login: SUPERVISOR,
        id: "invoice.get",
        args: { invoice: `dsor://org_456/invoice/${huge}` },
      },
      // the whole URI, which reaches VALIDATION_FAILED
      { login: SUPERVISOR, id: "invoice.get", args: { invoice: huge } },
      // and the operation id, which reaches UNSUPPORTED_CAPABILITY
      { login: SUPERVISOR, id: huge, args: {} },
    ];

    for (const { login, id, args } of cases) {
      await fresh();

      const answer = await callOperation(login, id, args);

      if (answer.kind !== "error") {
        throw new Error(`expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.message.length, answer.envelope.code).toBeLessThan(400);

      // Shortened, not silently misrepresented: the message says how much was dropped.
      expect(answer.envelope.message, answer.envelope.code).toMatch(/characters, \d+ dropped/);

      // And nothing enormous reached the log either.
      for (const record of await theLog()) {
        expect((record.reason ?? "").length, answer.envelope.code).toBeLessThan(700);
      }
    }
  });

  /**
   * The worst bug step 09 had, and a caller could trigger it with one request.
   *
   * A JavaScript string may contain a **lone surrogate** — `"invoice.\uD800get"` — which is not valid
   * Unicode and which UTF-8 cannot represent. The record was hashed as written and then stored by
   * PostgreSQL as something else:
   *
   *     sent     : "a\ud800b"
   *     read back: "a\ufffdb"
   *
   * So `verifyChain` recomputed the hash from the stored row, got a different answer, and reported
   * the whole log as tampered with — **permanently**, from one malformed request. A NUL byte was the
   * other half: PostgreSQL refuses it outright, so the write failed and the caller was told
   * `EVIDENCE_STORE_UNAVAILABLE` about a database that was perfectly healthy.
   *
   * The rule: **hash what the database will store, never what the caller sent.**
   */
  it("DSOR-AUD-04b: text a database cannot store verbatim does not break the chain", async () => {
    await fresh();

    for (const [what, id] of [
      ["a lone surrogate", "invoice.\uD800get"],
      ["a NUL byte", "invoice.\u0000get"],
      ["both at once", "a\uD800b\u0000c"],
      ["a lone low surrogate", "\uDFFFinvoice"],
    ] as const) {
      const answer = await callOperation(SUPERVISOR, id, {});

      // Refused for the right reason — the operation does not exist — not because of the encoding.
      expect(answer.kind === "error" && answer.envelope.code, what).toBe("UNSUPPORTED_CAPABILITY");

      // Recorded, and the chain still agrees with itself after it.
      expect(await verifyChain(await theLog(), await theHead()), what).toBe(true);
    }

    expect(await theLog()).toHaveLength(4);

    // And every stored row reads back as exactly what was hashed, which is the thing that was wrong.
    for (const record of await theLog()) {
      expect(record.reason!.isWellFormed(), record.record_id).toBe(true);
      expect(record.reason).not.toContain("\u0000");
    }
  });

  // An authenticated caller cannot grow the log without bound, which is the half decision 53 missed.
  it("DSOR-AUD-01: an enormous operation id does not become an enormous record", async () => {
    await fresh();

    const answer = await callOperation(SUPERVISOR, "x".repeat(2_000_000), {});

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("UNSUPPORTED_CAPABILITY");

    // The envelope too, not only the record. `audit` caps what it stores, which protects the log; this
    // caps what is built, which protects the caller — a two-megabyte error message is its own problem.
    expect(answer.envelope.message.length).toBeLessThan(400);

    expect(await theLog()).toHaveLength(1);
    expect((await theLog())[0]!.reason!.length).toBeLessThan(600);
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
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

  it("DSOR-EXE-02: no stage but the recording may run after a refusal", () => {
    const tooEager = PIPELINE.map((stage) =>
      stage.name === "authorize" ? Object.freeze({ ...stage, evenAfterARefusal: true }) : stage,
    );

    expect(() => assertPipeline(tooEager)).toThrow(/may not run after a refusal/);
    expect(() => makeDoor(tooEager)).toThrow(/may not run after a refusal/);
  });

  // The chain holds across a real run of mixed answers, which is the property step 39 will move into
  // a database.
  it("DSOR-AUD-01: every record the pipeline writes validates against the schema", async () => {
    await fresh();

    await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });
    await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });
    await callOperation(SUPERVISOR, "invoice.destroy", {});
    await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    // Every `validateAuditRecord` call in audit.test.ts is on a record that file built itself.
    // DSOR-AUD-01's sentence is about the records the pipeline actually writes, and a review pointed
    // out that nothing checked those.
    expect(await theLog()).toHaveLength(4);

    for (const record of await theLog()) {
      expect(validateAuditRecord(record), record.record_id).toBe(true);
    }
  });

  it("DSOR-AUD-04b: a run of allows and denials leaves one verifiable chain", async () => {
    await fresh();

    await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });
    await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });
    await callOperation(undefined, "invoice.get", { invoice: INV_1008 });
    await callOperation(SUPERVISOR, "invoice.destroy", {});
    await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    // Four records, not five: the caller with no login was counted instead.
    expect(await theLog()).toHaveLength(4);
    expect(countedWithoutARecord()).toBe(1);
    expect(verifyChain(await theLog(), await theHead())).toBe(true);
    expect((await theLog()).map((record) => record.authorization)).toEqual([
      "ALLOW",
      "DENY",
      "DENY",
      "ALLOW",
    ]);
  });
});
