// A payment run, many drafts proposed as one list. Each line keeps its own checks
// and its own record; the day's limit is booked once, for the run's total; the CFO approves the
// list once, with its fingerprint and its totals; and the run drafts every line, or none
// (DSOR-BAT-01a, DSOR-BAT-01b, DSOR-BAT-02a, DSOR-BAT-02b; step 41's README, claims C1 to C8).
import { describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import type { Answer } from "../src/envelope.ts";
import type { Invoice } from "../src/invoice.ts";
import { money } from "../src/money.ts";
import { handlersFor } from "../src/operations.ts";
import { lineKeyOf, runProblems, totalsOf } from "../src/run.ts";
import { ADMIN, AGENT, CFO, contract, keyed, SUPERVISOR, without } from "./helpers.ts";
import {
  ruleCall,
  ruleWorld,
  ruleWorldOnTuesday,
  textOf,
  version9,
  type RuleWorld,
} from "./rule-world.ts";

/** A run's input: one line for each of these bills of org_456, each decided on version 1. */
function lines(...ids: string[]): { lines: { invoice: string; expected_version: number }[] } {
  return {
    lines: ids.map((id) => ({ invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 })),
  };
}

/** A bill of org_456, issued, version 1, added to the world's invoices. */
function bill(w: RuleWorld, id: string, vendor: string, value: string, currency = "USD"): void {
  const amount = money(value, currency);
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

  it("DSOR-BAT-01b: C2: each line's key is derived from the run's company, caller, key, and the line's invoice, and the same run sent again with that key makes no new proposal", async () => {
    const w = ruleWorld();
    const sent = keyed(AGENT, "k-week-42");
    const first = await w.ask(sent, "payment.run", RUN_A);
    const run = String((first as { proposal: string }).proposal);
    const kept = await linesOf(w, run);
    expect(kept.map((p) => p.idempotency_key)).toStrictEqual(
      RUN_A.lines.map((line) =>
        lineKeyOf("org_456", "accounts-payable-fte", "k-week-42", line.invoice),
      ),
    );
    expect(new Set(kept.map((p) => p.idempotency_key)).size).toBe(3);
    const again = await w.ask(sent, "payment.run", RUN_A);
    expect(again).toMatchObject({ outcome: "PENDING_APPROVAL", proposal: run });
    expect(await w.proposals.all()).toHaveLength(4);
  });

  // Changed by the learner's D11, after step 41's review, L2: the company and the caller too, as
  //   the run's own claim is scoped, so two callers' runs with one key never share a line's key.
  it("DSOR-BAT-01b: C2: a line's key is a hash of its company, its caller, the run's key, and its invoice: change any one, and the key changes", () => {
    const INV = "dsor://org_456/invoice/INV-1002";
    const one = lineKeyOf("org_456", "accounts-payable-fte", "k-week-42", INV);
    expect(one).toMatch(/^line_[0-9a-f]{64}$/);
    expect(lineKeyOf("org_456", "accounts-payable-fte", "k-week-43", INV)).not.toBe(one);
    expect(lineKeyOf("org_456", "accounts-payable-fte", "k-week-42", `${INV}0`)).not.toBe(one);
    expect(lineKeyOf("org_456", "intake-fte", "k-week-42", INV)).not.toBe(one);
    expect(lineKeyOf("org_789", "accounts-payable-fte", "k-week-42", INV)).not.toBe(one);
  });

  it("DSOR-BAT-01b: C2: two callers who send the same run with one key get different line keys", async () => {
    /** The line keys of RUN_B, sent by this caller with the key k-same, in a world of its own. */
    const keysOf = async (who: typeof AGENT): Promise<string[]> => {
      const w = ruleWorld();
      const answer = await w.ask(keyed(who, "k-same"), "payment.run", RUN_B);
      const run = String((answer as { proposal: string }).proposal);
      return (await linesOf(w, run)).map((p) => p.idempotency_key);
    };
    const agent = await keysOf(AGENT);
    const person = await keysOf(SUPERVISOR);
    expect(agent).toHaveLength(3);
    expect(agent.filter((k) => person.includes(k))).toStrictEqual([]);
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

describe("C3: an accident keeps nothing of a run", () => {
  // Memory has no transaction, so its claim undoes what an accident left, as the database's
  //   rollback does: every proposal the call made, the run and each line, and the run's booking.
  it("step 41's decision D2: C3: an accident in a run's work leaves no proposal, line or run, and no booking", async () => {
    const broken = {
      ...handlersFor(),
      "payment.create": async (): Promise<never> => {
        throw new Error("a bug in the company's code");
      },
    };
    const u = undefined;
    const w = ruleWorld(u, u, u, u, u, u, u, u, u, broken);
    const answer = await w.ask(keyed(AGENT), "payment.run", RUN_B);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await w.proposals.all()).toStrictEqual([]);
    expect(await w.reservations.all()).toStrictEqual([]);
  });
});

/** Run A, waiting for cfo_100: its URI, and what her screen shows of it. */
async function waitingRunA(w: RuleWorld) {
  const answer = await w.ask(keyed(AGENT), "payment.run", RUN_A);
  const run = (await proposalAt(w, String((answer as { proposal: string }).proposal)))!;
  const shown = {
    proposal: run.uri,
    payload_hash: run.payload_hash,
    manifest_hash: run.manifest_hash,
    totals: run.totals,
    vendor_totals: run.vendor_totals,
  };
  return { run, shown };
}

describe("C5 and C6: one approval, of the list and its totals", () => {
  it("DSOR-BAT-02a: C5: cfo_100 approves the run with its payload hash, its fingerprint, and its totals: the run and the line she was asked about are APPROVED", async () => {
    const w = ruleWorld();
    const { run, shown } = await waitingRunA(w);
    const approval = await w.ask(keyed(CFO), "proposal.approve", shown);
    expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    expect((await proposalAt(w, run.uri))!.state).toBe("APPROVED");
    expect((await linesOf(w, run.uri)).map((p) => p.state)).toStrictEqual([
      "READY",
      "APPROVED",
      "READY",
    ]);
  });

  it.each([
    ["a fingerprint of other lines", { manifest_hash: payloadHash(RUN_B.lines) }],
    ["the totals her screen showed wrong", { totals: [{ value: "39940.50", currency: "USD" }] }],
    [
      "the totals per vendor in another order",
      {
        vendor_totals: [
          {
            vendor: "dsor://org_456/vendor/VENDOR-44",
            amount: { value: "40300.50", currency: "USD" },
          },
          {
            vendor: "dsor://org_456/vendor/VENDOR-31",
            amount: { value: "640.00", currency: "USD" },
          },
        ],
      },
    ],
  ])(
    "DSOR-BAT-02a: C5: an approval with %s is refused with APPROVAL_MISMATCH, and the run still waits",
    async (_what, changed) => {
      const w = ruleWorld();
      const { run, shown } = await waitingRunA(w);
      const approval = await w.ask(keyed(CFO), "proposal.approve", { ...shown, ...changed });
      expect(approval).toMatchObject({ code: "APPROVAL_MISMATCH" });
      expect((await proposalAt(w, run.uri))!.state).toBe("PENDING_APPROVAL");
      expect((await linesOf(w, run.uri))[1]!.state).toBe("PENDING_APPROVAL");
    },
  );

  it("DSOR-BAT-02a: C5: an approval of a run with only its payload hash, as for one draft, is refused with APPROVAL_MISMATCH", async () => {
    const w = ruleWorld();
    const { run, shown } = await waitingRunA(w);
    const { proposal, payload_hash } = shown;
    const approval = await w.ask(keyed(CFO), "proposal.approve", { proposal, payload_hash });
    expect(approval).toMatchObject({ code: "APPROVAL_MISMATCH" });
    expect((await proposalAt(w, run.uri))!.state).toBe("PENDING_APPROVAL");
  });

  it("DSOR-BAT-02a: C5: an approval of one draft that carries a fingerprint is refused: one draft is no run", async () => {
    const w = ruleWorld();
    const answer = await w.draft("INV-1008");
    const uri = String((answer as { proposal: string }).proposal);
    const draft = (await proposalAt(w, uri))!;
    const approval = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: uri,
      payload_hash: draft.payload_hash,
      manifest_hash: draft.payload_hash,
      totals: [],
      vendor_totals: [],
    });
    expect(approval).toMatchObject({ code: "APPROVAL_MISMATCH" });
    expect((await proposalAt(w, uri))!.state).toBe("PENDING_APPROVAL");
  });

  it("step 41's decision D7: C6: a line is never approved alone: cfo_100's approval of INV-1008's line is refused, and it still waits", async () => {
    const w = ruleWorld();
    const { run } = await waitingRunA(w);
    const line = (await linesOf(w, run.uri))[1]!;
    const approval = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: line.uri,
      payload_hash: line.payload_hash,
    });
    expect(approval).toMatchObject({ code: "CONFLICT" });
    expect((await proposalAt(w, line.uri))!.state).toBe("PENDING_APPROVAL");
  });
});

/** Run A, approved by cfo_100: its URI. */
async function approvedRunA(w: RuleWorld): Promise<string> {
  const { run, shown } = await waitingRunA(w);
  const approval = await w.ask(keyed(CFO), "proposal.approve", shown);
  expect(approval).toMatchObject({ data: { state: "APPROVED" } });
  return run.uri;
}

/** The states of a run and of its lines, the run first. */
async function statesOf(w: RuleWorld, run: string): Promise<string[]> {
  const lines = await linesOf(w, run);
  return [(await proposalAt(w, run))!.state, ...lines.map((p) => p.state)];
}

describe("C8: the release, all or nothing again", () => {
  it("step 41's decision D2: C8: the agent releases the approved run: every line is drafted, in the order of its lines, each with its payment.created, and all are COMMITTED", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({ outcome: "COMMITTED" });
    const payments = (released as { data: { payments: { invoice_id: string }[] } }).data.payments;
    expect(payments.map((p) => p.invoice_id)).toStrictEqual(["INV-1002", "INV-1008", "INV-1006"]);
    expect(w.drafted.map((p) => p.invoice_id)).toStrictEqual(["INV-1002", "INV-1008", "INV-1006"]);
    const created = (await w.outbox.events("org_456")).filter(
      (e) => e.event.type === "payment.created",
    );
    expect(created).toHaveLength(3);
    expect(await statesOf(w, run)).toStrictEqual(Array(4).fill("COMMITTED"));
    expect(await w.reservations.all()).toMatchObject([{ state: "committed" }]);
  });

  it("step 41's decision D2: C8: a run prepared in propose_only mode, whose lines asked for no one, is released whole", async () => {
    const w = ruleWorld();
    const prepared = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.run", RUN_B);
    expect(prepared).toMatchObject({ outcome: "READY" });
    const run = String((prepared as { proposal: string }).proposal);
    expect(await statesOf(w, run)).toStrictEqual(Array(4).fill("READY"));
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({ outcome: "COMMITTED" });
    expect(w.drafted).toHaveLength(3);
    expect(await statesOf(w, run)).toStrictEqual(Array(4).fill("COMMITTED"));
  });

  it("step 41's decision D2: C8: a vendor suspended after the approval voids the whole run at its release: nothing drafted, every line INVALIDATED, the booking given back", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    w.vendors.find((v) => v.id === "VENDOR-31")!.status = "suspended";
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: expect.stringMatching(/line 3 of "payment\.run"/),
    });
    expect(w.drafted).toStrictEqual([]);
    expect(await statesOf(w, run)).toStrictEqual(Array(4).fill("INVALIDATED"));
    expect(await w.reservations.all()).toMatchObject([{ state: "released" }]);
  });

  it("DSOR-BAT-02a: C8: a bill corrected after the approval, to a new version, voids the run at its release", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    const bill1002 = w.bills.find((b) => b.id === "INV-1002")!;
    bill1002.amount = money("9900.50", "USD");
    bill1002.open_amount = money("9900.50", "USD");
    bill1002.version = 2;
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect(w.drafted).toStrictEqual([]);
    expect(await statesOf(w, run)).toStrictEqual(Array(4).fill("INVALIDATED"));
  });

  it("DSOR-BAT-02a: C8: a bill whose amount changed with no new version still voids the run: its totals are added up again from the bills, and no longer match", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    const bill1006 = w.bills.find((b) => b.id === "INV-1006")!;
    bill1006.open_amount = money("6400.00", "USD");
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: expect.stringMatching(/totals/),
    });
    expect(w.drafted).toStrictEqual([]);
  });

  it("step 41's decision D7: C6: a line is never released alone: the agent's release of a line that waits READY is refused, and it still waits", async () => {
    const w = ruleWorld();
    const { run } = await waitingRunA(w);
    const line = (await linesOf(w, run.uri))[0]!;
    expect(line.state).toBe("READY");
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: line.uri });
    expect(released).toMatchObject({ code: "CONFLICT" });
    expect((await proposalAt(w, line.uri))!.state).toBe("READY");
    expect(w.drafted).toStrictEqual([]);
  });
});

// Found by step 41's review, H3: an amount with six decimal places, as a conversion makes, lost its
//   whole fraction when added, so a run with a line in another currency was refused as past the
//   day's limit, far below it.
describe("step 41's review, H3: amounts added exactly, six decimal places too", () => {
  it("DSOR-BAT-02b: H3: totals keep the fraction of an amount with six decimal places", () => {
    const vendor = "dsor://org_456/vendor/VENDOR-44";
    const { totals } = totalsOf([
      { spends: money("27300.123457", "USD"), vendor },
      { spends: money("100.00", "USD"), vendor },
    ]);
    expect(totals).toStrictEqual([{ value: "27400.123457", currency: "USD" }]);
    expect(totalsOf([{ spends: money("1.000001", "USD"), vendor }]).totals).toStrictEqual([
      { value: "1.000001", currency: "USD" },
    ]);
  });

  it("DSOR-BAT-02b: H3: a run with a line of 100.00 GBP is booked by its converted total, and drafted, as each line alone would be", async () => {
    const w = await ruleWorldOnTuesday();
    bill(w, "INV-3301", "VENDOR-44", "100.00", "GBP");
    const answer = await w.ask(keyed(AGENT), "payment.run", lines("INV-3301", "INV-1002"));
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect(w.drafted.map((p) => p.invoice_id)).toStrictEqual(["INV-3301", "INV-1002"]);
    const [booking] = await w.reservations.all();
    expect(booking!.amount.currency).toBe("USD");
    expect(Number(booking!.amount.value)).toBeGreaterThan(9000);
    expect(Number(booking!.amount.value)).toBeLessThan(9100);
  });
});

// Found by step 41's review, H1 and H2: a dry run of a run checked none of its lines and said ALLOW,
//   and every dry release of a run was INTERNAL_ERROR. A dry run hears what the real call would, and
//   changes nothing (DSOR-OPR-05, DSOR-OPR-06).
describe("step 41's review, H1 and H2: a dry run of a run, and of its release", () => {
  const DRY = { ...AGENT, mode: "validate_only" as const };

  it("DSOR-BAT-01b: H1: a dry run of a run that a line's rule asks about hears REQUIRE_APPROVAL, and makes nothing", async () => {
    const w = ruleWorld();
    const answer = await w.ask(DRY, "payment.run", RUN_A);
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "REQUIRE_APPROVAL" });
    expect(await w.proposals.all()).toStrictEqual([]);
    expect(await w.reservations.all()).toStrictEqual([]);
  });

  it("DSOR-BAT-01b: H1: a dry run of small lines hears ALLOW", async () => {
    const w = ruleWorld();
    const answer = await w.ask(DRY, "payment.run", RUN_B);
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
  });

  it("DSOR-BAT-01b: H1: a dry run with a suspended vendor's line, or a bill that is not there, is refused as the real run is, naming the line", async () => {
    const w = ruleWorld();
    w.vendors.find((v) => v.id === "VENDOR-31")!.status = "suspended";
    const suspended = await w.ask(DRY, "payment.run", RUN_B);
    expect(suspended).toMatchObject({
      message: expect.stringMatching(/^line 3 of "payment\.run": /),
    });
    const real = await w.ask(keyed(AGENT), "payment.run", RUN_B);
    expect((suspended as { code: string }).code).toBe((real as { code: string }).code);
    const missing = await w.ask(DRY, "payment.run", lines("INV-1002", "INV-9999"));
    expect(missing).toMatchObject({
      message: expect.stringMatching(/^line 2 of "payment\.run": /),
    });
  });

  it("DSOR-BAT-02b: H1: a dry run whose total would pass the day's limit hears LIMIT_EXCEEDED, and books nothing", async () => {
    const w = ruleWorld();
    const ids = ["INV-3101", "INV-3102", "INV-3103", "INV-3104", "INV-3105"];
    for (const id of ids) bill(w, id, "VENDOR-44", "45000.00");
    const answer = await w.ask(DRY, "payment.run", lines(...ids));
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await w.reservations.all()).toStrictEqual([]);
  });

  it("DSOR-BAT-02a: H2: a dry release of an approved run hears ALLOW, and moves nothing", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    const answer = await w.ask(DRY, "proposal.execute", { proposal: run });
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    expect(await statesOf(w, run)).toStrictEqual(["APPROVED", "READY", "APPROVED", "READY"]);
    expect(w.drafted).toStrictEqual([]);
  });

  it("DSOR-BAT-02a: H2: a dry release of an approved run whose vendor was suspended says it would be invalidated, and moves nothing", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    w.vendors.find((v) => v.id === "VENDOR-31")!.status = "suspended";
    const answer = await w.ask(DRY, "proposal.execute", { proposal: run });
    expect(answer).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect(await statesOf(w, run)).toStrictEqual(["APPROVED", "READY", "APPROVED", "READY"]);
  });
});

// Found by step 41's review, M1: a sheet of rates that went stale between the approval and the
//   release voided an approved run, where one draft waits for a fresh sheet (step 31's README,
//   decision D15). A check that cannot be made now is not a no.
describe("step 41's review, M1: no usable rate at the release is not a no", () => {
  it("DSOR-BAT-02b: M1: four days after the approval, with no fresh sheet, the release waits: FRESHNESS_UNSATISFIABLE, the run and its lines still waiting, the booking held", async () => {
    const w = await ruleWorldOnTuesday();
    bill(w, "INV-3301", "VENDOR-44", "790.00", "GBP");
    const answer = await w.ask(keyed(AGENT), "payment.run", lines("INV-3301", "INV-1008"));
    const run = (await proposalAt(w, String((answer as { proposal: string }).proposal)))!;
    const { uri, payload_hash, manifest_hash, totals, vendor_totals } = run;
    const shown = { proposal: uri, payload_hash, manifest_hash, totals, vendor_totals };
    expect(await w.ask(keyed(CFO), "proposal.approve", shown)).toMatchObject({
      data: { state: "APPROVED" },
    });
    w.clock.now += 4 * 24 * 60 * 60 * 1000;
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri });
    expect(released).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(await statesOf(w, uri)).toStrictEqual(["APPROVED", "READY", "APPROVED"]);
    expect(await w.reservations.all()).toMatchObject([{ state: "held" }]);
    expect(w.drafted).toStrictEqual([]);
  });
});

// Found by step 41's review, M2: two runs over the same bills, in opposite orders, each took the
//   first bill's lock and waited for the other's. On the database one was killed as a deadlock; in
//   memory both waited for ever.
describe("step 41's review, M2: two runs over the same bills at once", () => {
  it("DSOR-BAT-01b: M2: two runs of INV-1002 and INV-1009, in opposite orders, at once: both end, and neither is an accident", async () => {
    const w = ruleWorld();
    const both = Promise.all([
      w.ask(keyed(AGENT), "payment.run", lines("INV-1002", "INV-1009")),
      w.ask(keyed(AGENT), "payment.run", lines("INV-1009", "INV-1002")),
    ]);
    const timeout = new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 2000));
    const ended = await Promise.race([both, timeout]);
    expect(ended).not.toBe("stuck");
    for (const answer of ended as Answer[]) expect(saidOf(answer)).not.toBe("INTERNAL_ERROR");
  });
});

// Found by step 41's review, M3: a run's approval bound no state: the run's contract binds nothing,
//   so its approval kept no version, where one draft's keeps its invoice's and its vendor's
//   (DSOR-APR-02a).
describe("step 41's review, M3: a run's approval binds every line's state", () => {
  it("DSOR-BAT-02a: M3: the approval of a run keeps the version of each line's invoice and vendor", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    const [approval] = await w.proposals.approvals("org_456", run.split("/").at(-1)!);
    expect(approval!.bound_state.versions).toStrictEqual({
      "dsor://org_456/invoice/INV-1002": 1,
      "dsor://org_456/invoice/INV-1006": 1,
      "dsor://org_456/invoice/INV-1008": 1,
      "dsor://org_456/vendor/VENDOR-31": 1,
      "dsor://org_456/vendor/VENDOR-44": 1,
    });
  });
});

// Found by step 41's review, M4: breaks that left every test green. Each clause now has a test that
//   needs it.
describe("step 41's review, M4: each clause has a test that needs it", () => {
  it("DSOR-BAT-01b: M4: a line above the limit for one payment refuses the whole run, naming the line (U1)", async () => {
    const w = ruleWorld();
    bill(w, "INV-3401", "VENDOR-12", "60000.00");
    const answer = await w.ask(keyed(AGENT), "payment.run", lines("INV-1002", "INV-3401"));
    expect(answer).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message:
        'line 2 of "payment.run": "payment.create" would pass slip del_100\'s limit for one payment',
    });
    expect((await w.proposals.all()).map((p) => p.state)).toStrictEqual(Array(3).fill("DENIED"));
  });

  it("DSOR-APR-03c: M4: a rule switched on after the approval asks one line for another approver: the release voids the run (U2, U9)", async () => {
    const w = await ruleWorldOnTuesday();
    const run = await approvedRunA(w);
    const rule = "dsor://org_456/rule/admin-above-30000";
    const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });
    const text = {
      ...textOf(version9()),
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      authority: { system: "local", rule: "admin-above-30000" },
      owner: "admin_100",
      tests: [
        { state: usd("30000.00"), expect: "ALLOW" },
        { state: usd("30000.01"), expect: "REQUIRE_APPROVAL" },
      ],
    };
    expect(await ruleCall(w, ADMIN, "rule.draft", { draft: text }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { status: "active" },
    });
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: expect.stringMatching(/APPROVAL_REQUIRED: admin-above-30000/),
    });
    expect(w.drafted).toStrictEqual([]);
  });

  it("DSOR-BAT-02a: M4: one vendor's lines in two currencies keep a total per vendor in each currency (U5)", async () => {
    const w = await ruleWorldOnTuesday();
    bill(w, "INV-3301", "VENDOR-44", "100.00", "GBP");
    const answer = await w.ask(
      { ...keyed(AGENT), mode: "propose_only" },
      "payment.run",
      lines("INV-1002", "INV-3301"),
    );
    const run = (await proposalAt(w, String((answer as { proposal: string }).proposal)))!;
    expect(run.vendor_totals).toStrictEqual([
      { vendor: "dsor://org_456/vendor/VENDOR-44", amount: { value: "100.00", currency: "GBP" } },
      { vendor: "dsor://org_456/vendor/VENDOR-44", amount: { value: "8900.50", currency: "USD" } },
    ]);
    expect(run.totals).toStrictEqual([
      { value: "100.00", currency: "GBP" },
      { value: "8900.50", currency: "USD" },
    ]);
  });

  it("DSOR-BAT-02a: M4: a bill moved to another vendor after the approval, its amount the same, voids the run: the totals per vendor are added up again (U21)", async () => {
    const w = ruleWorld();
    const run = await approvedRunA(w);
    w.bills.find((b) => b.id === "INV-1006")!.vendor_id = "VENDOR-44";
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: expect.stringMatching(/totals/),
    });
    expect(w.drafted).toStrictEqual([]);
  });
});

// Found by step 41's review, L1: memory's claim undid only the proposals an accident's call made, so
//   after an accident at a release the run went back to APPROVED and its lines stayed EXECUTING,
//   each holding its invoice.
describe("step 41's review, L1: an accident at a release keeps nothing of it", () => {
  it("step 41's decision D2: L1: an accident on a run's third line at its release leaves the run and every line as they waited", async () => {
    const shipped = handlersFor();
    const create = shipped["payment.create"]!;
    let broken = false;
    const code = {
      ...shipped,
      "payment.create": async (input: unknown, company: Parameters<typeof create>[1]) => {
        if (broken && (input as { invoice: string }).invoice.endsWith("INV-1006")) {
          throw new Error("a bug in the company's code");
        }
        return create(input, company);
      },
    };
    const u = undefined;
    const w = ruleWorld(u, u, u, u, u, u, u, u, u, code);
    const run = await approvedRunA(w);
    broken = true;
    const released = await w.ask(keyed(AGENT), "proposal.execute", { proposal: run });
    expect(released).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await statesOf(w, run)).toStrictEqual(["APPROVED", "READY", "APPROVED", "READY"]);
  });
});
