// NEW IN STEP 11: the second lock. PostgreSQL itself hides every other company's rows.
//
// Step 10's lock is a WHERE in every query, held by the program alone. These tests go underneath
// the program: raw SQL, as the application's own account, with and without a company said. What
// they prove is the database's behaviour, not the stores' — so a query that forgets the company,
// the kind nobody has written yet, is already answered correctly.
//
// Rule DSOR-TEN-01b: tenant isolation MUST be enforced in at least two independent layers: DSoR
// core, and the connector or store.
// Rule DSOR-RP-01b: tenant tables MUST use FORCE ROW LEVEL SECURITY.
// Rule DSOR-RP-01d: a query executed with no tenant setting MUST yield no rows.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aDatabase, asTheOwner, resetInvoices } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

/** The query step 10 could not survive: an invoice number, and no company. */
const FORGOT_THE_COMPANY =
  "SELECT tenant_id, id FROM public.invoices WHERE id = 'INV-1008' ORDER BY tenant_id";

/** One record per company, written by the owner, so that the log has something to hide. */
const TWO_RECORDS = `
  INSERT INTO public.audit (record_id, chain, sequence, previous_hash, record_hash, at, tenant,
                            kind, identity, correlation, result)
  VALUES ('audit:org_456:0', 'audit:org_456', 0, 'sha256:AAAA', 'sha256:BBBB', now(), 'org_456',
          'decision', '{}', '{}', 'ALLOWED'),
         ('audit:org_789:0', 'audit:org_789', 0, 'sha256:AAAA', 'sha256:CCCC', now(), 'org_789',
          'decision', '{}', '{}', 'ALLOWED')`;

beforeEach(async () => {
  await resetInvoices();
  await asTheOwner(async () => {
    await db.exec("DELETE FROM public.audit");
    await db.exec(TWO_RECORDS);
  });
});

/**
 * Run one statement as the application, the way the adapter in database.ts does: inside a
 * transaction that first says the company — or with none said at all.
 */
async function asTheApplication<T>(sql: string, tenant?: string): Promise<T[]> {
  if (tenant === undefined) {
    return (await db.query<T>(sql)).rows;
  }

  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);

    return (await tx.query<T>(sql)).rows;
  });
}

describe("the second lock, on reads", () => {
  it("the owner sees that both companies have an INV-1008", async () => {
    // The fact the lock has to hide. Step 10 put the same number in two companies on purpose.
    const rows = await asTheOwner(async () => (await db.query<{ tenant_id: string }>(FORGOT_THE_COMPANY)).rows);

    expect(rows.map((r) => r.tenant_id)).toStrictEqual(["org_456", "org_789"]);
  });

  it("DSOR-TEN-01b: a query that forgot the company gets only the company the transaction said", async () => {
    const rows = await asTheApplication<{ tenant_id: string }>(FORGOT_THE_COMPANY, "org_456");

    expect(rows.map((r) => r.tenant_id)).toStrictEqual(["org_456"]);
  });

  it("DSOR-TEN-01b: the audit log is locked the same way", async () => {
    const rows = await asTheApplication<{ tenant: string }>(
      "SELECT tenant FROM public.audit ORDER BY tenant",
      "org_789",
    );

    expect(rows.map((r) => r.tenant)).toStrictEqual(["org_789"]);
  });

  it("DSOR-RP-01d: with no company said, the application gets no rows at all", async () => {
    expect(await asTheApplication(FORGOT_THE_COMPANY)).toStrictEqual([]);
    expect(await asTheApplication("SELECT tenant FROM public.audit")).toStrictEqual([]);
  });

  it("DSOR-RP-01d: a company that has no rows is the same as no company", async () => {
    expect(await asTheApplication(FORGOT_THE_COMPANY, "org_000")).toStrictEqual([]);
  });
});

describe("the second lock, on writes", () => {
  it("DSOR-TEN-01b: org_789's invoice cannot be changed from org_456's transaction", async () => {
    const changed = await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");

      const { rows } = await tx.query(
        `UPDATE public.invoices SET status = 'issued'
         WHERE tenant_id = 'org_789' AND id = 'INV-1008' RETURNING id`,
      );

      return rows.length;
    });

    expect(changed).toBe(0);

    // Untouched, as the owner sees it: the statement found no row to change, rather than being
    // refused — a lock on reads is a lock on what an UPDATE can find.
    const status = await asTheOwner(async () =>
      (await db.query<{ status: string }>(
        "SELECT status FROM public.invoices WHERE tenant_id = 'org_789' AND id = 'INV-1008'",
      )).rows[0]?.status,
    );

    expect(status).toBe("draft");
  });

  it("DSOR-TEN-01b: a record for org_789 cannot be written from org_456's transaction", async () => {
    // The guarantee step 10 did not have: a bug that computes the wrong chain cannot put a record
    // into another company's log, because the lock checks what is written, not only what is read.
    await expect(
      db.transaction(async (tx) => {
        await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
        await tx.query(
          `INSERT INTO public.audit (record_id, chain, sequence, previous_hash, record_hash, at,
                                     tenant, kind, identity, correlation, result)
           VALUES ('audit:org_789:1', 'audit:org_789', 1, 'sha256:CCCC', 'sha256:DDDD', now(),
                   'org_789', 'decision', '{}', '{}', 'ALLOWED')`,
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("the first trap: the table owner", () => {
  it("DSOR-RP-01b: the lock is forced, so an owner that is not a superuser is filtered too", async () => {
    // By default a table's owner skips every policy on it. FORCE makes the owner subject to them.
    // The owner here is PGlite's superuser, which skips everything whatever the table says — so the
    // test hands the table to an owner that is not, and asks as it.
    await asTheOwner(async () => {
      await db.exec(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'a_plain_owner') THEN
          CREATE ROLE a_plain_owner;
        END IF;
      END $$;`);
      await db.exec("ALTER TABLE public.invoices OWNER TO a_plain_owner");
    });

    try {
      await db.exec("SET ROLE a_plain_owner");

      const { rows } = await db.query(FORGOT_THE_COMPANY);

      expect(rows).toStrictEqual([]);
    } finally {
      await asTheOwner(async () => {
        await db.exec("ALTER TABLE public.invoices OWNER TO postgres");
      });
    }
  });
});
