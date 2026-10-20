// NEW IN STEP 41: a payment run, many drafts proposed as one list. Each line keeps its own checks
// and its own record; the day's limit is booked once, for the run's total; the CFO approves the
// list once, with its fingerprint and its totals; and the run drafts every line, or none
// (DSOR-BAT-01a, DSOR-BAT-01b, DSOR-BAT-02a, DSOR-BAT-02b; step 41's README, claims C1 to C8).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { runProblems } from "../src/run.ts";
import { AGENT, contract, keyed, without } from "./helpers.ts";
import { ruleWorld } from "./rule-world.ts";

/** A run's input: one line for each of these bills of org_456, each decided on version 1. */
function lines(...ids: string[]): { lines: { invoice: string; expected_version: number }[] } {
  return {
    lines: ids.map((id) => ({ invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 })),
  };
}

/** The code of a refusal, or the outcome of anything else. */
function saidOf(answer: Answer): string {
  return "code" in answer ? answer.code : String((answer as { outcome?: unknown }).outcome);
}

describe("C1: a run declares how it ends and how long it may be", () => {
  it("DSOR-BAT-01a: C1: payment.run's contract declares all_or_nothing and at most 50 lines", () => {
    expect(contract("payment.run")["batch"]).toStrictEqual({
      atomicity: "all_or_nothing",
      max_items: 50,
    });
  });

  it("DSOR-BAT-01a: C1: start-up refuses a run that declares no batch, and a batch that names no line", () => {
    const run = contract("payment.run");
    expect(runProblems([without(run, "batch")])).toStrictEqual([
      "payment.run: its lines are payment.create, and it declares no batch: its atomicity and its most lines (DSOR-BAT-01a)",
    ]);
    const unnamed = { ...run, extensions: {} };
    expect(runProblems([unnamed])).toStrictEqual([
      "payment.run: it declares a batch, and names no operation for its lines (DSOR-BAT-01a)",
    ]);
    expect(runProblems([run])).toStrictEqual([]);
  });

  it("DSOR-BAT-01a: C1: start-up refuses per_item, which this step does not build", () => {
    const run = contract("payment.run");
    const partial = { ...run, batch: { atomicity: "per_item", max_items: 50 } };
    expect(runProblems([partial])).toStrictEqual([
      'payment.run: the atomicity "per_item" is not built yet (DSOR-BAT-01a)',
    ]);
  });

  it("DSOR-BAT-01a: C1: a run of 51 lines is refused before any bill is read, and no proposal is made", async () => {
    const w = ruleWorld();
    const ids = Array.from({ length: 51 }, (_, i) => `INV-${5001 + i}`);
    const answer = await w.ask(keyed(AGENT), "payment.run", lines(...ids));
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"payment.run" takes at most 50 lines, and this run has 51',
    });
    expect(await w.proposals.all()).toStrictEqual([]);
  });

  it("DSOR-BAT-01a: C1: a run of 50 lines is not refused for its length", async () => {
    const w = ruleWorld();
    const ids = Array.from({ length: 50 }, (_, i) => `INV-${5001 + i}`);
    const answer = await w.ask(keyed(AGENT), "payment.run", lines(...ids));
    expect(saidOf(answer)).not.toBe("VALIDATION_FAILED");
  });

  it("step 41's decision D6: C1: a run that names one bill twice is refused, and no proposal is made", async () => {
    const w = ruleWorld();
    const answer = await w.ask(
      keyed(AGENT),
      "payment.run",
      lines("INV-1002", "INV-1009", "INV-1002"),
    );
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"payment.run" names one invoice on two lines: lines 1 and 3',
    });
    expect(await w.proposals.all()).toStrictEqual([]);
  });
});
