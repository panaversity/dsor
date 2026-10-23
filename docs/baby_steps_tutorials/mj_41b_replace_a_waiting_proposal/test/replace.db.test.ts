// NEW IN STEP 41b: a new proposal that replaces a waiting one, on the database (DSOR-APR-12;
//   step 41b's README, claims C1 to C9). intake-fte proposes under del_190, with the story's limits
//   of 50,000 USD a payment and 200,000 USD a day, over the bills of test/owner-run-bills.ts:
//   INV-9411 8,900.50 and INV-9412 31,400.00 of VENDOR-44, INV-9413 640.00 of VENDOR-31, and
//   INV-9414 to INV-9418, 45,000.00 each, of VENDOR-12. The CFO's rule is the shipped one. A real
//   PostgreSQL, never a mock: the savepoint, the lock, the trigger, and the bookings are its own.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readControls } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { Handler, Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memoryControls } from "../src/rulebook.ts";
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
import { CFO, keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";

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

/** One line of a draft or a run, of one of the tests' bills, decided on version 1. */
function draftOf(id: string): { invoice: string; expected_version: number } {
  return { invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 };
}
function linesOf(...ids: string[]): { lines: { invoice: string; expected_version: number }[] } {
  return { lines: ids.map(draftOf) };
}

/** intake-fte calls this operation, with this envelope's extras, on the given registry. */
function asIntake(
  name: string,
  input: unknown,
  extra: Partial<RequestEnvelope> = {},
  on: Registry = registry,
): Promise<Answer> {
  const sent = { ...keyed(INTAKE), ...extra } as RequestEnvelope;
  return withPlanted("tok_intake", intake, () => call(on, log, sent, name, input));
}

/** The address an answer names. */
function uriOf(answer: Answer): string {
  return String((answer as { proposal?: string }).proposal ?? "");
}
function idOf(uri: string): string {
  return uri.split("/").at(-1)!;
}

/** The states of a run and of its lines, the run first, then the lines in the order of their ids. */
async function statesOf(uri: string): Promise<string[]> {
  const kept = (await proposals.get("org_456", idOf(uri)))!;
  const lines = await proposals.lines("org_456", uri);
  return [kept.state, ...lines.map((l) => l.state)];
}

/** One proposal's booking, as dsor.reservations holds it. */
async function bookingOf(uri: string): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT amount_value::text AS value, state FROM dsor.reservations WHERE proposal_id = $1`,
    "org_456",
    [idOf(uri)],
  );
  return rows;
}

/** What del_190 has used today, as text. */
async function usedToday(): Promise<string> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT coalesce(sum(used), 0)::numeric(14,2)::text AS used FROM dsor.limit_counters
      WHERE delegation = 'del_190' AND day = (now() AT TIME ZONE 'UTC')::date`,
    "org_456",
  );
  return String(rows[0]?.["used"]);
}

/** intake-fte's run of INV-9411, INV-9412, and INV-9413, waiting for cfo_100: its address. */
async function waitingRun(): Promise<string> {
  const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412", "INV-9413"));
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  return uriOf(answer);
}

describe("C1 and C2: supersedes, kept on the database", () => {
  it("DSOR-APR-12: C1: the new proposal keeps supersedes, and dsor_runtime cannot change it, nor the payload", async () => {
    const old = await waitingRun();
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"), {
      supersedes: old,
    });
    const made = (await proposals.get("org_456", idOf(uriOf(answer))))!;
    expect(made.supersedes).toBe(old);
    const tries: [string, unknown[]][] = [
      ["UPDATE dsor.proposals SET supersedes = NULL WHERE id = $1", [idOf(made.uri)]],
      ["UPDATE dsor.proposals SET payload = '{}'::jsonb WHERE id = $1", [idOf(made.uri)]],
      ["UPDATE dsor.proposals SET payload = '{}'::jsonb WHERE id = $1", [idOf(old)]],
    ];
    for (const [sql, values] of tries) {
      await expect(tryThenRollBack(pool, sql, "org_456", values)).rejects.toThrow();
    }
  });

  it("DSOR-APR-12: C1: the owner cannot change what a proposal replaces either: the trigger keeps it", async () => {
    const old = await waitingRun();
    const answer = await asIntake("payment.run", linesOf("INV-9411"), { supersedes: old });
    const id = idOf(uriOf(answer));
    const changed = ownerRuns("resupersede", id) as { said: string };
    expect(changed.said).toMatch(/only the state of a proposal changes/);
  });

  it("DSOR-APR-12: C1: the database refuses a supersedes that names another company's proposal", async () => {
    const old = await waitingRun();
    const id = idOf(old);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await expect(
        client.query(
          `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload, payload_hash,
                                       resources, requester, idempotency_key, expires_at, supersedes)
           SELECT tenant_id, 'prop_' || gen_random_uuid(), operation, mode, 'PROPOSED', payload,
                  payload_hash, resources, requester, 'other-company', expires_at, $2
             FROM dsor.proposals WHERE id = $1`,
          [id, "dsor://org_789/proposal/prop_00000000-0000-4000-8000-000000000041"],
        ),
      ).rejects.toThrow(/proposals_supersedes_of_company/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("step 41b's decision D9: C2: on the database, the same key with another supersedes is IDEMPOTENCY_CONFLICT", async () => {
    const first = await waitingRun();
    const second = uriOf(await asIntake("payment.create", draftOf("INV-9414")));
    const key = `k-41b-c2-${randomUUID()}`;
    const one = await asIntake("payment.create", draftOf("INV-9415"), {
      idempotency_key: key,
      supersedes: second,
    });
    expect(one).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const other = await asIntake("payment.create", draftOf("INV-9415"), {
      idempotency_key: key,
      supersedes: first,
    });
    expect(other).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const none = await asIntake("payment.create", draftOf("INV-9415"), { idempotency_key: key });
    expect(none).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const again = await asIntake("payment.create", draftOf("INV-9415"), {
      idempotency_key: key,
      supersedes: second,
    });
    expect(again).toMatchObject({ outcome: "PENDING_APPROVAL", proposal: uriOf(one) });
    expect((await proposals.get("org_456", idOf(first)))!.state).toBe("PENDING_APPROVAL");
  });
});

describe("C4 to C6: the replacement, in one transaction, on the database", () => {
  it("DSOR-APR-12: C4: a waiting run replaced by a run: the old run and its lines CANCELLED, each naming the new run, its booking given back, and the new run booked", async () => {
    const old = await waitingRun();
    const answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9412"), {
      supersedes: old,
    });
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const made = uriOf(answer);
    expect(await statesOf(old)).toStrictEqual(Array(4).fill("CANCELLED"));
    const kept = (await proposals.get("org_456", idOf(old)))!;
    expect(kept.transitions.at(-1)).toMatchObject({ cause: `replaced by proposal ${made}` });
    expect(await bookingOf(old)).toStrictEqual([{ value: "40940.50", state: "released" }]);
    expect(await bookingOf(made)).toStrictEqual([{ value: "40300.50", state: "held" }]);
    expect(await usedToday()).toBe("40300.50");
  });

  it("step 41b's decision D6: C5: a new run with a suspended vendor is refused: the old run still waits with its lines and its booking, and the new one is DENIED", async () => {
    const old = await waitingRun();
    const before = await statesOf(old);
    ownerInvoices("vendor", "VENDOR-31", "suspended");
    let answer: Answer;
    try {
      answer = await asIntake("payment.run", linesOf("INV-9411", "INV-9413"), { supersedes: old });
    } finally {
      ownerInvoices("vendor", "VENDOR-31", "approved");
    }
    expect(answer).toMatchObject({ code: "CONFLICT" });
    expect(await statesOf(old)).toStrictEqual(before);
    expect(await bookingOf(old)).toStrictEqual([{ value: "40940.50", state: "held" }]);
    expect(await usedToday()).toBe("40940.50");
    expect(await statesOf(uriOf(answer))).toStrictEqual(Array(3).fill("DENIED"));
  });

  it("step 41b's decision D7: C5: a new run over the day's limit, once the old booking is given back, is refused, and the old booking is held again", async () => {
    const old = await waitingRun();
    const ids = ["INV-9414", "INV-9415", "INV-9416", "INV-9417", "INV-9418"];
    const answer = await asIntake("payment.run", linesOf(...ids), { supersedes: old });
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await proposals.get("org_456", idOf(old)))!.state).toBe("PENDING_APPROVAL");
    expect(await bookingOf(old)).toStrictEqual([{ value: "40940.50", state: "held" }]);
    expect(await usedToday()).toBe("40940.50");
  });

  it("step 41b's decision D6: C5: an accident in the new draft's work rolls everything back: the old run still waits, with its booking", async () => {
    const broken = registryWith({
      ...handlersFor(),
      "payment.create": async (): Promise<never> => {
        throw new Error("a bug in the company's code");
      },
    });
    const old = await waitingRun();
    const before = await statesOf(old);
    // INV-9411 needs no one, so the broken code runs at once, once the old run lets go of it.
    const answer = await asIntake(
      "payment.create",
      draftOf("INV-9411"),
      { supersedes: old },
      broken,
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await statesOf(old)).toStrictEqual(before);
    expect(await bookingOf(old)).toStrictEqual([{ value: "40940.50", state: "held" }]);
  });

  it("step 41b's decision D7: C6: two replacements of one run at the same moment: one wins, the other hears CONFLICT, and the day holds one booking", async () => {
    const old = await waitingRun();
    // Changed by step 41b's review, M3: the two new runs share no bill, so only the company's ending
    //   lock keeps them apart, and the loser's words say it found the run CANCELLED.
    const answers = await Promise.all([
      asIntake("payment.run", linesOf("INV-9414"), { supersedes: old }),
      asIntake("payment.run", linesOf("INV-9415"), { supersedes: old }),
    ]);
    const said = answers.map((a) => ("code" in a ? a.code : (a as { outcome: string }).outcome));
    expect(said.sort()).toStrictEqual(["CONFLICT", "PENDING_APPROVAL"]);
    const won = answers.find((a) => !("code" in a))!;
    expect(await statesOf(old)).toStrictEqual(Array(4).fill("CANCELLED"));
    const { rows } = await tryThenRollBack(
      pool,
      `SELECT count(*)::int AS n FROM dsor.reservations WHERE delegation = 'del_190' AND state = 'held'`,
      "org_456",
    );
    expect(rows[0]?.["n"]).toBe(1);
    expect(await bookingOf(uriOf(won))).toMatchObject([{ state: "held" }]);
  });
});

describe("C7 and C9: the refusal tells, and the dry run, on the database", () => {
  // Found by step 41b's review, M3. user_123, whose clearance shows DSoR's words, as the agent's
  //   does not: the loser found the old draft CANCELLED, because the lock made it wait for the winner.
  it("step 41b's decision D7: M3: two replacements of user_123's draft at once, of bills they do not share: the loser found it CANCELLED", async () => {
    const asUser = (input: unknown, extra: Partial<RequestEnvelope> = {}): Promise<Answer> =>
      call(
        registry,
        log,
        { ...keyed(SUPERVISOR), ...extra } as RequestEnvelope,
        "payment.create",
        input,
      );
    const old = uriOf(await asUser(draftOf("INV-9412")));
    const answers = await Promise.all([
      asUser(draftOf("INV-9414"), { supersedes: old }),
      asUser(draftOf("INV-9415"), { supersedes: old }),
    ]);
    const lost = answers.filter((a) => "code" in a);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${idOf(old)} is CANCELLED, and only a READY, PENDING_APPROVAL, or APPROVED proposal is replaced`,
    });
  });

  it("step 41b's decision D8: C7: cfo_100 approves the replaced run: CONFLICT, naming the new run", async () => {
    const old = await waitingRun();
    const run = (await proposals.get("org_456", idOf(old)))!;
    const { payload_hash, manifest_hash, totals, vendor_totals } = run;
    const made = uriOf(
      await asIntake("payment.run", linesOf("INV-9411", "INV-9412"), { supersedes: old }),
    );
    const shown = { proposal: old, payload_hash, manifest_hash, totals, vendor_totals };
    const answer = await call(registry, log, keyed(CFO), "proposal.approve", shown);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${idOf(old)} was replaced by proposal ${made}, so it is not approved`,
    });
  });

  // Changed by step 41b's review, M4: the dry run fits only once the old booking counts as given
  //   back, so the database's own subtraction is what passes it.
  it("DSOR-OPR-05: C9: a dry run of a replacement counts the old booking as given back, and changes nothing", async () => {
    const answerOld = await asIntake(
      "payment.run",
      linesOf("INV-9411", "INV-9413", "INV-9414", "INV-9415", "INV-9416"),
    );
    expect(answerOld).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const old = uriOf(answerOld);
    expect(await usedToday()).toBe("144540.50");
    const dry = { ...INTAKE, mode: "validate_only" } as RequestEnvelope;
    const plain = await withPlanted("tok_intake", intake, () =>
      call(registry, log, dry, "payment.run", linesOf("INV-9417", "INV-9418")),
    );
    expect(plain).toMatchObject({ code: "LIMIT_EXCEEDED" });
    const used = await usedToday();
    const sent = { ...INTAKE, mode: "validate_only", supersedes: old } as RequestEnvelope;
    const answer = await withPlanted("tok_intake", intake, () =>
      call(registry, log, sent, "payment.run", linesOf("INV-9417", "INV-9418")),
    );
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "REQUIRE_APPROVAL" });
    expect((await proposals.get("org_456", idOf(old)))!.state).toBe("PENDING_APPROVAL");
    expect(await usedToday()).toBe(used);
  });
});

describe("C8: a line moves to CANCELLED only with its run, on the database", () => {
  it("step 41b's decision D11: C8: dsor_runtime cannot cancel a waiting line alone; with its run first, it can", async () => {
    const old = await waitingRun();
    const [line] = await proposals.lines("org_456", old);
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.proposals SET state = 'CANCELLED' WHERE id = $1",
        "org_456",
        [line!.id],
      ),
    ).rejects.toThrow(/a line moves to CANCELLED only with its run/);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query("UPDATE dsor.proposals SET state = 'CANCELLED' WHERE id = $1", [
        idOf(old),
      ]);
      const moved = await client.query(
        "UPDATE dsor.proposals SET state = 'CANCELLED' WHERE id = $1",
        [line!.id],
      );
      expect(moved.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("step 41b's decision D11: C8: a tear-up of del_190 cancels its waiting runs and every line of each, whatever the order of their ids", async () => {
    // Three waiting runs: the chance that every line's id comes after its run's is one in 18.
    const runs = [];
    for (const ids of [["INV-9411", "INV-9412"], ["INV-9413"], ["INV-9414", "INV-9415"]]) {
      const answer = await asIntake("payment.run", linesOf(...ids), { mode: "propose_only" });
      expect(answer).toMatchObject({
        outcome: expect.stringMatching(/^(READY|PENDING_APPROVAL)$/),
      });
      runs.push(uriOf(answer));
    }
    const tearUp = {
      slip: "dsor://org_456/delegation/del_190",
      reason: "intake-fte's runs are wrong",
    };
    const answer = await call(registry, log, keyed(SUPERVISOR), "delegation.revoke", tearUp);
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    for (const run of runs) {
      const states = await statesOf(run);
      expect(states).toStrictEqual(Array(states.length).fill("CANCELLED"));
    }
  });
});

// Found by step 41b's review, M1: a replacement of a single draft gave back the old booking, which
//   locks the day's total, before it took the new bill's lock. A plain draft of the same bill, which
//   took the bill's lock first and then waited for the day's total, waited for it in turn, and
//   PostgreSQL ended one of the two as a deadlock: INTERNAL_ERROR.
describe("step 41b's review, M1 and M2: a replacement at the same moment as other calls", () => {
  it(
    "step 41b's decision D7: M1: a replacement and a plain draft of the same bill at once, thirty times: never an accident",
    { timeout: 180_000 },
    async () => {
      const said: string[] = [];
      for (let round = 0; round < 30; round++) {
        ownerAttempts();
        ownerLimits("add");
        const old = uriOf(await asIntake("payment.create", draftOf("INV-9414")));
        const answers = await Promise.all([
          asIntake("payment.create", draftOf("INV-9415"), { supersedes: old }),
          asIntake("payment.create", draftOf("INV-9415")),
        ]);
        for (const answer of answers) {
          said.push("code" in answer ? answer.code : (answer as { outcome: string }).outcome);
        }
      }
      expect(said).not.toContain("INTERNAL_ERROR");
      expect(said.filter((one) => one === "PENDING_APPROVAL")).toHaveLength(30);
    },
  );

  // Found by step 41b's review, M2: a release takes no ending lock, so only the move's own check of
  //   the state keeps a release and a replacement of one approved proposal apart.
  it(
    "step 41b's decision D6: M2: a release and a replacement of one approved draft at once, eight times: never a payment running with its booking given back",
    { timeout: 180_000 },
    async () => {
      for (let round = 0; round < 8; round++) {
        ownerAttempts();
        ownerLimits("add");
        const old = uriOf(await asIntake("payment.create", draftOf("INV-9412")));
        const kept = (await proposals.get("org_456", idOf(old)))!;
        const approval = { proposal: old, payload_hash: kept.payload_hash };
        expect(await call(registry, log, keyed(CFO), "proposal.approve", approval)).toMatchObject({
          data: { state: "APPROVED" },
        });
        const answers = await Promise.all([
          asIntake("proposal.execute", { proposal: old }),
          asIntake("payment.create", draftOf("INV-9411"), { supersedes: old }),
        ]);
        const said = answers.map((a) =>
          "code" in a ? a.code : (a as { outcome: string }).outcome,
        );
        expect(said).not.toContain("INTERNAL_ERROR");
        const state = (await proposals.get("org_456", idOf(old)))!.state;
        const booking = await bookingOf(old);
        if (state === "COMMITTED") expect(booking).toMatchObject([{ state: "committed" }]);
        else expect(state).toBe("CANCELLED");
        // Exactly one of the two went through.
        expect(said.filter((one) => one === "COMMITTED")).toHaveLength(1);
      }
    },
  );
});

// Found by step 41b's review, L4 and L5: rules and paths with no test on the database.
describe("step 41b's review, L4 and L5: the smaller gaps, on the database", () => {
  it("DSOR-APR-12: L4: a line never names what it replaces, a claim's supersedes names this company's proposal, and dsor_runtime cannot change it", async () => {
    const old = await waitingRun();
    const [line] = await proposals.lines("org_456", old);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query("SAVEPOINT one");
      await expect(
        client.query(
          `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload, payload_hash,
                                       resources, requester, idempotency_key, expires_at, run, supersedes)
           SELECT tenant_id, 'prop_' || gen_random_uuid(), operation, mode, 'PROPOSED', payload,
                  payload_hash, resources, requester, 'line-supersedes', expires_at, run, $2
             FROM dsor.proposals WHERE id = $1`,
          [line!.id, old],
        ),
      ).rejects.toThrow(/a line is made only with its run/);
      // The trigger refuses first, so the CHECK proposals_line_supersedes_nothing cannot be reached,
      //   as step 41's review, L4, found for the run's own CHECKs.
      await client.query("ROLLBACK TO SAVEPOINT one");
      await expect(
        client.query(
          `INSERT INTO dsor.idempotency (tenant_id, principal, operation, idempotency_key,
                                         payload_hash, mode, request_id, supersedes)
           VALUES ('org_456', 'intake-fte', 'payment.create', 'k-other-company', $1, 'execute',
                   'req_x', 'dsor://org_789/proposal/prop_00000000-0000-4000-8000-000000000041')`,
          [`sha256:${"0".repeat(64)}`],
        ),
      ).rejects.toThrow(/idempotency_supersedes_of_company/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    await expect(
      tryThenRollBack(pool, "UPDATE dsor.idempotency SET supersedes = NULL", "org_456"),
    ).rejects.toThrow(/permission denied/);
  });

  it("step 41b's decision D8: L5: on the database, a release of a replaced approved draft names the new one", async () => {
    const old = uriOf(await asIntake("payment.create", draftOf("INV-9412")));
    const kept = (await proposals.get("org_456", idOf(old)))!;
    await call(registry, log, keyed(CFO), "proposal.approve", {
      proposal: old,
      payload_hash: kept.payload_hash,
    });
    const made = uriOf(await asIntake("payment.create", draftOf("INV-9412"), { supersedes: old }));
    // user_123 releases, a person who holds payment:create, whose clearance shows DSoR's words.
    const answer = await call(registry, log, keyed(SUPERVISOR), "proposal.execute", {
      proposal: old,
    });
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${idOf(old)} was replaced by proposal ${made}, so it is not released`,
    });
  });

  it("step 41b's decision D6: L5: on the database, a refused single-draft replacement leaves the old draft waiting with its booking", async () => {
    const old = uriOf(await asIntake("payment.create", draftOf("INV-9412")));
    ownerInvoices("vendor", "VENDOR-31", "suspended");
    let answer: Answer;
    try {
      answer = await asIntake("payment.create", draftOf("INV-9413"), { supersedes: old });
    } finally {
      ownerInvoices("vendor", "VENDOR-31", "approved");
    }
    expect(answer).toMatchObject({ code: "CONFLICT" });
    expect((await proposals.get("org_456", idOf(old)))!.state).toBe("PENDING_APPROVAL");
    expect(await bookingOf(old)).toStrictEqual([{ value: "31400.00", state: "held" }]);
  });
});
