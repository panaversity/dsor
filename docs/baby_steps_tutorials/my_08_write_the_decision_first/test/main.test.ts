// STEP 07 was the first to run the program the README tells a learner to run, as a subprocess, and
// to compare what it printed byte for byte. NEW IN STEP 08: the output now ends with the audit log,
// and one column of it — the hash — covers the time each decision was made, so it differs on every
// run. The byte-for-byte literal had to go. This file checks the lines that cannot move, and
// normalises the one column that can.
//
// Why the file exists has not changed. `src/main.ts` is imported by no other test. It is the program
// whose output the README pastes as proof — and flipping a single `===` inside it leaves every other
// test green while `pnpm start` prints the *opposite* of what the README promises, or crashes
// outright.
//
// It is a subprocess rather than an import because `main.ts` *is* a script: it does its work at the
// top level, so importing it would mean running it, and there would be nothing to call.

import { execFileSync } from "node:child_process";
// fileURLToPath, not `new URL(…).pathname`: on Windows the pathname of a file URL is "/D:/…",
// which Node reads as a relative path under the current drive — "D:\D:\…", and nothing is there.
// Steps 01 to 07 and 09 onwards already say this; this file was the one that did not. Found by
// CI on Windows, 2026-10-07.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The program's output, with the hashes replaced so two runs can be compared. */
function demo(): string {
  const out = execFileSync("node", [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
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

  // The hash column is the only thing that moves between runs, and it moves because the time a
  // decision was made is part of what is hashed. Two runs, same everything else.
  it("DSOR-AUD-04b: every run prints the same report, and different hashes", () => {
    const first = demo();
    const second = demo();

    expect(second).toBe(first);

    const hashes = (text: string): string[] => text.match(/sha256:[0-9a-f]+/g) ?? [];
    const raw = execFileSync("node", [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
      encoding: "utf8",
    });
    const again = execFileSync("node", [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
      encoding: "utf8",
    });

    expect(hashes(raw)).toHaveLength(10);
    expect(hashes(raw)).not.toEqual(hashes(again));
  });
});
