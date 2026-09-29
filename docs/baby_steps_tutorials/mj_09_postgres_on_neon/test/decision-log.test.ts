// Every decision is written down before the answer leaves, by claim (C1
// to C5 in step 08's README).
import { describe, expect, it, vi } from "vitest";
import { Refusal, type Answer, type ErrorCode } from "../src/envelope.ts";
import { createLog, type Decision, type DecisionLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import {
  AGENT,
  NOBODY,
  REFUSALS,
  SUPERVISOR,
  THE_AGENT,
  UNEXPECTED,
  correlationFor,
  log,
  registry,
  registryWith,
  schemaProblems,
} from "./helpers.ts";

// "aud_" and a random UUID. The form is this tutorial's decision (step 08's README,
// decision 5); the specification's example is "aud_9001".
const RECORD_ID = /^aud_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The message when the log cannot take a record, typed out rather than imported.
const NOT_RECORDED = "DSoR could not record its decision, so it refuses the call";

/** A log that refuses to write: a full disk, or a store that is down. */
const brokenLog: DecisionLog = {
  add: async () => {
    throw new Error("disk full at /var/dsor/log");
  },
  records: async () => [],
};

// Each refusal from helpers.ts, and what its record must say beyond its code and message:
// ALLOW once the call reached its code at line ⑨, and the operation it asked for, when a
// contract has that name (step 08's README, decision 5).
const RECORDED_AS: Record<string, ["ALLOW" | "DENY", string | undefined]> = {
  "a call with no login": ["DENY", "invoice.get@1"],
  "a request id that is empty": ["DENY", "invoice.get@1"],
  "the agent naming cfo_100 in its arguments": ["DENY", "invoice.get@1"],
  "an operation with no contract": ["DENY", undefined],
  "the agent calling invoice.issue, which no role of its grants": ["DENY", "invoice.issue@1"],
  "invoice.issue, which has no code yet": ["DENY", "invoice.issue@1"],
  "invoice.issue given code, because it is a command": ["DENY", "invoice.issue@1"],
  "invoice.get without an id": ["DENY", "invoice.get@1"],
  "invoice.get for INV-9999": ["ALLOW", "invoice.get@1"],
  "a bug in an operation's code": ["ALLOW", "test.run@1"],
};

/** The record a test expects: the fields DSoR fills in, and the decision itself. */
function recordOf(sequence: number, decision: Record<string, unknown>): Record<string, unknown> {
  return {
    record_id: expect.stringMatching(RECORD_ID),
    sequence,
    at: expect.any(String),
    kind: "decision",
    ...decision,
  };
}

/** Calls through a fresh log, and gives back the answer and every record in the log. */
async function recorded(
  make: (log: DecisionLog) => Promise<Answer>,
): Promise<{ answer: Answer; records: unknown[] }> {
  const fresh = createLog();
  const answer = await make(fresh);
  return { answer, records: await fresh.records() };
}

describe("C1: every answer call gives has a record in the log", () => {
  it("DSOR-EXE-02: a success leaves one record: ALLOW, the result ok, and no reason", async () => {
    const { answer, records } = await recorded((l) =>
      call(registry, l, AGENT, "invoice.get", { id: "INV-1008" }),
    );
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(records).toStrictEqual([
      recordOf(1, {
        operation: "invoice.get@1",
        authorization: "ALLOW",
        result: "ok",
        correlation: answer.correlation,
      }),
    ]);
  });

  it("the table of refusals covers every refusal in helpers.ts", async () => {
    expect(REFUSALS.map(([why]) => why).sort()).toStrictEqual(Object.keys(RECORDED_AS).sort());
  });

  it.each(REFUSALS)("DSOR-EXE-02: %s leaves one record", async (why, make, code, message) => {
    const before = (await log.records()).length;
    const answer = await make();
    const after = await log.records();
    const [authorization, operation] = RECORDED_AS[why]!;
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toStrictEqual(
      recordOf(before + 1, {
        ...(operation === undefined ? {} : { operation }),
        authorization,
        result: code,
        reason: message,
        correlation: answer.correlation,
      }),
    );
  });

  it("DSOR-EXE-02: the record names the caller and the caller's own request id", async () => {
    const { records } = await recorded((l) =>
      call(registry, l, { ...SUPERVISOR, request_id: "ap-desk-7" }, "invoice.get", {
        id: "INV-1008",
      }),
    );
    expect(records).toMatchObject([
      { correlation: { request_id: "ap-desk-7", principal_id: "user_123" } },
    ]);
  });

  it("DSOR-EXE-02: a record's time is the time of the call", async () => {
    const start = new Date().toISOString();
    const { records } = await recorded((l) => call(registry, l, AGENT, "invoice.get", { id: "X" }));
    const end = new Date().toISOString();
    const { at } = records[0] as { at: string };
    expect(new Date(at).toISOString()).toBe(at);
    expect(at >= start && at <= end).toBe(true);
  });
});

// Found by the review: a log that worked out the time once, when it was created, passed.
describe("C1: each record has the time it was written", () => {
  it("DSOR-EXE-02: two calls five seconds apart get two different times", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T09:00:00.000Z"));
      const fresh = createLog();
      vi.setSystemTime(new Date("2026-09-27T09:00:01.000Z"));
      await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
      vi.setSystemTime(new Date("2026-09-27T09:00:06.000Z"));
      await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
      expect((await fresh.records()).map((r) => r.at)).toStrictEqual([
        "2026-09-27T09:00:01.000Z",
        "2026-09-27T09:00:06.000Z",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("C2: a failure between the decision and the answer still leaves a record", () => {
  // Line ⑤ says yes. Then the operation's code throws at line ⑨, before the answer is ready.
  it("DSOR-EXE-02: the code throws after line ⑤ said yes, and the call is still recorded", async () => {
    const broken = registryWith(() => {
      throw new Error("boom: the connection to 10.0.0.7 was reset");
    });
    const { answer, records } = await recorded((l) =>
      call(broken, l, AGENT, "test.run", { id: "INV-1008" }),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(records).toStrictEqual([
      recordOf(1, {
        operation: "test.run@1",
        authorization: "ALLOW",
        result: "INTERNAL_ERROR",
        reason: UNEXPECTED,
        correlation: correlationFor(THE_AGENT),
      }),
    ]);
    // The bug's own message names internal details. It reaches neither the caller nor the log.
    expect(JSON.stringify(records)).not.toContain("10.0.0.7");
  });

  // Here the failure comes before the code: something throws while line ⑥ starts.
  it("DSOR-EXE-02: a failure after line ⑤, before the code runs, is recorded as DENY", async () => {
    const { answer, records } = await recorded((l) =>
      call(registry, l, AGENT, "invoice.get", { id: "INV-1008" }, (line) => {
        if (line === 6) throw new Error("the checker crashed");
      }),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(records).toMatchObject([
      { operation: "invoice.get@1", authorization: "DENY", result: "INTERNAL_ERROR" },
    ]);
  });

  // Found by the review: the observer hears 9 before the code runs. A throw there means
  // the code never ran, so the record says DENY.
  it("DSOR-EXE-02: a failure at line ⑨, before the code runs, is recorded as DENY", async () => {
    const { records } = await recorded((l) =>
      call(registry, l, AGENT, "invoice.get", { id: "INV-1008" }, (line) => {
        if (line === 9) throw new Error("crashed before the code");
      }),
    );
    expect(records).toMatchObject([{ authorization: "DENY", result: "INTERNAL_ERROR" }]);
  });

  // Found by the review: a thrown value that throws again when DSoR asks what it is. It
  // made the catch itself throw, so call threw and line ⑪ never ran (step 08's README,
  // Think it through). The bug was step 04's, and is fixed in toEnvelope from step 04 on.
  it("DSOR-EXE-02: a throw that throws again when inspected is still answered and recorded", async () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("secret /var/dsor/keys");
        },
      },
    );
    const request = {
      get token(): string {
        throw hostile;
      },
    };
    const { answer, records } = await recorded((l) =>
      call(registry, l, request, "invoice.get", { id: "INV-1008" }),
    );
    expect(answer).toStrictEqual({
      code: "INTERNAL_ERROR",
      message: UNEXPECTED,
      retry: "never",
      correlation: correlationFor(NOBODY),
    });
    expect(records).toMatchObject([
      { operation: "invoice.get@1", authorization: "DENY", result: "INTERNAL_ERROR" },
    ]);
    expect(JSON.stringify(records)).not.toContain("secret");
  });

  // A refusal whose code is not in the §28 table fails the schema, and the caller hears
  // INTERNAL_ERROR instead. The record says what the caller heard.
  it("DSOR-EXE-02: the record says what the caller heard, not what the code threw", async () => {
    const odd = registryWith(() => {
      throw new Refusal("NOT_A_CODE" as ErrorCode, "refused on purpose");
    });
    const { answer, records } = await recorded((l) =>
      call(odd, l, AGENT, "test.run", { id: "INV-1008" }),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    expect(records).toMatchObject([{ result: "INTERNAL_ERROR", reason: UNEXPECTED }]);
  });
});

describe("C4: if the log cannot take the record, the answer is EVIDENCE_STORE_UNAVAILABLE", () => {
  it("DSOR-EXE-03b: a call that would succeed is refused, and the invoice never returned", async () => {
    expect(await call(registry, brokenLog, AGENT, "invoice.get", { id: "INV-1008" })).toStrictEqual(
      {
        code: "EVIDENCE_STORE_UNAVAILABLE",
        message: NOT_RECORDED,
        retry: "safe_same_key",
        correlation: correlationFor(THE_AGENT),
      },
    );
  });

  it("DSOR-EXE-03b: a call that would be refused hears the same", async () => {
    expect(await call(registry, brokenLog, {}, "invoice.get", { id: "INV-1008" })).toStrictEqual({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message: NOT_RECORDED,
      retry: "safe_same_key",
      correlation: correlationFor(NOBODY),
    });
  });

  it("DSOR-EXE-03b: the refusal keeps the caller's own request id and names the caller", async () => {
    const request = { ...SUPERVISOR, request_id: "ap-desk-7" };
    expect(
      await call(registry, brokenLog, request, "invoice.get", { id: "INV-1008" }),
    ).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      correlation: { request_id: "ap-desk-7", principal_id: "user_123" },
    });
  });

  it("DSOR-EXE-03b: a log that throws something that is not an Error is refused the same", async () => {
    const strange: DecisionLog = {
      add: async () => {
        throw "full";
      },
      records: async () => [],
    };
    expect(await call(registry, strange, AGENT, "invoice.get", { id: "INV-1008" })).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
    });
  });

  // Found by the review: a bug while building the record was covered by a comment only.
  // Here the contract's version cannot be turned into text.
  it("DSOR-EXE-03b: a bug while building the record is refused the same", async () => {
    const badVersion = {
      ...registry.contracts.get("invoice.get")!,
      version: {
        toString: (): string => {
          throw new Error("no version");
        },
      },
    };
    const handMade: Registry = {
      ...registry,
      contracts: new Map([...registry.contracts, ["invoice.get", badVersion]]),
    };
    const fresh = createLog();
    expect(await call(handMade, fresh, AGENT, "invoice.get", { id: "INV-1008" })).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
    });
    expect(await fresh.records()).toStrictEqual([]);
  });

  // Found by the review: with a broken log, line ⑪ still runs, and the observer hears it.
  it("a call through a broken log still reaches line ⑪", async () => {
    const lines: number[] = [];
    await call(registry, brokenLog, AGENT, "invoice.get", { id: "INV-1008" }, (n) => lines.push(n));
    expect(lines).toStrictEqual([1, 5, 6, 9, 11]);
  });

  it("the refusal passes the error envelope's schema", async () => {
    const answer = await call(registry, brokenLog, AGENT, "invoice.get", { id: "INV-1008" });
    expect(schemaProblems(answer)).toStrictEqual([]);
  });
});

// No rule id: that the log only grows is this tutorial's decision (step 08's README, C5).
// DSOR-AUD-04a, which says the program may never change a record, arrives with step 09.
describe("C5: the log only grows", () => {
  it("a new log is empty", async () => {
    expect(await createLog().records()).toStrictEqual([]);
  });

  it("two calls give two records, numbered 1 and 2, in the order of the calls", async () => {
    const fresh = createLog();
    const first = await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
    const second = await call(registry, fresh, AGENT, "invoice.get", { id: "INV-9999" });
    expect(await fresh.records()).toMatchObject([
      { sequence: 1, result: "ok", correlation: first.correlation },
      { sequence: 2, result: "RESOURCE_NOT_FOUND", correlation: second.correlation },
    ]);
  });

  it("every record has an id of its own", async () => {
    const fresh = createLog();
    await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
    await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
    const [a, b] = await fresh.records();
    expect(a!.record_id).toMatch(RECORD_ID);
    expect(b!.record_id).not.toBe(a!.record_id);
  });

  // Found by the review: the test matched the request id to /^req_[0-9a-f]/, and
  // "req_forged" matches that too. Now it compares the exact id.
  it("changing a record read from the log does not change the log", async () => {
    const fresh = createLog();
    const { correlation } = await call(registry, fresh, {}, "invoice.get", { id: "INV-1008" });
    const read = await fresh.records();
    read[0]!.result = "ok";
    read[0]!.correlation.request_id = "req_forged";
    read.pop();
    expect(await fresh.records()).toMatchObject([
      { result: "AUTHENTICATION_REQUIRED", correlation: { request_id: correlation.request_id } },
    ]);
  });

  it("changing an answer after the call does not change its record", async () => {
    const fresh = createLog();
    const answer = await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
    const sent = answer.correlation.request_id;
    answer.correlation.request_id = "req_forged";
    expect((await fresh.records())[0]!.correlation.request_id).toBe(sent);
  });

  it("changing a decision after it was added does not change the log", async () => {
    const fresh = createLog();
    const decision: Decision = {
      kind: "decision",
      authorization: "DENY",
      result: "AUTHORIZATION_DENIED",
      correlation: { request_id: "req_1" },
    };
    await fresh.add(decision);
    decision.authorization = "ALLOW";
    expect((await fresh.records())[0]!.authorization).toBe("DENY");
  });

  // Found by the review: anyone holding the log could replace add with a function that
  // writes nothing, and every call would still answer.
  it("the log's two functions cannot be replaced", async () => {
    const fresh = createLog();
    expect(() => {
      (fresh as { add: unknown }).add = () => {};
    }).toThrow(TypeError);
    await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008" });
    expect(await fresh.records()).toHaveLength(1);
  });

  it("the log has two functions, and no way to change or remove a record", async () => {
    expect(Object.keys(createLog()).sort()).toStrictEqual(["add", "records"]);
  });
});
