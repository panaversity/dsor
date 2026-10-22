// NEW IN STEP 41: a payment run on the database (DSOR-BAT-01b, DSOR-BAT-02a, DSOR-BAT-02b; step 41's
// README, claims C2 to C8). intake-fte proposes runs under del_190, with the story's limits of
// 50,000 USD a payment and 200,000 USD a day, over the tests' own bills, INV-9411 to INV-9418, which
// test/owner-run-bills.ts adds. The CFO's rule is the shipped one: above 25,000 USD. A real
// PostgreSQL, never a mock.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import { readControls } from "../src/controls.ts";
import { Refusal, type Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { Handler, Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memoryControls } from "../src/rulebook.ts";
import { lineKeyOf } from "../src/run.ts";
import {
  dbRegistry,
  newPool,
  ownerAttempts,
  ownerInvoices,
  ownerLimits,
  ownerRunBills,
  ownerRuns,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, withPlanted } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
/** A registry on the database with this code, and the shipped CFO's rule. */
function registryWith(code: Record<string, Handler> = handlersFor()): Registry {
  const rules = memoryControls(readControls());
  return dbRegistry(pool, storyDirectories(), code, ownWorkFor(), readLifetimes(), rules);
}
const registry = registryWith();
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;

beforeEach(() => {
  ownerAttempts();
  ownerLimits("add");
  ownerRunBills("add");
});
afterAll(async () => {
  ownerAttempts();
  ownerRunBills("remove");
  ownerLimits("remove");
  await pool.end();
});

/** A run's input: one line for each of these bills, each decided on version 1. */
function linesOf(...ids: string[]): { lines: { invoice: string; expected_version: number }[] } {
  return {
    lines: ids.map((id) => ({ invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 })),
  };
}

/** intake-fte calls this operation, with this key, on the given registry. */
function asIntake(
  name: string,
  input: unknown,
  key?: string,
  on: Registry = registry,
): Promise<Answer> {
  return withPlanted("tok_intake", intake, () =>
    call(on, log, key === undefined ? keyed(INTAKE) : keyed(INTAKE, key), name, input),
  );
}

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String((answer as { proposal?: string }).proposal ?? "")
    .split("/")
    .at(-1)!;
}

/** The states of a run and of its lines, the run first, the lines in the order of the run's. */
async function statesOf(run: string): Promise<string[]> {
  const kept = (await proposals.get("org_456", run))!;
  const lines = await proposals.lines("org_456", kept.uri);
  const order = (kept.payload as { lines: { invoice: string }[] }).lines.map((l) => l.invoice);
  const states = order.map((invoice) => lines.find((l) => l.invoice === invoice)?.state);
  return [kept.state, ...states.map(String)];
}

/** The payments drafted for these bills, as the database holds them. */
async function draftsOf(...ids: string[]): Promise<string[]> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT invoice_id FROM app.payments WHERE invoice_id = ANY ($1::text[]) ORDER BY invoice_id",
    "org_456",
    [ids],
  );
  return rows.map((row) => String(row["invoice_id"]));
}

/** The run's booking, as dsor.reservations holds it. */
async function bookingOf(run: string): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT amount_value::text AS value, amount_currency AS currency, state
       FROM dsor.reservations WHERE proposal_id = $1`,
    "org_456",
    [run],
  );
  return rows;
}

describe("C2 to C4: a run, proposed on the database", () => {
  it("DSOR-BAT-01b: C2: a run of three lines keeps four proposals: each line a payment.create proposal naming its run, with the key derived from the run's company, caller, key, and the line's invoice", async () => {
    const input = linesOf("INV-9411", "INV-9412", "INV-9413");
    // A key of this test run's own: the database keeps every claim, so a fixed key would replay a
    //   run an earlier test run made.
    const key = `k-run-41-c2-${randomUUID()}`;
    const answer = await asIntake("payment.run", input, key);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const run = (await proposals.get("org_456", idOf(answer)))!;
    expect(run).toMatchObject({
      operation: "payment.run@1",
      manifest_hash: payloadHash(input.lines),
    });
    const lines = await proposals.lines("org_456", run.uri);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const kept = (await proposals.get("org_456", line.id))!;
      expect(kept).toMatchObject({
        operation: "payment.create@1",
        run: run.uri,
        idempotency_key: lineKeyOf("org_456", "intake-fte", key, line.invoice),
      });
    }
    expect(await statesOf(run.uri.split("/").at(-1)!)).toStrictEqual([
      "PENDING_APPROVAL",
      "READY",
      "PENDING_APPROVAL",
      "READY",
    ]);
  });

  it("DSOR-BAT-02b: C4: a run that fits books its total once, under the run's id, and keeps its totals", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412", "INV-9413"));
    const run = idOf(answer);
    expect(await bookingOf(run)).toStrictEqual([
      { value: "40940.50", currency: "USD", state: "held" },
    ]);
    const kept = (await proposals.get("org_456", run))!;
    expect(kept.totals).toStrictEqual([{ value: "40940.50", currency: "USD" }]);
    expect(kept.vendor_totals).toStrictEqual([
      { vendor: "dsor://org_456/vendor/VENDOR-31", amount: { value: "640.00", currency: "USD" } },
      { vendor: "dsor://org_456/vendor/VENDOR-44", amount: { value: "40300.50", currency: "USD" } },
    ]);
  });

  it("DSOR-BAT-02b: C4: a run whose total would pass the day's limit is refused whole: every proposal DENIED, no booking, no draft", async () => {
    const ids = ["INV-9414", "INV-9415", "INV-9416", "INV-9417", "INV-9418"];
    const answer = await asIntake("payment.run", linesOf(...ids));
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
    const run = idOf(answer);
    expect(await statesOf(run)).toStrictEqual(Array(6).fill("DENIED"));
    expect(await bookingOf(run)).toStrictEqual([]);
    expect(await draftsOf(...ids)).toStrictEqual([]);
  });

  it("step 41's decision D2: C3: a run whose lines need no one is drafted at once, every line, in one transaction", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9413"));
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect(await draftsOf("INV-9411", "INV-9413")).toStrictEqual(["INV-9411", "INV-9413"]);
    expect(await statesOf(idOf(answer))).toStrictEqual(Array(3).fill("COMMITTED"));
  });

  it("step 41's decision D2: C3: when the code refuses the second line, the first line's draft is undone with it: nothing is drafted", async () => {
    const shipped = handlersFor();
    const create = shipped["payment.create"]!;
    const refusing = registryWith({
      ...shipped,
      "payment.create": async (input, company) => {
        if ((input as { invoice: string }).invoice.endsWith("INV-9413")) {
          throw new Refusal("CONFLICT", "the accounts system refuses INV-9413 now", "internal");
        }
        return create(input, company);
      },
    });
    const ids = ["INV-9411", "INV-9413"];
    const answer = await asIntake("payment.run", linesOf(...ids), undefined, refusing);
    expect(answer).toMatchObject({ code: "CONFLICT" });
    expect(await draftsOf(...ids)).toStrictEqual([]);
    expect(await statesOf(idOf(answer))).toStrictEqual(Array(3).fill("FAILED"));
  });

  it("step 41's decision D5: C7: while a run waits, its line holds its invoice: a single draft of it is refused with CONFLICT", async () => {
    await asIntake("payment.run", linesOf("INV-9411", "INV-9412"));
    const alone = await asIntake("payment.create", linesOf("INV-9411").lines[0]);
    expect(alone).toMatchObject({ code: "CONFLICT" });
    expect(await draftsOf("INV-9411")).toStrictEqual([]);
  });
});

describe("C5 and C8: one approval, then the release", () => {
  /** A run of INV-9411, INV-9412, and INV-9413, waiting for cfo_100, and what her screen shows. */
  async function waiting() {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412", "INV-9413"));
    const run = (await proposals.get("org_456", idOf(answer)))!;
    const { uri, payload_hash, manifest_hash, totals, vendor_totals } = run;
    return { run, shown: { proposal: uri, payload_hash, manifest_hash, totals, vendor_totals } };
  }

  it("DSOR-BAT-02a: C5: totals the CFO's screen showed wrong are refused with APPROVAL_MISMATCH, and the run still waits", async () => {
    const { run, shown } = await waiting();
    const wrong = { ...shown, totals: [{ value: "39940.50", currency: "USD" }] };
    const approval = await call(registry, log, keyed(CFO), "proposal.approve", wrong);
    expect(approval).toMatchObject({ code: "APPROVAL_MISMATCH" });
    expect((await proposals.get("org_456", idOf({ proposal: run.uri } as Answer)))!.state).toBe(
      "PENDING_APPROVAL",
    );
  });

  it("DSOR-BAT-02a: C8: cfo_100 approves the run, and its release drafts every line in one transaction: all COMMITTED, the booking kept", async () => {
    const { run, shown } = await waiting();
    const approval = await call(registry, log, keyed(CFO), "proposal.approve", shown);
    expect(approval).toMatchObject({ data: { state: "APPROVED" } });
    const released = await asIntake("proposal.execute", { proposal: run.uri });
    expect(released).toMatchObject({ outcome: "COMMITTED" });
    expect(await draftsOf("INV-9411", "INV-9412", "INV-9413")).toStrictEqual([
      "INV-9411",
      "INV-9412",
      "INV-9413",
    ]);
    const id = run.uri.split("/").at(-1)!;
    expect(await statesOf(id)).toStrictEqual(Array(4).fill("COMMITTED"));
    expect(await bookingOf(id)).toMatchObject([{ state: "committed" }]);
  });

  it("step 41's decision D2: C8: a vendor suspended after the approval voids the run at its release: every line INVALIDATED, nothing drafted, the booking given back", async () => {
    const { run, shown } = await waiting();
    await call(registry, log, keyed(CFO), "proposal.approve", shown);
    ownerInvoices("vendor", "VENDOR-31", "suspended");
    try {
      const released = await asIntake("proposal.execute", { proposal: run.uri });
      expect(released).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    } finally {
      ownerInvoices("vendor", "VENDOR-31", "approved");
    }
    const id = run.uri.split("/").at(-1)!;
    expect(await statesOf(id)).toStrictEqual(Array(4).fill("INVALIDATED"));
    expect(await draftsOf("INV-9411", "INV-9412", "INV-9413")).toStrictEqual([]);
    expect(await bookingOf(id)).toMatchObject([{ state: "released" }]);
  });
});

describe("C5: the database keeps what a run's approval binds to", () => {
  it("DSOR-BAT-02a: C5: dsor_runtime cannot change a run's totals once written, nor a line's run, nor a run's fingerprint", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"));
    const run = (await proposals.get("org_456", idOf(answer)))!;
    const id = run.uri.split("/").at(-1)!;
    const [line] = await proposals.lines("org_456", run.uri);
    const tries: [string, unknown[]][] = [
      ["UPDATE dsor.proposals SET totals = '[]'::jsonb WHERE id = $1", [id]],
      ["UPDATE dsor.proposals SET vendor_totals = '[]'::jsonb WHERE id = $1", [id]],
      ["UPDATE dsor.proposals SET manifest_hash = $2 WHERE id = $1", [id, payloadHash([])]],
      ["UPDATE dsor.proposals SET run = NULL WHERE id = $1", [line!.id]],
    ];
    for (const [sql, values] of tries) {
      await expect(tryThenRollBack(pool, sql, "org_456", values)).rejects.toThrow();
    }
    expect((await proposals.get("org_456", id))!.totals).toStrictEqual(run.totals);
  });
});

// Found by step 41's own breaks, B11 to B13: the trigger's three rules of a run had no test that
//   needed them. dsor_runtime's privileges refused first, or its move check did.
describe("C5: the trigger keeps a run's rules, for every login", () => {
  /** A run of INV-9411 and INV-9412, waiting for the CFO: its id, its URI, and one line's id. */
  async function waitingRun() {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"));
    const run = (await proposals.get("org_456", idOf(answer)))!;
    const [line] = await proposals.lines("org_456", run.uri);
    return { id: run.uri.split("/").at(-1)!, uri: run.uri, line: line!.id };
  }

  it("DSOR-BAT-02a: C5: a run's totals change with no move either: dsor_runtime's move of a waiting run that also rewrites them is refused", async () => {
    const { id } = await waitingRun();
    for (const column of ["totals", "vendor_totals"]) {
      const sql = `UPDATE dsor.proposals SET state = 'CANCELLED', ${column} = '[]'::jsonb WHERE id = $1`;
      await expect(tryThenRollBack(pool, sql, "org_456", [id])).rejects.toThrow(
        /a run's totals are written once, when it starts to wait/,
      );
    }
  });

  it("DSOR-BAT-01b: C5: the owner cannot take a line from its run, nor change a run's fingerprint", async () => {
    const { id, line } = await waitingRun();
    const unlinked = ownerRuns("unlink", line) as { said: string };
    expect(unlinked.said).toMatch(/only the state of a proposal changes/);
    const changed = ownerRuns("refingerprint", id) as { said: string };
    expect(changed.said).toMatch(/only the state of a proposal changes/);
  });

  it("DSOR-BAT-01b: C5: dsor_runtime cannot add a line to a run that waits, to a draft that is no run, or to a run that is not there", async () => {
    const { uri, line } = await waitingRun();
    const single = await asIntake("payment.create", linesOf("INV-9413").lines[0]);
    const draft = String((single as { proposal?: string }).proposal);
    const missing = "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000041";
    const add = `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload,
                   payload_hash, resources, requester, idempotency_key, expires_at, run)
                 SELECT tenant_id, 'prop_' || gen_random_uuid(), operation, mode, 'PROPOSED', payload,
                        payload_hash, resources, requester, 'line_added', expires_at, $2
                   FROM dsor.proposals WHERE id = $1`;
    for (const run of [uri, draft, missing]) {
      await expect(tryThenRollBack(pool, add, "org_456", [line, run])).rejects.toThrow(
        /a line is made only with its run/,
      );
    }
  });
});

// Found by step 41's review, M2: on the database, two runs over the same bills in opposite orders
//   could each take one bill's lock and wait for the other's, and PostgreSQL killed one as a
//   deadlock: INTERNAL_ERROR.
describe("step 41's review, M2: runs over the same bills at once, on the database", () => {
  it("DSOR-BAT-01b: M2: six pairs of runs of INV-9411 and INV-9413, in opposite orders, at once: none is an accident", async () => {
    const said: string[] = [];
    for (let pair = 0; pair < 6; pair++) {
      const answers = await Promise.all([
        asIntake("payment.run", linesOf("INV-9411", "INV-9413")),
        asIntake("payment.run", linesOf("INV-9413", "INV-9411")),
      ]);
      for (const answer of answers) {
        said.push("code" in answer ? answer.code : String((answer as { outcome: string }).outcome));
      }
    }
    expect(said).not.toContain("INTERNAL_ERROR");
  });
});

// Found by step 41's review, M4: no test sent two runs over one waiting bill at once (U6), and none
//   needed a line's own key in the database, proposals_one_attempt (U7).
describe("step 41's review, M4: a waiting line's bill, held on the database", () => {
  it("DSOR-BAT-01b: M4: two runs over INV-9412 at once: one waits for the CFO, the other hears CONFLICT, never an accident (U6)", async () => {
    const answers = await Promise.all([
      asIntake("payment.run", linesOf("INV-9412")),
      asIntake("payment.run", linesOf("INV-9412", "INV-9411")),
    ]);
    const said = answers.map((a) => ("code" in a ? a.code : (a as { outcome: string }).outcome));
    expect(said.sort()).toStrictEqual(["CONFLICT", "PENDING_APPROVAL"]);
  });

  it("DSOR-BAT-01b: M4: the database's own key keeps a second attempt at a waiting line's bill out of flight (U7)", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9412"));
    const run = (await proposals.get("org_456", idOf(answer)))!;
    const [line] = await proposals.lines("org_456", run.uri);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload, payload_hash,
                                     resources, requester, idempotency_key, expires_at, exclusive_over)
         SELECT tenant_id, 'prop_' || gen_random_uuid(), operation, mode, 'PROPOSED', payload,
                payload_hash, resources, requester, 'second-attempt', expires_at, $2
           FROM dsor.proposals WHERE id = $1 RETURNING id`,
        [line!.id, "dsor://org_456/invoice/INV-9412"],
      );
      await expect(
        client.query("UPDATE dsor.proposals SET state = 'READY' WHERE id = $1", [rows[0]!.id]),
      ).rejects.toThrow(/proposals_one_attempt/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

// The learner's D12, after step 41's review, L3: the database moves a line only with its run. As
//   dsor_runtime, raw SQL could approve a waiting line, or start one, by itself.
describe("step 41's decision D12: a line moves with its run, on the database", () => {
  it("step 41's decision D12: dsor_runtime cannot approve a waiting line, nor start a READY one, while its run waits", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"));
    const run = (await proposals.get("org_456", idOf(answer)))!;
    const lines = await proposals.lines("org_456", run.uri);
    const waiting = lines.find((l) => l.state === "PENDING_APPROVAL")!;
    const ready = lines.find((l) => l.state === "READY")!;
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.proposals SET state = 'APPROVED' WHERE id = $1",
        "org_456",
        [waiting.id],
      ),
    ).rejects.toThrow(/a line moves to APPROVED only with its run/);
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.proposals SET state = 'EXECUTING' WHERE id = $1",
        "org_456",
        [ready.id],
      ),
    ).rejects.toThrow(/a line moves to EXECUTING only with its run/);
  });

  it("step 41's decision D12: a run that needs no one still drafts at once: its lines start after the run", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9413"));
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect(await statesOf(idOf(answer))).toStrictEqual(Array(3).fill("COMMITTED"));
  });
});

// Found by step 41's review, L4: two of the trigger's rules of a run's totals had no test that
//   needed them. The CHECKs proposals_run_of_company and proposals_totals_of_run stay untested: the
//   trigger refuses every row they would, first, for every login.
describe("step 41's review, L4: a run's totals, from its start", () => {
  it("DSOR-BAT-02a: L4: dsor_runtime cannot move a run to wait without its totals", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"));
    const run = (await proposals.get("org_456", idOf(answer)))!;
    const sql = `WITH made AS (
                   INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload,
                     payload_hash, resources, requester, idempotency_key, expires_at, manifest_hash)
                   SELECT tenant_id, 'prop_' || gen_random_uuid(), operation, mode, 'PROPOSED',
                          payload, payload_hash, resources, requester, 'no-totals', expires_at,
                          manifest_hash
                     FROM dsor.proposals WHERE id = $1 RETURNING id)
                 SELECT id FROM made`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      const { rows } = await client.query<{ id: string }>(sql, [run.uri.split("/").at(-1)]);
      await expect(
        client.query("UPDATE dsor.proposals SET state = 'READY' WHERE id = $1", [rows[0]!.id]),
      ).rejects.toThrow(/a run that waits keeps its totals/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("DSOR-BAT-02a: L4: the owner cannot add a run whose totals are written before it waits", async () => {
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"));
    const id = idOf(answer);
    const born = ownerRuns("born-with-totals", id) as { said: string };
    expect(born.said).toMatch(/a run starts with no totals/);
  });
});
