// STEP 08: the demo program itself is tested.
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
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The program's own database, which it keeps on disk between runs.
 *
 * STEP 09: these tests have to delete it first. The log is durable now, so a second run finds
 * the first run's records still there — which is the step's whole point, and which makes "the demo
 * prints ten records" true only on a fresh database.
 */
const ITS_DATABASE = fileURLToPath(new URL("../.local-database", import.meta.url));

/** Start from nothing, so a run's output is about that run. */
beforeEach(() => {
  rmSync(ITS_DATABASE, { recursive: true, force: true });
});

// STEP 10: and leave nothing behind. These tests used to delete the database before each
// run and never after, so `pnpm check` left one demo run's records and an issued INV-1009 in the
// folder `pnpm start` uses — and a learner's first `pnpm start` printed CONFLICT and thirty records.
// A critic measured it. The README's "run it twice" story only means something from an empty folder.
afterAll(() => {
  rmSync(ITS_DATABASE, { recursive: true, force: true });
});

/**
 * Run the program once, and return what it printed both ways.
 *
 * `raw` is what a learner sees. `report` has the hashes replaced, so two runs can be compared — they
 * differ every run because the time a decision was made is part of what is hashed.
 *
 * Both from **one** subprocess. An earlier version ran the program a second time just to see real
 * hashes, and each run builds a PostgreSQL on disk: with the suite's other files doing the same thing
 * in parallel, two tests here timed out while passing comfortably when the file ran alone. A test
 * that only passes when nothing else is running is a test that will fail on somebody's laptop.
 */
function demo(): { raw: string; report: string } {
  const raw = execFileSync("node", [fileURLToPath(new URL("../src/main.ts", import.meta.url))], {
    encoding: "utf8",
    // Pinned to the on-disk route. Without this the subprocess inherits whatever `DSOR_DB_URL` the
    // shell has exported and `pnpm check` runs the demo — eight times, ten decisions each — against
    // that server's audit log. Three independent reviewers found it; `database.test.ts` had closed
    // the same hole for its own process a commit earlier and this file was left open.
    env: { ...process.env, DSOR_DB_URL: "" },
  });

  // And asserted, not assumed: the first thing the program says is where its log is.
  if (!raw.includes("a PostgreSQL on disk at")) {
    throw new Error(`the demo did not run on the on-disk route:\n${raw.split("\n")[1]}`);
  }

  return { raw, report: raw.replace(/sha256:[0-9a-f]+/g, "sha256:HASH") };
}

describe("the program a learner runs", () => {
  it("DSOR-AUT-01b: the CFO is refused the command and the agent is allowed it", () => {
    const out = demo().report;

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
    const out = demo().report;

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
    const out = demo().report;
    const rows = out.split("\n").filter((line) => /^\s*\d+\s+(ALLOW|DENY)\s/.test(line));

    // STEP 10: two logs, printed one after the other — org_456's fifteen records and
    // org_789's two.
    expect(rows).toHaveLength(17);

    // Denials recorded, which is step 08's point: a program that logged only its successes
    // would have lost every one of them. Five of the nine are this step's — four refusals for being
    // outside one company, and the agent's unsaid request counted once in each employer's log.
    // Ten since the review: a principal planted in the arguments that is not the caller is refused
    // (DSOR-SRC-02b) where step 05 ignored it, so the demo's third request is a DENY now.
    expect(rows.filter((r) => r.includes("DENY"))).toHaveLength(10);
    expect(rows.filter((r) => r.includes("ALLOW"))).toHaveLength(7);

    // Sequences 0..14 for org_456 and then 0..1 for org_789: each chain counts from zero.
    expect(rows.map((r) => Number(r.trim().split(/\s+/)[0]))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 1,
    ]);

    expect(out).toContain("org_456: 15 records, chain verifies against the head: true");
    expect(out).toContain("org_789: 2 records, chain verifies against the head: true");
    expect(out).toContain("2 refusals counted without a record");

    // The line that shows what a checkpoint is for — and only as far as it goes. Hash chaining alone
    // says a shortened log is fine, because every link in it still holds; the head notices, for a log
    // held in memory. It does NOT notice a row deleted from the table, because `theHead("org_456")` is a query
    // over that table and moves with it. The demo's wording says so, and so does `theHead("org_456")`.
    expect(out).toContain(
      "drop one from the copy we are holding: the chain alone still says true, and against the head false",
    );
  });

  it("DSOR-AUD-01: an unknown operation is recorded with no operation field", () => {
    // The whole line for record 7, because the fallback label is now also printed for §21.2
    // refusals. Built with the printer's own widths rather than typed, so the test pins the
    // content — DENY, no operation, UNSUPPORTED_CAPABILITY — and not a guess at the spacing.
    const line = [
      " 7",
      "DENY ",
      "(none resolved)".padEnd(19),
      "user_123".padEnd(21),
      "UNSUPPORTED_CAPABILITY".padEnd(22),
    ].join("  ");

    expect(demo().report).toContain(line);
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
    const records = (out: string, company: string): number =>
      Number(new RegExp(`^${company}: (\\d+) records, chain verifies`, "m").exec(out)?.[1] ?? "-1");

    const first = demo().report;

    expect(records(first, "org_456")).toBe(15);
    expect(records(first, "org_789")).toBe(2);
    expect(first).toContain("org_456: 15 records, chain verifies against the head: true");

    // A second process. Nothing is shared with the first but the directory on disk.
    const second = demo().report;

    expect(records(second, "org_456")).toBe(30);
    expect(records(second, "org_789")).toBe(4);
    expect(second).toContain("org_456: 30 records, chain verifies against the head: true");
    expect(second).toContain("org_789: 4 records, chain verifies against the head: true");

    // Run one's records are still there, unchanged, among run two's.
    expect(second).toContain(" 0  ALLOW  invoice.get@1");
    expect(second.split("\n").filter((line) => /^\s*\d+\s+(ALLOW|DENY)\s/.test(line))).toHaveLength(
      34,
    );

    // STEP 10: the invoices are durable too. Run one issued INV-1009; run two finds it
    // issued and the agent's second attempt is CONFLICT, where in step 09 — invoices in a list that
    // died with the process — every run issued it afresh.
    expect(first).toContain("accounts-payable-fte  COMMITTED");
    expect(second).toContain("accounts-payable-fte  CONFLICT");
    expect(second).not.toContain("accounts-payable-fte  COMMITTED");
  });

  // The hashes move every run, because the time a decision was made is part of what is hashed.
  it("DSOR-AUD-04b: two fresh runs print the same report with different hashes", () => {
    const first = demo();

    rmSync(ITS_DATABASE, { recursive: true, force: true });

    const second = demo();

    // The same report once the hashes are normalised.
    expect(second.report).toBe(first.report);

    // And genuinely different underneath — ten hashes each, none of them shared.
    const hashesOf = (text: string): string[] => text.match(/sha256:[0-9a-f]+/g) ?? [];

    expect(hashesOf(first.raw)).toHaveLength(17);
    expect(hashesOf(second.raw)).toHaveLength(17);
    expect(hashesOf(second.raw)).not.toEqual(hashesOf(first.raw));
  });

  // STEP 10: what the demo shows about two companies.
  it("DSOR-IDN-03b: the same invoice number is two different invoices, one per company", () => {
    const out = demo().report;

    expect(out).toContain("dsor://org_456/invoice/INV-1008  31400.00 USD  issued");
    expect(out).toContain("dsor://org_789/invoice/INV-1008  18000.00 USD  draft");
  });

  it("DSOR-ERR-01b: the four refusals, and the same words for a real company and one that does not exist", () => {
    const out = demo().report;
    // The envelope lines (they carry a retry class), not the audit rows that also say TENANT_MISMATCH.
    const labelled = out
      .split("\n")
      .filter((line) => line.includes("TENANT_MISMATCH") && line.includes("retry:"));

    expect(labelled).toHaveLength(4);

    const real = labelled.find((line) => line.startsWith("their address, real"));
    const fake = labelled.find((line) => line.startsWith("their address, no such co"));

    if (real === undefined || fake === undefined) {
      throw new Error("both refusals should be in the output");
    }

    // Same words but for the address echoed back, and nothing about the company the caller is in.
    expect(real.split("TENANT_MISMATCH")[1]?.replace("org_789", "X")).toBe(
      fake.split("TENANT_MISMATCH")[1]?.replace("org_000", "X"),
    );

    for (const line of labelled) {
      expect(line).not.toContain("serves");
      expect(line.split("TENANT_MISMATCH")[1]).not.toContain("org_456");
    }
  });

  it("DSOR-TEN-02a: the agent's unsaid request is in both employers' logs, and nothing else crosses", () => {
    const out = demo().report;
    const [, ours = "", theirs = ""] = out.split(/The audit log of org_\d+:/);

    expect(ours).toContain("accounts-payable-fte   TENANT_MISMATCH");
    expect(theirs).toContain("accounts-payable-fte   TENANT_MISMATCH");
    // org_789's log holds nothing of user_123 or the CFO, who belong to org_456 only.
    expect(theirs).not.toContain("user_123");
    expect(theirs).not.toContain("cfo_100");
  });
});
