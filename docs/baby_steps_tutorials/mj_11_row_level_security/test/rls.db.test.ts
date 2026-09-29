// NEW IN STEP 11: the second lock. PostgreSQL filters every row by the company set in the
// transaction, even when the SQL forgets it. By claim, C1 to C5 in step 11's README.
// Most tests here run their own SQL, with the company left out on purpose: the lock under
// test is the database's, not DSoR's code (DSOR-TEN-01b, two independent layers).
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool } from "../src/postgres.ts";
import {
  NO_PRIVILEGE,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  ownerRowsFor,
  ownerStore,
  poolOfOne,
  requestId,
  rowsFor,
  tryThenRollBack,
} from "./db.ts";
import { AGENT, USER_700 } from "./helpers.ts";

// The test's own window into the database: dsor_runtime, never through src.
const observer = newPool();
// The program's own pool and log, for the calls that put records in the table.
const pool = openPool(RUNTIME_URL);
afterAll(async () => {
  await observer.end();
  await pool.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

// Every table, in any schema that is not PostgreSQL's own, with a column that names a
// company, and what row-level security says about it.
const TENANT_TABLES = `
  SELECT c.oid::regclass::text AS table, c.relrowsecurity AS enabled,
         c.relforcerowsecurity AS forced,
         (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p')
     AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND NOT a.attisdropped
                    AND a.attname IN ('tenant_id', 'tenant'))
   ORDER BY 1`;

describe("C1: every table with a company column has its lock", () => {
  // A new table with a company column changes this list, so it fails here until it has
  // its own lock and this list names it (step 11's README, decision 1).
  it("DSOR-RP-01b: app.invoices and dsor.audit have row-level security enabled, forced, and policies", async () => {
    const { rows } = await observer.query(TENANT_TABLES);
    expect(rows).toStrictEqual([
      { table: "app.invoices", enabled: true, forced: true, policies: 1 },
      { table: "dsor.audit", enabled: true, forced: true, policies: 2 },
    ]);
  });

  // Every policy exactly as written, the way step 09 lists every privilege. Found by the
  // review: a policy limited to SELECT, or given to one role only, passed every test.
  it("DSOR-TEN-01b: every policy is exactly as written: its command, its roles, and its rule", async () => {
    const { rows } = await observer.query(
      `SELECT schemaname || '.' || tablename AS table, policyname AS name, cmd AS command,
              roles::text[] AS roles, qual AS using, with_check AS check
         FROM pg_policies ORDER BY 1, 2`,
    );
    const company = "NULLIF(current_setting('dsor.tenant_id'::text, true), ''::text)";
    expect(rows).toStrictEqual([
      {
        table: "app.invoices",
        name: "tenant_isolation",
        command: "ALL",
        roles: ["public"],
        using: `(tenant_id = ${company})`,
        check: null,
      },
      {
        table: "dsor.audit",
        name: "audit_read",
        command: "SELECT",
        roles: ["public"],
        using: `(tenant = ${company})`,
        check: null,
      },
      {
        table: "dsor.audit",
        name: "audit_write",
        command: "INSERT",
        roles: ["public"],
        using: null,
        check: `(NOT (tenant IS DISTINCT FROM ${company}))`,
      },
    ]);
  });
});

describe("C2: the store keeps companies apart when the SQL forgets the company", () => {
  const INV_1008 = "SELECT tenant_id, id FROM app.invoices WHERE id = 'INV-1008'";

  it("DSOR-TEN-01b: inside org_456, SQL with no company finds only org_456's INV-1008", async () => {
    const { rows } = await tryThenRollBack(observer, INV_1008, "org_456");
    expect(rows).toStrictEqual([{ tenant_id: "org_456", id: "INV-1008" }]);
  });

  it("DSOR-TEN-01b: inside org_789, the same SQL finds only org_789's INV-1008", async () => {
    const { rows } = await tryThenRollBack(observer, INV_1008, "org_789");
    expect(rows).toStrictEqual([{ tenant_id: "org_789", id: "INV-1008" }]);
  });

  // Step 10's break U1 in one line: org_789's INV-2001 is the only invoice by that name.
  it("DSOR-TEN-01b: inside org_456, every invoice there is to see is org_456's", async () => {
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT DISTINCT tenant_id FROM app.invoices",
      "org_456",
    );
    expect(rows).toStrictEqual([{ tenant_id: "org_456" }]);
  });

  // The first lock alone. Found by the review: with DSoR's WHERE deleted (break V5), every
  // test passed, because the database's lock hid it. The owner holds BYPASSRLS, so no
  // policy applies to it, and only DSoR's own WHERE can filter what the store returns.
  it("DSOR-TEN-01b: with every policy skipped, DSoR's own store still finds only org_456's rows", () => {
    expect(ownerStore()).toStrictEqual({
      bypassrls: true,
      inv2001: null,
      inv1008: "org_456",
      recordTenants: ["org_456"],
    });
  });
});

describe("C3: no company set, no rows", () => {
  /** A connection of its own, closed after the work, so "fresh" really is fresh. */
  async function onFreshConnection<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: RUNTIME_URL });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  /** A connection whose last transaction was inside org_456, and has ended. */
  async function afterOrg456(client: pg.Client): Promise<void> {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
    await client.query("COMMIT");
    // The setting is not unset now. It is '' (step 11's README, decision 2).
    const { rows } = await client.query("SELECT current_setting('dsor.tenant_id', true) AS now");
    expect(rows).toStrictEqual([{ now: "" }]);
  }

  const INVOICES = "SELECT tenant_id, id FROM app.invoices";
  const RECORDS = "SELECT count(*)::int AS records FROM dsor.audit";

  // So "no record" means the lock hid it, not that the table was empty. Found by the review.
  async function aRecordExists(): Promise<void> {
    const answer = await call(registry, log, AGENT, "invoice.get", { id: "INV-1008" });
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
  }

  it("DSOR-RP-01d: a fresh connection with no company set reads no invoice", async () => {
    const { rows } = await onFreshConnection((client) => client.query(INVOICES));
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-RP-01d: a fresh connection with no company set reads no audit record", async () => {
    await aRecordExists();
    const { rows } = await onFreshConnection((client) => client.query(RECORDS));
    expect(rows).toStrictEqual([{ records: 0 }]);
  });

  it("DSOR-RP-01d: after a transaction inside org_456, no company set reads no invoice", async () => {
    const { rows } = await onFreshConnection(async (client) => {
      await afterOrg456(client);
      return client.query(INVOICES);
    });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-RP-01d: after a transaction inside org_456, no company set reads no audit record", async () => {
    await aRecordExists();
    const { rows } = await onFreshConnection(async (client) => {
      await afterOrg456(client);
      return client.query(RECORDS);
    });
    expect(rows).toStrictEqual([{ records: 0 }]);
  });

  // No rule id: step 11's decision 3. Another program's mistake, on a connection a pooler
  // could hand to DSoR next: a company set for the whole session. A call with no company
  // must run with none, not with the one the connection carries. Found by the review.
  it("a call with no company, on a connection that carries org_456 for its whole session, runs with none", async () => {
    const one = poolOfOne();
    try {
      await one.query("SELECT set_config('dsor.tenant_id', 'org_456', false)");
      const id = requestId("c3-left-over");
      const answer = await call(
        dbRegistry(one),
        createDbLog(one),
        { tenant: "org_456", request_id: id },
        "invoice.get",
        { id: "INV-1008" },
      );
      expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
      expect(ownerRowsFor(id)).toMatchObject([{ tenant: null, result: "AUTHENTICATION_REQUIRED" }]);
    } finally {
      // Closing the pool closes the connection, and the session's company with it.
      await one.end();
    }
  });
});

describe("C4: the company lasts one transaction, even when a pool lends the connection again", () => {
  // One connection, so the second request gets the very connection the first one used.
  const one = poolOfOne();
  afterAll(() => one.end());

  /** What the next request on the pool's one connection sees, with no company set. */
  async function nextRequest(): Promise<unknown> {
    const { rows } = await one.query(
      `SELECT pg_backend_pid() AS connection,
              nullif(current_setting('dsor.tenant_id', true), '') AS company,
              (SELECT count(*)::int FROM app.invoices) AS invoices,
              (SELECT count(*)::int FROM dsor.audit) AS records`,
    );
    return rows[0];
  }

  it("DSOR-RP-01c: after the program reads org_456's INV-1008, the next request sees no invoice", async () => {
    const { rows } = await one.query("SELECT pg_backend_pid() AS connection");
    const found = await createDbInvoices(one).get("org_456", "INV-1008");
    expect(found).toMatchObject({ tenant_id: "org_456", id: "INV-1008" });
    expect(await nextRequest()).toMatchObject({
      connection: rows[0]!["connection"],
      company: null,
      invoices: 0,
    });
  });

  it("DSOR-RP-01c: after the program records a call in org_456, the next request sees no record", async () => {
    const { rows } = await one.query("SELECT pg_backend_pid() AS connection");
    const answer = await call(dbRegistry(one), createDbLog(one), AGENT, "invoice.get", {
      id: "INV-1008",
    });
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(await nextRequest()).toMatchObject({
      connection: rows[0]!["connection"],
      company: null,
      records: 0,
    });
  });

  // No rule id: step 11's decision 3. A failed transaction may leave its connection in a
  // state the next request must not inherit, so the connection is closed, never lent
  // again. Found by the review: with it lent again, or never given back, every test passed.
  it("a connection whose transaction failed is closed, and the next request gets a new one", async () => {
    const { rows } = await one.query("SELECT pg_backend_pid() AS connection");
    // A record the database refuses: step 02's form has no company called acme, so the
    // CHECK of migration 002 fails inside the transaction.
    const refused = createDbLog(one).add({
      kind: "decision",
      authorization: "DENY",
      result: "VALIDATION_FAILED",
      correlation: { request_id: requestId("c4-failed") },
      tenant: "acme",
    });
    await expect(refused).rejects.toMatchObject({ code: "23514" });
    const next = await one.query("SELECT pg_backend_pid() AS connection");
    expect(next.rows[0]!["connection"]).not.toBe(rows[0]!["connection"]);
  });
});

describe("C5: the log is kept apart by company", () => {
  const RECORD = `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
                  VALUES ($1, 'decision', 'DENY', 'AUTHORIZATION_DENIED', '{}', $2)`;

  // The policy's refusal, by its message too: a missing privilege has the same code, 42501.
  // Found by the review.
  const BY_THE_POLICY = { ...NO_PRIVILEGE, message: expect.stringMatching(/row-level security/) };

  it("DSOR-TEN-02a: inside org_456, a record for org_789 is refused by the policy, 42501", async () => {
    await expect(
      tryThenRollBack(observer, RECORD, "org_456", [requestId("c5-foreign"), "org_789"]),
    ).rejects.toMatchObject(BY_THE_POLICY);
  });

  // A record with no company would be one that org_456's own readers never see.
  it("DSOR-TEN-02a: inside org_456, a record with no company is refused by the policy, 42501", async () => {
    await expect(
      tryThenRollBack(observer, RECORD, "org_456", [requestId("c5-no-company"), null]),
    ).rejects.toMatchObject(BY_THE_POLICY);
  });

  // Written and read in one transaction that is rolled back, so the table keeps nothing.
  it("DSOR-TEN-02a: with no company set, a record with no company is written, and cannot be read back", async () => {
    const id = requestId("c5-write-only");
    const client = await observer.connect();
    try {
      await client.query("BEGIN");
      await client.query(RECORD, [id, null]);
      const { rows } = await client.query("SELECT record_id FROM dsor.audit WHERE record_id = $1", [
        id,
      ]);
      expect(rows).toStrictEqual([]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("DSOR-TEN-02a: inside org_456, every record there is to read is org_456's", async () => {
    // So the table surely holds a record of org_789 and one with no company.
    await call(registry, log, USER_700, "invoice.get", { id: "INV-1008" });
    await call(registry, log, { tenant: "org_456" }, "invoice.get", { id: "INV-1008" });
    const { rows } = await tryThenRollBack(
      observer,
      "SELECT DISTINCT tenant FROM dsor.audit",
      "org_456",
    );
    expect(rows).toStrictEqual([{ tenant: "org_456" }]);
  });

  it("DSOR-TEN-02a: the program's log reads back one company's records only", async () => {
    const ours = requestId("c5-ours");
    const theirs = requestId("c5-theirs");
    await call(registry, log, { ...AGENT, request_id: ours }, "invoice.get", { id: "INV-1008" });
    await call(registry, log, { ...USER_700, request_id: theirs }, "invoice.get", {
      id: "INV-1008",
    });
    const read = await log.records("org_456");
    const ids = read.map((r) => r.correlation.request_id);
    expect(ids).toContain(ours);
    expect(ids).not.toContain(theirs);
    expect(new Set(read.map((r) => r.tenant))).toStrictEqual(new Set(["org_456"]));
  });

  it("DSOR-TEN-02a: a call with no login leaves its record, and only the owner can read it", async () => {
    const id = requestId("c5-no-login");
    const answer = await call(registry, log, { tenant: "org_456", request_id: id }, "invoice.get", {
      id: "INV-1008",
    });
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(await rowsFor(observer, undefined, id)).toStrictEqual([]);
    expect(await rowsFor(observer, "org_456", id)).toStrictEqual([]);
    expect(ownerRowsFor(id)).toStrictEqual([
      {
        tenant: null,
        extensions: null,
        authorization: "DENY",
        result: "AUTHENTICATION_REQUIRED",
      },
    ]);
  });

  // The only test that can catch break V7: a connection that has held a company reads an
  // unset company as '', not NULL (step 11's README, decision 2).
  it("DSOR-TEN-02a: on a pool of one connection, a call with no login after a call in org_456 is still recorded", async () => {
    const one = poolOfOne();
    try {
      const reg = dbRegistry(one);
      const oneLog = createDbLog(one);
      await call(reg, oneLog, AGENT, "invoice.get", { id: "INV-1008" });
      const id = requestId("c5-reused");
      const answer = await call(reg, oneLog, { tenant: "org_456", request_id: id }, "invoice.get", {
        id: "INV-1008",
      });
      expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
      expect(ownerRowsFor(id)).toMatchObject([{ tenant: null, result: "AUTHENTICATION_REQUIRED" }]);
    } finally {
      await one.end();
    }
  });
});
