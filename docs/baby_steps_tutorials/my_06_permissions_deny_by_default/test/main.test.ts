// NEW IN STEP 06: the demo program itself, under test.
//
// Why this file exists. `src/main.ts` is the one file the README tells a learner to run, and the
// README pastes its output as proof that the step works. Until this file, no test in any step
// imported or ran it. So flipping a single `===` inside `show` left every test green while
// `pnpm start` printed the opposite of what the README promised — or crashed, which is worse,
// because the first thing a learner does is run it.
//
// Why a subprocess and not an import. `src/main.ts` does all of its work at the top level and
// exports nothing: it prints as it loads. Importing it would run it, and there would be nothing
// left to call. So this runs the real program the way `pnpm start` runs it, and reads what it
// printed.
//
// What is normalised: nothing. Nothing in this output varies between runs. Every name in it
// comes from the story's fixed cast, every amount is stored text, and the one value the program
// generates fresh each run — the request id, counted from 1 — never reaches the output, because
// `show` prints a code, a retry class and a message and not the correlation block. Two runs were
// compared byte for byte before this file was written, and they were identical. A test that
// scrubs output it has not proved varies is a test that hides a real difference.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// fileURLToPath, not `new URL(...).pathname`. A pathname is percent-encoded, so a copy of this
// step in a folder with a space in its name would be handed "/My%20Steps/..." and Node would
// report a file that does not exist. The step has to run wherever a learner unzips it.
const program = fileURLToPath(new URL("../src/main.ts", import.meta.url));

let printedOnce: string | undefined;

/**
 * What the program printed, run once and remembered.
 *
 * Deliberately lazy, and this is not a performance point. Running it at module scope would mean
 * a program that crashes stops this *file* from loading, and vitest would then report fewer
 * tests rather than failing ones — a drop in the total that reads like nothing went wrong.
 * Called from inside a test, a crash is a red test with the program's own stderr in it.
 */
function printed(): string {
  if (printedOnce === undefined) {
    try {
      printedOnce = execFileSync(process.execPath, [program], {
        encoding: "utf8",
        // process.execPath is the Node that is running these tests, so the program is checked
        // on the same version rather than on whatever `node` happens to mean on this PATH.
        //
        // stderr is captured rather than inherited, so a crash is reported by the test that
        // asked for the output instead of appearing loose in the middle of the run.
        stdio: ["ignore", "pipe", "pipe"],
        // execFileSync blocks the thread, so vitest's own per-test timeout cannot fire while it
        // waits. This is the only thing that would end a program that hung.
        timeout: 30_000,
      });
    } catch (error) {
      const failed = error as { status?: number | null; stderr?: string };

      throw new Error(
        `node src/main.ts did not finish (exit ${failed.status}):\n${failed.stderr ?? "(no stderr)"}`,
      );
    }
  }

  return printedOnce;
}

/** The program's output, line by line, with no blank lines removed. */
function lines(): readonly string[] {
  return printed().split("\n");
}

/**
 * The one line that begins with this label, with the label and its padding taken off.
 *
 * The last six lines of the program are labelled — `denied, real invoice` and the rest — and
 * what matters about two of them is that everything *after* the label is the same text.
 */
function after(label: string): string {
  const found = lines().filter((line) => line.startsWith(label));

  if (found.length !== 1) {
    throw new Error(`expected one line starting ${JSON.stringify(label)}, found ${found.length}`);
  }

  return found[0]!.slice(label.length).trimStart();
}

/**
 * The program output the README pastes, read out of README.md itself.
 *
 * The README says "Run it" and then shows what you will see. That block is a claim about this
 * program, so it is read as a fixture rather than copied into this file: a copy would let the
 * two drift, which is the exact failure this file was written to stop.
 */
function readmeOutput(): string {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const fenced = readme.split("```").filter((block) => block.startsWith("text\nHello,"));

  if (fenced.length !== 1) {
    throw new Error(`expected one pasted program output in README.md, found ${fenced.length}`);
  }

  return fenced[0]!.slice("text\n".length);
}

describe("the program a learner runs", () => {
  // No rule id. This proves no sentence of the specification; it proves the README is not
  // lying, which is a different and equally real kind of defect. It is also the broadest net
  // in this file: any change to any printed character turns it red.
  it("prints exactly the output the README pastes", () => {
    expect(printed()).toBe(readmeOutput());
  });

  // No rule id: finishing is not a rule, it is the floor. A program that dies after the
  // greeting still prints a greeting, so the end of the output is what says it ran.
  it("runs from the greeting to the last refusal", () => {
    expect(lines()[0]).toBe("Hello, accounts-payable-fte.");
    expect(lines().at(-1)).toBe("");
    expect(lines().at(-2)).toMatch(/^denied, no such invoice /);
  });

  // The step in three consecutive lines, which is the README's own claim about them: cfo_100
  // reads INV-1009 and is told what it is, she is refused when she asks to issue it, and the
  // agent issues *that same invoice* on the very next line. Nothing about the invoice changed
  // between those lines — only who asked.
  //
  // The indexes are deliberate. "One line later" is part of the claim, so the three lines are
  // found as neighbours rather than searched for separately.
  it("DSOR-AUT-01b: the CFO is refused the invoice the agent issues one line later", () => {
    const read = lines().findIndex(
      (line) => line.startsWith("cfo_100") && line.includes("INV-1009"),
    );

    expect(read).toBeGreaterThan(0);

    // She may read it, and is told the amount and the state.
    expect(lines()[read]).toContain("dsor://org_456/invoice/INV-1009  2500.00 USD  draft");

    // She may not issue it.
    expect(lines()[read + 1]).toContain("cfo_100");
    expect(lines()[read + 1]).toContain("AUTHORIZATION_DENIED");
    expect(lines()[read + 1]).toContain("retry: never");

    // The agent may, and does, to the same invoice.
    expect(lines()[read + 2]).toContain("accounts-payable-fte");
    expect(lines()[read + 2]).toContain("COMMITTED");
    expect(lines()[read + 2]).toContain("dsor://org_456/invoice/INV-1009  issued");
  });

  // The README calls these two lines out as the ones that matter, and they are the reason the
  // may-you gate sits before the arguments are read. One invoice exists, the other does not.
  // Both refusals have to be the same words, or a caller who may not act could count records
  // she has no permission to see by comparing them.
  it("DSOR-AUT-01b: a denied caller cannot tell a real invoice from one that does not exist", () => {
    const real = after("denied, real invoice");
    const absent = after("denied, no such invoice");

    expect(real).toBe(absent);
    expect(real).toContain("AUTHORIZATION_DENIED");

    // And neither one leaks what it was asked about, in either direction.
    for (const refusal of [real, absent]) {
      expect(refusal).not.toContain("INV-1008");
      expect(refusal).not.toContain("INV-9999");
      expect(refusal).not.toContain("RESOURCE_NOT_FOUND");
      // Nor which permission was missing, which would draw the permission model for anyone
      // willing to ask twenty times.
      expect(refusal).not.toContain("invoice:issue");
    }
  });

  // Step 05's rule, visible in the program's own output. The third read plants
  // `principal: "cfo_100"` in the arguments and is otherwise identical to the first, so the two
  // printed lines must be identical too: a program that believed the arguments would file the
  // call under cfo_100 and the two lines would differ.
  it("DSOR-SRC-02a: a principal written into the arguments changes nothing the program prints", () => {
    const reads = lines().filter(
      (line) => line.startsWith("user_123") && line.includes("(no envelope)"),
    );

    expect(reads).toHaveLength(2);
    expect(reads[0]).toBe(reads[1]);

    // And no line anywhere credits a read of INV-1008 to the name that was planted. cfo_100
    // appears in this output twice, so this is not a check that passes for want of a subject.
    for (const line of lines().filter((l) => l.startsWith("cfo_100"))) {
      expect(line, line).not.toContain("INV-1008");
    }
  });

  // With nobody logged in, and with a name nobody has, the program does not reach the data. The
  // refusal is attributed to nobody rather than to a real person: a request stamped with
  // user_123 would put a caller in the record who never asked for anything.
  it("DSOR-IDN-01: an unknown caller is refused before anything is looked at", () => {
    for (const label of ["not logged in", "nobody by that name"]) {
      const refusal = after(label);

      expect(refusal, label).toContain("(nobody)");
      expect(refusal, label).toContain("AUTHENTICATION_REQUIRED");
      expect(refusal, label).not.toContain("INV-1008");
      expect(refusal, label).not.toContain("31400.00");
    }
  });

  // The two refusals that come after the login and before the gate, in the order the step's
  // README draws: an address that is not canonical is VALIDATION_FAILED, and an operation with
  // no contract is UNSUPPORTED_CAPABILITY. Both name the caller, because she was known.
  it("DSOR-ERR-01a: each refusal the program prints carries its own code and retry class", () => {
    expect(after("logged in, bad address")).toContain("user_123");
    expect(after("logged in, bad address")).toContain("VALIDATION_FAILED");
    expect(after("logged in, no contract")).toContain("UNSUPPORTED_CAPABILITY");

    // Every refusal in the output says plainly whether asking again could help.
    for (const line of lines().filter((l) => l.includes("retry:"))) {
      expect(line, line).toContain("retry: never");
    }
  });
});
