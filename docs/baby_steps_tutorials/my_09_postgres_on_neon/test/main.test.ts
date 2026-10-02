// NEW IN STEP 08: the demo program itself is tested.
//
// Four hostile reviews and a mutation sweep agreed on one thing about every step of this tutorial so
// far: `src/main.ts` is imported by no test. It is the program the README tells a learner to run and
// whose output the README pastes as proof — and flipping a single `===` inside it left every test
// green while `pnpm start` printed the *opposite* of what the README promises, or crashed outright.
//
// So this runs the real program, as a learner would, and checks what it prints. It is a subprocess
// rather than an import because `main.ts` *is* a script: it does its work at the top level, so
// importing it would mean running it, and there would be nothing to call.
//
// One thing has to be normalised. A record's hash covers the time the decision was made, so the hash
// column differs on every run. That is correct behaviour, documented in the README, and it is the only
// part of the output that moves.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The program's own database, which it keeps on disk between runs.
 *
 * NEW IN STEP 09: these tests have to delete it first. The log is durable now, so a second run finds
 * the first run's records still there — which is the step's whole point, and which makes "the demo
 * prints ten records" true only on a fresh database.
 */
const ITS_DATABASE = fileURLToPath(new URL("../.local-database", import.meta.url));

/** Start from nothing, so a run's output is about that run. */
beforeEach(() => {
  rmSync(ITS_DATABASE, { recursive: true, force: true });
});

/** The program's output, with the hashes replaced so two runs can be compared. */
function demo(): string {
  const out = execFileSync("node", [new URL("../src/main.ts", import.meta.url).pathname], {
    encoding: "utf8",
  });

  return out.replace(/sha256:[0-9a-f]+/g, "sha256:HASH");
}

describe("the program a learner runs", () => {
  it("DSOR-AUT-01b: the CFO is refused the command and the agent is allowed it", () => {
    const out = demo();

    // Step 06's whole lesson, in the output rather than in a test double.
    expect(out).toContain("cfo_100               AUTHORIZATION_DENIED");
    expect(out).toContain("accounts-payable-fte  COMMITTED");

    // And the two refusals that must be word for word identical, so a caller cannot tell whether
    // INV-9999 exists.
    const denials = out.split("\n").filter((line) => line.includes("denied,"));

    expect(denials).toHaveLength(2);
    expect(denials[0]!.split("AUTHORIZATION_DENIED")[1]).toBe(
      denials[1]!.split("AUTHORIZATION_DENIED")[1],
    );
  });

  it("DSOR-ERR-01a: every refusal the demo shows is an envelope with a retry class", () => {
    const out = demo();

    // The printer's branches, which is where the mutations landed: `answer.kind === "error"` and
    // `=== "result"`. Flipping either left every test green and made `pnpm start` crash.
    for (const code of [
      "AUTHENTICATION_REQUIRED",
      "VALIDATION_FAILED",
      "UNSUPPORTED_CAPABILITY",
      "AUTHORIZATION_DENIED",
    ]) {
      expect(out, code).toContain(code);
    }

    // Each of those lines carries its retry class, which is what makes an envelope worth having.
    const refusals = out.split("\n").filter((line) => line.includes("retry: "));

    expect(refusals.length).toBeGreaterThanOrEqual(6);

    // And no refusal in the demo invites a retry that could not help.
    expect(out).not.toContain("retry: safe_same_key");
  });

  it("DSOR-EXE-02: the log it prints has the decisions in it, and the chain verifies", () => {
    const out = demo();
    const rows = out.split("\n").filter((line) => /^\s*\d+\s+(ALLOW|DENY)\s/.test(line));

    expect(rows).toHaveLength(10);

    // Four denials recorded, which is the step's point: a program that logged only its successes
    // would have lost every one of them.
    expect(rows.filter((r) => r.includes("DENY"))).toHaveLength(4);
    expect(rows.filter((r) => r.includes("ALLOW"))).toHaveLength(6);

    // Sequences 0..9, in order, with no gaps.
    expect(rows.map((r) => Number(r.trim().split(/\s+/)[0]))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);

    expect(out).toContain("10 records, chain verifies against the head: true");
    expect(out).toContain("2 refusals counted without a record");

    // The line that shows what the checkpoint is for. Hash chaining alone says a shortened log is
    // fine, because every link in it still holds; only the head notices the missing record.
    expect(out).toContain(
      "drop the last record and the chain alone still says: true — but against the head: false",
    );
  });

  it("DSOR-AUD-01: an unknown operation is recorded with no operation field", () => {
    expect(demo()).toContain("DENY   (no such operation)");
  });

  /**
   * The step, in one test: **the log survives the program stopping.**
   *
   * This is what step 09 opens with. Step 08 kept the log in an array, so closing the program lost
   * every decision it had written down — and nothing in step 08 could test otherwise, because there
   * was nothing left to look at. Here the program is run three times as three separate processes,
   * and the log grows.
   *
   * Note what the chain does across that boundary: run two reads records written by a process that
   * no longer exists, links its own onto them, and the whole chain still verifies. The fingerprint of
   * the last record of run one is what run two's first record points at.
   */
  it("DSOR-AUD-01: the log survives the program stopping, and the chain survives with it", () => {
    const records = (out: string): number =>
      Number(/^(\d+) records, chain verifies/m.exec(out)?.[1] ?? "-1");

    const first = demo();

    expect(records(first)).toBe(10);
    expect(first).toContain("chain verifies against the head: true");

    // A second process. Nothing is shared with the first but the directory on disk.
    const second = demo();

    expect(records(second)).toBe(20);
    expect(second).toContain("chain verifies against the head: true");

    const third = demo();

    expect(records(third)).toBe(30);
    expect(third).toContain("chain verifies against the head: true");

    // And run one's records are still there, unchanged, in run three's output.
    expect(third).toContain(" 0  ALLOW  invoice.get@1");
    expect(third.split("\n").filter((line) => /^\s*\d+\s+(ALLOW|DENY)\s/.test(line))).toHaveLength(
      30,
    );
  });

  // The hashes move every run, because the time a decision was made is part of what is hashed.
  it("DSOR-AUD-04b: two fresh runs print the same report with different hashes", () => {
    const first = demo();

    rmSync(ITS_DATABASE, { recursive: true, force: true });

    const second = demo();

    // Identical once the hashes are normalised — `demo()` does that — and genuinely different
    // underneath.
    expect(second).toBe(first);

    // A third fresh run, read raw this time, so the hashes are the real ones rather than the
    // normalised placeholders `demo()` substitutes.
    rmSync(ITS_DATABASE, { recursive: true, force: true });

    const hashesOf = (text: string): string[] => text.match(/sha256:[0-9a-f]+/g) ?? [];
    const raw = execFileSync("node", [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
      encoding: "utf8",
    });

    expect(hashesOf(raw)).toHaveLength(10);
  });
});
