// The tests for the program a learner actually runs: `pnpm start`.
//
// Without this file, `src/main.ts` is the only code in the step that nothing checks.
// That is the file the README tells you to run, and whose four lines the README pastes
// as proof the step works. So a single flipped `===` inside it could leave every other
// test green while `pnpm start` printed the opposite of what the README promises.
//
// Why a subprocess, and not an import: `src/main.ts` does its work at the top level and
// exports nothing. Importing it would run it as a side effect of the import, and there
// would be no function left to call and nothing handed back to look at. Running it the
// way a learner runs it is also the only way to test the thing being claimed — that
// `pnpm start` prints these lines.
//
// What these tests cannot catch, said plainly. src/main.ts prints one invoice, INV-1008,
// and every one of its values is therefore printed exactly once. So replacing a value in
// the template with the literal it happens to equal — `${invoice.uri}` with
// `dsor://org_456/invoice/INV-1008`, or `${invoice.amount.currency}` with `USD` — produces
// the same four lines, byte for byte. No test that reads the output can tell the two
// programs apart, because there is no difference to read. Those mutations were tried: five
// of them survive for this reason, and twelve others die here. A guard that cannot be
// killed is worth a comment rather than a quiet gap. What would kill them is a program
// that printed both invoices, and that is step 03's registry, not this step's demo.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Where src/main.ts is, worked out from where this test file is, so the test passes no
// matter which folder you run it from.
//
// fileURLToPath, and not `new URL(…).pathname`: on Windows the pathname of a file URL
// keeps a slash in front of the drive letter ("/C:/Users/…"), which is not a path Node
// can open, and a folder name with a space in it arrives percent-encoded as "%20".
// fileURLToPath is the conversion that is correct on every platform.
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

// The address this step is about, written once so that the tests below cannot disagree
// with each other about what it is.
const ADDRESS = "dsor://org_456/invoice/INV-1008";

/**
 * Runs `node src/main.ts` and returns what it printed, one string per line.
 *
 * `"node"` and not `process.execPath`: `pnpm start` runs `node src/main.ts`, so the node
 * on the PATH is the one whose behaviour the README promises.
 *
 * execFileSync throws if the program exits with a non-zero code, so a test that gets a
 * list of lines back has already proved the program ran to the end without crashing.
 *
 * There is exactly one piece of normalisation here, and it is not about runs differing.
 * Every line of this program's output is fixed text read from the frozen array in
 * src/invoice.ts: nothing in it comes from the clock, the environment, the filesystem,
 * or a random number, so two runs cannot print different bytes. The one adjustment is
 * that console.log ends each line with a newline, so splitting on "\n" leaves an empty
 * string after the last one. That empty string is the final newline, not a fifth line.
 */
function runProgram(): string[] {
  const lines = execFileSync("node", [MAIN], { encoding: "utf8" }).split("\n");
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

  // NEW IN STEP 02: the address is this step's lesson, printed.
  //
  // DSOR-RID-01a at the only place a human ever sees it. The invoice reaches the screen
  // under its canonical address rather than under a bare "INV-1008", which is what step
  // 01 printed. An address that lost its scheme, its tenant or its entity would break
  // the rule in the output even if every unit test on formatUri still passed.
  //
  // The README calls out that the address is printed FIRST, before the amount, so the
  // position is pinned here and not only the text.
  it("DSOR-RID-01a: prints the invoice under its canonical address, before the amount", () => {
    const lines = runProgram();

    expect(lines[1]).toBe(ADDRESS);

    // Said again in parts, so a failure names which segment went wrong.
    expect(lines[1]).toContain("dsor://");
    expect(lines[1]).toContain("/invoice/");
    expect(lines[1]).toContain("INV-1008");

    // The amount line is the one after it, indented, so the address really is first.
    // No rule id for the indent: the two-space indent is this step's own formatting.
    expect(lines[2]).toMatch(/^ {2}\S/);
    expect(lines[2]).toContain("31400.00 USD");
  });

  // No rule id, and this is the honest limit of the test above. DSOR-RID-01b is a rule
  // about MEANING — is this segment an id or a name — and a line of expected output is a
  // literal, so matching it shows the program complies and proves nothing about what the
  // program would refuse. The proof of DSOR-RID-01b is in test/uri.test.ts, where
  // `dsor://acme/...` is refused. What this test can do is say that no human-readable
  // name reached the address, which is the failure a reader would spot in the output.
  it("no company name appears in the printed address", () => {
    const address = runProgram()[1] ?? "";

    expect(address).toContain("/org_456/");
    for (const name of ["acme", "Acme", "ACME", "accounts-payable-fte", "VENDOR-44"]) {
      expect(address, name).not.toContain(name);
    }
  });

  // The amount reaches the screen as its two parts, "31400.00" and "USD". That is
  // DSOR-MON-01 at the only place a human ever sees it. A `31400` here, or an amount
  // with the currency dropped, is the rule broken in the output even if every unit test
  // on money() still passes.
  it("DSOR-MON-01: prints the amount as a decimal string and a currency code", () => {
    const line = runProgram()[2];

    expect(line).toBe("  31400.00 USD to VENDOR-44 (issued)");

    // "31400.00 USD" and not "31400 USD": the trailing zeros are text the program must
    // not lose, and the currency follows the value rather than being dropped.
    expect(line).toContain("31400.00 USD");
    expect(line).not.toContain("31400 ");
  });

  // No rule id: a missing record returning `undefined` rather than throwing is this
  // step's choice, not a requirement. Error shapes a caller can see become rules in
  // step 04.
  //
  // Flip either `===` in src/main.ts to `!==` and this test is what notices: the first
  // flip sends the real invoice down the "not found" branch, the second announces that a
  // record which does not exist was found.
  it("reports a missing invoice as not found, and does not crash", () => {
    expect(runProgram()[3]).toBe("INV-9999: not found.");
  });

  // No rule id. Four lines, in this order, and nothing after them. Without this, a
  // fifth line of leftover debugging — or a line printed twice — would go unseen,
  // because each test above looks only at the line it was given.
  //
  // This is also the test that keeps the README's pasted output honest: the list below
  // is that block, character for character.
  it("prints exactly the four lines the README shows, in order", () => {
    expect(runProgram()).toEqual([
      "Hello, accounts-payable-fte.",
      "dsor://org_456/invoice/INV-1008",
      "  31400.00 USD to VENDOR-44 (issued)",
      "INV-9999: not found.",
    ]);
  });
});
