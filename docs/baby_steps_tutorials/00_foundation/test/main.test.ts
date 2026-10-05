import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Why this file exists.
//
// `src/greet.ts` is covered, because `test/greet.test.ts` imports it. `src/main.ts` is
// the program the README tells you to run, and whose printed line the README quotes as
// proof that your tools work. Code that no test runs is code that can break silently:
// change the greeting inside the program and every test would still pass, while
// `pnpm start` printed something the README does not promise.
//
// Why a separate process, and not an import. `src/main.ts` does its work at the top
// level: it prints as soon as it loads. Importing it from a test would run it at import
// time and leave nothing to call, and the printed line would go to the test runner's
// own output instead of somewhere we can read it. So this test starts the real program
// the way you do, as a child process, and reads what it printed.

// fileURLToPath, not `new URL(...).pathname`: pathname percent-encodes a space and keeps
// a leading slash in front of a Windows drive letter, so it is not always a path the
// operating system accepts. fileURLToPath is the conversion that is right everywhere,
// which matters because a learner may have unzipped this step into any folder.
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

// process.execPath is the Node that is running this test. Using it instead of the word
// "node" means the test does not depend on what `node` happens to point at in PATH.
const NODE = process.execPath;

describe("the demo program", () => {
  // No rule id in these titles. Step 00 implements no requirement of the specification,
  // as the README's last section says. An id here would be a coverage number for a rule
  // this step never claimed.

  it("prints the greeting the README promises, and nothing else", () => {
    // Only stdout comes back from execFileSync, and it throws if the program exits with
    // an error, so a crash fails this test instead of passing quietly.
    const out = execFileSync(NODE, [MAIN], { encoding: "utf8" });

    // Compared whole and raw, with nothing normalised away. Nothing in this output
    // differs between runs: there is no clock in it, no random value, and no file path.
    // The newline at the end is the one console.log adds after the line.
    expect(out).toBe("Hello, accounts-payable-fte.\n");
  });

  it("exits successfully, so `pnpm start` finishes instead of crashing", () => {
    // spawnSync hands back the exit code rather than throwing on it, which is what lets
    // this test state the promise plainly: the program ends with 0, meaning "no error".
    const run = spawnSync(NODE, [MAIN], { encoding: "utf8" });

    expect(run.status).toBe(0);
  });
});
