// The demo program itself, tested by running it.
//
// NEW: until now no test touched `src/main.ts`. It is the program the README tells you to
// run, and the README pastes its output as proof that the step works — so flipping one
// `===` inside it left every test green while `pnpm start` printed the opposite of what
// the README promised. A document that cannot go wrong is worth more than a document that
// is right today.
//
// Why a subprocess instead of an import: `main.ts` does its work at the top level. There
// is no function to call. Importing it would run it, print into the test output, and leave
// nothing to assert on. So the test starts the program the way a learner does and reads
// what came back.
//
// `execFileSync` throws when the program exits with a non-zero code, so a crash fails
// these tests without any assertion of its own.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CODE_RETRY } from "../src/envelopes.ts";
import { operationIds } from "../src/operations.ts";

// `fileURLToPath` rather than `.pathname`: a URL percent-encodes, so a folder with a space
// in its name would hand Node a path it cannot open. A learner's folder can be anywhere.
const PROGRAM = fileURLToPath(new URL("../src/main.ts", import.meta.url));

let ranOnce: string | undefined;

/**
 * Runs the program and returns what it printed. Run once, read by every test below.
 *
 * The run belongs **inside** a test, not at the top of this file, and a mutation sweep is
 * what taught that. Running it at module scope looked tidier — until a mutation made the
 * program crash: `execFileSync` threw while the module was loading, so this file collected
 * no tests at all. Vitest reported "98 passed" with nothing failed, and a crash in the
 * program under test read like a clean run. A test that disappears when the thing it
 * guards breaks is worse than no test.
 *
 * `process.execPath` is the Node running these tests, so the program cannot be run by a
 * different Node than the one `pnpm check` just type-checked for.
 */
function transcript(): string {
  ranOnce ??= execFileSync(process.execPath, [PROGRAM], { encoding: "utf8" });

  return ranOnce;
}

/**
 * What the README pastes under "Run it", line for line.
 *
 * **Nothing here is normalised, because nothing in it differs between runs.** That is
 * worth being explicit about, because a test that normalises more than it must stops
 * proving anything:
 *
 * - the request id and proposal counters start at zero in a fresh process, so `prop_0001`
 *   is `prop_0001` every time;
 * - `payload_hash` is a sha256 of fixed arguments, so the fingerprint is fixed too;
 * - there is no clock, no random number, and no network anywhere in the step.
 *
 * The day one of those stops being true, this list is where it has to be said out loud.
 */
const TRANSCRIPT: readonly string[] = [
  "Hello, accounts-payable-fte.",
  "operations: invoice.get, invoice.issue",
  "",
  "(no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued",
  "(no envelope)            dsor://org_456/invoice/INV-1009  2500.00 USD  draft",
  "",
  "COMMITTED                dsor://org_456/invoice/INV-1009  issued",
  "                         proposal dsor://org_456/proposal/prop_0001",
  "                         payload  sha256:e2f80b67d9a15698…",
  "CONFLICT                 retry: never                INV-1009 is issued, and only a draft invoice can be issued",
  "",
  "RESOURCE_NOT_FOUND       retry: never                INV-9999 is not an invoice we hold",
  "TENANT_MISMATCH          retry: never                dsor://org_999/invoice/INV-1008 is for org_999, and this program serves org_456",
  "VALIDATION_FAILED        retry: never                invoice.get is named for invoice, and dsor://org_456/vendor/VENDOR-44 names vendor",
  'VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"',
  "UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it",
];

/** One refusal line as the program printed it. */
interface PrintedRefusal {
  readonly code: string;
  readonly retry: string;
  readonly message: string;
}

/**
 * Every refusal line in a transcript.
 *
 * Read out of what the program printed, never out of `TRANSCRIPT` above. A test that
 * parses its own expected value proves only that the constant is well formed.
 */
function refusalsIn(output: string): PrintedRefusal[] {
  const found: PrintedRefusal[] = [];

  for (const line of output.split("\n")) {
    const parts = /^([A-Z][A-Z0-9_]*) +retry: ([a-z_]+) +(\S.*)$/.exec(line);

    if (parts !== null) {
      found.push({ code: parts[1]!, retry: parts[2]!, message: parts[3]! });
    }
  }

  return found;
}

describe("the program the README tells you to run", () => {
  // No rule id. This proves the README's transcript is still the truth, which is a
  // promise this step makes to a reader rather than a requirement of the specification.
  it("prints exactly what the README pastes under Run it", () => {
    // `console.log` ends every line with a newline, so the transcript ends with one too.
    expect(transcript()).toBe(`${TRANSCRIPT.join("\n")}\n`);
  });

  // The second line of the transcript is the registry's own list, so it is checked against
  // the registry rather than only against the text above.
  //
  // Today this cannot catch a `main.ts` that prints the same two names as a hardcoded
  // string: the output is identical, so no test reading the output can tell. What it does
  // do is turn that from invisible into obvious the moment a step adds a third operation.
  it("prints the operations the registry actually holds", () => {
    const lines = transcript().split("\n");

    expect(lines[1]).toBe(`operations: ${operationIds().join(", ")}`);
  });

  // The rule's own words: a code "from this table", and "a retry class". Here they are
  // checked where they actually reach a human — on the way out of the real program —
  // against the §28 table itself rather than against a list copied into the test.
  it("DSOR-ERR-01a: every refusal it prints carries a §28 code and that code's retry class", () => {
    const refusals = refusalsIn(transcript());

    // Six, named here so a loop that prints nothing cannot pass by printing nothing.
    expect(refusals.length).toBe(6);

    for (const refusal of refusals) {
      expect(Object.keys(CODE_RETRY), refusal.code).toContain(refusal.code);
      expect(refusal.retry, refusal.code).toBe(CODE_RETRY[refusal.code]);
      expect(refusal.message.length, refusal.code).toBeGreaterThan(0);
    }
  });

  // No rule id: "every one says never" is the README's own observation about these six
  // refusals, not a requirement. It is still the line the README calls out as mattering,
  // so it is pinned here — an agent that retries a `never` is an agent in a loop.
  it("prints six refusals and five different codes, and every one says never", () => {
    const refusals = refusalsIn(transcript());

    expect(refusals.map((refusal) => refusal.retry)).toEqual(Array(6).fill("never"));
    expect(new Set(refusals.map((refusal) => refusal.code)).size).toBe(5);
  });

  // No rule id. The receipt validated against result-envelope.schema.json inside
  // `success()` or the program would have thrown on the way out — but printing it proves
  // nothing about the schema, so this claims no rule. What it does prove is the README's
  // account of the step: the command really ran, the receipt names its two placeholders,
  // and the second attempt on the same invoice is refused rather than repeated.
  it("carries the command out once, shows the receipt, and refuses the second attempt", () => {
    const printed = transcript();
    const lines = printed.split("\n");

    expect(lines.filter((line) => line.startsWith("COMMITTED")).length).toBe(1);
    expect(printed).toContain("proposal dsor://org_456/proposal/prop_0001");
    expect(printed).toMatch(/payload {2}sha256:[0-9a-f]{16}…/);

    // The invoice went from draft to issued, and the receipt says which invoice.
    expect(printed).toContain("COMMITTED                dsor://org_456/invoice/INV-1009  issued");

    const conflicts = refusalsIn(printed).filter((refusal) => refusal.code === "CONFLICT");

    expect(conflicts.length).toBe(1);
    expect(conflicts[0]?.message).toContain("INV-1009 is issued");
  });

  // Two reads, and neither is in an envelope — the gap in the specification the README
  // explains under "Why two lines say (no envelope)". No rule id: it records a gap.
  it("hands back a read invoice with no envelope, twice", () => {
    const reads = transcript()
      .split("\n")
      .filter((line) => line.startsWith("(no envelope)"));

    expect(reads.length).toBe(2);
    expect(reads[0]).toContain("31400.00 USD");
    expect(reads[1]).toContain("2500.00 USD");
  });
});
