// STEP 24: a daily limit, kept by reservations (decision 140).
//
// Rule DSOR-DEL-06a: cumulative limits MUST be enforced with atomic reserve, commit, and release
// operations in the control-plane store.
// Rule DSOR-DEL-06b: a reservation MUST be keyed by proposal id, so that re-evaluating the same
// proposal never reserves twice.
// Rule DSOR-DEL-06c: a reservation MUST stay held while its proposal is PENDING_APPROVAL, APPROVED,
// EXECUTING, or OUTCOME_UNKNOWN.
// Rule DSOR-DEL-06d: a reservation MUST be released when its proposal reaches FAILED, REJECTED,
// EXPIRED, CANCELLED, REVOKED, or INVALIDATED.
// Rule DSOR-DEL-06e: a command that would exceed a limit MUST be refused with LIMIT_EXCEEDED.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { activeSlipFor } from "../src/delegation.ts";
import { refusal } from "../src/envelopes.ts";
import { money } from "../src/money.ts";
import { callOperation, PIPELINE } from "../src/operations.ts";
import { paymentsOf } from "../src/payment.ts";
import { moveProposalThrough, propose, proposalsOf } from "../src/proposal.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import { reserve, settleReservation, usedToday } from "../src/reservation.ts";
import { theDatabase, useDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { makeDoor } from "./support/door.ts";
import { onOneDay } from "./support/one-day.ts";

const DAILY = money("200000.00", "USD");

/** A proposal of org_456's agent, for a payment, to reserve against. */
const aProposal = (): Promise<string> =>
  propose({
    tenant: "org_456",
    operation: "payment.create@1",
    mode: "execute",
    payload: "{}",
    payloadHash: "sha256:0",
    requester: '{"mode":"unattended","subject":"user_123","actor_chain":["accounts-payable-fte"]}',
    idempotencyKey: `limits-${Math.random()}`,
    actor: "accounts-payable-fte",
    cause: "payment.create@1 invoked",
  });

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
});

describe("the slip's daily limit", () => {
  it("DSOR-DEL-06a: del_100 may spend 200,000.00 USD a day, beside 50,000.00 a payment", async () => {
    const found = await activeSlipFor("org_456", "accounts-payable-fte");
    const slip = found.kind === "one" ? found.slip : undefined;

    expect(slip?.dailyLimit).toStrictEqual(DAILY);
    expect(slip?.perTransactionLimit).toStrictEqual(money("50000.00", "USD"));
  });
});

describe("reserving against the day", () => {
  it("DSOR-DEL-06a: an amount within the day's limit is reserved, and the day's total rises by it", async () => {
    const id = await aProposal();

    expect(await reserve("org_456", id, "del_100", money("31400.00", "USD"), DAILY)).toStrictEqual({
      kind: "reserved",
    });
    expect(await usedToday("org_456", "del_100")).toBe("31400.00");
  });

  it("DSOR-DEL-06e: an amount that would take the day past its limit is not reserved, and the total does not move", async () => {
    const first = await aProposal();
    const second = await aProposal();

    await reserve("org_456", first, "del_100", money("180000.00", "USD"), DAILY);

    expect(
      await reserve("org_456", second, "del_100", money("20000.01", "USD"), DAILY),
    ).toStrictEqual({ kind: "over" });
    expect(await usedToday("org_456", "del_100")).toBe("180000.00");
  });

  it("DSOR-DEL-06e: the day's first amount, alone over the limit, is not reserved, and the day is not started", async () => {
    // Decision 155: the day's first booking inserts the total, and only its own condition, the
    // amount within the limit, refuses it. The test above books 180,000.00 first, so its refusal
    // comes from the addition; with that condition taken out, every test still passed.
    const id = await aProposal();

    expect(await reserve("org_456", id, "del_100", money("200000.01", "USD"), DAILY)).toStrictEqual(
      { kind: "over" },
    );
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
    expect(await reservationStates()).toStrictEqual([]);
  });

  it("DSOR-DEL-06e: exactly the limit is within it", async () => {
    const id = await aProposal();

    expect(await reserve("org_456", id, "del_100", money("200000.00", "USD"), DAILY)).toStrictEqual(
      { kind: "reserved" },
    );
  });

  it("DSOR-DEL-06b: the same proposal reserving again does not reserve twice", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("10000.00", "USD"), DAILY);

    expect(await reserve("org_456", id, "del_100", money("10000.00", "USD"), DAILY)).toStrictEqual({
      kind: "already",
    });
    expect(await usedToday("org_456", "del_100")).toBe("10000.00");
  });

  it("DSOR-DEL-06b: the same proposal reserving twice at once still reserves once", async () => {
    // Decision 155: the test above reserves one call after the other, and a reserve() with no key
    // that asks first and then books passed it. Sent together, both ask before either books, both
    // find nothing, and one proposal books twice: the check-then-act §13.4 warns about.
    const id = await aProposal();
    const both = await Promise.all(
      Array.from({ length: 2 }, () =>
        reserve("org_456", id, "del_100", money("10000.00", "USD"), DAILY),
      ),
    );

    expect(both.filter((b) => b.kind === "reserved")).toHaveLength(1);
    expect(both.filter((b) => b.kind === "already")).toHaveLength(1);
    expect(await usedToday("org_456", "del_100")).toBe("10000.00");
  });

  // Decision 155: fifty bookings take long enough for midnight UTC to fall among them. Then they
  // are on two days, and the test is skipped, not failed (test/support/one-day.ts).
  it("DSOR-DEL-06a: fifty reservations sent together never take the day past its limit", (context) =>
    onOneDay(context, async () => {
      const ids = await Promise.all(Array.from({ length: 50 }, () => aProposal()));
      const outcomes = await Promise.all(
        ids.map((id) => reserve("org_456", id, "del_100", money("5000.00", "USD"), DAILY)),
      );

      expect(outcomes.filter((o) => o.kind === "reserved")).toHaveLength(40);
      expect(outcomes.filter((o) => o.kind === "over")).toHaveLength(10);
      expect(await usedToday("org_456", "del_100")).toBe("200000.00");
    }));
});

/**
 * STEP 24, decision 141: a proposal walked to how it ended, as the door would move it, so that
 * its reservation may be settled: a reservation follows its proposal's history.
 */
async function endedAs(id: string, end: "COMMITTED" | "FAILED"): Promise<void> {
  const moved = await moveProposalThrough(
    "org_456",
    id,
    [
      ["PROPOSED", "READY", "allowed"],
      ["READY", "EXECUTING", "handed over"],
      ["EXECUTING", end, `ended ${end}`],
    ],
    "dsor",
    null,
  );

  if (moved.kind !== "moved") {
    throw new Error(`could not walk ${id} to ${end}`);
  }
}

describe("settling a reservation", () => {
  it("DSOR-DEL-06d: a released reservation gives its amount back to the day", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await endedAs(id, "FAILED");
    await settleReservation("org_456", id, "released");

    expect(await reservationStates()).toStrictEqual(["released"]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-06d: a release gives the amount back to the total it was booked against, and to no other", async () => {
    // Decision 155: only `t.delegation = s.delegation AND t.day = s.day` keeps a release to its own
    // total, and no test had a second total beside it. Without them, every test still passed, and
    // one refused payment under del_100 gave its amount back to every slip's total in the company,
    // on every day. So, as the owner: another slip with a total today, and del_100's yesterday.
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status,
                                             expires_at, daily_limit_value, daily_limit_currency)
               VALUES ('org_456', 'del_200', 'user_123', 'another-agent', ARRAY['payment:create'],
                       'active', '2099-12-31T23:59:59Z', 200000.00, 'USD');
               INSERT INTO dsor.day_totals (tenant, delegation, day, used_value, currency)
               VALUES ('org_456', 'del_200', (now() AT TIME ZONE 'UTC')::date, 100000.00, 'USD'),
                      ('org_456', 'del_100', (now() AT TIME ZONE 'UTC')::date - 1, 100000.00, 'USD')`),
    );

    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await endedAs(id, "FAILED");
    await settleReservation("org_456", id, "released");

    expect(await totalsOf()).toStrictEqual([
      "del_100 yesterday 100000.00",
      "del_100 today 0.00",
      "del_200 today 100000.00",
    ]);
  });

  it("DSOR-DEL-06d: a reservation booked yesterday and released today gives its amount back to yesterday, not to today", async () => {
    // Decision 155: the test above books its reservation today, so a release that took the amount
    // off today's total, and not off the reservation's own day, still passed it. A reservation can
    // be released days after it was booked: a payment booked before midnight UTC can end FAILED
    // after it, and revoking a slip releases what waited under it, however long it waited. Taken
    // off today, the amount is room that today never booked: a payment that failed after midnight
    // lets its slip spend past its daily limit. So, as the owner: del_100's yesterday, with a
    // reservation still held on it, and 150,000.00 booked today.
    const id = await aProposal();

    await asTheOwner(async () => {
      await db.exec(`INSERT INTO dsor.day_totals (tenant, delegation, day, used_value, currency)
                     VALUES ('org_456', 'del_100', (now() AT TIME ZONE 'UTC')::date - 1, 40000.00, 'USD'),
                            ('org_456', 'del_100', (now() AT TIME ZONE 'UTC')::date, 150000.00, 'USD')`);
      await db.query(
        `INSERT INTO dsor.reservations (tenant, proposal, delegation, day, amount_value, amount_currency)
         VALUES ('org_456', $1, 'del_100', (now() AT TIME ZONE 'UTC')::date - 1, 40000.00, 'USD')`,
        [id],
      );
    });

    await endedAs(id, "FAILED");
    await settleReservation("org_456", id, "released");

    expect(await reservationStates()).toStrictEqual(["released"]);
    expect(await totalsOf()).toStrictEqual(["del_100 yesterday 0.00", "del_100 today 150000.00"]);
  });

  it("DSOR-DEL-06a: a committed reservation keeps its amount on the day", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await endedAs(id, "COMMITTED");
    await settleReservation("org_456", id, "committed");

    expect(await reservationStates()).toStrictEqual(["committed"]);
    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
  });

  it("DSOR-DEL-06a: a committed reservation is never released, even by the application writing the SQL itself", async () => {
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await endedAs(id, "COMMITTED");
    await settleReservation("org_456", id, "committed");
    await settleReservation("org_456", id, "released");

    const { rows } = await theDatabase("org_456").query(
      "UPDATE dsor.reservations SET state = 'released' WHERE tenant = 'org_456' AND proposal = $1 RETURNING proposal",
      [id],
    );

    expect(rows).toStrictEqual([]);
    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
  });
});

describe("what the application may not do to a total or a reservation", () => {
  it("DSOR-DEL-06a: it may not delete a total or a reservation, nor write a reservation already settled", async () => {
    const { rows } = await db.query<{ right: string }>(
      `SELECT t || ' ' || r AS right
         FROM unnest(ARRAY['dsor.day_totals', 'dsor.reservations']) AS t,
              unnest(ARRAY['DELETE', 'TRUNCATE']) AS r
        WHERE has_table_privilege(current_user, t, r)
       UNION ALL
       SELECT 'dsor.reservations INSERT state'
        WHERE has_column_privilege(current_user, 'dsor.reservations', 'state', 'INSERT')
       UNION ALL
       SELECT 'dsor.reservations UPDATE amount_value'
        WHERE has_column_privilege(current_user, 'dsor.reservations', 'amount_value', 'UPDATE')`,
    );

    expect(rows).toStrictEqual([]);
  });
});

// STEP 24, piece 2: §21.10 books the day's amount, and the door settles it as the proposal
// ends.

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };

/** The agent pays INV-1009 this much, with a fresh key, as the program's door would be asked. */
const pay = (value: string, mode?: string): ReturnType<typeof callOperation> =>
  callOperation(
    AGENT,
    "payment.create",
    { invoice: "dsor://org_456/invoice/INV-1009", amount: { value, currency: "USD" } },
    { idempotencyKey: `pay-${Math.random()}`, ...(mode === undefined ? {} : { mode }) },
  );

/** org_456's reservations' states, in the order their proposals were numbered. */
const reservationStates = async (): Promise<string[]> => {
  const { rows } = await theDatabase("org_456").query<{ state: string }>(
    "SELECT state FROM dsor.reservations WHERE tenant = 'org_456' ORDER BY length(proposal), proposal",
  );

  return rows.map((r) => r.state);
};

/** Decision 155: org_456's day totals, "slip day used", by slip and then by day. */
const totalsOf = async (): Promise<string[]> => {
  const { rows } = await theDatabase("org_456").query<{ total: string }>(
    `SELECT delegation || ' ' ||
            CASE day - (now() AT TIME ZONE 'UTC')::date
              WHEN 0 THEN 'today' WHEN -1 THEN 'yesterday' ELSE day::text
            END || ' ' || used_value::text AS total
       FROM dsor.day_totals WHERE tenant = 'org_456' ORDER BY delegation, day`,
  );

  return rows.map((r) => r.total);
};

describe("the agent's payments against del_100's day", () => {
  // Decision 155: on one day, or skipped, as the fifty above.
  it("DSOR-DEL-06e: four payments of 50,000.00 fill the day, and the fifth is LIMIT_EXCEEDED", (context) =>
    onOneDay(context, async () => {
      for (let i = 0; i < 4; i += 1) {
        expect((await pay("50000.00")).kind).toBe("result");
      }

      const fifth = await pay("50000.00");

      expect(fifth.kind === "error" && fifth.envelope.code).toBe("LIMIT_EXCEEDED");
      expect(fifth.kind === "error" && fifth.envelope.message).toMatch(/200000\.00 USD a day/);
      expect(await usedToday("org_456", "del_100")).toBe("200000.00");
      expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual([
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "DENIED",
      ]);
    }));

  it("DSOR-DEL-06a: a payment made commits its reservation, and keeps its amount on the day", async () => {
    await pay("31400.00");

    expect(await reservationStates()).toStrictEqual(["committed"]);
    expect(await usedToday("org_456", "del_100")).toBe("31400.00");
  });

  it("DSOR-DEL-06d: a payment its handler refuses is FAILED, and its reservation is released", async () => {
    const answer = await callOperation(
      AGENT,
      "payment.create",
      {
        invoice: "dsor://org_456/invoice/INV-9999",
        amount: { value: "40000.00", currency: "USD" },
      },
      { idempotencyKey: "pay-no-such-invoice" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("RESOURCE_NOT_FOUND");
    expect(await reservationStates()).toStrictEqual(["released"]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-06c: a payment whose handler throws is OUTCOME_UNKNOWN, and its reservation stays held", async () => {
    const door = makeDoor(PIPELINE, {
      "payment.create": () => {
        throw new Error("the bank hung up half way");
      },
    });

    await expect(
      door(
        AGENT,
        "payment.create",
        {
          invoice: "dsor://org_456/invoice/INV-1009",
          amount: { value: "40000.00", currency: "USD" },
        },
        { idempotencyKey: "pay-unknown" },
      ),
    ).rejects.toThrow(/half way/);
    expect(await reservationStates()).toStrictEqual(["held"]);
    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
  });

  it("only a payment books against the day: an amount planted in invoice.issue books nothing", async () => {
    // Decision 155: the stage booked any command whose arguments carried an `amount`, and the
    // arguments keep every field a contract does not name. So the agent's invoice.issue of INV-1009,
    // with 50,000.00 USD planted beside it, took that much of del_100's day, and kept it.
    const answer = await callOperation(
      AGENT,
      "invoice.issue",
      {
        invoice: "dsor://org_456/invoice/INV-1009",
        expected_version: 1,
        amount: { value: "50000.00", currency: "USD" },
      },
      { idempotencyKey: "issue-with-an-amount" },
    );

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("COMMITTED");
    expect(await reservationStates()).toStrictEqual([]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-06c: a prepared payment, READY, holds its reservation, because it may still run", async () => {
    expect((await pay("40000.00", "propose_only")).kind).toBe("result");
    expect(await reservationStates()).toStrictEqual(["held"]);
  });

  // Decision 155: on one day, or skipped, as the fifty above.
  it("DSOR-OPR-06: a dry run reserves nothing, and is refused when the day has no room for it", (context) =>
    onOneDay(context, async () => {
      expect((await pay("40000.00", "validate_only")).kind).toBe("result");
      expect(await reservationStates()).toStrictEqual([]);

      for (let i = 0; i < 4; i += 1) {
        await pay("50000.00");
      }

      const dry = await pay("0.01", "validate_only");

      expect(dry.kind === "error" && dry.envelope.code).toBe("LIMIT_EXCEEDED");
    }));

  it("DSOR-DEL-06d: a decision that cannot be recorded after the amount was booked gives it back", async () => {
    const connection = overPGlite(db);
    let failed = false;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        if (!failed && sql.includes("INSERT INTO dsor.audit")) {
          failed = true;

          throw Object.assign(new Error("the log is full"), { code: "53100" });
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    try {
      expect((await pay("40000.00")).kind).toBe("error");
    } finally {
      useDatabase(connection);
    }

    expect(await reservationStates()).toStrictEqual(["released"]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });
});

// STEP 24, decision 141: what the review measured.

/** The store, failing every write of moves into the states named, until it is put back. */
function failingMovesInto(states: readonly string[]): () => void {
  const connection = overPGlite(db);

  useDatabase({
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      if (
        sql.includes("INSERT INTO dsor.proposal_moves") &&
        states.some((state) => params?.includes(state))
      ) {
        throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
      }

      return connection.query<T>(sql, params, tenant);
    },
  });

  return () => useDatabase(connection);
}

/**
 * Decision 155: run something with the store failing every statement `picked` chooses, then put
 * the store back. The statement fails before it runs; or, with `replyLost`, after it ran, as when
 * only its reply is lost on the way back.
 */
async function withTheStoreFailing<Answer>(
  picked: (sql: string) => boolean,
  run: () => Promise<Answer>,
  replyLost = false,
): Promise<Answer> {
  const connection = overPGlite(db);

  useDatabase({
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      if (!picked(sql)) {
        return connection.query<T>(sql, params, tenant);
      }

      if (replyLost) {
        await connection.query<T>(sql, params, tenant);
      }

      throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
    },
  });

  try {
    return await run();
  } finally {
    useDatabase(connection);
  }
}

describe("a reservation follows its proposal's history, as written", () => {
  it("DSOR-DEL-06c: a refusal whose move to FAILED is not written leaves the proposal EXECUTING, and its reservation held", async () => {
    // Decision 141: it was released anyway, and the day showed 0.00 for a proposal nobody knew the
    // end of.
    const putBack = failingMovesInto(["FAILED"]);

    try {
      await callOperation(
        AGENT,
        "payment.create",
        {
          invoice: "dsor://org_456/invoice/INV-9999",
          amount: { value: "40000.00", currency: "USD" },
        },
        { idempotencyKey: "pay-failed-unwritten" },
      );
    } finally {
      putBack();
    }

    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["EXECUTING"]);
    expect(await reservationStates()).toStrictEqual(["held"]);
    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
  });

  it("DSOR-DEL-06c: a payment whose move to COMMITTED is not written keeps its reservation held, not committed", async () => {
    const putBack = failingMovesInto(["COMMITTED"]);

    try {
      await pay("40000.00");
    } finally {
      putBack();
    }

    expect(await reservationStates()).toStrictEqual(["held"]);
  });

  it("DSOR-DEL-06c: a handler that answers a failure which does not say nothing was done keeps its reservation held", async () => {
    // Decision 141: the guard was reached only by a handler that threw.
    const door = makeDoor(PIPELINE, {
      "payment.create": (_args, _contract, askedBy, _tenant, _hash, requestId) => ({
        kind: "error",
        askedBy,
        envelope: refusal("TRANSACTION_FAILED", "the bank hung up", requestId, askedBy),
      }),
    });

    await door(
      AGENT,
      "payment.create",
      {
        invoice: "dsor://org_456/invoice/INV-1009",
        amount: { value: "40000.00", currency: "USD" },
      },
      { idempotencyKey: "pay-transaction-failed" },
    );

    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["OUTCOME_UNKNOWN"]);
    expect(await reservationStates()).toStrictEqual(["held"]);
  });

  it("DSOR-DEL-06d: a reservation is released only when its proposal's history says FAILED or DENIED", async () => {
    // At the store: a proposal still PROPOSED has its reservation released by nobody.
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await settleReservation("org_456", id, "released");
    await settleReservation("org_456", id, "committed");

    expect(await usedToday("org_456", "del_100")).toBe("40000.00");
    expect(await reservationStates()).toStrictEqual(["held"]);
  });
});

describe("what reserve() keeps to itself", () => {
  it("DSOR-MON-04: an amount in another currency than the limit's is over it, and the day is not touched", async () => {
    // Decision 141: booked directly, EUR 150,000 went against the USD limit and stamped the day EUR,
    // and USD 1.00 came back over for the rest of the day.
    const euros = await aProposal();
    const dollars = await aProposal();

    expect(
      await reserve("org_456", euros, "del_100", money("150000.00", "EUR"), DAILY),
    ).toStrictEqual({ kind: "over" });
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
    expect(await reserve("org_456", dollars, "del_100", money("1.00", "USD"), DAILY)).toStrictEqual(
      {
        kind: "reserved",
      },
    );
  });

  it("DSOR-DEL-06b: a proposal whose reservation was settled is not 'already reserved', and is not booked again", async () => {
    // Decision 141: latent until step 31 re-checks a proposal.
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await endedAs(id, "FAILED");
    await settleReservation("org_456", id, "released");

    expect(await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY)).toStrictEqual({
      kind: "settled",
    });
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-06b: §21.10 refuses a proposal whose reservation was settled, and books nothing", async () => {
    // Decision 155: decision 141 refuses it at the stage, and no test reached that refusal: with
    // the stage carrying on instead, every test still passed, and a proposal checked again after its
    // release would run with nothing booked. Today's door makes a new proposal for every request, so
    // the stage is run here by itself, for a proposal whose reservation was released.
    const id = await aProposal();

    await reserve("org_456", id, "del_100", money("40000.00", "USD"), DAILY);
    await endedAs(id, "FAILED");
    await settleReservation("org_456", id, "released");

    const stage = PIPELINE.find((s) => s.name === "check the slip's limit");
    const found = await activeSlipFor("org_456", "accounts-payable-fte");

    if (stage === undefined || found.kind !== "one") {
      throw new Error("the pipeline has no stage that checks the slip's limit, or del_100 is gone");
    }

    const checked = await stage.run({
      login: undefined,
      id: "payment.create",
      args: {},
      requestId: "req_checked_again",
      tenant: "org_456",
      contract: loadRegistry(contractsFromDisk()).get("payment.create"),
      delegation: found.slip,
      mode: "execute",
      proposal: id,
      given: {
        invoice: "dsor://org_456/invoice/INV-1009",
        amount: { value: "40000.00", currency: "USD" },
      },
    });

    expect(
      checked.kind === "refused" && checked.answer.kind === "error" && checked.answer.envelope,
    ).toMatchObject({
      code: "INTERNAL_ERROR",
      message: `${id}'s reservation against del_100's day was settled already, so it is not booked again`,
    });
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-MON-04: a slip with only a daily limit refuses a payment in another currency, a day's limit", async () => {
    // Decision 141: never reached, because del_100's limit per payment refuses another currency
    // first. Here del_100 has only its daily limit.
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations
                  SET per_transaction_limit_value = NULL, per_transaction_limit_currency = NULL
                WHERE tenant = 'org_456' AND id = 'del_100'`),
    );

    const answer = await callOperation(
      AGENT,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1009", amount: { value: "100.00", currency: "EUR" } },
      { idempotencyKey: "pay-in-euros" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("LIMIT_EXCEEDED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(
      /cannot be compared with del_100's limit of 200000\.00 USD a day/,
    );
  });

  it("DSOR-DEL-06e: a slip with only a daily limit refuses the day's first payment over it", async () => {
    // Decision 155: del_100's limit per payment, 50,000.00, refuses any amount that could pass
    // 200,000.00 alone, so no payment ever took the day's first booking over the limit. Here
    // del_100 has only its daily limit, as above.
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations
                  SET per_transaction_limit_value = NULL, per_transaction_limit_currency = NULL
                WHERE tenant = 'org_456' AND id = 'del_100'`),
    );

    const answer = await pay("250000.00");

    expect(answer.kind === "error" && answer.envelope.code).toBe("LIMIT_EXCEEDED");
    expect(answer.kind === "error" && answer.envelope.message).toBe(
      "250000.00 USD would take del_100 past its limit of 200000.00 USD a day",
    );
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
    expect((await paymentsOf("org_456")).map((p) => p.id)).toStrictEqual(["PAY-901"]);
  });
});

describe("a day's total that cannot be booked, or read", () => {
  // Decision 155: the walk catches no stage that throws, so the stage's own catch is what turns a
  // failed booking into a refusal. With it taken out, every test still passed, and the door threw:
  // nothing on the record, the proposal left PROPOSED, and its key claimed with no answer, which no
  // retry can use.
  const booking = (sql: string): boolean => sql.includes("WITH booked");
  const payment = {
    invoice: "dsor://org_456/invoice/INV-1009",
    amount: { value: "40000.00", currency: "USD" },
  };

  it("DSOR-EXE-02: a booking the store refuses is a refusal on the record, safe to send again", async () => {
    const answer = await withTheStoreFailing(booking, () =>
      callOperation(AGENT, "payment.create", payment, { idempotencyKey: "pay-not-booked" }),
    );

    if (answer.kind !== "error") {
      throw new Error(`a booking the store refused was answered ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(answer.envelope.retry).toBe("safe_same_key");
    // This request's records: its decision, a DENY that says why.
    expect(
      (await theLog("org_456"))
        .filter((r) => r.correlation.request_id === answer.envelope.correlation.request_id)
        .map((r) => `${r.kind} ${r.authorization} ${r.result}: ${r.reason}`),
    ).toStrictEqual([
      "decision DENY EVIDENCE_STORE_UNAVAILABLE: the day's total for del_100 could not be booked; nothing was done",
    ]);
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");

    // And its key was given back: the same request, with the same key, is carried out.
    const again = await callOperation(AGENT, "payment.create", payment, {
      idempotencyKey: "pay-not-booked",
    });

    expect(again.kind === "result" && again.envelope.outcome).toBe("COMMITTED");
  });

  it("DSOR-DEL-06d: a booking whose reply is lost is given back, when its proposal is DENIED", async () => {
    // The booking was written, and only its reply lost. The stage refuses, the proposal moves to
    // DENIED, and the reservation the stage never heard of is released with it.
    const answer = await withTheStoreFailing(booking, () => pay("40000.00"), true);

    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
    expect(await reservationStates()).toStrictEqual(["released"]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("a dry run whose read of the day fails says the day's total could not be read, not booked", async () => {
    // A dry run only reads the room left, and books nothing (DSOR-OPR-06).
    const dry = await withTheStoreFailing(
      (sql) => sql.includes("FROM dsor.day_totals"),
      () => pay("40000.00", "validate_only"),
    );

    expect(dry.kind === "error" && dry.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(dry.kind === "error" && dry.envelope.message).toBe(
      "the day's total for del_100 could not be read; nothing was done",
    );
  });
});
