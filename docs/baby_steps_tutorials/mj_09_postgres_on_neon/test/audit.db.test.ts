// NEW IN STEP 09: the letterbox. The log is a table, dsor_runtime can drop a record in and
// read it, and can never change or remove one. By claim, C1 to C5 in step 09's README.
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool, runtimeRoleProblems } from "../src/postgres.ts";
import { handlersFor } from "../src/operations.ts";
import { buildRegistry } from "../src/registry.ts";
import {
  NO_PRIVILEGE,
  PRIVILEGES_HELD,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  requestId,
  rowsFor,
  tryThenRollBack,
} from "./db.ts";
import { AGENT, shipped, shippedRoles } from "./helpers.ts";

// The test's own window into the database: a pool the code under test never uses.
const observer = newPool();
afterAll(() => observer.end());

describe("C1: dsor_runtime cannot change or remove an audit record", () => {
  // Postgres checks the privilege before it looks for rows. Each try is rolled back, so a
  // break that hands out the privilege still cannot change a record (test/db.ts).
  it("DSOR-AUD-04a: UPDATE on dsor.audit fails with 42501", async () => {
    await expect(
      tryThenRollBack(observer, "UPDATE dsor.audit SET result = 'ok'"),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("DSOR-AUD-04a: DELETE on dsor.audit fails with 42501", async () => {
    await expect(tryThenRollBack(observer, "DELETE FROM dsor.audit")).rejects.toMatchObject(
      NO_PRIVILEGE,
    );
  });

  // "No DELETE" does not cover TRUNCATE, a privilege of its own that empties a table.
  it("DSOR-AUD-04a: TRUNCATE on dsor.audit fails with 42501", async () => {
    await expect(tryThenRollBack(observer, "TRUNCATE dsor.audit")).rejects.toMatchObject(
      NO_PRIVILEGE,
    );
  });

  // The whole list, so a GRANT added by mistake shows here even if no test above tries it
  // (step 09's README, decision 5). Found by the review: a list of whole-table grants
  // missed a grant on one column, on the sequence, and CREATE in a schema. Postgres's own
  // has_..._privilege functions answer for every one, memberships included.
  it("DSOR-AUD-04a: dsor_runtime holds exactly decision 5's privileges, column by column", async () => {
    const { rows } = await observer.query(PRIVILEGES_HELD);
    expect(rows).toStrictEqual([
      { object: "app.invoices", held: "SELECT" },
      { object: "dsor.audit", held: "SELECT" },
      {
        object: "dsor.audit INSERT",
        held: "record_id kind operation authorization result reason correlation",
      },
      { object: "schema app", held: "USAGE" },
      { object: "schema dsor", held: "USAGE" },
      { object: "schema public", held: "USAGE" },
    ]);
  });

  // The database numbers and times each record (step 09's README, decision 6). Found by
  // the review: with INSERT on the whole table, the program could backdate a record.
  it("DSOR-AUD-04a: an INSERT that sets the record's time fails with 42501", async () => {
    await expect(
      tryThenRollBack(
        observer,
        `INSERT INTO dsor.audit (record_id, at, kind, "authorization", result, correlation)
         VALUES ('aud_backdated', '2001-01-01', 'decision', 'ALLOW', 'ok', '{}')`,
      ),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("DSOR-AUD-04a: an INSERT that chooses the record's number fails with 42501", async () => {
    await expect(
      tryThenRollBack(
        observer,
        `INSERT INTO dsor.audit (sequence, record_id, kind, "authorization", result, correlation)
         OVERRIDING SYSTEM VALUE
         VALUES (999999, 'aud_renumbered', 'decision', 'ALLOW', 'ok', '{}')`,
      ),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });

  // An owner may do anything to its own table, and a superuser or a member of
  // pg_write_all_data may change any table, whatever was revoked. Neon puts roles made in
  // its console into neon_superuser, which holds pg_write_all_data (step 09's README).
  it("DSOR-AUD-04a: dsor_runtime owns no table, is no superuser, and cannot write every table", async () => {
    const { rows } = await observer.query(
      `SELECT r.rolsuper AS superuser,
              r.rolbypassrls AS bypassrls,
              pg_has_role(r.oid, 'pg_write_all_data', 'MEMBER') AS writes_all,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows).toStrictEqual([
      { superuser: false, bypassrls: false, writes_all: false, owns: 0 },
    ]);
  });

  // The program asks the same questions at start-up, and refuses to run on a wrong answer
  // (step 09's README, decision 17).
  it("DSOR-AUD-04a: the program's start-up check finds no problem with dsor_runtime", async () => {
    expect(await runtimeRoleProblems(observer)).toStrictEqual([]);
  });

  it("the tests really are dsor_runtime", async () => {
    const { rows } = await observer.query("SELECT current_user AS who");
    expect(rows).toStrictEqual([{ who: "dsor_runtime" }]);
  });
});

describe("C2 and C5: when call answers, its record is already a row of dsor.audit", () => {
  const pool = openPool(RUNTIME_URL);
  afterAll(() => pool.end());
  const registry = dbRegistry(pool);
  const log = createDbLog(pool);

  it("DSOR-EXE-02: a success is committed before the answer, and another connection sees it", async () => {
    const id = requestId("c2-success");
    const answer = await call(registry, log, { ...AGENT, request_id: id }, "invoice.get", {
      id: "INV-1008",
    });
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    // Right after the answer, with no waiting: the observer is a separate connection.
    expect(await rowsFor(observer, id)).toMatchObject([
      {
        kind: "decision",
        operation: "invoice.get@1",
        authorization: "ALLOW",
        result: "ok",
        reason: null,
        correlation: answer.correlation,
      },
    ]);
  });

  it("DSOR-EXE-02: a refusal is committed before the answer too", async () => {
    const id = requestId("c2-denied");
    const answer = await call(registry, log, { ...AGENT, request_id: id }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await rowsFor(observer, id)).toMatchObject([
      { operation: "invoice.issue@1", authorization: "DENY", result: "AUTHORIZATION_DENIED" },
    ]);
  });

  // Found by the review: a NUL made the INSERT fail, so the call left no record at all.
  it.each([
    ["a NUL character", "ap\u0000desk"],
    ["half of an emoji", "ap\ud83d"],
  ])(
    "DSOR-EXE-02: a request id with %s is refused, and the refusal is recorded",
    async (_why, bad) => {
      const answer = await call(registry, log, { ...AGENT, request_id: bad }, "invoice.get", {
        id: "INV-1008",
      });
      expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
      // Recorded under the id DSoR made, because the one sent could not be kept.
      expect(answer.correlation.request_id).toMatch(/^req_/);
      expect(await rowsFor(observer, answer.correlation.request_id)).toMatchObject([
        { authorization: "DENY", result: "VALIDATION_FAILED" },
      ]);
    },
  );

  // The database numbers and timestamps each record (step 09's README, decision 6).
  it("DSOR-AUD-02a: the record is a row in DSoR's own table, numbered and timed by the database", async () => {
    const id = requestId("c5");
    await call(registry, log, { ...AGENT, request_id: id }, "invoice.get", { id: "INV-1008" });
    const rows = await rowsFor(observer, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["record_id"]).toMatch(/^aud_[0-9a-f-]{36}$/);
    expect(rows[0]!["at"]).toBeInstanceOf(Date);
    expect(Number(rows[0]!["sequence"])).toBeGreaterThan(0);
  });

  it("DSOR-EXE-02: the log reads back what it wrote, through its own records()", async () => {
    const id = requestId("c2-records");
    await call(registry, log, { ...AGENT, request_id: id }, "invoice.get", { id: "INV-1008" });
    const mine = (await log.records()).filter((r) => r.correlation.request_id === id);
    expect(mine).toMatchObject([{ authorization: "ALLOW", result: "ok" }]);
    expect(typeof mine[0]!.sequence).toBe("number");
    expect(typeof mine[0]!.at).toBe("string");
  });
});

describe("C3: the record survives a restart", () => {
  it("DSOR-EXE-02: every pool the program used is closed, new ones are opened, and the record is there", async () => {
    const id = requestId("c3");
    const before = openPool(RUNTIME_URL);
    await call(
      dbRegistry(before),
      createDbLog(before),
      { ...AGENT, request_id: id },
      "invoice.get",
      {
        id: "INV-1008",
      },
    );
    await before.end();

    const after = newPool();
    try {
      expect(await rowsFor(after, id)).toMatchObject([{ authorization: "ALLOW", result: "ok" }]);
    } finally {
      await after.end();
    }
  });
});

describe("C4: if the database cannot take the record, the caller hears EVIDENCE_STORE_UNAVAILABLE", () => {
  // Invoices come through a working pool, so the only thing that fails is the log.
  const invoices = openPool(RUNTIME_URL);
  afterAll(() => invoices.end());
  const registry = buildRegistry(shipped, handlersFor(createDbInvoices(invoices)), shippedRoles);

  it("DSOR-EXE-03b: a log whose pool is closed gives no invoice, and no record", async () => {
    const closed = openPool(RUNTIME_URL);
    await closed.end();
    const id = requestId("c4-closed");
    const answer = await call(
      registry,
      createDbLog(closed),
      { ...AGENT, request_id: id },
      "invoice.get",
      {
        id: "INV-1008",
      },
    );
    expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(answer).not.toHaveProperty("data");
    expect(await rowsFor(observer, id)).toStrictEqual([]);
  });

  it("DSOR-EXE-03b: a log with the wrong password gives no invoice, and no word about why", async () => {
    const wrong = new URL(RUNTIME_URL);
    wrong.password = "not-the-password";
    const pool = openPool(wrong.toString());
    try {
      const id = requestId("c4-wrong-secret");
      const answer = await call(
        registry,
        createDbLog(pool),
        { ...AGENT, request_id: id },
        "invoice.get",
        {
          id: "INV-1008",
        },
      );
      expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
      expect(answer).not.toHaveProperty("data");
      // What the database said stays inside: it names users and servers (step 08's
      // README, decision 4).
      expect(JSON.stringify(answer)).not.toMatch(/password|dsor_runtime|neon/i);
    } finally {
      await pool.end();
    }
  });
});
