// NEW IN STEP 17: two more record types, the vendors a company pays and the payments it makes.
//
// They are the business's records, beside the invoices, under the same two locks: every key starts
// with the company, and the second lock hides another company's rows from a statement that forgot
// to say which company it is about (decision 125). The commands that use them are in
// payments.test.ts; this file is about the tables, and what the application may do to them.
//
// Rule DSOR-TEN-01a: every tenant-owned resource MUST carry its `tenant_id`.
// Rule DSOR-RP-01b: tenant tables MUST use FORCE ROW LEVEL SECURITY.
// Rule DSOR-RP-01d: a query executed with no tenant setting MUST yield no rows.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

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

/** One statement as the application, with one company said, or none. */
async function asTheApplication<T>(sql: string, tenant?: string): Promise<T[]> {
  if (tenant === undefined) {
    return (await db.query<T>(sql)).rows;
  }

  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);

    return (await tx.query<T>(sql)).rows;
  });
}

/** What a statement as the application did: "allowed", or PostgreSQL's refusal. */
async function attempt(sql: string, tenant = "org_456"): Promise<string> {
  try {
    await asTheApplication(sql, tenant);

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  }
}

interface PaymentRow {
  readonly tenant_id: string;
  readonly id: string;
  readonly vendor: string;
  readonly invoice: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: string;
}

const PAYMENTS = `SELECT tenant_id, id, vendor, invoice, amount_value::text AS amount,
                         amount_currency AS currency, status
                    FROM public.payments ORDER BY tenant_id, id`;

describe("the running example's vendor and payment", () => {
  it("DSOR-TEN-01a: PAY-901 is org_456's draft for 31,400.00 USD, paying INV-1008 to VENDOR-44", async () => {
    // The step's "done when", as the owner reads it.
    const rows = await asTheOwner(async () => (await db.query<PaymentRow>(PAYMENTS)).rows);

    expect(rows.find((r) => r.tenant_id === "org_456" && r.id === "PAY-901")).toStrictEqual({
      tenant_id: "org_456",
      id: "PAY-901",
      vendor: "VENDOR-44",
      invoice: "INV-1008",
      amount: "31400.00",
      currency: "USD",
      status: "draft",
    });
  });

  it("DSOR-TEN-01a: each company holds a PAY-901 and a VENDOR-44 of its own", async () => {
    const payments = await asTheOwner(async () => (await db.query<PaymentRow>(PAYMENTS)).rows);
    const vendors = await asTheOwner(
      async () =>
        (
          await db.query<{ tenant_id: string; id: string; status: string }>(
            "SELECT tenant_id, id, status FROM public.vendors ORDER BY tenant_id, id",
          )
        ).rows,
    );

    expect(payments.map((r) => `${r.tenant_id}/${r.id}/${r.amount}`)).toStrictEqual([
      "org_456/PAY-901/31400.00",
      "org_789/PAY-901/7700.00",
    ]);
    expect(vendors).toStrictEqual([
      { tenant_id: "org_456", id: "VENDOR-44", status: "approved" },
      { tenant_id: "org_789", id: "VENDOR-44", status: "approved" },
    ]);
  });

  it("DSOR-TEN-01a: a payment cannot pay another company's invoice, whatever the program does", async () => {
    // INV-2001 is org_789's alone. The company is inside every key, so the database refuses the
    // row even from the owner, who skips the lock.
    const refused = await asTheOwner(async () => {
      try {
        await db.exec(
          `INSERT INTO public.payments (tenant_id, vendor, invoice, amount_value, amount_currency)
           VALUES ('org_456', 'VENDOR-44', 'INV-2001', 10.00, 'USD')`,
        );

        return "allowed";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(refused).toMatch(/foreign key/);
  });

  it("DSOR-TEN-01a: a payment's vendor is its invoice's vendor, whatever the program does", async () => {
    // NEW IN STEP 17, decision 126: the keys tied the vendor and the invoice to the same company,
    // not to each other. A review wrote PAY-902 for VENDOR-77 against INV-1008, whose vendor is
    // VENDOR-44, as the application, and it was accepted.
    // A vendor of its own, removed again: the story's reset puts payments and invoices back, not
    // vendors, and the other tests here count the vendors.
    await asTheOwner(() =>
      db.exec(
        "INSERT INTO public.vendors (tenant_id, id, status) VALUES ('org_456', 'VENDOR-77', 'approved')",
      ),
    );

    try {
      expect(
        await attempt(
          `INSERT INTO public.payments (tenant_id, vendor, invoice, amount_value, amount_currency)
           VALUES ('org_456', 'VENDOR-77', 'INV-1008', 10.00, 'USD')`,
        ),
      ).toMatch(/foreign key/);
    } finally {
      await asTheOwner(async () => {
        await db.exec("DELETE FROM public.payments WHERE vendor = 'VENDOR-77'");
        await db.exec("DELETE FROM public.vendors WHERE id = 'VENDOR-77'");
      });
    }
  });

  it("DSOR-TEN-01a: an invoice names a vendor its company has", async () => {
    // NEW IN STEP 17, decision 126: or a payment for it would fail halfway, after its ALLOW was
    // recorded, on the payment's own key to the vendor.
    const refused = await asTheOwner(async () => {
      try {
        await db.exec(
          `INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status)
           VALUES ('org_456', 'INV-7000', 'VENDOR-99', 10.00, 'USD', 'issued')`,
        );

        return "allowed";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(refused).toMatch(/foreign key/);
  });
});

describe("the second lock on the new tables", () => {
  for (const table of ["public.vendors", "public.payments"]) {
    it(`DSOR-RP-01d: the forgotten WHERE on ${table} sees one company's rows, and none with no company`, async () => {
      const forgot = `SELECT tenant_id FROM ${table} ORDER BY tenant_id`;

      expect(await asTheApplication(forgot, "org_456")).toStrictEqual([{ tenant_id: "org_456" }]);
      expect(await asTheApplication(forgot)).toStrictEqual([]);

      // Not testing nothing: the owner, who skips the lock, sees both companies.
      expect(await asTheOwner(async () => (await db.query(forgot)).rows)).toHaveLength(2);
    });

    it(`DSOR-RP-01b: ${table} has row-level security, forced`, async () => {
      const { rows } = await db.query<{ on: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class
          WHERE oid = '${table}'::regclass`,
      );

      expect(rows[0]).toStrictEqual({ on: true, forced: true });
    });
  }
});

describe("what the application may do to the new tables", () => {
  it("a payment the application makes takes the next number and starts as a draft", async () => {
    const made = await asTheApplication<{ id: string; status: string }>(
      `INSERT INTO public.payments (tenant_id, vendor, invoice, amount_value, amount_currency)
       VALUES ('org_456', 'VENDOR-44', 'INV-1008', 100.00, 'USD') RETURNING id, status`,
      "org_456",
    );

    expect(made).toStrictEqual([{ id: "PAY-902", status: "draft" }]);
  });

  it("the application may change a payment's status, and nothing else about it", async () => {
    expect(
      await attempt("UPDATE public.payments SET status = 'cancelled' WHERE id = 'PAY-901'"),
    ).toBe("allowed");

    for (const column of [
      "tenant_id",
      "id",
      "vendor",
      "invoice",
      "amount_value",
      "amount_currency",
    ]) {
      expect(
        await attempt(`UPDATE public.payments SET ${column} = ${column} WHERE id = 'PAY-901'`),
        column,
      ).toMatch(/permission denied for table payments/);
    }
  });

  it("the application may not choose a payment's number or status, or delete a payment", async () => {
    expect(
      await attempt(
        `INSERT INTO public.payments (tenant_id, id, vendor, invoice, amount_value, amount_currency)
         VALUES ('org_456', 'PAY-999', 'VENDOR-44', 'INV-1008', 1.00, 'USD')`,
      ),
    ).toMatch(/permission denied for table payments/);
    expect(
      await attempt(
        `INSERT INTO public.payments (tenant_id, vendor, invoice, amount_value, amount_currency, status)
         VALUES ('org_456', 'VENDOR-44', 'INV-1008', 1.00, 'USD', 'cancelled')`,
      ),
    ).toMatch(/permission denied for table payments/);
    expect(await attempt("DELETE FROM public.payments WHERE id = 'PAY-901'")).toMatch(
      /permission denied for table payments/,
    );
    expect(await attempt("TRUNCATE public.payments")).toMatch(
      /permission denied for table payments/,
    );
  });

  it("the application may read the vendors, and change nothing about them", async () => {
    expect(await attempt("SELECT 1 FROM public.vendors")).toBe("allowed");
    expect(
      await attempt(
        "INSERT INTO public.vendors (tenant_id, id, status) VALUES ('org_456', 'V-1', 'approved')",
      ),
    ).toMatch(/permission denied for table vendors/);
    expect(await attempt("UPDATE public.vendors SET status = 'suspended'")).toMatch(
      /permission denied for table vendors/,
    );
    expect(await attempt("DELETE FROM public.vendors")).toMatch(
      /permission denied for table vendors/,
    );
  });
});
