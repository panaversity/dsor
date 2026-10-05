// NEW IN STEP 10: the invoices are rows, and every row carries its company.
//
// Step 09 moved the audit log into PostgreSQL and left the invoices in a list, on purpose, so that
// step had one idea. This step's idea is the company, and "a tenant_id on every row" needs rows —
// so the invoices move now, as the cost of rows, the way async was the cost of a database.
//
// The key is (tenant_id, id). That one line is DSOR-TEN-01a in SQL: an invoice number alone is
// not an identity, because org_456 and org_789 both have an INV-1008.
//
// Rule DSOR-TEN-01a: every tenant-owned resource MUST carry its tenant_id.
// Rule DSOR-IDN-03b: an operation MUST NOT read or write across tenants.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { getInvoice, issueInvoice } from "../src/invoice.ts";
import { callOperation } from "../src/operations.ts";
import { aDatabase, resetInvoices } from "./support/database.ts";

const AGENT_FOR_456 = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const AGENT_FOR_789 = { loggedInAs: "accounts-payable-fte", tenant: "org_789" };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

beforeEach(async () => {
  await resetInvoices();
});

afterAll(async () => {
  await db.close();
});

/** Run SQL as the application's own account, and say what happened. */
async function asTheApplication(sql: string): Promise<string> {
  await db.exec("SET ROLE dsor_runtime;");

  try {
    await db.exec(sql);

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  } finally {
    await db.exec("RESET ROLE;");
  }
}

describe("the table", () => {
  it("DSOR-TEN-01a: a row without a company cannot exist", async () => {
    await expect(
      db.exec(`INSERT INTO public.invoices (id, vendor, amount_value, amount_currency, status)
               VALUES ('INV-5000', 'VENDOR-44', 1.00, 'USD', 'draft')`),
    ).rejects.toThrow(/null value in column "tenant_id"|not-null/i);
  });

  it("DSOR-TEN-01a: the key is the company AND the number, so two companies can both have INV-1008", async () => {
    const both = await db.query<{ tenant_id: string; amount: string }>(
      `SELECT tenant_id, amount_value::text AS amount FROM public.invoices
       WHERE id = 'INV-1008' ORDER BY tenant_id`,
    );

    expect(both.rows).toEqual([
      { tenant_id: "org_456", amount: "31400.00" },
      { tenant_id: "org_789", amount: "18000.00" },
    ]);

    // And the same number twice in ONE company is refused, by name.
    await expect(
      db.exec(`INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status)
               VALUES ('org_456', 'INV-1008', 'VENDOR-44', 1.00, 'USD', 'draft')`),
    ).rejects.toThrow(/invoices_pkey/);
  });

  it("DSOR-TEN-01a: the application cannot move an invoice to another company, or renumber it", async () => {
    // The application may change an invoice's status and nothing else: UPDATE is granted column by
    // column, as step 09 did for the audit log's witness. tenant_id and id are not on the list.
    expect(
      await asTheApplication(
        "UPDATE public.invoices SET tenant_id = 'org_789' WHERE id = 'INV-1009'",
      ),
    ).toMatch(/permission denied/);
    expect(
      await asTheApplication("UPDATE public.invoices SET id = 'INV-1' WHERE id = 'INV-1009'"),
    ).toMatch(/permission denied/);
    expect(
      await asTheApplication(
        "UPDATE public.invoices SET status = 'issued' WHERE tenant_id = 'org_456' AND id = 'INV-1009'",
      ),
    ).toBe("allowed");
  });

  it("DSOR-TEN-01a: the application cannot delete or add invoices", async () => {
    // Nothing in this step creates or removes an invoice, so the application holds neither right.
    expect(await asTheApplication("DELETE FROM public.invoices")).toMatch(/permission denied/);
    expect(
      await asTheApplication(`INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status)
                              VALUES ('org_456', 'INV-5000', 'VENDOR-44', 1.00, 'USD', 'draft')`),
    ).toMatch(/permission denied/);
  });
});

describe("the store, asked inside one company", () => {
  it("DSOR-IDN-03b: INV-1008 is a different invoice in each company", async () => {
    const ours = await getInvoice("org_456", "INV-1008");
    const theirs = await getInvoice("org_789", "INV-1008");

    expect(ours?.amount).toEqual({ value: "31400.00", currency: "USD" });
    expect(theirs?.amount).toEqual({ value: "18000.00", currency: "USD" });
    expect(ours?.uri).toBe("dsor://org_456/invoice/INV-1008");
    expect(theirs?.uri).toBe("dsor://org_789/invoice/INV-1008");
    expect(ours?.tenantId).toBe("org_456");
    expect(theirs?.tenantId).toBe("org_789");
  });

  it("DSOR-IDN-03b: an invoice the other company has is not found in yours", async () => {
    // org_456 has INV-1009; org_789 does not.
    expect(await getInvoice("org_456", "INV-1009")).toBeDefined();
    expect(await getInvoice("org_789", "INV-1009")).toBeUndefined();
  });

  it("DSOR-IDN-03b: issuing org_789's INV-1008 leaves org_456's INV-1008 exactly as it was", async () => {
    const before = await getInvoice("org_456", "INV-1008");
    const outcome = await issueInvoice("org_789", "INV-1008");

    expect(outcome.kind).toBe("issued");
    expect((await getInvoice("org_789", "INV-1008"))?.status).toBe("issued");
    expect(await getInvoice("org_456", "INV-1008")).toEqual(before);
  });
});

describe("through the whole pipeline", () => {
  it("DSOR-IDN-03b: the agent working for org_789 gets org_789's INV-1008, not org_456's", async () => {
    // The leak step 09 would have had: `getInvoice("INV-1008")` found whichever came first.
    const answer = await callOperation(AGENT_FOR_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });

    if (answer.kind !== "data") {
      throw new Error(`expected data, got ${answer.kind}`);
    }

    expect(answer.invoice.uri).toBe("dsor://org_789/invoice/INV-1008");
    expect(answer.invoice.amount.value).toBe("18000.00");
  });

  it("DSOR-IDN-03b: the same agent, working for org_456, gets org_456's", async () => {
    const answer = await callOperation(AGENT_FOR_456, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });

    if (answer.kind !== "data") {
      throw new Error(`expected data, got ${answer.kind}`);
    }

    expect(answer.invoice.amount.value).toBe("31400.00");
  });
});
