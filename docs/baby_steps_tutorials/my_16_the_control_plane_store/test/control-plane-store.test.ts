// NEW IN STEP 16: DSoR's paperwork has a place of its own, a schema called `dsor`, beside the
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

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { callOperation } from "../src/operations.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetInvoices } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
  await resetInvoices();
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

  it("DSOR-MOD-01: the business's schema holds the business's table, and nothing of DSoR's", async () => {
    // The migrations' own record, `public.applied_migrations`, is not DSoR's paperwork in the
    // rule's list: it records the shape of the business's tables and DSoR's alike. It stays where
    // it is (decision 122 moved the log only). The migration tool makes it on a real server; this
    // database is built by applying the files directly, so here there is none.
    const ofTheBusiness = (await tablesIn("public")).filter((t) => t !== "applied_migrations");

    expect(ofTheBusiness).toStrictEqual(["invoices"]);
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
