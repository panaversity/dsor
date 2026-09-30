// One kind of business record. The field names are the ones in specs/dsor/01-model.md,
// section 6. The program reads invoices from the table app.invoices (postgres.ts); the
// unit tests read them from memory (memoryInvoices below).
import { money, type Money } from "./money.ts";
import { formatUri } from "./uri.ts";

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export type Invoice = {
  // The company the invoice belongs to. Its identity is the pair (company,
  // id), so the object carries both, not only its row (step 10's README, decision 10).
  tenant_id: string;
  id: string;
  vendor_id: string;
  amount: Money;
  open_amount: Money; // what is still unpaid
  status: InvoiceStatus;
};

/** The invoices this step knows about. */
export const invoices: Invoice[] = [
  {
    tenant_id: "org_456",
    id: "INV-1008",
    vendor_id: "VENDOR-44",
    amount: money("31400.00", "USD"),
    open_amount: money("31400.00", "USD"),
    status: "issued",
  },
  // Org_789's invoices, the same ones migration 002 adds. Its INV-1008 has
  // the same id as org_456's (step 10's README, decision 5).
  {
    tenant_id: "org_789",
    id: "INV-1008",
    vendor_id: "VENDOR-77",
    amount: money("99000.00", "USD"),
    open_amount: money("99000.00", "USD"),
    status: "issued",
  },
  {
    tenant_id: "org_789",
    id: "INV-2001",
    vendor_id: "VENDOR-77",
    amount: money("12500.00", "USD"),
    open_amount: money("12500.00", "USD"),
    status: "issued",
  },
  // NEW IN STEP 13: more invoices, so that a list has more than one page. The same ones
  // migration 006 adds (step 13's README, decision 7).
  invoice("org_456", "INV-1001", "VENDOR-12", "1250.00", "0.00", "paid"),
  invoice("org_456", "INV-1002", "VENDOR-44", "8900.50", "8900.50", "issued"),
  invoice("org_456", "INV-1003", "VENDOR-31", "450.00", "0.00", "paid"),
  invoice("org_456", "INV-1004", "VENDOR-12", "27300.00", "27300.00", "issued"),
  invoice("org_456", "INV-1005", "VENDOR-44", "1999.99", "1999.99", "draft"),
  invoice("org_456", "INV-1006", "VENDOR-31", "640.00", "640.00", "issued"),
  invoice("org_456", "INV-1007", "VENDOR-12", "15000.00", "0.00", "paid"),
  invoice("org_456", "INV-1009", "VENDOR-44", "7425.00", "7425.00", "issued"),
  invoice("org_456", "INV-1010", "VENDOR-31", "312.40", "0.00", "cancelled"),
  invoice("org_456", "INV-1011", "VENDOR-12", "5600.00", "5600.00", "draft"),
  invoice("org_456", "INV-1012", "VENDOR-44", "22750.00", "22750.00", "issued"),
  invoice("org_789", "INV-2002", "VENDOR-77", "3300.00", "3300.00", "issued"),
  invoice("org_789", "INV-2003", "VENDOR-77", "480.25", "0.00", "paid"),
  invoice("org_789", "INV-2004", "VENDOR-77", "61000.00", "61000.00", "draft"),
];

// One invoice in US dollars, written on one line.
function invoice(
  tenant_id: string,
  id: string,
  vendor_id: string,
  amount: string,
  open: string,
  status: InvoiceStatus,
): Invoice {
  return {
    tenant_id,
    id,
    vendor_id,
    amount: money(amount, "USD"),
    open_amount: money(open, "USD"),
    status,
  };
}

// By company and id together. An id alone no longer names one invoice.
/** Finds one invoice of one company and returns a copy of it, or `undefined` when there is none. */
export function getInvoice(list: Invoice[], tenant: string, id: string): Invoice | undefined {
  // The list is passed in, so this stays a pure function.
  const found = list.find((invoice) => invoice.tenant_id === tenant && invoice.id === id);
  // A copy, so a caller that changes what it was given cannot change the stored invoice.
  // A read never writes. Found by step 04's review, and fixed from step 01 on.
  return found === undefined ? undefined : structuredClone(found);
}

// Where invoices come from, in memory or in the database (step 09's
// README, decision 12). One function, so the operations never know which.
// The company comes first. The store never looks outside it (DSOR-IDN-03b).
/** Finds one invoice of one company: a copy of it, or `undefined` when there is none. */
export type InvoiceStore = { get: (tenant: string, id: string) => Promise<Invoice | undefined> };

/** The invoices above, held in memory, for the unit tests. */
export function memoryInvoices(): InvoiceStore {
  return { get: async (tenant, id) => getInvoice(invoices, tenant, id) };
}

// Every invoice has its canonical URI (DSOR-RID-01a). The URI names the
// invoice's own company, which the invoice carries. Step 01's constant TENANT is gone
// (step 10's README, decision 10).
/** The invoice's canonical URI, such as dsor://org_456/invoice/INV-1008. */
export function invoiceUri(invoice: Invoice): string {
  return formatUri({ tenant_id: invoice.tenant_id, entity: "invoice", id: invoice.id });
}
