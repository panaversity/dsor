// NEW IN STEP 07: the order of the checks, as something a test can read.
//
// Nothing here calls an operation. The whole point of this step is that the order stopped being
// the order some lines happened to sit in, and became a list — so these tests are about the list.

import { describe, expect, it } from "vitest";
import { assertPipeline, stagesFor, type Context, type Stage } from "../src/pipeline.ts";
// The machinery lives in pipeline.ts; the actual list lives in operations.ts, because the stages
// need the registry and the handlers and those belong to the operations.
import { PIPELINE, STAGES_CHECKED } from "../src/operations.ts";

/** A stage that does nothing, for tests about the list rather than about the work. */
function fake(at: number | null, name: string, applies: Stage["applies"] = "both"): Stage {
  return Object.freeze({
    at,
    name,
    applies,
    run: (context: Context) => ({ kind: "carry_on" as const, context }),
  });
}

describe("the pipeline", () => {
  // The order, written out. If a later step inserts a stage in the wrong place, this is what says
  // so — which is the whole reason the order is a list and not the shape of a function.
  it("DSOR-EXE-01a: the stages run in this order", () => {
    expect(PIPELINE.map((s) => s.name)).toEqual([
      "authenticate",
      "resolve the operation",
      "authorize",
      "validate the input",
    ]);
  });

  // §21 numbers its seventeen steps. This step has four, and the gaps in the numbering are the
  // roadmap: 1 to 5 is missing the tenant, the delegation and the operational status; after 6 come
  // the idempotency claim, the proposal, the preconditions and the controls.
  it("DSOR-EXE-01a: each stage carries its §21 number, and they only ever go up", () => {
    expect(PIPELINE.map((s) => s.at)).toEqual([1, null, 5, 6]);

    const numbered = PIPELINE.map((s) => s.at).filter((at): at is number => at !== null);

    expect([...numbered].sort((a, b) => a - b)).toEqual(numbered);
  });

  it("DSOR-EXE-01a: no stage appears twice", () => {
    expect(new Set(PIPELINE.map((s) => s.name)).size).toBe(PIPELINE.length);
  });

  // A query runs the stages that apply to it. Today every stage applies to both, so this asserts
  // the mechanism on a list of its own rather than pretending the real list exercises it — the
  // first command-only stage is the idempotency claim, in step 20.
  it("DSOR-EXE-01b: a query runs the stages that apply to it, and no others", () => {
    const list = [
      fake(1, "authenticate"),
      fake(7, "claim the idempotency key", "command"),
      fake(9, "read the state"),
    ];

    expect(stagesFor("query", list).map((s) => s.name)).toEqual(["authenticate", "read the state"]);
    expect(stagesFor("command", list).map((s) => s.name)).toEqual([
      "authenticate",
      "claim the idempotency key",
      "read the state",
    ]);
  });

  it("DSOR-EXE-01b: every stage in the real list applies to both kinds, for now", () => {
    expect(stagesFor("query", PIPELINE)).toEqual(PIPELINE);
    expect(stagesFor("command", PIPELINE)).toEqual(PIPELINE);
  });

  // A bad list is refused when the program loads, the way a bad contract is in step 03 and a bad
  // role table is in step 06. A pipeline is the one thing in this program whose *order* is the
  // guarantee, so a list that cannot be trusted is not something to discover on a request.
  it("DSOR-EXE-01a: a list whose numbers go backwards stops the program", () => {
    expect(() => assertPipeline([fake(5, "authorize"), fake(1, "authenticate")])).toThrow(
      /out of order/,
    );
  });

  it("DSOR-EXE-01a: a list with the same stage twice stops the program", () => {
    expect(() => assertPipeline([fake(1, "authenticate"), fake(5, "authenticate")])).toThrow(
      /twice/,
    );
  });

  // Each of the four is named, and dropping any one of them is refused by name. A count would
  // have caught a short list; the names catch the *wrong* list.
  it("DSOR-EXE-01b: a list missing any stage the program needs stops it, by name", () => {
    const whole = [
      fake(1, "authenticate"),
      fake(null, "resolve the operation"),
      fake(5, "authorize"),
      fake(6, "validate the input"),
    ];

    // The whole list is fine, so the cases below fail for the reason claimed.
    expect(assertPipeline(whole)).toBe(4);

    for (const missing of whole) {
      const short = whole.filter((s) => s !== missing);

      expect(() => assertPipeline(short), missing.name).toThrow(missing.name);
    }
  });

  it("DSOR-EXE-01a: an empty list stops the program", () => {
    expect(() => assertPipeline([])).toThrow();
  });

  // The count, not `true`. Lesson 12: a boolean beside a start-up check can be left behind when
  // the check is deleted, and every test stays green.
  it("DSOR-EXE-01a: the list was checked when the program loaded, all of it", () => {
    expect(STAGES_CHECKED).toBe(PIPELINE.length);
    expect(STAGES_CHECKED).toBeGreaterThan(0);
  });

  it("the list cannot be edited after it is handed out", () => {
    expect(Object.isFrozen(PIPELINE)).toBe(true);

    for (const stage of PIPELINE) {
      expect(Object.isFrozen(stage), stage.name).toBe(true);
      expect(() => {
        (stage as { name: string }).name = "something else";
      }, stage.name).toThrow(TypeError);
    }

    expect(() => (PIPELINE as Stage[]).push(fake(99, "sneak in"))).toThrow(TypeError);
  });
});
