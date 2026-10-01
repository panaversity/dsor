// NEW IN STEP 03: the demo program itself is tested.
//
// `src/main.ts` is the program the README tells a learner to run, and the README pastes its
// output as proof that the step works. Until now no test imported it. That is a hole, not a
// detail: flipping one `===` inside `main.ts` left every other test green while `pnpm start`
// printed the opposite of what the README promises, or crashed. A program nothing checks is a
// program that can rot quietly, and this one is the first thing a learner sees.
//
// It runs as a subprocess rather than an import because `main.ts` *is* a script. It does its
// work at the top level, so importing it would run it, and there would be nothing left to call.
// A subprocess also runs it the way a learner does, with `node`, through the same imports.
//
// Nothing in this output moves between runs, so nothing is normalised here and the whole text is
// compared character for character. That is worth saying out loud rather than leaving implied:
// there is no clock in this program, no random value, and no file path in anything it prints.
// The greeting is a fixed string, the two invoices are the in-memory list from step 01, and the
// four refusal messages are fixed text. A test that normalised more than it had to would be a
// test that had stopped noticing things.
//
// What this file cannot test is the step's headline claim — that a broken contract stops the
// program before it prints anything. Proving that needs a broken contract on disk, so it is the
// README's "Break it" exercise 1 and not a test here. The reason it holds is module order:
// `main.ts` imports `operations.ts`, every import is evaluated before the first statement of
// `main.ts` runs, and `operations.ts` builds the registry while it loads. So a registry that
// throws means an empty stdout, and `test/registry.test.ts` is what proves the throwing.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `fileURLToPath`, not the URL's own `pathname`. A pathname keeps percent-escapes, so a checkout
// in a folder whose name has a space in it would hand node `/Users/a%20b/...` and the run would
// fail for a reason that has nothing to do with the step.
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/** Runs the program exactly as `pnpm start` does, and hands back everything it printed. */
function demo(): string {
  // `process.execPath`, not the word "node": the same Node that is running this test. Otherwise
  // the test could pass against one version while a learner's `pnpm start` used a different one
  // that happened to be first on the PATH.
  //
  // execFileSync throws when the program exits non-zero, so a crash fails the test rather than
  // handing back a short string that an assertion might still accept.
  return execFileSync(process.execPath, [MAIN], { encoding: "utf8" });
}

// Pasted from the README's "Run it" section, with the trailing newline that console.log adds.
// The two have to stay identical: if the program changes, this test goes red, and the red test
// is the reminder that the README now promises something untrue.
const EXPECTED = `Hello, accounts-payable-fte.
operations: invoice.get, invoice.issue

invoice.get    dsor://org_456/invoice/INV-1008  31400.00 USD  issued
invoice.get    dsor://org_456/invoice/INV-1009  2500.00 USD  draft

refused  not built yet: invoice.issue has a contract, and no handler until step 04
refused  wrong company: dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456
refused  wrong entity: invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor
refused  no contract: execute_sql is not an operation: this program has no contract for it
`;

/** The `invoice.get` rows, each split into its columns. */
function invoiceRows(out: string): string[][] {
  // Two or more spaces separate the columns, and one space never does. That is why main.ts pads
  // its columns the way it does.
  return out
    .split("\n")
    .filter((line) => line.startsWith("invoice.get  "))
    .map((line) => line.trim().split(/\s{2,}/));
}

describe("the program a learner runs", () => {
  // No requirement id on this one, and that is correct rather than a gap. It proves the README
  // is honest about the output, which is a promise this tutorial makes and the specification
  // does not. The named requirements get their own tests below.
  it("prints exactly what the README promises, and prints it the same way twice", () => {
    expect(demo()).toBe(EXPECTED);

    // Run it again. Two identical runs are what earns the character-for-character comparison
    // above: they say there is nothing in this program that varies, so nothing needed hiding.
    expect(demo()).toBe(EXPECTED);
  });

  it("DSOR-OPR-01: the program answers only to operations that have a contract", () => {
    const out = demo();

    // The registry's keys, printed. Both ids are here because both contracts loaded and
    // validated; a contract that failed would have stopped the program before this line.
    expect(out).toContain("operations: invoice.get, invoice.issue");

    // §7's Common mistake, refused. No contract means no such operation.
    expect(out).toContain(
      "refused  no contract: execute_sql is not an operation: this program has no contract for it",
    );

    // And the other side of the pairing: a contract with no handler is refused too, with a
    // different message, so a reader can tell the two situations apart.
    expect(out).toContain(
      "refused  not built yet: invoice.issue has a contract, and no handler until step 04",
    );

    // The alarm for this whole block. main.ts prints "refused? <what>: it was allowed" when a
    // call it expected to refuse returns a value instead, so this one assertion catches any
    // check that has quietly stopped checking.
    expect(out).not.toContain("it was allowed");
    expect(out.split("\n").filter((line) => line.startsWith("refused  "))).toHaveLength(4);
  });

  it("DSOR-RID-01a: each invoice is printed at its own canonical address", () => {
    // The id in each address is the id that was asked for. Without this, a handler that always
    // returned the first invoice in the list would print a perfectly well-formed address for
    // the wrong record, twice over, and nothing would say so.
    expect(invoiceRows(demo()).map((row) => row[1])).toEqual([
      "dsor://org_456/invoice/INV-1008",
      "dsor://org_456/invoice/INV-1009",
    ]);
  });

  it("DSOR-MON-01: each amount is printed as a decimal string with its currency code", () => {
    const amounts = invoiceRows(demo()).map((row) => row[2] ?? "");

    expect(amounts).toEqual(["31400.00 USD", "2500.00 USD"]);

    // Said again as a shape, not as two literals, because the literals are the easy half. The
    // rule is that an amount is never printed alone: 31400.00 without USD is not an amount, and
    // a bare 31400 has lost the cents that made the value text in the first place.
    for (const amount of amounts) {
      expect(amount, amount).toMatch(/^[0-9]+\.[0-9]{2} [A-Z]{3}$/);
    }
  });

  // No requirement id. The tenant check inside invoice.get is this step's own smaller promise —
  // that a part of an address we read is a part we honour — and real multi-tenancy is DSOR-TEN
  // territory in step 10. Claiming a tenancy id here would count coverage this step has not
  // earned. The README's "The address names a company" section says the same thing in prose.
  it("an address for another company is refused rather than quietly answered", () => {
    const out = demo();

    expect(out).toContain(
      "refused  wrong company: dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456",
    );

    // The failure this guards against is not a crash, it is a wrong answer: org_999's request
    // answered with org_456's record. So no row in the output may carry another company's
    // address, and the refusal above must not have printed an invoice beside it.
    for (const row of invoiceRows(out)) {
      expect(row[1], row.join(" ")).toContain("dsor://org_456/");
    }

    expect(out).not.toContain("org_999/invoice/INV-1008  ");
  });

  it("DSOR-OPR-01: an operation is refused an address whose entity it is not named for", () => {
    // `invoice.get` is named for `invoice`. That the name and the contract agree on what the
    // operation works on is the whole reason an operation has a contract rather than a
    // signature, so the refusal belongs to DSOR-OPR-01.
    expect(demo()).toContain(
      "refused  wrong entity: invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor",
    );
  });
});
