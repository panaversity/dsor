// NEW IN STEP 07: the one test that runs the program the README tells a learner to run.
//
// Every other test in this step imports a function and calls it. Nothing imported src/main.ts at
// all -- so `pnpm test` could be green while `pnpm start` printed the opposite of what the README
// promises. Flip one `===` inside `show` and no existing test moves. The README pastes that output
// as proof that this step changed nothing, which makes the output a promise; a promise nobody
// tests is a promise nobody has.
//
// main.ts does its work at the top level, so importing it would *run* it and leave no function to
// call. This runs the real program as a child process and reads what it printed -- which is also
// the only thing a learner at a terminal ever sees.
//
// What this file cannot catch, said plainly. Seventeen edits to src/main.ts were tried one at a
// time; fifteen turned a test red and two did not, and both survivors are unkillable rather than
// missed:
//
//   - printing the literal "never" in place of `e.retry`. Every §28 code the demo can reach has
//     retry class `never`, so the screen is byte-identical.
//   - printing the literal "COMMITTED" in place of `r.outcome`. A ResultEnvelope's `outcome` is
//     typed as that one word, and it is the only outcome this step has. The second one,
//     PENDING_APPROVAL, arrives with proposals in step 22, and that is when these two separate.
//
// An output that genuinely cannot differ is not a gap. Writing the pair down is cheaper than
// rediscovering them, and stops the next reader hunting for a test that cannot exist yet.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CODE_RETRY } from "../src/envelopes.ts";

// fileURLToPath, not `new URL(...).pathname`. On Windows a file URL's pathname is "/C:/..." --
// with a leading slash -- which is not a path Node can spawn. A step has to run on whatever
// machine a learner has.
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/**
 * What `pnpm start` prints, byte for byte, and what the README's "Run it" block shows.
 *
 * This is a literal on purpose. The program's whole output is three lines of code away from being
 * wrong in a way no other test in this step can see.
 */
const EXPECTED = `Hello, accounts-payable-fte.

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

cfo_100               (no envelope)            dsor://org_456/invoice/INV-1009  2500.00 USD  draft
cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
accounts-payable-fte  COMMITTED                dsor://org_456/invoice/INV-1009  issued

not logged in           (nobody)              AUTHENTICATION_REQUIRED  retry: never                nobody is logged in
nobody by that name     (nobody)              AUTHENTICATION_REQUIRED  retry: never                "nobody" is not someone this program knows
logged in, bad address  user_123              VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"
logged in, no contract  user_123              UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it
denied, real invoice    cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
denied, no such invoice cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
`;

let printed: string | undefined;

/**
 * Runs the program once and keeps what it printed.
 *
 * **Once**, because starting Node and compiling the schemas costs a tenth of a second and every
 * test below asks a different question of the same output.
 *
 * **Lazily, not at module scope.** A program that crashes has to fail a *test*. A throw while this
 * file was still loading would take the whole file out of the run, and the totals would shrink
 * instead of going red -- which is exactly the trap the README's break 1 describes, and it would
 * hide the very failure this file exists to catch.
 */
function output(): string {
  if (printed === undefined) {
    const stdout = execFileSync("node", [MAIN], {
      encoding: "utf8",
      // stderr is piped rather than inherited, so Node's own experimental-type-stripping warning
      // (Node 22 prints one; Node 24 does not) cannot land in the middle of the test report. It is
      // Node talking, not the program. A non-zero exit still throws, and the thrown error carries
      // whatever was on stderr, so a crash is still loud.
      stdio: ["ignore", "pipe", "pipe"],
    });

    // The one thing in this output that changes with the machine: a Windows console ends a line
    // with \r\n and every other console with \n. Same text either way.
    //
    // Nothing else is normalised, because nothing else varies. No clock, no random id and no
    // request id reaches the screen: `show` prints only the code, the retry class, the message and
    // the invoice. Two runs on one machine are byte-identical, which is what lets the assertion
    // below be a literal.
    printed = stdout.replaceAll("\r\n", "\n");
  }

  return printed;
}

/** The printed lines, without the empty one the final newline leaves behind. */
function lines(): string[] {
  return output().replace(/\n$/, "").split("\n");
}

/** The one line that starts with this label, or a failure naming what was there instead. */
function lineStarting(label: string): string {
  const found = lines().filter((line) => line.startsWith(label));

  if (found.length !== 1) {
    throw new Error(
      `expected one line starting with ${JSON.stringify(label)}, got ${found.length}`,
    );
  }

  return found[0] as string;
}

/**
 * Line number `n`, counting from 1 the way an editor does, or a failure.
 *
 * It throws rather than handing back `undefined`, and that is the whole reason it exists. Two of
 * the tests below compare one line against another, and `expect(undefined).toBe(undefined)` is a
 * test that passes because the output vanished. A missing line has to be louder than that.
 */
function lineAt(n: number): string {
  const line = lines()[n - 1];

  if (line === undefined) {
    throw new Error(`the program printed ${lines().length} lines, so there is no line ${n}`);
  }

  return line;
}

describe("the program a learner runs", () => {
  // No rule id. This proves the README, not a sentence of the specification: it is one assertion
  // against every line the step promises, and it is what makes a broken `show` or a loop that
  // iterates nothing go red.
  it("prints what the README shows, byte for byte", () => {
    expect(output()).toBe(EXPECTED);
  });

  // DSOR-IDN-01 says a caller is normalized into a principal "before any other processing", and
  // these are the lines that show it from outside. A login nobody has gets the identity refusal --
  // not UNSUPPORTED_CAPABILITY for the operation, not VALIDATION_FAILED for the address -- and it
  // is attributed to nobody, never to one of the three real people.
  it("DSOR-IDN-01: the two refused logins are answered as nobody, before anything else is read", () => {
    for (const label of ["not logged in", "nobody by that name"]) {
      const line = lineStarting(label);

      expect(line, label).toContain("(nobody)");
      expect(line, label).toContain("AUTHENTICATION_REQUIRED");

      for (const real of ["user_123", "cfo_100", "accounts-payable-fte"]) {
        expect(line, `${label} must not name ${real}`).not.toContain(real);
      }
    }

    // And the operation is looked at only once the caller is known: the same nonsense operation,
    // asked by somebody real, gets the refusal about the operation instead.
    expect(lineStarting("logged in, no contract")).toContain("UNSUPPORTED_CAPABILITY");
  });

  // The step 06 story the README calls "the step in four lines", read off the screen. Nothing about
  // INV-1009 changes between these three lines -- only who asked.
  it("DSOR-AUT-01b: cfo_100 is refused invoice.issue and the agent is not, for the same invoice", () => {
    // Three consecutive lines, in the order the program printed them: she reads INV-1009, she is
    // refused when she tries to issue it, and the agent then issues that same invoice.
    const read = lineAt(8);
    const refused = lineAt(9);
    const issued = lineAt(10);

    // She may read it, so what stops her is not the invoice.
    expect(read).toContain("cfo_100");
    expect(read).toContain("INV-1009");
    expect(read).toContain("draft");

    expect(refused).toContain("cfo_100");
    expect(refused).toContain("AUTHORIZATION_DENIED");

    expect(issued).toContain("accounts-payable-fte");
    expect(issued).toContain("COMMITTED");
    expect(issued).toContain("INV-1009");
    expect(issued).toContain("issued");
  });

  // The line the README calls the step's whole point: the same read, with `principal: "cfo_100"`
  // written into the arguments, answers exactly as the honest one did and still says user_123.
  it("DSOR-SRC-02a: a principal written into the arguments changes nothing the program prints", () => {
    const honest = lineAt(3);
    const planted = lineAt(6);

    expect(planted).toBe(honest);
    expect(planted).toContain("user_123");
    expect(planted).not.toContain("cfo_100");

    // The program has to actually *try* the attack, or the two identical lines prove nothing. This
    // is the only assertion in the file that reads the source instead of the output, and that is
    // why: deleting the planted principal would leave every printed line unchanged.
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

    expect(source).toMatch(/principal:\s*"cfo_100"/);
  });

  // The strongest line in the output, and the README says so: authority is settled before the
  // address is read, so a real invoice and an invoice that does not exist get the same refusal
  // **word for word**. If the order were the other way round, cfo_100 could tell the two apart and
  // count invoices she may not see, one guess at a time.
  it("DSOR-EXE-01a: the two denied lines are the same refusal, word for word", () => {
    const real = lineStarting("denied, real invoice");
    const absent = lineStarting("denied, no such invoice");

    // Past the label, because the label is this demo's own wording for what it is trying and not
    // part of the program's answer. The two labels are different lengths, so each line is cut at
    // its own label and the padding that follows is trimmed.
    const answer = (line: string, label: string): string => line.slice(label.length).trim();
    const given = answer(real, "denied, real invoice");

    expect(given).toBe(answer(absent, "denied, no such invoice"));
    expect(given).toContain("AUTHORIZATION_DENIED");

    // Nothing in either line hints at which invoice was asked for.
    for (const line of [real, absent]) {
      expect(line).not.toContain("RESOURCE_NOT_FOUND");
      expect(line).not.toContain("INV-9999");
      expect(line).not.toContain("INV-1008");
    }
  });

  // Every refusal on the screen carries a code from §28 and the retry class §28 gives that code.
  // The table in src/envelopes.ts is where the classes live, so this compares the printed answer
  // against the table rather than against a list written out again here.
  it("DSOR-ERR-01a: every refusal printed carries a §28 code and that code's retry class", () => {
    const found = [...output().matchAll(/([A-Z][A-Z_]+)\s+retry:\s+(\S+)/g)];

    // Every `retry:` in the output was read, so a refusal cannot hide from this by being printed
    // in some other shape.
    expect(found.length).toBe(output().split("retry:").length - 1);
    expect(found.length).toBe(7);

    for (const [, code, retry] of found) {
      expect(CODE_RETRY[code as string], `${code} is not a code from §28`).toBeDefined();
      expect(retry, `${code}`).toBe(CODE_RETRY[code as string]);
    }
  });
});
