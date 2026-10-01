// The second lock. PostgreSQL filters every row by the company set in the
// transaction, even when the SQL forgets it. By claim, C1 to C5 in step 11's README.
// Most tests here run their own SQL, with the company left out on purpose: the lock under
// test is the database's, not DSoR's code (DSOR-TEN-01b, two independent layers).
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, inCompany, openPool } from "../src/postgres.ts";
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

// The schemas the catalog checks: every schema but PostgreSQL's own. Those are
// information_schema and every name that starts with pg_, such as pg_catalog and pg_toast,
// a prefix no one else may use. A regular expression, because in LIKE an _ matches any one
// character, so NOT LIKE 'pg_%' also skipped a schema named pgcrm (step 11's README,
// decision 1). Found by the Stage 2 review, and fixed from step 11 on.
const OUTSIDE_SYSTEM = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'";

// Every table, in any schema that is not PostgreSQL's own, with a column that names a
// company, and what row-level security says about it.
const TENANT_TABLES = `
  SELECT c.oid::regclass::text AS table, c.relrowsecurity AS enabled,
         c.relforcerowsecurity AS forced,
         (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r', 'p') AND ${OUTSIDE_SYSTEM}
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND NOT a.attisdropped
                    AND a.attname IN ('tenant_id', 'tenant'))
   ORDER BY 1`;

// Every relation in the database, with its schema, its kind, and its options: r is a
// table, v a view, m a materialized view, f a foreign table. Found by the Stage 2 review,
// and fixed from step 11 on.
const RELATIONS = `
  (SELECT c.oid::regclass::text AS relation, s.nspname, c.relkind::text AS relkind, c.reloptions
     FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace)`;

/**
 * The relations among these rows that no policy can stand behind. A view reads with its
 * owner's rights unless it is made WITH (security_invoker = true), and the owner holds
 * BYPASSRLS. A materialized view is a stored copy of rows, and no policy filters a copy. A
 * foreign table reads another table through a connection of its own, and can carry no
 * policy. The rows are RELATIONS, or a planted list in a test of this filter (step 11's
 * README, decision 1). Found by the Stage 2 review, and fixed from step 11 on; the foreign
 * table by a hostile pass on that fix.
 */
function relationsAroundPolicies(rows: string): string {
  return `
    SELECT n.relation FROM ${rows} AS n
     WHERE ${OUTSIDE_SYSTEM}
       AND (n.relkind IN ('m', 'f')
            OR (n.relkind = 'v'
                AND NOT coalesce('security_invoker=true' = ANY (n.reloptions), false)))
     ORDER BY 1`;
}

// Every function in the database, with its schema, whether it runs with the rights of the
// role that made it, and whether the user of this test, dsor_runtime, may run it. Found
// by the Stage 2 review, and fixed from step 11 on.
const FUNCTIONS = `
  (SELECT p.oid::regprocedure::text AS signature, s.nspname, p.prosecdef,
          has_function_privilege(p.oid, 'EXECUTE') AS executable
     FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace)`;

/**
 * The SECURITY DEFINER functions among these rows that dsor_runtime may run. Such a
 * function runs with the rights of the role that made it, so the owner's BYPASSRLS comes
 * with it (step 11's README, decision 1). Found by the Stage 2 review, and fixed from step
 * 11 on.
 */
function definersRuntimeMayRun(rows: string): string {
  return `
    SELECT n.signature FROM ${rows} AS n
     WHERE ${OUTSIDE_SYSTEM} AND n.prosecdef AND n.executable
     ORDER BY 1`;
}

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

  // A table is not the only way to reach a row. On a local PostgreSQL, the review made a
  // view, a materialized view, and a SECURITY DEFINER function as the owner, and each
  // showed both companies' rows from inside org_456. None may exist, in any schema but
  // PostgreSQL's own (step 11's README, decision 1). Found by the Stage 2 review, and
  // fixed from step 11 on.
  it("step 11's decision 1: no view reads with its owner's rights, and there is no materialized view or foreign table", async () => {
    const { rows } = await observer.query(relationsAroundPolicies(RELATIONS));
    expect(rows).toStrictEqual([]);
  });

  it("step 11's decision 1: dsor_runtime may run no SECURITY DEFINER function", async () => {
    const { rows } = await observer.query(definersRuntimeMayRun(FUNCTIONS));
    expect(rows).toStrictEqual([]);
  });
});

// The catalog's filters themselves, each on planted rows that PostgreSQL reads inside one
// query. Nothing is created in the database, so each filter is shown catching what the
// database does not hold today (step 11's README, decision 1). Found by the Stage 2 review,
// and fixed from step 11 on.
describe("C1's filters, on planted catalog rows", () => {
  // The guards above expect no rows, so an empty source would pass them too. Each source
  // reads the real catalog: here a table, two of PostgreSQL's own views, one of them with
  // an option, and a function, with every column the filters read. Whether a function runs
  // as its definer is read as it is: no function in the database does today, so no real
  // row can show it. Found by the Stage 2 review, and fixed from step 11 on.
  it("step 11's decision 1: the guards read the real catalog", async () => {
    const relations = await observer.query(
      `SELECT n.relation, n.nspname, n.relkind, n.reloptions FROM ${RELATIONS} AS n
        WHERE n.relation IN ('app.invoices', 'pg_roles', 'pg_stats') ORDER BY 1`,
    );
    expect(relations.rows).toStrictEqual([
      { relation: "app.invoices", nspname: "app", relkind: "r", reloptions: null },
      { relation: "pg_roles", nspname: "pg_catalog", relkind: "v", reloptions: null },
      {
        relation: "pg_stats",
        nspname: "pg_catalog",
        relkind: "v",
        reloptions: ["security_barrier=true"],
      },
    ]);
    const functions = await observer.query(
      `SELECT n.signature, n.nspname, n.prosecdef, n.executable FROM ${FUNCTIONS} AS n
        WHERE n.signature = 'now()'`,
    );
    expect(functions.rows).toStrictEqual([
      { signature: "now()", nspname: "pg_catalog", prosecdef: false, executable: true },
    ]);
  });

  // NOT LIKE 'pg_%' skipped pgcrm: in LIKE, _ matches any one character. Found by the
  // Stage 2 review, and fixed from step 11 on.
  it("step 11's decision 1: PostgreSQL's own schemas are skipped, and every other is checked, pgcrm too", async () => {
    const { rows } = await observer.query(
      `SELECT n.nspname
         FROM unnest(ARRAY['pg_catalog', 'pg_toast', 'pg_temp_1', 'information_schema',
                           'app', 'dsor', 'public', 'pgcrm']) WITH ORDINALITY AS n(nspname, place)
        WHERE ${OUTSIDE_SYSTEM} ORDER BY n.place`,
    );
    expect(rows.map((row) => row["nspname"])).toStrictEqual(["app", "dsor", "public", "pgcrm"]);
  });

  it("step 11's decision 1: the relation filter finds a view without security_invoker=true, every materialized view, and every foreign table", async () => {
    const planted = `(SELECT * FROM (VALUES
        ('app.open_invoices', 'app', 'v', NULL::text[]),
        ('app.invoice_copy', 'app', 'm', NULL),
        ('app.as_owner', 'app', 'v', ARRAY['security_invoker=false']),
        ('app.as_reader', 'app', 'v', ARRAY['security_invoker=true']),
        ('app.invoices', 'app', 'r', NULL),
        ('app.remote_invoices', 'app', 'f', NULL),
        ('pgcrm.contacts', 'pgcrm', 'v', NULL),
        ('pg_catalog.pg_roles', 'pg_catalog', 'v', NULL),
        ('information_schema.tables', 'information_schema', 'v', NULL)
      ) AS planted(relation, nspname, relkind, reloptions))`;
    const { rows } = await observer.query(relationsAroundPolicies(planted));
    expect(rows.map((row) => row["relation"])).toStrictEqual([
      "app.as_owner",
      "app.invoice_copy",
      "app.open_invoices",
      "app.remote_invoices",
      "pgcrm.contacts",
    ]);
  });

  it("step 11's decision 1: the function filter finds a SECURITY DEFINER function that dsor_runtime may run", async () => {
    const planted = `(SELECT * FROM (VALUES
        ('app.all_invoices()', 'app', true, true),
        ('app.my_invoices()', 'app', false, true),
        ('dsor.repair()', 'dsor', true, false),
        ('pgcrm.export()', 'pgcrm', true, true),
        ('pg_catalog.planted()', 'pg_catalog', true, true)
      ) AS planted(signature, nspname, prosecdef, executable))`;
    const { rows } = await observer.query(definersRuntimeMayRun(planted));
    expect(rows.map((row) => row["signature"])).toStrictEqual([
      "app.all_invoices()",
      "pgcrm.export()",
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
  // The test writes a record of each company first. Found live 2026-10-01, on step 15's
  // branch made fresh from main: the log was empty, so the test failed, or passed only
  // after another file had written records. With no org_789 record, it had no teeth.
  // It may take as long as the owner's program is given, 60 s (asOwner in test/db.ts).
  // Found live 2026-10-02: one run took 45 s on Neon, where it usually takes 11.
  it(
    "DSOR-TEN-01b: with every policy skipped, DSoR's own store still finds only org_456's rows",
    { timeout: 60_000 },
    async () => {
      await call(registry, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      });
      await call(registry, log, USER_700, "invoice.get", {
        invoice: "dsor://org_789/invoice/INV-1008",
      });
      expect(ownerStore()).toStrictEqual({
        bypassrls: true,
        inv2001: null,
        inv1008: "org_456",
        recordTenants: ["org_456"],
      });
    },
  );
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
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
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
        { invoice: "dsor://org_456/invoice/INV-1008" },
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
    // NEW IN STEP 15: the store gives the invoice beside its read's label.
    const { invoice: found } = await createDbInvoices(one).get("org_456", "INV-1008");
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
      invoice: "dsor://org_456/invoice/INV-1008",
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

  // When a statement fails, PostgreSQL aborts the whole transaction. A COMMIT sent after
  // that raises no error: PostgreSQL rolls the work back and answers ROLLBACK. So work that
  // catches its own failure must not look kept, and inCompany reported it as success
  // (step 11's README, decision 10). Found by the Stage 2 review, and fixed from step 11
  // on.
  it("step 11's decision 10: work that swallows its own failed statement makes inCompany reject, and nothing is kept", async () => {
    const id = requestId("c4-swallowed");
    const work = async (client: pg.PoolClient): Promise<string> => {
      // A real record of org_456, written inside org_456's transaction...
      await client.query(
        `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
         VALUES ($1, 'decision', 'DENY', 'AUTHORIZATION_DENIED', $2, 'org_456')`,
        [`aud_${id}`, { request_id: id }],
      );
      // ...then a statement that fails, and the work catches the failure and goes on.
      await client.query("SELECT 1 / 0").catch(() => {});
      return "done";
    };
    await expect(inCompany(pool, "org_456", work)).rejects.toThrow(
      "the transaction was rolled back",
    );
    expect(await rowsFor(observer, "org_456", id)).toStrictEqual([]);
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
    await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    await call(registry, log, { tenant: "org_456" }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
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
    await call(registry, log, { ...AGENT, request_id: ours }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    await call(registry, log, { ...USER_700, request_id: theirs }, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
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
      invoice: "dsor://org_456/invoice/INV-1008",
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
        // The owner's reader gives each record's size too (test/owner-reads.ts). Found by
        // the Stage 2 review, and fixed from step 10 on.
        bytes: expect.any(Number),
      },
    ]);
  });

  // Written for break V7: a connection that has held a company reads an unset company as
  // '', not NULL (step 11's README, decision 2). Since step 11's review, a call with no
  // company sets '' itself. So without nullif, every record with no company that the
  // program writes is refused, on any connection, and many tests catch V7. Found by the
  // Stage 2 review: this comment said it was the only test that could.
  it("DSOR-TEN-02a: on a pool of one connection, a call with no login after a call in org_456 is still recorded", async () => {
    const one = poolOfOne();
    try {
      const reg = dbRegistry(one);
      const oneLog = createDbLog(one);
      await call(reg, oneLog, AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" });
      const id = requestId("c5-reused");
      const answer = await call(reg, oneLog, { tenant: "org_456", request_id: id }, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      });
      expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
      expect(ownerRowsFor(id)).toMatchObject([{ tenant: null, result: "AUTHENTICATION_REQUIRED" }]);
    } finally {
      await one.end();
    }
  });
});
