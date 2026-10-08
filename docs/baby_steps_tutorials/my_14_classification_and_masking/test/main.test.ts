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
import { operationIds } from "../src/operations.ts";
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

    // STEP 10: two logs, printed one after the other — org_456's seventeen records and
    // org_789's two. STEP 12: seventeen, not fifteen, because the generated section refuses
    // one request per operation, and a refusal is a decision.
    expect(rows).toHaveLength(23); // STEP 13: one more refusal for invoice.list, and three pages read

    // Denials recorded, which is step 08's point: a program that logged only its successes
    // would have lost every one of them. Five of the nine are this step's — four refusals for being
    // outside one company, and the agent's unsaid request counted once in each employer's log.
    // Ten since the review: a principal planted in the arguments that is not the caller is refused
    // (DSOR-SRC-02b) where step 05 ignored it, so the demo's third request is a DENY now. Twelve
    // since step 12: one refusal per operation from the generated section.
    expect(rows.filter((r) => r.includes("DENY"))).toHaveLength(13);
    expect(rows.filter((r) => r.includes("ALLOW"))).toHaveLength(10); // STEP 13: three pages read

    // Sequences for org_456 and then 0..1 for org_789: each chain counts from zero.
    // STEP 14: the gaps — 1, 5, 21, 23, 25 — are the records of reads, which this filter does not
    // count: the supervisor's and the CFO's reads of one invoice, and the three pages, each
    // written down after the decision that allowed it. The agent's reads leave no such record.
    expect(rows.map((r) => Number(r.trim().split(/\s+/)[0]))).toEqual([
      0, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 0, 1,
    ]);

    expect(out).toContain("org_456: 26 records, chain verifies against the head: true"); // STEP 14: 21 decisions, 5 reads
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
    // The whole line for record 9 (STEP 14: two reads sit before it now), because the fallback label is now also printed for §21.2
    // refusals. Built with the printer's own widths rather than typed, so the test pins the
    // content — DENY, no operation, UNSUPPORTED_CAPABILITY — and not a guess at the spacing.
    const line = [
      " 9",
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

    expect(records(first, "org_456")).toBe(26); // STEP 14: 21 decisions and 5 reads
    expect(records(first, "org_789")).toBe(2);
    expect(first).toContain("org_456: 26 records, chain verifies against the head: true");

    // A second process. Nothing is shared with the first but the directory on disk.
    const second = demo().report;

    expect(records(second, "org_456")).toBe(52);
    expect(records(second, "org_789")).toBe(4);
    expect(second).toContain("org_456: 52 records, chain verifies against the head: true");
    expect(second).toContain("org_789: 4 records, chain verifies against the head: true");

    // Run one's records are still there, unchanged, among run two's.
    expect(second).toContain(" 0  ALLOW  invoice.get@1");
    expect(second.split("\n").filter((line) => /^\s*\d+\s+(ALLOW|DENY)\s/.test(line))).toHaveLength(
      46,
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

    expect(hashesOf(first.raw)).toHaveLength(28); // STEP 14: 26 and 2, reads included
    expect(hashesOf(second.raw)).toHaveLength(28);
    expect(hashesOf(second.raw)).not.toEqual(hashesOf(first.raw));
  });

  // STEP 10: what the demo shows about two companies.
  // STEP 11: the two lines that are this step. An evaluation inverted them — no company
  // for the first, org_789 for the second — and this file passed 9 of 9. The README's "Run it"
  // block was pasted output with nothing behind it, which is the failure this file's header says
  // it exists to stop.
  it("DSOR-RP-01d: the forgotten WHERE gets org_456's row with the company said, and no rows with none", () => {
    const { raw } = demo();
    const section = raw.split("A forgotten WHERE, caught by the second lock:")[1] ?? "";

    expect(section).toContain("  for org_456:      org_456  INV-1008  31400.00  issued");
    expect(section).toContain("  no company said:  (no rows)");
    // And only org_456's row, with the company said: the point is the row that is NOT there.
    expect(section.split("no company said")[0]).not.toContain("org_789");
  });

  // STEP 12: the lines that are this step, pinned, as step 11's were after an evaluation
  // found them unpinned. One line per operation in the registry, every one a TENANT_MISMATCH.
  // NEW IN STEP 13: the lines that are this step, pinned from the start.
  // Not titled with DSOR-QRY-01: with two invoices in the story, "a million" prints two whether or
  // not a ceiling exists, and a review ran it green with the cap and the door's check both deleted.
  // It pins the demo's lines; bounded-queries.test.ts, which seeds three hundred, proves the rule.
  it("the demo's list shows a page, its cursor, and a request for a million getting what there is", () => {
    const { raw } = demo();
    const section =
      raw.split("A list, one page at a time, and the ceiling:")[1]?.split("The audit log")[0] ?? "";
    const lines = section
      .split("\n")
      .filter((line) => /^(limit 1 |after the first|limit 1,000,000)/.test(line));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/1 invoices, next after dsor:\/\/org_456\/invoice\/INV-1008$/);
    expect(lines[1]).toMatch(/1 invoices, the last page$/);
    // Two invoices in the story, so the million gets both — and "the last page", not a million.
    expect(lines[2]).toMatch(/2 invoices, the last page$/);
  });

  it("DSOR-TEN-02b: the demo refuses every operation in the registry another company's address", () => {
    const { raw } = demo();
    const section = raw.split("Every operation, with another company's address:")[1] ?? "";
    const lines = section.split("\n").filter((line) => /^invoice\./.test(line));

    expect(lines.map((line) => line.split(/\s+/)[0])).toStrictEqual(operationIds().sort());

    for (const line of lines) {
      expect(line).toContain("TENANT_MISMATCH");
      expect(line).toContain("dsor://org_789/");
      expect(line).not.toContain("(no example request");
    }
  });

  it("DSOR-IDN-03b: the same invoice number is two different invoices, one per company", () => {
    const out = demo().report;

    // STEP 14: both lines are the agent's, and the agent sees no amount: what it sees is which
    // company's INV-1008 it got, told apart by the status.
    expect(out).toContain("dsor://org_456/invoice/INV-1008  (amount withheld)  issued");
    expect(out).toContain("dsor://org_789/invoice/INV-1008  (amount withheld)  draft");
  });

  it("DSOR-ERR-01b: the four refusals, and the same words for a real company and one that does not exist", () => {
    const out = demo().report;
    // The envelope lines (they carry a retry class), not the audit rows that also say TENANT_MISMATCH.
    // STEP 12: the section before "Every operation" — the two lines that section adds are
    // the generated suite's and are pinned by their own test above.
    const labelled = (out.split("Every operation, with another company's address:")[0] ?? "")
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
