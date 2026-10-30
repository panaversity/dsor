// The tests for the program a learner actually runs: `pnpm start`.
//
// Without this file, `src/main.ts` is the only code in the step that nothing checks.
// That is the file the README tells you to run, and whose three lines the README pastes
// as proof the step works. So a single flipped `===` inside it could leave every other
// test green while `pnpm start` printed the opposite of what the README promises.
//
// Why a subprocess, and not an import: `src/main.ts` does its work at the top level and
// exports nothing. Importing it would run it as a side effect of the import, and there
// would be no function left to call and nothing handed back to look at. Running it the
// way a learner runs it is also the only way to test the thing being claimed — that
// `pnpm start` prints these lines.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Where src/main.ts is, worked out from where this test file is, so the test passes no
// matter which folder you run it from.
//
// fileURLToPath, and not `new URL(…).pathname`: on Windows the pathname of a file URL
// keeps a slash in front of the drive letter ("/C:/Users/…"), which is not a path Node
// can open. fileURLToPath is the conversion that is correct on every platform.
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

// The Node that is running this test, rather than the word "node". Looking up "node" in
// PATH can find a different version from the one running vitest, or nothing at all.
const NODE = process.execPath;

/**
 * Runs `node src/main.ts` and returns what it printed, one string per line.
 *
 * execFileSync throws if the program exits with a non-zero code, so a test that gets a
 * list of lines back has already proved the program ran to the end without crashing.
 *
 * There is exactly one piece of normalisation here, and it is not about runs differing.
 * Every line of this program's output is fixed text read from the frozen array in
 * src/invoice.ts: nothing in it comes from the clock, the environment, the filesystem,
 * or a random number, so two runs cannot print different bytes. The one adjustment is
 * that console.log ends each line with a newline, so splitting on "\n" leaves an empty
 * string after the last one. That empty string is the final newline, not a fourth line.
 */
function runProgram(): string[] {
  const lines = execFileSync(NODE, [MAIN], { encoding: "utf8" }).split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

describe("pnpm start", () => {
  // No rule id: no requirement says a program must greet anybody. This line is step
  // 00's "does this project run at all" check, and it is in the output, so it is
  // tested.
  it("still opens by greeting the agent", () => {
    expect(runProgram()[0]).toBe("Hello, accounts-payable-fte.");
  });

  // NEW IN STEP 01: the invoice line is this step's lesson, printed.
  //
  // The amount reaches the screen as its two parts, "31400.00" and "USD". That is
  // DSOR-MON-01 at the only place a human ever sees it. A `31400` here, or an amount
  // with the currency dropped, is the rule broken in the output even if every unit test
  // on money() still passes.
  it("DSOR-MON-01: prints the amount as a decimal string and a currency code", () => {
    const line = runProgram()[1];

    expect(line).toBe("INV-1008: 31400.00 USD to VENDOR-44 (issued)");

    // Said again in parts, so a failure names which half went wrong. "31400.00 USD"
    // and not "31400 USD": the trailing zeros are text the program must not lose.
    expect(line).toContain("31400.00 USD");
    expect(line).not.toContain("31400 ");
  });

  // No rule id: a missing record returning `undefined` rather than throwing is this
  // step's choice, not a requirement. Error shapes a caller can see become rules in
  // step 04.
  //
  // The README calls this line out as mattering as much as the one above it, so it is
  // pinned. Flip the `===` in src/main.ts to `!==` and this test is what notices.
  it("reports a missing invoice as not found, and does not crash", () => {
    expect(runProgram()[2]).toBe("INV-9999: not found.");
  });

  // No rule id. Three lines, in this order, and nothing after them. Without this, a
  // fourth line of leftover debugging — or a line printed twice — would go unseen,
  // because each test above looks only at the line it was given.
  it("prints exactly the three lines the README shows, in order", () => {
    expect(runProgram()).toEqual([
      "Hello, accounts-payable-fte.",
      "INV-1008: 31400.00 USD to VENDOR-44 (issued)",
      "INV-9999: not found.",
    ]);
  });
});
