// STEP 16: DSoR's paperwork has a place of its own, a schema called `dsor`, beside the
// business's tables in the same database.
//
// Measured on step 15: DSoR's only paperwork in the database, the log, was `public.audit`, filed
// beside the business's `public.invoices` in the schema the business's own tools treat as theirs.
// An accounting upgrade that resets its tables, or a cleanup that empties `public`, would take the
// evidence with it. Decision 122: the log moves into `dsor`, as it is, and every other kind of
// paperwork arrives there with the step that builds it.
//
// Rule DSOR-MOD-01: a DSoR implementation MUST durably own, in a control-plane store separate from
// agent context, its delegations, controls, proposals, approvals, idempotency records, intent
// records, cumulative-limit counters, holds, and audit evidence.

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit, theLog, useDatabase, verifyChain } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { migrationsIn } from "../src/migrations.ts";
import { callOperation } from "../src/operations.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
  await resetTheStory();
});

afterAll(async () => {
  await db.close();
});

/** The tables in one schema, by name, asked of the catalogue as the owner, who sees them all. */
const tablesIn = async (schema: string): Promise<string[]> =>
  asTheOwner(async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
      [schema],
    );

    return rows.map((row) => row.name);
  });

describe("DSoR's own store", () => {
  it("DSOR-MOD-01: the log lives in dsor, DSoR's own schema, and not among the business's tables", async () => {
    expect(await tablesIn("dsor")).toStrictEqual(["audit"]);
    expect(await tablesIn("public")).not.toContain("audit");
  });

  it("DSOR-MOD-01: the business's schema holds the business's tables, and nothing of DSoR's", async () => {
    // The migrations' own record, `public.applied_migrations`, is not DSoR's paperwork in the
    // rule's list: it records the shape of the business's tables and DSoR's alike. It stays where
    // it is (decision 122 moved the log only). The migration tool makes it on a real server; this
    // database is built by applying the files directly, so here there is none.
    const ofTheBusiness = (await tablesIn("public")).filter((t) => t !== "applied_migrations");

    // STEP 17: and the vendors and payments, the business's records too (decision 125).
    expect(ofTheBusiness).toStrictEqual(["invoices", "payments", "vendors"]);
  });

  it("DSOR-MOD-01: a decision recorded through the door lands in dsor.audit", async () => {
    await forgetTheLog("org_456");
    await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    const counted = await asTheOwner(async () => {
      const { rows } = await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM dsor.audit WHERE tenant = 'org_456'",
      );

      return rows[0]?.n;
    });

    expect(counted).toBeGreaterThan(0);
    expect(counted).toBe((await theLog("org_456")).length);
  });

  it("DSOR-MOD-01: the application may use the dsor schema, and may create nothing in it", async () => {
    const { rows } = await db.query<{ use: boolean; create: boolean }>(
      `SELECT has_schema_privilege('dsor_runtime', 'dsor', 'USAGE') AS use,
              has_schema_privilege('dsor_runtime', 'dsor', 'CREATE') AS create`,
    );

    expect(rows[0]).toStrictEqual({ use: true, create: false });
  });
});

describe("creating nothing in dsor, on a server that hands out rights to every new schema", () => {
  // A fresh schema gives nobody anything, so on a fresh server migration 008's REVOKE lines take
  // away nothing, and deleting either would fail no test above. A server somebody administered
  // first is another matter: ALTER DEFAULT PRIVILEGES hands rights out on every schema made from
  // then on. A review measured it: with these two defaults, the application held CREATE on `dsor`
  // after 008, and every role did once the line for PUBLIC was gone (decision 123). A default grant
  // to a group by name survives 008, which names only PUBLIC and the application; start-up refuses
  // an application that belongs to such a group (decision 124).
  it("DSOR-MOD-01: migration 008 takes CREATE on dsor back from PUBLIC and from the application", async () => {
    const server = await PGlite.create();

    try {
      await server.exec(`
        CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-throwaway-not-a-secret';
        CREATE ROLE a_stranger;
        ALTER DEFAULT PRIVILEGES GRANT USAGE, CREATE ON SCHEMAS TO PUBLIC;
        ALTER DEFAULT PRIVILEGES GRANT CREATE ON SCHEMAS TO dsor_runtime;
      `);

      for (const migration of migrationsIn(
        fileURLToPath(new URL("../migrations", import.meta.url)),
      )) {
        await server.exec(migration.sql);
      }

      const may = async (role: string, schema: string): Promise<unknown> =>
        (
          await server.query<{ use: boolean; create: boolean }>(
            `SELECT has_schema_privilege($1::name, $2::text, 'USAGE') AS use,
                    has_schema_privilege($1::name, $2::text, 'CREATE') AS create`,
            [role, schema],
          )
        ).rows[0];

      // Not testing nothing: a schema made now, with no REVOKE after it, hands CREATE to both.
      await server.exec("CREATE SCHEMA witness");

      expect(await may("a_stranger", "witness")).toStrictEqual({ use: true, create: true });
      expect(await may("dsor_runtime", "witness")).toStrictEqual({ use: true, create: true });

      expect(await may("a_stranger", "dsor")).toStrictEqual({ use: false, create: false });
      expect(await may("dsor_runtime", "dsor")).toStrictEqual({ use: true, create: false });
    } finally {
      await server.close();
    }
  });
});

describe("moving a log that already has records in it", () => {
  // Decision 147: every other database these tests build runs 008 while the log is still empty,
  // so an 008 that lost the records passed them all. A review measured it: 008 with one line added,
  // `TRUNCATE dsor.audit`, and the whole suite still passed. A real server meets 008 with records
  // in its log, as step 15's own database did. This test builds that server, and asks what step
  // 16 promised: the table moves with every record in it, and nothing is copied.
  it("DSOR-MOD-01: migration 008 moves a log that has records, every one of them, and copies nothing", async () => {
    const server = await PGlite.create();
    const migrations = migrationsIn(fileURLToPath(new URL("../migrations", import.meta.url)));

    /** A table's identity and every row in it, recorded_at included, asked as the owner. */
    const theTable = async (name: string): Promise<{ oid: unknown; rows: unknown[] }> => ({
      oid: (await server.query<{ oid: unknown }>("SELECT $1::regclass::oid AS oid", [name])).rows[0]
        ?.oid,
      rows: (await server.query(`SELECT * FROM ${name} ORDER BY chain, sequence`)).rows,
    });

    try {
      await server.exec(
        "CREATE ROLE dsor_runtime WITH LOGIN PASSWORD 'local-throwaway-not-a-secret';",
      );

      // A server as step 15 left it: migrations 001 to 007, and nothing in dsor.
      for (const migration of migrations.filter((m) => m.number < 8)) {
        await server.exec(migration.sql);
      }

      // Three records, written by the program's own writer, as the application, to the log's old
      // address. The one name is swapped, as the re-run of 002 does, so the records are real: each
      // hashed and chained to the one before.
      const theOldAddress = overPGlite(server);

      useDatabase({
        query: <T>(sql: string, params?: unknown[], tenant?: string): Promise<{ rows: T[] }> =>
          theOldAddress.query<T>(sql.replaceAll("dsor.audit", "public.audit"), params, tenant),
      });
      await server.exec("SET ROLE dsor_runtime");

      for (const requestId of ["req_1", "req_2", "req_3"]) {
        await audit({
          kind: "decision",
          subject: "user_123",
          tenant: "org_456",
          requestId,
          operation: "invoice.get@1",
          authorization: "ALLOW",
          result: "ALLOWED",
        });
      }

      await server.exec("RESET ROLE");

      const before = await theTable("public.audit");

      expect(before.rows).toHaveLength(3);

      // Then 008 alone, as the owner, as `pnpm migrate` runs it on that server.
      for (const migration of migrations.filter((m) => m.number === 8)) {
        await server.exec(migration.sql);
      }

      const after = await theTable("dsor.audit");

      // The same table, not a new one beside it with the rows copied in.
      expect(after.oid).toBe(before.oid);
      // Every record, as it was, down to the time the database stamped on it.
      expect(after.rows).toStrictEqual(before.rows);

      // And the chain still verifies at the new address, read the way the program reads it.
      useDatabase(overPGlite(server));
      await server.exec("SET ROLE dsor_runtime");

      const log = await theLog("org_456");

      expect(log).toHaveLength(3);
      expect(verifyChain(log)).toBe(true);
    } finally {
      // Back to this file's own database, for any test that runs after this one.
      useDatabase(overPGlite(db));
      await server.close();
    }
  });
});
