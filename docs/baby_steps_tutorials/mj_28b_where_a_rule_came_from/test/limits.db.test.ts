// Limits with reservations on the database (DSOR-DEL-06a to DSOR-DEL-06e). One statement grows the
// day's total only while it stays within the limit, so fifty drafts at the same moment never pass
// it: the step's "done when". A real PostgreSQL and real parallel requests, never a mock (step 24's
// README, decisions 4, 5, 12, and 13).
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals, createDbReservations } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerInvoices,
  ownerLimits,
  RUNTIME_URL,
  tryThenRollBack,
} from "./db.ts";
import { keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";

// The test's own window into the database, and the code's pool. Fifty requests at the same moment
// need their own connections, so the race runs through a pool of twenty.
const observer = newPool();
const pool = newPool();
const wide = new pg.Pool({ connectionString: RUNTIME_URL, max: 20 });
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const raceRegistry = dbRegistry(wide);
const proposals = createDbProposals(pool);

// intake-fte, the tests' own agent, works under del_190, which the owner adds with the limits of
// §13's example (test/owner-limits.ts). Its login is planted for each call, as the unit tests of
// steps 14 and 15 plant it.
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
function asIntake<T>(run: () => Promise<T>): Promise<T> {
  return withPlanted("tok_intake", intake, run);
}

// The tests' own invoice, INV-9001, which the owner adds, credited to 31,400.00 USD so six drafts
// fit in 200,000.00 USD and a seventh does not.
beforeAll(() => {
  ownerInvoices("add");
  ownerInvoices("credit", "31400.00");
  ownerLimits("add");
});
afterAll(async () => {
  ownerLimits("remove");
  ownerInvoices("remove");
  await observer.end();
  await pool.end();
  await wide.end();
});
// Each test starts with the whole day's room.
beforeEach(() => {
  ownerLimits("reset");
});

/** One statement as dsor_runtime inside org_456, rolled back after, and its rows. */
async function rowsOf(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(observer, sql, "org_456", values)).rows;
}

/** INV-9001's version now, which every draft names. */
async function version9001(): Promise<number> {
  const rows = await rowsOf("SELECT version FROM app.invoices WHERE id = 'INV-9001'");
  return Number(rows[0]?.["version"]);
}

/** What del_190 has used today, as text. */
async function usedToday(): Promise<string> {
  const rows = await rowsOf(
    `SELECT coalesce(sum(used), 0)::numeric(14,2)::text AS used FROM dsor.limit_counters
      WHERE delegation = 'del_190' AND day = (now() AT TIME ZONE 'UTC')::date`,
  );
  return String(rows[0]?.["used"]);
}

/** intake-fte drafts a payment for INV-9001, with a fresh key, through this registry. */
async function draft(
  on = registry,
  envelope: RequestEnvelope = keyed(INTAKE),
  version?: number,
  // And the lines the call runs, as each one starts.
  observe?: (line: number) => void,
): Promise<Answer> {
  const input = {
    invoice: "dsor://org_456/invoice/INV-9001",
    expected_version: version ?? (await version9001()),
  };
  return asIntake(() => call(on, log, envelope, "payment.create", input, observe));
}

const word = (answer: Answer): string =>
  "code" in answer ? answer.code : "outcome" in answer ? answer.outcome : "data";
const proposalId = (answer: Answer): string =>
  ("proposal" in answer ? String(answer.proposal) : "").slice("dsor://org_456/proposal/".length);

describe("the day's limit, on the database", () => {
  it("DSOR-DEL-06a: fifty drafts at the same moment never pass the day's limit: six are made, and forty-four are refused", async () => {
    const version = await version9001();
    const envelopes = Array.from({ length: 50 }, () => keyed(INTAKE));
    const answers = await asIntake(() =>
      Promise.all(
        envelopes.map((envelope) =>
          call(raceRegistry, log, envelope, "payment.create", {
            invoice: "dsor://org_456/invoice/INV-9001",
            expected_version: version,
          }),
        ),
      ),
    );
    const words = answers.map(word);
    expect(words.filter((w) => w === "COMMITTED")).toHaveLength(6);
    expect(words.filter((w) => w === "LIMIT_EXCEEDED")).toHaveLength(44);
    // The day holds six reservations, all committed, and their total.
    expect(await usedToday()).toBe("188400.00");
    const kept = await rowsOf(
      `SELECT state, count(*)::int AS n FROM dsor.reservations
        WHERE delegation = 'del_190' GROUP BY state ORDER BY state`,
    );
    expect(kept).toStrictEqual([{ state: "committed", n: 6 }]);
    // Every refused draft's proposal ended DENIED.
    const keys = envelopes.map((envelope) => envelope.idempotency_key);
    const states = await rowsOf(
      `SELECT state, count(*)::int AS n FROM dsor.proposals
        WHERE idempotency_key = ANY($1) GROUP BY state ORDER BY state`,
      [keys],
    );
    expect(states).toStrictEqual([
      { state: "COMMITTED", n: 6 },
      { state: "DENIED", n: 44 },
    ]);
  });

  it("DSOR-DEL-06e: on the database, the seventh draft of the day is refused with LIMIT_EXCEEDED", async () => {
    const words: string[] = [];
    for (let i = 0; i < 7; i++) words.push(word(await draft()));
    expect(words).toStrictEqual([...Array(6).fill("COMMITTED"), "LIMIT_EXCEEDED"]);
    expect(await usedToday()).toBe("188400.00");
  });

  it("DSOR-DEL-06d: on the database, a draft the code refuses after its reservation is released, and the day gets its amount back", async () => {
    const stale = (await version9001()) + 1;
    const answer = await draft(registry, keyed(INTAKE), stale);
    expect(answer).toMatchObject({ code: "STALE_STATE" });
    const id = proposalId(answer);
    expect((await proposals.get("org_456", id))?.state).toBe("FAILED");
    expect(
      await rowsOf("SELECT state FROM dsor.reservations WHERE proposal_id = $1", [id]),
    ).toStrictEqual([{ state: "released" }]);
    expect(await usedToday()).toBe("0.00");
  });

  it("DSOR-DEL-06b: on the database, a second reserve for one proposal adds nothing", async () => {
    const reservations = createDbReservations(pool);
    const amount = { value: "31400.00", currency: "USD" };
    const limit = { value: "200000", currency: "USD" };
    const proposal = "prop_00000000-0000-4000-8000-000000000240";
    expect(await reservations.reserve("org_456", proposal, "del_190", amount, limit)).toBe(true);
    expect(await reservations.reserve("org_456", proposal, "del_190", amount, limit)).toBe(true);
    expect(await usedToday()).toBe("31400.00");
  });

  it("Step 24: on the database, a dry run checks the day's limit and reserves nothing", async () => {
    const dry = { ...INTAKE, mode: "validate_only" };
    expect(word(await draft(registry, dry))).toBe("VALIDATED");
    for (let i = 0; i < 6; i++) await draft();
    expect(word(await draft(registry, dry))).toBe("LIMIT_EXCEEDED");
    const kept = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.reservations WHERE delegation = 'del_190'",
    );
    expect(kept).toStrictEqual([{ n: 6 }]);
  });

  // Found by step 24's sweep: a denied claim could keep no proposal on the database, and no test
  // replayed one there.
  it("DSOR-IDM-01c: on the database, a replay of a refused draft hears the same refusal, names the same DENIED proposal, and reserves nothing", async () => {
    for (let i = 0; i < 6; i++) await draft();
    const envelope = keyed(INTAKE);
    const refused = await draft(registry, envelope);
    const again = await draft(registry, envelope);
    expect(again).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(proposalId(again)).toBe(proposalId(refused));
    expect((await proposals.get("org_456", proposalId(again)))?.state).toBe("DENIED");
    const kept = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.reservations WHERE delegation = 'del_190'",
    );
    expect(kept).toStrictEqual([{ n: 6 }]);
  });

  // Found by step 24's sweep: the day's first amount was never compared with the limit on the
  // database, because the limit for one payment, 50,000 USD, always refused a larger draft first.
  it("DSOR-DEL-06e: on the database, the day's first draft is refused when it alone passes the day's limit", async () => {
    ownerLimits("daily-only", "20000");
    try {
      const answer = await draft();
      expect(answer).toMatchObject({
        code: "LIMIT_EXCEEDED",
        message: '"payment.create" would pass slip del_190\'s limit for one day',
      });
      expect(await usedToday()).toBe("0.00");
    } finally {
      ownerLimits("add");
    }
  });

  it("Step 24: on the database, a new day starts at zero", async () => {
    for (let i = 0; i < 6; i++) await draft();
    expect(word(await draft())).toBe("LIMIT_EXCEEDED");
    ownerLimits("yesterday");
    expect(word(await draft())).toBe("COMMITTED");
    expect(await usedToday()).toBe("31400.00");
  });
});

describe("the database's own rules for reservations", () => {
  /** The error code PostgreSQL gave one statement, as dsor_runtime inside org_456, or "none". */
  async function codeOf(sql: string): Promise<string> {
    try {
      await tryThenRollBack(observer, sql, "org_456");
      return "none";
    } catch (error) {
      return String((error as { code?: string }).code);
    }
  }
  const RESERVATION = `INSERT INTO dsor.reservations
      (tenant_id, proposal_id, delegation, day, amount_value, amount_currency, state)
    VALUES ('org_456', 'prop_00000000-0000-4000-8000-000000000241', 'del_190', current_date, 100, 'USD'`;

  it("Step 24: a reservation starts held: dsor_runtime cannot add one that is committed or released already", async () => {
    expect(await codeOf(`${RESERVATION}, 'held')`)).toBe("none");
    expect(await codeOf(`${RESERVATION}, 'committed')`)).toBe(NO_PRIVILEGE.code);
    expect(await codeOf(`${RESERVATION}, 'released')`)).toBe(NO_PRIVILEGE.code);
  });

  it("Step 24: a reservation leaves held once: a committed one cannot go back, and a held one only to committed or released", async () => {
    // In one transaction, as dsor_runtime, always rolled back: add one, commit it, then try to
    // hold it again.
    const client = await observer.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query(`${RESERVATION}, 'held')`);
      const id = "prop_00000000-0000-4000-8000-000000000241";
      const committed = await client.query(
        "UPDATE dsor.reservations SET state = 'committed' WHERE proposal_id = $1",
        [id],
      );
      expect(committed.rowCount).toBe(1);
      // A committed reservation is out of the policy's reach: no row changes.
      const again = await client.query(
        "UPDATE dsor.reservations SET state = 'held' WHERE proposal_id = $1",
        [id],
      );
      expect(again.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it.each([
    ["remove a reservation", "DELETE FROM dsor.reservations"],
    ["remove a total", "DELETE FROM dsor.limit_counters"],
    ["change a reservation's amount", "UPDATE dsor.reservations SET amount_value = 1"],
    ["change a reservation's day", "UPDATE dsor.reservations SET day = day - 1"],
    ["move a total to another day", "UPDATE dsor.limit_counters SET day = day - 1"],
  ])("Step 24: dsor_runtime may not %s", async (_what, sql) => {
    expect(await codeOf(sql)).toBe(NO_PRIVILEGE.code);
  });

  it("DSOR-TEN-01b: org_456's totals and reservations are invisible inside org_789, and with no company set", async () => {
    await draft();
    for (const company of ["org_789", undefined]) {
      for (const table of ["dsor.limit_counters", "dsor.reservations"]) {
        const { rows } = await tryThenRollBack(
          observer,
          `SELECT count(*)::int AS n FROM ${table} WHERE delegation = 'del_190'`,
          company,
        );
        expect(rows).toStrictEqual([{ n: 0 }]);
      }
    }
  });
});

describe("from the review, on the database", () => {
  /** The records of one request, in order. */
  async function recordsOf(request_id: string): Promise<Record<string, unknown>[]> {
    return rowsOf(
      `SELECT "authorization", result FROM dsor.audit
        WHERE correlation->>'request_id' = $1 AND kind = 'decision' ORDER BY sequence`,
      [request_id],
    );
  }

  // Found by step 24's review (H1): line ⑨ read INV-9001 at one version, line ⑩ reserved its
  // amount, and the code drafted the next version's amount, which its caller had named. Here the
  // day's total is held, so the call waits at line ⑩, after line ⑨ read the invoice. Meanwhile the
  // accounts system raises INV-9001 to 120,000.00 USD. The work may draft only on what line ⑨ read.
  it("DSOR-CON-01b: on the database, a draft decided on the invoice's next version is refused when the invoice changes while the call waits at line ⑩ (step 24's README, decision 16)", async () => {
    const v = await version9001();
    // One honest draft first, so today's total has a row to hold.
    expect(word(await draft())).toBe("COMMITTED");
    const holder = await observer.connect();
    let committed = false;
    let pending: Promise<unknown> = Promise.resolve();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await holder.query(
        "SELECT used FROM dsor.limit_counters WHERE delegation = 'del_190' FOR UPDATE",
      );
      // Changed by step 25's sweep: the test waited for any lock that waited, on the whole server,
      // and another database's tests could end the wait too early. Now it waits for line ⑩ of its
      // own call to start: line ⑨ has read INV-9001 by then, and the call waits on the held row.
      let reached = (): void => {};
      const atLineTen = new Promise<void>((resolve) => (reached = resolve));
      const drafting = draft(registry, keyed(INTAKE), v + 1, (line) => {
        if (line === 10) reached();
      });
      pending = drafting;
      await atLineTen;
      expect(ownerInvoices("credit", "120000.00")).toStrictEqual({ version: v + 1 });
      await holder.query("COMMIT");
      committed = true;
      const answer = await drafting;
      expect(answer).toMatchObject({ code: "STALE_STATE" });
      const big = await rowsOf(
        "SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001' AND amount_value = 120000",
      );
      expect(big).toStrictEqual([{ n: 0 }]);
      expect(await usedToday()).toBe("31400.00");
    } finally {
      // A test that fails before its COMMIT rolls back, and waits for its draft, before anything
      // else runs: an owner script blocks this process, and would wait for the draft's lock for
      // ever. Found by step 25b's review.
      if (!committed) await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      await Promise.allSettled([pending]);
      ownerInvoices("credit", "31400.00");
    }
  });

  // Found by step 24's review (M1): a replay of a propose_only call that lines ⑨ and ⑩ refused gave
  // INTERNAL_ERROR on the database.
  it("DSOR-IDM-01c: on the database, a replay of a prepared call that line ⑩ refused hears the same refusal", async () => {
    for (let i = 0; i < 6; i++) await draft();
    const envelope = { ...keyed(INTAKE), mode: "propose_only" };
    const first = await draft(registry, envelope);
    const again = await draft(registry, envelope);
    expect(first).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(again).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(proposalId(again)).toBe(proposalId(first));
  });

  it("DSOR-IDM-01c: on the database, a replay of a prepared call that line ⑨ refused hears the same refusal", async () => {
    const envelope = { ...keyed(SUPERVISOR), mode: "propose_only" };
    const input = { invoice: "dsor://org_456/invoice/INV-9999", expected_version: 1 };
    const first = await call(registry, log, envelope, "payment.create", input);
    const again = await call(registry, log, envelope, "payment.create", input);
    expect(first).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(again).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  // Found by step 24's review (M2): the replay of a denied claim was recorded ALLOW.
  it("DSOR-EXE-02: on the database, the replay of a refused draft is recorded DENY, as its first call was", async () => {
    for (let i = 0; i < 6; i++) await draft();
    const envelope = keyed(INTAKE);
    const first = await draft(registry, {
      ...envelope,
      request_id: `s24-first-${envelope.idempotency_key}`,
    });
    const again = await draft(registry, {
      ...envelope,
      request_id: `s24-again-${envelope.idempotency_key}`,
    });
    expect([word(first), word(again)]).toStrictEqual(["LIMIT_EXCEEDED", "LIMIT_EXCEEDED"]);
    expect(await recordsOf(first.correlation.request_id)).toStrictEqual([
      { authorization: "DENY", result: "LIMIT_EXCEEDED" },
    ]);
    expect(await recordsOf(again.correlation.request_id)).toStrictEqual([
      { authorization: "DENY", result: "LIMIT_EXCEEDED" },
    ]);
  });

  // Found by step 24's review (M3): a paid invoice's open amount is 0.00, and the database refused
  // to keep a reservation of nothing, as an accident.
  it("Step 24: on the database, a draft of a paid invoice reserves nothing, and the code refuses it: CONFLICT, and its proposal ends FAILED", async () => {
    const answer = await asIntake(() =>
      call(registry, log, keyed(INTAKE), "payment.create", {
        invoice: "dsor://org_456/invoice/INV-1001",
        expected_version: 1,
      }),
    );
    expect(answer).toMatchObject({ code: "CONFLICT" });
    expect((await proposals.get("org_456", proposalId(answer)))?.state).toBe("FAILED");
    const kept = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.reservations WHERE proposal_id = $1",
      [proposalId(answer)],
    );
    expect(kept).toStrictEqual([{ n: 0 }]);
  });

  // Changed by step 24's review (M4): §21 reserves at line ⑩ in propose_only mode too.
  it("DSOR-DEL-06a: on the database, a prepared call reserves its amount, held while its proposal waits in READY", async () => {
    const answer = await draft(registry, { ...keyed(INTAKE), mode: "propose_only" });
    expect(word(answer)).toBe("READY");
    expect(
      await rowsOf("SELECT state FROM dsor.reservations WHERE proposal_id = $1", [
        proposalId(answer),
      ]),
    ).toStrictEqual([{ state: "held" }]);
    expect(await usedToday()).toBe("31400.00");
  });

  it("Step 24: on the database, the reservations refuse an amount in another currency, or with more digits than DSoR compares", async () => {
    const reservations = createDbReservations(pool);
    const limit = { value: "200000", currency: "USD" };
    const odd = [
      { value: "100.00", currency: "EUR" },
      { value: "100.0000001", currency: "USD" },
    ];
    for (const [i, amount] of odd.entries()) {
      const proposal = `prop_00000000-0000-4000-8000-00000000025${i}`;
      expect(await reservations.reserve("org_456", proposal, "del_190", amount, limit)).toBe(false);
      expect(await reservations.fits("org_456", "del_190", amount, limit)).toBe(false);
    }
    expect(await usedToday()).toBe("0.00");
  });

  it("Step 24: on the database, an accident rolls the reservation back with the claim, the proposal, and the draft (step 24's README, decision 7)", async () => {
    const shipped = handlersFor();
    const breaking = dbRegistry(pool, storyDirectories(), {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        throw new Error("the connection dropped after the draft");
      },
    });
    const envelope = keyed(INTAKE);
    const answer = await draft(breaking, envelope);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    const left = await rowsOf(
      `SELECT (SELECT count(*)::int FROM dsor.idempotency WHERE idempotency_key = $1) AS claims,
              (SELECT count(*)::int FROM dsor.proposals WHERE idempotency_key = $1) AS proposals,
              (SELECT count(*)::int FROM dsor.reservations WHERE delegation = 'del_190') AS reservations`,
      [envelope.idempotency_key],
    );
    expect(left).toStrictEqual([{ claims: 0, proposals: 0, reservations: 0 }]);
    expect(await usedToday()).toBe("0.00");
  });

  it("DSOR-DEL-06a: on the database, the day's limit may be reached exactly, and not passed", async () => {
    ownerLimits("daily-only", "62800");
    try {
      const words: string[] = [];
      words.push(word(await draft()));
      // One draft's room is left, exactly: a dry run of one more fits.
      words.push(word(await draft(registry, { ...INTAKE, mode: "validate_only" })));
      words.push(word(await draft()));
      words.push(word(await draft()));
      expect(words).toStrictEqual(["COMMITTED", "VALIDATED", "COMMITTED", "LIMIT_EXCEEDED"]);
      expect(await usedToday()).toBe("62800.00");
    } finally {
      ownerLimits("add");
    }
  });

  it("Step 24: on the database, a day's total can never go below zero", async () => {
    await draft();
    const client = await observer.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await expect(
        client.query("UPDATE dsor.limit_counters SET used = -1 WHERE delegation = 'del_190'"),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("Step 24: on the database, a dry run on a new day sees the new day's room", async () => {
    for (let i = 0; i < 6; i++) await draft();
    expect(word(await draft(registry, { ...INTAKE, mode: "validate_only" }))).toBe(
      "LIMIT_EXCEEDED",
    );
    ownerLimits("yesterday");
    expect(word(await draft(registry, { ...INTAKE, mode: "validate_only" }))).toBe("VALIDATED");
  });
});

describe("from step 24's third sweep, on the database", () => {
  // Found by the sweep (M5): no test made a day's first amount equal to the day's limit, so the
  // first draft's statement could refuse it, and every test stayed green.
  it("DSOR-DEL-06a: on the database, a day's first draft may take the day's whole limit, exactly", async () => {
    ownerLimits("daily-only", "31400");
    try {
      expect([word(await draft()), word(await draft())]).toStrictEqual([
        "COMMITTED",
        "LIMIT_EXCEEDED",
      ]);
      expect(await usedToday()).toBe("31400.00");
    } finally {
      ownerLimits("add");
    }
  });

  // Found by the sweep (M7): the day was the session's own date, and every test stayed green. The
  // test database's time zone is Asia/Karachi, whose date differs from UTC's five hours a day. So
  // the draft runs in two sessions far from UTC: one twelve hours behind it, and one fourteen hours
  // ahead. At every hour, one of the two is on another date than UTC.
  it("Step 24: on the database, the day's total is kept on UTC's date, whatever the session's time zone (step 24's README, decision 3)", async () => {
    for (const zone of ["Etc/GMT+12", "Etc/GMT-14"]) {
      ownerLimits("reset");
      const zoned = new pg.Pool({
        connectionString: RUNTIME_URL,
        max: 2,
        options: `-c TimeZone=${zone}`,
      });
      try {
        expect(word(await draft(dbRegistry(zoned)))).toBe("COMMITTED");
        const { rows } = await tryThenRollBack(
          zoned,
          `SELECT day::text AS day, ((now() AT TIME ZONE 'UTC')::date)::text AS utc
             FROM dsor.limit_counters WHERE delegation = 'del_190'`,
          "org_456",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.["day"]).toBe(rows[0]?.["utc"]);
      } finally {
        await zoned.end();
      }
    }
  });
});
