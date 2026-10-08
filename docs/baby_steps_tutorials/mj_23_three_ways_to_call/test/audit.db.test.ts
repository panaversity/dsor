// The letterbox. The log is a table, dsor_runtime can drop a record in and
// read it, and can never change or remove one. By claim, C1 to C5 in step 09's README.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
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
  ownerLoginCheck,
  ownerRowsFor,
  requestId,
  redact,
  rowsFor,
  tryThenRollBack,
} from "./db.ts";
import { AGENT, shipped, shippedInputs, shippedLabels, shippedRoles } from "./helpers.ts";

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
      // SELECT on each column too, so a grant of one column alone shows
      // here. Found by the review of step 16.
      {
        object: "app.invoices SELECT",
        // And the version (step 21's README, decision 1).
        held: "id vendor_id amount_value amount_currency open_amount_value open_amount_currency status tenant_id version",
      },
      // Step 17's app.payments: read it, add a draft through named columns, change only its
      // status. Nothing on number or id, which the database writes (step 17's README,
      // decision 3).
      { object: "app.payments", held: "SELECT" },
      {
        object: "app.payments INSERT",
        held: "tenant_id invoice_id vendor_id amount_value amount_currency status",
      },
      {
        object: "app.payments SELECT",
        held: "number id tenant_id invoice_id vendor_id amount_value amount_currency status version",
      },
      { object: "app.payments UPDATE", held: "status" },
      { object: "dsor.audit", held: "SELECT" },
      {
        object: "dsor.audit INSERT",
        // Tenant too (step 10's README, decision 6). What a read returned,
        // and how many (step 14's README, decision 7). And which connector
        // served it (step 15's README, decision 7).
        // And step 18's identity and delegation, for an agent's call (step 18's README,
        // decision 8).
        held: "record_id kind operation authorization result reason correlation tenant extensions resources row_count connector identity delegation",
      },
      {
        object: "dsor.audit SELECT",
        held: "sequence record_id at kind operation authorization result reason correlation tenant extensions resources row_count connector identity delegation",
      },
      // Step 18's slips: read every column (step 18's README, decision 3).
      { object: "dsor.delegations", held: "SELECT" },
      {
        object: "dsor.delegations SELECT",
        held: "tenant_id id delegator delegate modes permissions constraints subdelegation parent status expires_at extensions",
      },
      // And change a slip's status, and nothing else, to suspend it
      // (step 19b's README, decision 3).
      { object: "dsor.delegations UPDATE", held: "status" },
      // The claims of idempotency keys. Read every column, add a claim through
      // named columns, and fill its answer once (step 20's README, decision 12).
      { object: "dsor.idempotency", held: "SELECT" },
      {
        object: "dsor.idempotency INSERT",
        // NEW IN STEP 23: and the mode (step 23's README, decision 13).
        held: "tenant_id principal operation idempotency_key payload_hash request_id mode",
      },
      {
        object: "dsor.idempotency SELECT",
        held: "tenant_id principal operation idempotency_key payload_hash request_id answer claimed_at mode",
      },
      { object: "dsor.idempotency UPDATE", held: "answer" },
      // The proposals. Read every column, add a proposal through named
      // columns, and change its state only. Nothing on created_at, which the database fills
      // (step 22's README, decisions 3 and 9).
      { object: "dsor.proposals", held: "SELECT" },
      {
        object: "dsor.proposals INSERT",
        held: "tenant_id id operation mode state payload payload_hash resources requester idempotency_key",
      },
      {
        object: "dsor.proposals SELECT",
        held: "tenant_id id operation mode state payload payload_hash resources requester idempotency_key created_at",
      },
      { object: "dsor.proposals UPDATE", held: "state" },
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
  // BYPASSRLS skips every policy, FORCE included, so row-level security
  // stands on this test. And a role dsor_runtime belongs to is one SET ROLE can switch to,
  // with all that role's powers. Found by the review (step 11's README, C6).
  it("DSOR-RP-01a: dsor_runtime is no superuser, holds no BYPASSRLS, owns no table, belongs to no role, and cannot write every table", async () => {
    const { rows } = await observer.query(
      `SELECT r.rolsuper AS superuser,
              r.rolbypassrls AS bypassrls,
              pg_has_role(r.oid, 'pg_write_all_data', 'MEMBER') AS writes_all,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns,
              (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS member_of
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows).toStrictEqual([
      { superuser: false, bypassrls: false, writes_all: false, owns: 0, member_of: 0 },
    ]);
  });

  // The program asks the same questions at start-up, and refuses to run on a wrong answer
  // (step 09's README, decision 17).
  it("DSOR-AUD-04a: the program's start-up check finds no problem with dsor_runtime", async () => {
    expect(await runtimeRoleProblems(observer)).toStrictEqual([]);
  });

  // The owner can set a search path that finds public first, and put functions there with
  // PostgreSQL's names that answer "no". The check must still read PostgreSQL's own, so the
  // owner, who can change the log, is told so. The child program makes the look-alikes
  // inside a transaction that is rolled back, so nothing is kept, and runs the check on
  // that connection. Found by step 16's review, and fixed from step 09 on.
  it("DSOR-AUD-04a: the start-up check reads PostgreSQL's own names, whatever the search path finds first", () => {
    const problems = ownerLoginCheck();
    expect(problems).toContain("can change or remove records in dsor.audit");
    expect(problems).toContain("is a member of pg_write_all_data");
    expect(problems).toContain("holds BYPASSRLS");
  });

  // SET LOCAL lasts only inside a transaction. Outside one, PostgreSQL ignores it and warns,
  // and the look-alikes above would answer again. So the check that the program runs, on its
  // pool, must open its own transaction, pin the path, ask, and roll back, in that order.
  // The test notes each statement the pool's connection sends, and hears every warning.
  // Found by step 16's review, and fixed from step 09 on. The list of statements came from
  // a review of step 15's port: a pool that skipped the pin sent no SET LOCAL, so nothing
  // warned, and the test passed.
  it("DSOR-AUD-04a: the start-up check pins the search path inside a transaction of its own", async () => {
    const pool = newPool();
    const notices: string[] = [];
    const sent: string[] = [];
    pool.on("connect", (client) => {
      client.on("notice", (notice) => notices.push(String(notice.message)));
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      // Every statement goes to the database as it was written, and is noted first.
      client.query = ((...args: unknown[]) => {
        sent.push(typeof args[0] === "string" ? args[0].trim() : "(not text)");
        return query(...args);
      }) as typeof client.query;
    });
    try {
      expect(await runtimeRoleProblems(pool)).toStrictEqual([]);
      expect(sent).toStrictEqual([
        "BEGIN READ ONLY",
        "SET LOCAL search_path TO pg_catalog, pg_temp",
        expect.stringMatching(/^SELECT r\.rolname AS who/),
        "ROLLBACK",
      ]);
      expect(notices).toStrictEqual([]);
    } finally {
      await pool.end();
    }
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
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    // Right after the answer, with no waiting: the observer is a separate connection.
    expect(await rowsFor(observer, "org_456", id)).toMatchObject([
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

  // The agent's command. Line ⑤ refused it until step 16, and line ③ in step 17. Since step
  // 18 the agent passes line ③ under del_100, which lists no invoice:issue, so line ⑤
  // refuses it again (step 18's README, decision 5). Either way, a refusal.
  it("DSOR-EXE-02: a refusal is committed before the answer too", async () => {
    const id = requestId("c2-denied");
    const answer = await call(registry, log, { ...AGENT, request_id: id }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await rowsFor(observer, "org_456", id)).toMatchObject([
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
        invoice: "dsor://org_456/invoice/INV-1008",
      });
      expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
      // Recorded under the id DSoR made, because the one sent could not be kept.
      expect(answer.correlation.request_id).toMatch(/^req_/);
      // Refused at line ①, before any company, so only the owner can read the record
      // (step 11's README, decision 4).
      expect(ownerRowsFor(answer.correlation.request_id)).toMatchObject([
        { tenant: null, authorization: "DENY", result: "VALIDATION_FAILED" },
      ]);
    },
  );

  // The database numbers and timestamps each record (step 09's README, decision 6).
  it("DSOR-AUD-02a: the record is a row in DSoR's own table, numbered and timed by the database", async () => {
    const id = requestId("c5");
    await call(registry, log, { ...AGENT, request_id: id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    const rows = await rowsFor(observer, "org_456", id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["record_id"]).toMatch(/^aud_[0-9a-f-]{36}$/);
    expect(rows[0]!["at"]).toBeInstanceOf(Date);
    expect(Number(rows[0]!["sequence"])).toBeGreaterThan(0);
  });

  it("DSOR-EXE-02: the log reads back what it wrote, through its own records(tenant)", async () => {
    const id = requestId("c2-records");
    await call(registry, log, { ...AGENT, request_id: id }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    const mine = (await log.records("org_456")).filter((r) => r.correlation.request_id === id);
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
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    await before.end();

    const after = newPool();
    try {
      expect(await rowsFor(after, "org_456", id)).toMatchObject([
        { authorization: "ALLOW", result: "ok" },
      ]);
    } finally {
      await after.end();
    }
  });
});

// A crash, not a restart. Found by the second review: closing pools
// politely proves only that a record survives a restart (step 09's README, C3).
describe("C3, by fault injection: the record survives a crash straight after the answer", () => {
  const CRASH = fileURLToPath(new URL("crash-after-answer.ts", import.meta.url));

  it(
    "DSOR-EXE-02: a program killed with SIGKILL the moment it answers has left its record",
    { timeout: 120_000 },
    async () => {
      // Three times, because a missing await loses a race, and a race can be won once.
      for (let run = 1; run <= 3; run++) {
        const id = requestId("c3-crash");
        const child = spawnSync(process.execPath, [CRASH, id], {
          encoding: "utf8",
          timeout: 60_000,
        });
        expect(child.signal).toBe("SIGKILL");
        // The caller heard "yes"...
        expect(JSON.parse(redact(child.stdout, { "<runtime URL>": RUNTIME_URL }))).toMatchObject({
          data: { id: "INV-1008" },
          correlation: { request_id: id },
        });
        // ...so the record must already be in the database.
        expect(await rowsFor(observer, "org_456", id)).toMatchObject([
          { authorization: "ALLOW", result: "ok" },
        ]);
      }
    },
  );
});

describe("C4: if the database cannot take the record, the caller hears EVIDENCE_STORE_UNAVAILABLE", () => {
  // Invoices come through a working pool, so the only thing that fails is the log.
  const invoices = openPool(RUNTIME_URL);
  afterAll(() => invoices.end());
  const registry = buildRegistry(
    shipped,
    handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    createDbInvoices(invoices),
  );

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
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(answer).not.toHaveProperty("data");
    expect(await rowsFor(observer, "org_456", id)).toStrictEqual([]);
  });

  // The tests of a closed pool and of a wrong password fail before the
  // transaction begins, at pool.connect(). Here the INSERT itself fails, inside
  // inCompany's transaction, because the log's connections are read-only. Found by step
  // 11's review: with the error swallowed inside inCompany, the caller got the invoice and
  // no record was kept.
  it("DSOR-EXE-03b: a log whose INSERT fails inside its transaction gives no invoice, and no record", async () => {
    const readOnly = new pg.Pool({ connectionString: RUNTIME_URL, max: 1 });
    readOnly.on("connect", (client) => {
      void client.query("SET default_transaction_read_only = on");
    });
    try {
      const id = requestId("c4-read-only");
      const answer = await call(
        registry,
        createDbLog(readOnly),
        { ...AGENT, request_id: id },
        "invoice.get",
        { invoice: "dsor://org_456/invoice/INV-1008" },
      );
      expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
      expect(answer).not.toHaveProperty("data");
      expect(await rowsFor(observer, "org_456", id)).toStrictEqual([]);
    } finally {
      await readOnly.end();
    }
  });

  // A COMMIT that fails, by fault injection around the real client (§47). The database is
  // real, and so is the work: the record is written inside its transaction. Then the first
  // COMMIT never leaves the client. The client hears that it failed, and the transaction
  // stays open on the database, record and all, until inCompany's own ROLLBACK ends it.
  // With the COMMIT not awaited, every test passed (step 11's README, decision 10). Found
  // by the Stage 2 review, and fixed from step 11 on.
  it("DSOR-EXE-03b: a log whose COMMIT fails gives no invoice, and no record", async () => {
    const failing = new pg.Pool({ connectionString: RUNTIME_URL, max: 1 });
    // How many COMMITs reached the fault, so the test knows it fired, and fired once.
    let commits = 0;
    failing.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      // Every statement goes to the database as it was written, except the first COMMIT.
      client.query = ((...args: unknown[]) => {
        if (args[0] === "COMMIT" && ++commits === 1) {
          return Promise.reject(new Error("fault injected: the COMMIT failed"));
        }
        return query(...args);
      }) as typeof client.query;
    });
    try {
      const id = requestId("c4-commit-fails");
      const answer = await call(
        registry,
        createDbLog(failing),
        { ...AGENT, request_id: id },
        "invoice.get",
        { invoice: "dsor://org_456/invoice/INV-1008" },
      );
      expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
      expect(answer).not.toHaveProperty("data");
      // The record was written, and inCompany's ROLLBACK took it away. A COMMIT sent in its
      // place would keep it here. Found by a hostile pass on the Stage 2 review's fix.
      expect(await rowsFor(observer, "org_456", id)).toStrictEqual([]);
      expect(commits).toBe(1);
    } finally {
      await failing.end();
    }
  });

  // The database can take an INSERT and keep no row: a rule DO INSTEAD NOTHING on the log,
  // or a trigger that returns NULL. Here the log's own values go in an INSERT that matches
  // no row: a real statement, on the real database, and no mock. Only that INSERT changes,
  // by fault injection around the real client, as in the test above. Found by step 16's
  // review, and fixed from step 09 on.
  it("DSOR-EXE-03b: a log whose INSERT keeps no row gives no invoice, and no record", async () => {
    const swallowing = new pg.Pool({ connectionString: RUNTIME_URL, max: 1 });
    // The log's own columns, each value cast to its column's type in the migrations. Since
    // step 18 the log writes two more, an agent's identity and slip (step 18's README,
    // decision 8). Found by step 18's run on a local PostgreSQL: with 12, the swapped INSERT
    // failed on its 14 values, so it kept no row for the wrong reason.
    const keepsNothing = `INSERT INTO dsor.audit
        (record_id, kind, operation, "authorization", result, reason, correlation, tenant,
         extensions, resources, row_count, connector, identity, delegation)
      SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::text,
             $9::jsonb, $10::text[], $11::integer, $12::text, $13::jsonb, $14::text
       WHERE false`;
    // How many rows each swapped INSERT kept, so the test knows the fault fired once, and
    // that the statement ran. An INSERT that failed would pass for the wrong reason.
    const kept: (number | null)[] = [];
    swallowing.on("connect", (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      // Every statement goes to the database as it was written, except the log's INSERT.
      client.query = ((...args: unknown[]) => {
        const [text, ...values] = args;
        if (typeof text === "string" && text.trimStart().startsWith("INSERT INTO dsor.audit")) {
          return query(keepsNothing, ...values).then((result) => {
            kept.push((result as pg.QueryResult).rowCount);
            return result;
          });
        }
        return query(...args);
      }) as typeof client.query;
    });
    try {
      const id = requestId("c4-kept-nothing");
      const answer = await call(
        registry,
        createDbLog(swallowing),
        { ...AGENT, request_id: id },
        "invoice.get",
        { invoice: "dsor://org_456/invoice/INV-1008" },
      );
      expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
      expect(answer).not.toHaveProperty("data");
      expect(await rowsFor(observer, "org_456", id)).toStrictEqual([]);
      expect(kept).toStrictEqual([0]);
    } finally {
      await swallowing.end();
    }
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
          invoice: "dsor://org_456/invoice/INV-1008",
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
