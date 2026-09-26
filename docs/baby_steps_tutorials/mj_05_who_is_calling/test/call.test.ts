// NEW IN STEP 04: what call answers, by claim (C4, C6, C7 in the README).
import { describe, expect, it, vi } from "vitest";
import type { Answer, ErrorEnvelope } from "../src/envelope.ts";
import { handlers } from "../src/operations.ts";
import { buildRegistry, call, type Handler } from "../src/registry.ts";
import {
  REFUSALS,
  REQUEST_ID,
  UNEXPECTED,
  refusedWith,
  registry,
  run,
  shipped,
} from "./helpers.ts";

// A request id with the right form, so code that used any well-formed id it found in the
// input would fail too.
const MINE = "req_00000000-0000-4000-8000-000000000000";

describe("C4: every answer carries a request_id that DSoR made", () => {
  it("DSOR-COR-01b: a success carries a request_id that DSoR made", () => {
    const answer = call(registry, "invoice.get", { id: "INV-1008" });
    expect(answer.correlation.request_id).toMatch(REQUEST_ID);
  });

  // Found by a run: before INV-9999 was refused, it came back as { data: undefined } with
  // a request id, and a test that looked only at the id passed. So the code comes first.
  it("DSOR-COR-01b: a refusal carries a request_id that DSoR made", () => {
    const answer = call(registry, "invoice.get", { id: "INV-9999" });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(answer.correlation.request_id).toMatch(REQUEST_ID);
  });

  // Found by the review: a fixed request id on a refusal, on a bug, or on the envelope
  // sent in place of a broken one passed every test. Only successes were called twice.
  const EVERY_ANSWER: [string, () => Answer][] = [
    ["a success", () => call(registry, "invoice.get", { id: "INV-1008" })],
    ...REFUSALS.map(([why, ask]): [string, () => Answer] => [why, ask]),
    ["an envelope that fails the schema, so INTERNAL_ERROR", () => refusedWith("BATCH_PARTIAL")],
  ];
  it.each(EVERY_ANSWER)("DSOR-COR-01b: %s gets a new request_id on every call", (_why, ask) => {
    const first = ask().correlation.request_id;
    const second = ask().correlation.request_id;
    expect(first).toMatch(REQUEST_ID);
    expect(second).toMatch(REQUEST_ID);
    expect(second).not.toBe(first);
  });

  // No rule id: the rule lets DSoR use a request id that a caller sends. That the input is
  // not the place to send one is this tutorial's decision 4. Found by the review: an id
  // in a correlation object inside the input was used, and every test passed.
  it.each([
    ["at the top of the input", { id: "INV-1008", request_id: MINE }],
    [
      "in a correlation object inside the input",
      { id: "INV-1008", correlation: { request_id: MINE } },
    ],
  ])("a request_id %s is not used", (_where, input) => {
    const answer = call(registry, "invoice.get", input);
    expect(answer.correlation.request_id).toMatch(REQUEST_ID);
    expect(answer.correlation.request_id).not.toBe(MINE);
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

  // A command's success needs a result envelope, and that needs a proposal (step 22). So
  // call refuses a command before its code runs (README, decision 1). Found by the review:
  // a command with code answered in the query's shape.
  it("a command's code never runs, even when the command has code", () => {
    const spy = vi.fn<Handler>(() => "issued");
    const issueHasCode = buildRegistry(shipped, { ...handlers, "invoice.issue": spy });
    expect(call(issueHasCode, "invoice.issue", {})).toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

// No rule id: C7 is the tutorial's own claim. A caller outside the program sends JSON, so
// C7 covers what JSON can carry (README, "Left open").
describe("C7: nothing a caller can send as JSON makes call throw", () => {
  it.each(REFUSALS)("%s comes back as a value, not a throw", (_why, ask) => {
    expect(ask).not.toThrow();
  });

  it.each([
    ["null", null],
    ["a number", 1008],
    ["a text", "INV-1008"],
    ["an id that is a number", { id: 1008 }],
    ["a list", ["INV-1008"]],
  ])("invoice.get with %s as its input is refused with VALIDATION_FAILED", (_why, input) => {
    expect(call(registry, "invoice.get", input)).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "invoice.get needs { id: string }",
      retry: "never",
    });
  });

  // A bug is anything thrown that is not a Refusal. Found by the review: with the
  // instanceof check gone, an Error with a code of its own went out as that code, and a
  // bug that threw undefined made call throw.
  const BUGS: [string, Handler][] = [
    // Our checks threw a TypeError for bad input in step 03. JavaScript throws the same
    // class for this bug, so the class cannot tell them apart (README, decision 5).
    [
      "a TypeError, from reading .id of undefined",
      (input) => (input as { invoice: { id: string } }).invoice.id,
    ],
    [
      "an Error",
      () => {
        throw new Error("ledger connection failed at 10.0.0.12:5432");
      },
    ],
    [
      "an Error with a code of its own",
      () => {
        throw Object.assign(new Error("ledger at 10.0.0.12:5432 said no"), { code: "CONFLICT" });
      },
    ],
    [
      "a text, not an Error",
      () => {
        throw "ledger at 10.0.0.12:5432 did not answer";
      },
    ],
    [
      "undefined",
      () => {
        throw undefined;
      },
    ],
    [
      "null",
      () => {
        throw null;
      },
    ],
  ];
  it.each(BUGS)(
    "a bug that throws %s comes back as INTERNAL_ERROR, with the fixed message",
    (_why, bug) => {
      const envelope = run(bug);
      expect(envelope).toStrictEqual({
        code: "INTERNAL_ERROR",
        message: UNEXPECTED,
        retry: "never",
        correlation: { request_id: expect.stringMatching(REQUEST_ID) },
      });
      expect(JSON.stringify(envelope)).not.toContain("10.0.0.12");
    },
  );
});

// No rule id: this is about the refusal's message, as in steps 01 to 03. Found by the
// review: an id pasted whole into the message passed every test.
describe("a refusal of a huge id", () => {
  it("shows only a short piece of it", () => {
    const huge = "INV-" + "9".repeat(100_000);
    const { message } = call(registry, "invoice.get", { id: huge }) as ErrorEnvelope;
    expect(message).toMatch("no invoice");
    expect(message.length).toBeLessThan(200);
  });
});
