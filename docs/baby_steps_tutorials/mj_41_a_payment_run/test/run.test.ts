// NEW IN STEP 41: a payment run, many drafts proposed as one list. Each line keeps its own checks
// and its own record; the day's limit is booked once, for the run's total; the CFO approves the
// list once, with its fingerprint and its totals; and the run drafts every line, or none
// (DSOR-BAT-01a, DSOR-BAT-01b, DSOR-BAT-02a, DSOR-BAT-02b; step 41's README, claims C1 to C8).
import { describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import type { Answer } from "../src/envelope.ts";
import type { Invoice } from "../src/invoice.ts";
import { money } from "../src/money.ts";
import { lineKeyOf, runProblems } from "../src/run.ts";
import { AGENT, contract, keyed, SUPERVISOR, without } from "./helpers.ts";
import { ruleWorld, type RuleWorld } from "./rule-world.ts";

/** A run's input: one line for each of these bills of org_456, each decided on version 1. */
function lines(...ids: string[]): { lines: { invoice: string; expected_version: number }[] } {
  return {
    lines: ids.map((id) => ({ invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 })),
  };
}

/** A bill of org_456, issued, version 1, added to the world's invoices. */
function bill(w: RuleWorld, id: string, vendor: string, value: string): void {
  const amount = money(value, "USD");
  const fields = { vendor_id: vendor, amount, open_amount: amount, status: "issued" };
  w.bills.push({ tenant_id: "org_456", id, ...fields, version: 1 } as Invoice);
}

/** One of org_456's proposals, by its URI. */
async function proposalAt(w: RuleWorld, uri: string) {
  return (await w.proposals.all()).find((p) => p.uri === uri);
}

/** The run's lines' proposals, in the order of the run's lines. */
async function linesOf(w: RuleWorld, run: string) {
  const all = await w.proposals.all();
  const lines = all.filter((p) => p.run === run);
  const order = (p: { payload: unknown }) =>
    ((p.payload as { invoice: string }).invoice.match(/INV-\d+/) ?? [""])[0];
  const kept = (await proposalAt(w, run))!.payload as { lines: { invoice: string }[] };
  const wanted = kept.lines.map((l) => (l.invoice.match(/INV-\d+/) ?? [""])[0]);
  return wanted.map((id) => lines.find((p) => order(p) === id)!);
}

// The story's bills: INV-1002 is 8,900.50 USD of VENDOR-44, INV-1006 640.00 of VENDOR-31, INV-1008
//   31,400.00 of VENDOR-44, above the CFO's 25,000, and INV-1009 7,425.00 of VENDOR-44.
// Run A waits for the CFO, because of INV-1008: 40,940.50 USD in all.
const RUN_A = lines("INV-1002", "INV-1008", "INV-1006");
// Run B needs no one: 16,965.50 USD in all.
const RUN_B = lines("INV-1002", "INV-1009", "INV-1006");

/** The code of a refusal, or the outcome of anything else. */
function saidOf(answer: Answer): string {
  return "code" in answer ? answer.code : String((answer as { outcome?: unknown }).outcome);
}

describe("C1: a run declares how it ends and how long it may be", () => {
  it("DSOR-BAT-01a: C1: payment.run's contract declares all_or_nothing and at most 50 lines", () => {
    expect(contract("payment.run")["batch"]).toStrictEqual({
      atomicity: "all_or_nothing",
      max_items: 50,
    });
  });

  it("DSOR-BAT-01a: C1: start-up refuses a run that declares no batch, and a batch that names no line", () => {
    const run = contract("payment.run");
    expect(runProblems([without(run, "batch")])).toStrictEqual([
      "payment.run: its lines are payment.create, and it declares no batch: its atomicity and its most lines (DSOR-BAT-01a)",
    ]);
    const unnamed = { ...run, extensions: {} };
    expect(runProblems([unnamed])).toStrictEqual([
      "payment.run: it declares a batch, and names no operation for its lines (DSOR-BAT-01a)",
    ]);
    const shipped = [...ruleWorld().registry.contracts.values()];
    expect(runProblems(shipped)).toStrictEqual([]);
    // And lines of an operation that has no contract, such as a slip of the pen.
    const misnamed = { ...run, extensions: { "org.panaversity.steps": { line: "payment.draft" } } };
    const others = shipped.filter((c) => c.id !== "payment.run");
    expect(runProblems([...others, misnamed])).toStrictEqual([
      "payment.run: its lines are payment.draft, which is not a command with a contract (DSOR-BAT-01a)",
    ]);
  });

  it("DSOR-BAT-01a: C1: start-up refuses per_item, which this step does not build", () => {
    const run = contract("payment.run");
    const partial = { ...run, batch: { atomicity: "per_item", max_items: 50 } };
    const others = [...ruleWorld().registry.contracts.values()].filter((c) => c.id !== run["id"]);
    expect(runProblems([...others, partial])).toStrictEqual([
      'payment.run: the atomicity "per_item" is not built yet (DSOR-BAT-01a)',
    ]);
  });

  it("DSOR-BAT-01a: C1: a run of 51 lines is refused before any bill is read, and no proposal is made", async () => {
    const w = ruleWorld();
    const ids = Array.from({ length: 51 }, (_, i) => `INV-${5001 + i}`);
    const answer = await w.ask(keyed(AGENT), "payment.run", lines(...ids));
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"payment.run" takes at most 50 lines, and this run has 51',
    });
    expect(await w.proposals.all()).toStrictEqual([]);
  });

  it("DSOR-BAT-01a: C1: a run of 50 lines is not refused for its length", async () => {
    const w = ruleWorld();
    const ids = Array.from({ length: 50 }, (_, i) => `INV-${5001 + i}`);
    const answer = await w.ask(keyed(AGENT), "payment.run", lines(...ids));
    expect(saidOf(answer)).not.toBe("VALIDATION_FAILED");
  });

  it("step 41's decision D6: C1: a run that names one bill twice is refused, and no proposal is made", async () => {
    const w = ruleWorld();
    const answer = await w.ask(
      keyed(AGENT),
      "payment.run",
      lines("INV-1002", "INV-1009", "INV-1002"),
    );
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"payment.run" names one invoice on two lines: lines 1 and 3',
    });
    expect(await w.proposals.all()).toStrictEqual([]);
  });
});

describe("C2: each line is its own proposal, with its own key and its own checks", () => {
  it("DSOR-BAT-01b: C2: a run of three lines makes four proposals: the run, and a payment.create proposal for each line, which names its run", async () => {
    const w = ruleWorld();
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_A);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const run = String((answer as { proposal: string }).proposal);
    expect(await proposalAt(w, run)).toMatchObject({ operation: "payment.run@1", payload: RUN_A });
    const kept = await linesOf(w, run);
    expect(kept.map((p) => [p.operation, p.payload, p.run])).toStrictEqual(
      RUN_A.lines.map((line) => ["payment.create@1", line, run]),
    );
    expect(await w.proposals.all()).toHaveLength(4);
  });

  it("DSOR-BAT-01b: C2: each line's key is derived from the run's key and its invoice, and the same run sent again with that key makes no new proposal", async () => {
    const w = ruleWorld();
    const sent = keyed(AGENT, "k-week-42");
    const first = await w.ask(sent, "payment.run", RUN_A);
    const run = String((first as { proposal: string }).proposal);
    const kept = await linesOf(w, run);
    expect(kept.map((p) => p.idempotency_key)).toStrictEqual(
      RUN_A.lines.map((line) => lineKeyOf("k-week-42", line.invoice)),
    );
    expect(new Set(kept.map((p) => p.idempotency_key)).size).toBe(3);
    const again = await w.ask(sent, "payment.run", RUN_A);
    expect(again).toMatchObject({ outcome: "PENDING_APPROVAL", proposal: run });
    expect(await w.proposals.all()).toHaveLength(4);
  });

  it("DSOR-BAT-01b: C2: a line's key is a hash of the run's key and its invoice, so two runs, or two invoices, never share one", () => {
    const one = lineKeyOf("k-week-42", "dsor://org_456/invoice/INV-1002");
    expect(one).toMatch(/^line_[0-9a-f]{64}$/);
    expect(lineKeyOf("k-week-43", "dsor://org_456/invoice/INV-1002")).not.toBe(one);
    expect(lineKeyOf("k-week-42", "dsor://org_456/invoice/INV-1009")).not.toBe(one);
  });

  it("DSOR-BAT-01b: C2: each line's controls are its own: INV-1008's line waits for the CFO's rule, and the other two lines wait READY for their run", async () => {
    const w = ruleWorld();
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_A);
    const run = String((answer as { proposal: string }).proposal);
    const kept = await linesOf(w, run);
    expect(kept.map((p) => p.state)).toStrictEqual(["READY", "PENDING_APPROVAL", "READY"]);
    expect(kept[1]!.requires).toMatchObject([
      { control: "high-value-payment", approval: { role: "CFO", quorum: 1 } },
    ]);
    expect(kept[0]!.requires).toBeUndefined();
    expect(kept[2]!.requires).toBeUndefined();
  });
});

describe("C3: all or nothing", () => {
  it("step 41's decision D2: C3: a line whose vendor is suspended refuses the whole run before anything is drafted, and the answer names the line", async () => {
    const w = ruleWorld();
    w.vendors.find((v) => v.id === "VENDOR-31")!.status = "suspended";
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_B);
    expect(answer).toMatchObject({ message: expect.stringMatching(/^line 3 of "payment\.run": /) });
    expect(w.drafted).toStrictEqual([]);
    expect((await w.proposals.all()).map((p) => p.state)).toStrictEqual(Array(4).fill("DENIED"));
    expect(await w.reservations.all()).toStrictEqual([]);
  });

  it("step 41's decision D2: C3: a run whose lines need no one is drafted at once, every line, in the order of its lines, each with its payment.created", async () => {
    const w = ruleWorld();
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_B);
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    const payments = (answer as { data: { payments: { invoice_id: string }[] } }).data.payments;
    expect(payments.map((p) => p.invoice_id)).toStrictEqual(["INV-1002", "INV-1009", "INV-1006"]);
    expect(w.drafted.map((p) => p.invoice_id)).toStrictEqual(["INV-1002", "INV-1009", "INV-1006"]);
    const events = await w.outbox.events("org_456");
    expect(events.map((e) => e.event.type)).toStrictEqual(Array(3).fill("payment.created"));
    expect((await w.proposals.all()).map((p) => p.state)).toStrictEqual(Array(4).fill("COMMITTED"));
  });
});

describe("C4: the day's limit, against the run's total", () => {
  it("DSOR-BAT-02b: C4: a run whose total would pass the day's limit is refused whole: nothing drafted, nothing booked", async () => {
    const w = ruleWorld();
    const ids = ["INV-3101", "INV-3102", "INV-3103", "INV-3104", "INV-3105"];
    for (const id of ids) bill(w, id, "VENDOR-44", "45000.00");
    const answer = await w.ask(keyed(AGENT), "payment.run", lines(...ids));
    expect(answer).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: '"payment.run" would pass slip del_100\'s limit for one day',
    });
    expect(w.drafted).toStrictEqual([]);
    expect((await w.proposals.all()).map((p) => p.state)).toStrictEqual(Array(6).fill("DENIED"));
    expect(await w.reservations.all()).toStrictEqual([]);
  });

  it("DSOR-BAT-02b: C4: a run that fits books its total once, under the run's id, and no line books", async () => {
    const w = ruleWorld();
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_A);
    const run = String((answer as { proposal: string }).proposal);
    expect(await w.reservations.all()).toMatchObject([
      { proposal: run.split("/").at(-1), amount: { value: "40940.50", currency: "USD" } },
    ]);
  });

  it("DSOR-BAT-02b: C4: the day's room is counted against the whole run: after 170,000 today, three lines of 12,000 are refused, though each would fit alone", async () => {
    const w = ruleWorld();
    for (const id of ["INV-3201", "INV-3202", "INV-3203", "INV-3204"]) {
      bill(w, id, "VENDOR-12", "42500.00");
      expect(await w.draft(id)).toMatchObject({ outcome: "PENDING_APPROVAL" });
    }
    const ids = ["INV-3211", "INV-3212", "INV-3213"];
    for (const id of ids) bill(w, id, "VENDOR-12", "12000.00");
    const answer = await w.ask(keyed(AGENT), "payment.run", lines(...ids));
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("170000.00");
    // Each would fit alone: one single draft of 12,000 is booked.
    expect(await w.draft("INV-3211")).toMatchObject({ outcome: "COMMITTED" });
  });
});

describe("C5: the run keeps what its approval binds to", () => {
  it("DSOR-BAT-02a: C5: the run keeps its fingerprint over its ordered lines, and its totals per currency and per vendor, added up from the bills DSoR read", async () => {
    const w = ruleWorld();
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_A);
    const run = (await proposalAt(w, String((answer as { proposal: string }).proposal)))!;
    expect(run.manifest_hash).toBe(payloadHash(RUN_A.lines));
    expect(run.totals).toStrictEqual([{ value: "40940.50", currency: "USD" }]);
    expect(run.vendor_totals).toStrictEqual([
      { vendor: "dsor://org_456/vendor/VENDOR-31", amount: { value: "640.00", currency: "USD" } },
      { vendor: "dsor://org_456/vendor/VENDOR-44", amount: { value: "40300.50", currency: "USD" } },
    ]);
  });

  it("DSOR-BAT-02a: C5: the same lines in another order have another fingerprint", () => {
    const turned = [...RUN_A.lines].reverse();
    expect(payloadHash(turned)).not.toBe(payloadHash(RUN_A.lines));
  });
});

describe("C6 and C7: a run that waits", () => {
  it("step 41's decision D7: C6: a run waits for the CFO when one of its lines would, and asks what that line asks", async () => {
    const w = ruleWorld();
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_A);
    expect(answer).toMatchObject({
      outcome: "PENDING_APPROVAL",
      requires: [{ control: "high-value-payment", approval: { role: "CFO", quorum: 1 } }],
    });
    expect(w.drafted).toStrictEqual([]);
  });

  it("step 41's decision D5: C7: while a run waits, a single draft of one of its bills is refused with CONFLICT, and no draft is made", async () => {
    const w = ruleWorld();
    await w.ask(keyed(AGENT), "payment.run", RUN_A);
    const alone = await w.draft("INV-1008", SUPERVISOR);
    expect(alone).toMatchObject({ code: "CONFLICT" });
    expect(w.drafted).toStrictEqual([]);
  });
});
