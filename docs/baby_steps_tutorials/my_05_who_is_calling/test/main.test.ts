// The demo program itself, tested.
//
// Every other test file in this step calls a function. This one runs the whole program the
// README tells you to run — `pnpm start` — and checks what it prints.
//
// Why it needs testing at all: the README pastes that program's output as proof that the step
// works. Until this file existed, no test imported src/main.ts, so one flipped `===` inside it
// could print the opposite of what the README promises with every test still green. A promise
// nothing checks is a promise that quietly stops being true.
//
// Why a *subprocess* — a second copy of Node, started by this test. src/main.ts does its work
// at the top level: it has no exported function to call, and importing it would run the whole
// program while this file was being loaded. So the test starts Node on the file and reads what
// it wrote, exactly as a reader at a terminal does.
//
// Nothing in that output differs between runs. The program prints no clock time, no request id
// and no proposal id — the four things that vary in this step all stay inside the envelopes,
// and `show()` in src/main.ts never prints them. So the test compares the output whole. The
// only thing it drops is the newline at the very end, which the last `console.log` adds.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// fileURLToPath, not `new URL(...).pathname`. On Windows `pathname` keeps a slash in front of
// the drive letter ("/C:/..."), and on any machine it writes a space in a folder name as
// "%20". Either one hands Node a path that does not exist.
const PROGRAM = fileURLToPath(new URL("../src/main.ts", import.meta.url));

// Exactly what the README's "Run it" block promises, line for line, blank lines included.
// If this list and the README ever disagree, one of the two is lying to the reader.
const EXPECTED: readonly string[] = [
  "Hello, accounts-payable-fte.",
  "",
  "user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued",
  "accounts-payable-fte  (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued",
  "",
  "user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued",
  "",
  "accounts-payable-fte  COMMITTED                dsor://org_456/invoice/INV-1009  issued",
  "",
  "not logged in           (nobody)              AUTHENTICATION_REQUIRED  retry: never                nobody is logged in",
  'nobody by that name     (nobody)              AUTHENTICATION_REQUIRED  retry: never                "nobody" is not someone this program knows',
  'logged in, bad address  user_123              VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"',
  "logged in, no contract  user_123              UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it",
];

// The names of everybody in the people list, so a test can say "and nobody else was named".
const REAL_PEOPLE: readonly string[] = ["user_123", "cfo_100", "accounts-payable-fte"];

// Run once, not once per test. Starting Node costs about a tenth of a second, and the output
// cannot change between two runs of the same program.
let printed: string | undefined;

/** Everything `pnpm start` printed, as one string. */
function output(): string {
  if (printed === undefined) {
    try {
      printed = execFileSync(process.execPath, [PROGRAM], {
        encoding: "utf8",
        // process.execPath is the Node already running these tests, so the program runs on the
        // same version rather than on whatever "node" happens to mean on this machine.
        //
        // stderr is captured rather than passed through, so a crash arrives in the failure
        // message below instead of scrolling past in the middle of the test output.
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };

      throw new Error(
        `src/main.ts exited with ${failure.status}, so pnpm start is broken:\n${
          failure.stderr ?? "(nothing on stderr)"
        }`,
      );
    }
  }

  return printed;
}

/** The printed lines, without the newline the last `console.log` leaves behind. */
function lines(): readonly string[] {
  return output().replace(/\n$/, "").split("\n");
}

/** One printed line, counted from one, the way the README counts them. */
function line(n: number): string {
  const found = lines()[n - 1];

  if (found === undefined) {
    throw new Error(`the program printed ${lines().length} lines, so there is no line ${n}`);
  }

  return found;
}

/** A line without its leading "who asked" column, which `show()` pads to 21 characters. */
function withoutTheName(text: string): string {
  return text.slice(21);
}

describe("pnpm start", () => {
  // No rule id. "The program prints what the README says it prints" is a promise this tutorial
  // makes to its reader, not a requirement in the specification.
  it("prints exactly what the README shows", () => {
    expect(lines()).toEqual(EXPECTED);
  });

  // The line the README calls out as the step's whole point: the third read is the same read
  // again, and its arguments carried `principal: "cfo_100"`. The answer still says user_123,
  // so the claim was read and thrown away.
  it("DSOR-SRC-02a: the printed answer ignores a principal planted in the arguments", () => {
    // The claim itself is never printed, so deleting it from the program would leave the
    // output byte for byte the same — a mutation sweep proved that. The demo would stop
    // demonstrating anything and no test would notice. So the program is read as text too,
    // and the claim has to still be in it. The *behaviour* — that it is ignored — is proven
    // against the function in test/who-is-calling.test.ts.
    expect(readFileSync(PROGRAM, "utf8")).toContain('principal: "cfo_100"');

    expect(line(6).startsWith("user_123 ")).toBe(true);

    // Identical to the honest read on line 3, planted argument and all.
    expect(line(6)).toBe(line(3));

    // And cfo_100 — the person who approves large payments — is named nowhere in the output.
    // She is in the people list, so this is not true by accident: nothing named her because
    // nothing believed the arguments.
    expect(output()).not.toContain("cfo_100");
  });

  // Who asked is the login and nothing else. The only difference between these two lines is
  // the name in front: same invoice, same amount, same status.
  //
  // No rule id. Attribution is groundwork for DSOR-COR-01a, which also wants the identifiers
  // carried through connectors, audit and events — none of which exist in this step — so
  // test/who-is-calling.test.ts does not claim it either.
  it("shows the same read by two callers, differing only in who asked", () => {
    expect(line(3).startsWith("user_123 ")).toBe(true);
    expect(line(4).startsWith("accounts-payable-fte ")).toBe(true);
    expect(withoutTheName(line(4))).toBe(withoutTheName(line(3)));
  });

  // The last four lines. Two callers could not be turned into a principal, so they are
  // attributed to nobody and never got a code about their request. Two could, so they are
  // named and their own problem was found. That is what DSOR-IDN-01's "before any other
  // processing" looks like from outside the program.
  it("DSOR-IDN-01: a caller who is not a principal is refused, and named as nobody", () => {
    for (const n of [10, 11]) {
      expect(line(n)).toContain("(nobody)");
      expect(line(n)).toContain("AUTHENTICATION_REQUIRED");
      expect(line(n)).toContain("retry: never");

      // Inventing a name here would put somebody in the record who never asked for anything.
      for (const name of REAL_PEOPLE) {
        expect(line(n), `line ${n} must not name ${name}`).not.toContain(name);
      }
    }

    // Logged in, so the request was looked at and its real problem reported — under the
    // caller's own name.
    expect(line(12)).toContain("user_123");
    expect(line(12)).toContain("VALIDATION_FAILED");
    expect(line(13)).toContain("user_123");
    expect(line(13)).toContain("UNSUPPORTED_CAPABILITY");
  });

  // The one line where something changed. No rule id: the outcome word is printed from the
  // result envelope, and the rule about that envelope — DSOR-SCH-01 — is about it validating
  // against its schema, which printing it does not show.
  it("shows the agent issuing INV-1009, and says the agent asked", () => {
    expect(line(8).startsWith("accounts-payable-fte ")).toBe(true);
    expect(line(8)).toContain("COMMITTED");
    expect(line(8)).toContain("dsor://org_456/invoice/INV-1009");
    expect(line(8)).toContain("issued");
  });
});
