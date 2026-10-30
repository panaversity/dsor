// The two things one in-process connection cannot prove.
//
// `audit-permissions.test.ts` runs against PGlite — real PostgreSQL, in-process — and proves that
// `UPDATE dsor.audit` is refused. It has one connection, so it reaches the application's account with
// `SET ROLE` rather than by logging in as it, and it cannot race itself. Those two gaps are what
// this file is for, and they need a server.
//
// It runs only under `pnpm test:db`, and only with DSOR_DB_URL set. `pnpm check` never collects it,
// so the step still runs with no database and no network — and a skipped test says so in the report
// rather than passing quietly.
//
// Rule DSOR-AUD-04a: the DSoR runtime identity MUST NOT be able to update or delete audit records.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyMigrations, asRunner } from "../src/migrations.ts";
import { openTheDatabase, overPool } from "../src/database.ts";
import {
  audit,
  type Database,
  recordTogether,
  resetClock,
  setClock,
  theHead,
  theLog,
  theRecordsAlone,
  useDatabase,
  verifyChain,
} from "../src/audit.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

/**
 * Two pools, which is the point of the file: one connected as the owner, one as the application.
 *
 * The in-process tests cannot do this. `SET ROLE` applies the same privilege checks, so what is
 * untested there is whether `dsor_runtime` *connecting* is given the same answers — and a role whose
 * rights differ depending on how it arrived is exactly the kind of thing worth not assuming.
 */
let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  application = new Pool({ connectionString: APPLICATION, max: 3 });

  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  // NEW IN STEP 22, decision 157: the moves first: each names its record in the log.
  await owner.query("DELETE FROM dsor.proposal_moves");
  await owner.query("DELETE FROM dsor.audit");
});

afterAll(async () => {
  // Clear the table on the way out, not only on the way in. These tests insert records with
  // deliberately fake hashes — `sha256:0`, `req_0` — because what they are testing is the
  // UNIQUE constraint and the GRANTs, not hashing. Left behind, those rows become the start of
  // the chain the demo appends to, and `pnpm start` then reports a *correctly* broken chain:
  //
  //     21 records, chain verifies against the head: false
  //
  // which cost an hour to explain, and which a learner running `pnpm test:db` before `pnpm start`
  // would hit with no idea why. A test that shares a database with the program cleans up after
  // itself. Found live 2026-10-04.
  // NEW IN STEP 22, decision 157: the moves first: each names its record in the log.
  await owner?.query("DELETE FROM dsor.proposal_moves");
  await owner?.query("DELETE FROM dsor.audit");
  await owner?.end();
  await application?.end();
});

/** One decision, shaped like the record the program writes. */
function aDecision(sequence: number, id = `audit:org_456:${sequence}`): [string, unknown[]] {
  return [
    `INSERT INTO dsor.audit (
       record_id, chain, sequence, previous_hash, record_hash, at, tenant, kind,
       identity, correlation, result
     ) VALUES ($1, 'audit:org_456', $2, $3, $4, now(), 'org_456', 'decision', $5, $6, 'ALLOWED')`,
    [
      id,
      sequence,
      `sha256:${"0".repeat(64)}`,
      `sha256:${sequence}`,
      JSON.stringify({
        mode: "direct",
        subject: "user_123",
        actor_chain: [],
        subject_authority: { source: "role_source", as_of: new Date().toISOString() },
      }),
      JSON.stringify({ request_id: `req_${sequence}` }),
    ],
  ];
}

/**
 * STEP 11: a raw statement as the application, for org_456, on a real pooled connection.
 *
 * Through the same adapter the program uses, so each statement takes a connection from the pool,
 * says the company for one transaction, and gives the connection back clean. Three racers through
 * this are three real connections, which is what this file exists to test.
 */
function forOrg456<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
  return overPool(application).query<T>(sql, params, "org_456");
}

describe.skipIf(!haveAServer)("against a real server, as a real second user", () => {
  it("the application connects as itself and may add a record", async () => {
    const who = await application.query<{ user: string }>("SELECT current_user AS user");

    // Logged in as the application, not a role assumed from somewhere more privileged.
    expect(who.rows[0]!.user).toBe("dsor_runtime");

    const [sql, params] = aDecision(0);

    await expect(forOrg456(sql, params)).resolves.toBeDefined();
  });

  it("DSOR-AUD-04a: the application, logged in as itself, may not change or delete a record", async () => {
    for (const forbidden of [
      "UPDATE dsor.audit SET result = 'ALLOWED'",
      "DELETE FROM dsor.audit",
      "TRUNCATE dsor.audit",
    ]) {
      await expect(forOrg456(forbidden), forbidden).rejects.toThrow(/permission denied/);
    }

    // Still there, which is the assertion that matters.
    const left = await owner.query<{ n: string }>("SELECT count(*)::text AS n FROM dsor.audit");

    expect(left.rows[0]!.n).not.toBe("0");
  });

  /**
   * Two writers, racing for one position in the chain.
   *
   * `src/audit.ts` reads the tail and then inserts, and it has to: `sequence` and `previous_hash` are
   * both inside the hash, so they are known before the record exists. Step 08 did the same thing in
   * an array, where both writers won and the log quietly held two records at one position.
   *
   * `UNIQUE (chain, sequence)` is what makes that safe, and this is the only test that can see it —
   * one connection cannot race itself, which is why the in-process tests leave this gap open and say
   * so. Exactly one writer must win.
   *
   * THE TEST USED TO PROVE SOMETHING ELSE. It sent the *same* `aDecision(0)` three times, which
   * means the same `record_id` three times — so the two losers were refused by `audit_pkey`, the
   * primary key on `record_id`, and `UNIQUE (chain, sequence)` was never consulted. Dropping the
   * unique constraint entirely left the test green. Three different ids racing for one position is
   * what actually exercises it, and the constraint is now named in the assertion so the claim above
   * is checkable rather than decorative.
   */
  it("DSOR-AUD-01: two writers cannot both claim one position in the chain", async () => {
    // NEW IN STEP 22, decision 157: the moves first: each names its record in the log.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");

    // Three different record ids, all claiming position 0 of the same chain. Nothing here collides
    // on the primary key, so only the unique constraint can refuse them.
    const racers = [0, 1, 2].map((which) => aDecision(0, `audit:org_456:racer_${which}`));
    const bothAtOnce = await Promise.allSettled(
      racers.map(([sql, params]) => forOrg456(sql, params)),
    );
    const won = bothAtOnce.filter((one) => one.status === "fulfilled");
    const lost = bothAtOnce.filter((one) => one.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(2);

    // Which constraint did the refusing. This is the whole point of the test.
    for (const refusal of lost) {
      const message = (refusal as PromiseRejectedResult).reason as { message: string };

      expect(message.message).toMatch(/audit_chain_sequence_key/);
    }

    const rows = await owner.query<{ n: string }>("SELECT count(*)::text AS n FROM dsor.audit");

    expect(rows.rows[0]!.n).toBe("1");
  });

  it("DSOR-AUD-01: one record id cannot be written twice, by the primary key", async () => {
    // The other constraint, kept as its own test now that the one above no longer covers it by
    // accident. Same id, two different positions — so only `audit_pkey` can refuse it.
    // NEW IN STEP 22, decision 157: the moves first: each names its record in the log.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");

    const [first, firstParams] = aDecision(0, "audit:org_456:same");
    const [second, secondParams] = aDecision(1, "audit:org_456:same");

    await forOrg456(first, firstParams);
    await expect(forOrg456(second, secondParams)).rejects.toThrow(/audit_pkey/);
  });

  it("DSOR-AUD-04a: the application cannot grant itself the rights back", async () => {
    // Accepted with a warning and granting nothing, which is PostgreSQL's way — so the assertion is
    // about the privilege, never about whether the statement threw. Lesson 19.
    await application.query("GRANT UPDATE ON dsor.audit TO dsor_runtime").catch(() => undefined);

    // Asked of PostgreSQL, not of the grant catalogue. This read `role_table_grants` and expected
    // `["INSERT", "SELECT"]`, and it broke the day `002_runtime_user.sql` started granting INSERT
    // column by column — correctly, because there is no table-level INSERT row any more. A
    // catalogue listing answers "what did somebody type"; `has_*_privilege` answers "what will
    // happen when the statement runs", counting a direct grant, PUBLIC, role membership, a column
    // grant, and superuser bypass. Third place in this step that made the same mistake.
    const may = await application.query<{
      insert_any: boolean;
      insert_recorded_at: boolean;
      select: boolean;
      update: boolean;
      del: boolean;
      truncate: boolean;
    }>(
      `SELECT has_column_privilege('dsor_runtime', 'dsor.audit', 'record_id', 'INSERT') AS insert_any,
              has_column_privilege('dsor_runtime', 'dsor.audit', 'recorded_at', 'INSERT')
                AS insert_recorded_at,
              has_table_privilege('dsor_runtime', 'dsor.audit', 'SELECT')   AS select,
              has_table_privilege('dsor_runtime', 'dsor.audit', 'UPDATE')   AS update,
              has_table_privilege('dsor_runtime', 'dsor.audit', 'DELETE')   AS del,
              has_table_privilege('dsor_runtime', 'dsor.audit', 'TRUNCATE') AS truncate`,
    );
    const held = may.rows[0]!;

    // What it needs, still there — the GRANT it issued itself changed nothing in either direction.
    expect(held.insert_any).toBe(true);
    expect(held.select).toBe(true);

    // What it must not have, including the witness column it tried to grant itself nothing about.
    expect([held.update, held.del, held.truncate, held.insert_recorded_at]).toStrictEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe.skipIf(!haveAServer)("the program's own door, pointed at a real server", () => {
  /**
   * The `pg` branch of `openTheDatabase`, which no test on either tier executed. The in-process
   * tests stub `DSOR_DB_URL` to "" so they never enter it; the demo subprocess is pinned the same
   * way. A critic's prediction: delete the refusal on that branch and nothing fails. This file is
   * what makes that prediction false — it needs the two real logins, so it lives in this tier.
   */
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("DSOR-AUD-04a: pointed at the owner, the program refuses to start", async () => {
    vi.stubEnv("DSOR_DB_URL", OWNER!);

    await expect(openTheDatabase()).rejects.toThrow(/may UPDATE, DELETE, TRUNCATE/);
  });

  it("DSOR-AUD-04a: pointed at the application, it starts, says so, and still cannot UPDATE", async () => {
    vi.stubEnv("DSOR_DB_URL", APPLICATION!);

    const opened = await openTheDatabase();

    try {
      expect(opened.where).toContain("the PostgreSQL at");
      expect(opened.where).not.toContain("on disk");

      // Through the program's own connection, on a real server, as a real login.
      const who = await opened.connection.query<{ u: string }>("SELECT current_user AS u");

      expect(who.rows[0]?.u).toBe("dsor_runtime");
      await expect(opened.connection.query("UPDATE dsor.audit SET result = 'x'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await opened.close();
    }
  });
});

describe.skipIf(!haveAServer)("the program's own writer, against a real server", () => {
  /**
   * Two questions every in-process measurement left open, answered where they can only be answered.
   *
   * Which constraint refuses a collision of the program's OWN row shape? `record_id` is
   * `${chain}:${sequence}`, so two writers at one position collide on the primary key and the unique
   * constraint both, and PGlite named `audit_pkey`. PostgreSQL 17 should check indexes in the same
   * order. "Should" is the word this test removes.
   *
   * And does the writer survive genuine parallelism — three `audit()` calls on three real connections
   * from one pool, no fault injection, no held reads?
   */
  afterEach(() => {
    resetClock();
  });

  it("DSOR-AUD-01: a collision of the program's own row shape is refused by the primary key", async () => {
    // NEW IN STEP 22, decision 157: the moves first: each names its record in the log.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");

    const [sql, params] = aDecision(0); // record_id audit:org_456:0 AND (chain, sequence) = (…, 0)

    await forOrg456(sql, params);

    const refusal = await forOrg456(sql, [...params]).then(
      () => "accepted",
      (e: unknown) => e as { constraint?: string; code?: string },
    );

    expect(refusal).toMatchObject({ code: "23505", constraint: "audit_pkey" });
  });

  it("DSOR-AUD-01: three writers at once, on three real connections, leave one verifiable chain", async () => {
    // NEW IN STEP 22, decision 157: the moves first: each names its record in the log.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");
    setClock(() => "2026-10-04T00:00:00.000Z");
    // NEW IN STEP 22, decision 158, found by a second review: through a database that takes no turns,
    // so that the three really do run side by side on a pool of three. In turns they would go one at
    // a time, and this test is about writers that race, as a writer that takes no turns still can.
    const raced = overPool(application);

    useDatabase({ query: (sql, params, tenant) => raced.query(sql, params, tenant) });

    const decision = (id: string) =>
      ({
        kind: "decision",
        subject: "user_123",
        tenant: "org_456",
        requestId: id,
        operation: "invoice.get@1",
        authorization: "ALLOW",
        result: "ALLOWED",
      }) as const;
    const outcomes = await Promise.allSettled([
      audit(decision("req_a")),
      audit(decision("req_b")),
      audit(decision("req_c")),
    ]);
    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");

    // How many collide is up to the scheduler. What is not up to it: every loser was refused by the
    // database with 23505 (never absorbed, never reported unknown), every winner is in the log, and
    // the log is one chain that verifies.
    expect(won.length).toBeGreaterThanOrEqual(1);
    expect(won.length + lost.length).toBe(3);

    for (const loser of lost) {
      expect(loser.reason).toMatchObject({ code: "23505" });
    }

    const log = await theLog("org_456");

    expect(log).toHaveLength(won.length);
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });

  /** NEW IN STEP 22, decision 158: a decision of user_123's, for `tenant`, under a request id of its own. */
  const decisionFor = (tenant: string, requestId: string) =>
    ({
      kind: "decision",
      subject: "user_123",
      tenant,
      requestId,
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "ALLOWED",
    }) as const;

  /**
   * NEW IN STEP 22, decision 158: how many transactions on this database wait for org_456's turn at
   * its log. Asked of the turn's own key, `hashtext('dsor.audit')` and `hashtext('audit:org_456')`,
   * so another database's tests, or another line, are not counted (found by a review).
   */
  async function waitingForTheTurn(): Promise<number | undefined> {
    const { rows } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid = hashtext('dsor.audit')::oid
          AND objid = hashtext('audit:org_456')::oid
          AND objsubid = 2`,
    );

    return rows[0]?.n;
  }

  /**
   * NEW IN STEP 22, decision 158: org_456's turn at its log, held through `db` until let go. A turn may
   * sit idle ten seconds, so the holder says a word to the database every two.
   */
  function holdTheTurn(db: Database): {
    held: Promise<void>;
    holding: Promise<void>;
    letGo: () => void;
  } {
    const turn = db.inTurn;

    if (turn === undefined) {
      throw new Error("the pool takes no turns");
    }

    let letGo = (): void => {};
    const until = new Promise<boolean>((resolve) => {
      letGo = () => resolve(true);
    });
    let inside = (): void => {};
    const holding = new Promise<void>((resolve) => {
      inside = resolve;
    });
    const held = turn("org_456", "audit:org_456", async (statements) => {
      inside();

      while (
        !(await Promise.race([
          until,
          new Promise<boolean>((r) => setTimeout(() => r(false), 2000)),
        ]))
      ) {
        await statements.query("SELECT 1");
      }
    });

    return { held, holding, letGo };
  }

  it("DSOR-AUD-01: a writer waits for its company's turn at the log, reads the end only then, and writes after it", async () => {
    // NEW IN STEP 22, decision 158. Measured on Neon, 127 ms away: fifty reads sent at once by one
    // company raced for the end of its log, and most of them lost ten places in a row and were
    // refused. Now a writer waits for the company's turn. This test holds the turn itself, as another
    // program on the same database would, and asks PostgreSQL whether the writer waits for it. While
    // it waits, a writer that takes no turns, as a person at the database would, writes the end of
    // the log. The waiting writer may take one place only, so it must read the end after its turn is
    // given, or it loses that place and fails.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");
    setClock(() => "2026-10-04T00:00:00.000Z");

    // Two programs: this pool holds the turn, and a second one's writer waits for it.
    const secondPool = new Pool({ connectionString: APPLICATION, max: 2 });
    const second = overPool(secondPool);
    const { held, holding, letGo } = holdTheTurn(overPool(application));

    try {
      await holding;
      useDatabase(second);

      const writer = recordTogether(
        "org_456",
        [decisionFor("org_456", "req_waits")],
        theRecordsAlone,
        1,
      );

      await expect.poll(waitingForTheTurn, { timeout: 20_000, interval: 100 }).toBe(1);

      useDatabase({ query: (sql, params, tenant) => second.query(sql, params, tenant) });
      await audit(decisionFor("org_456", "req_takes_no_turn"));
      useDatabase(second);

      letGo();
      await held;

      const { records } = await writer;
      const log = await theLog("org_456");

      expect(records[0]?.sequence).toBe(1);
      expect(log).toHaveLength(2);
      expect(verifyChain(log, await theHead("org_456"))).toBe(true);
    } finally {
      letGo();
      await held.catch(() => {});
      await secondPool.end();
    }
  }, 60_000);

  it("DSOR-TEN-02a: one company's crowd at its log waits in the program, and another company's request is not kept waiting", async () => {
    // NEW IN STEP 22, decision 158, found by a review: waiting for a turn on the database holds a
    // connection, so a crowd of org_456's writers could take every connection in the pool, and
    // org_789's next request would wait behind them for one. Here the pool has three: org_456's turn
    // takes one, the first of its crowd takes another to wait on the database's lock, the rest wait in
    // the program, and org_789 is given the third.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");
    setClock(() => "2026-10-04T00:00:00.000Z");

    const threePool = new Pool({ connectionString: APPLICATION, max: 3 });
    const db = overPool(threePool);

    useDatabase(db);

    const { held, holding, letGo } = holdTheTurn(db);

    try {
      await holding;

      const crowd = ["req_crowd_1", "req_crowd_2", "req_crowd_3"].map((id) =>
        audit(decisionFor("org_456", id)),
      );
      const other = audit(decisionFor("org_789", "req_other"));
      const outcome = await Promise.race([
        other.then(() => "written"),
        new Promise<string>((resolve) => setTimeout(() => resolve("kept waiting"), 15_000)),
      ]);

      expect(outcome).toBe("written");

      letGo();
      await held;
      await Promise.all(crowd);

      expect(await theLog("org_456")).toHaveLength(3);
    } finally {
      letGo();
      await held.catch(() => {});
      await threePool.end();
    }
  }, 60_000);

  it("DSOR-AUD-01: a turn whose program goes quiet ends after ten seconds, and the next writer is given it", async () => {
    // NEW IN STEP 22, decision 158, found by a review: a program that stalls in its turn, or whose
    // network goes quiet without closing, would hold its company's log for ever. Its turn ends when it
    // has sat idle ten seconds, and the writer behind it goes on. One program, found by a second
    // review: the writer waits in the program's line first, which lets it go once the quiet turn is
    // taken, and then on the database's lock, which PostgreSQL lets go.
    await owner.query("DELETE FROM dsor.proposal_moves");
    await owner.query("DELETE FROM dsor.audit");
    setClock(() => "2026-10-04T00:00:00.000Z");

    const onePool = new Pool({ connectionString: APPLICATION, max: 3 });
    const holder = overPool(onePool);

    if (holder.inTurn === undefined) {
      throw new Error("the pool takes no turns");
    }

    let inside = (): void => {};
    const holding = new Promise<void>((resolve) => {
      inside = resolve;
    });
    const quiet = holder.inTurn("org_456", "audit:org_456", async () => {
      inside();
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    });

    try {
      await holding;
      useDatabase(holder);

      const started = Date.now();
      const written = await audit(decisionFor("org_456", "req_after_the_quiet_one"));
      const waited = Date.now() - started;

      expect(written?.sequence).toBe(0);
      // It waited for the turn, and not for the twenty seconds the quiet one meant to keep it.
      expect(waited).toBeGreaterThanOrEqual(9_000);
      expect(waited).toBeLessThan(18_000);
      await expect(quiet).rejects.toThrow();
    } finally {
      await quiet.catch(() => {});
      await onePool.end();
    }
  }, 60_000);
});
