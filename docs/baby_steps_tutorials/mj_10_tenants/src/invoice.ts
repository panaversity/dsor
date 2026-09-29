// One kind of business record. The field names are the ones in specs/dsor/01-model.md,
// section 6. The program reads invoices from the table app.invoices (postgres.ts); the
// unit tests read them from memory (memoryInvoices below).
import { money, type Money } from "./money.ts";
import { formatUri } from "./uri.ts";

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export type Invoice = {
  // NEW IN STEP 10: the company the invoice belongs to. Its identity is the pair (company,
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
  // NEW IN STEP 10: org_789's invoices, the same ones migration 002 adds. Its INV-1008 has
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
];

// NEW IN STEP 10: by company and id together. An id alone no longer names one invoice.
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
// NEW IN STEP 10: the company comes first. The store never looks outside it (DSOR-IDN-03b).
/** Finds one invoice of one company: a copy of it, or `undefined` when there is none. */
export type InvoiceStore = { get: (tenant: string, id: string) => Promise<Invoice | undefined> };

/** The invoices above, held in memory, for the unit tests. */
export function memoryInvoices(): InvoiceStore {
  return { get: async (tenant, id) => getInvoice(invoices, tenant, id) };
}

// Every invoice has its canonical URI (DSOR-RID-01a). NEW IN STEP 10: the URI names the
// invoice's own company, which the invoice carries. Step 01's constant TENANT is gone
// (step 10's README, decision 10).
/** The invoice's canonical URI, such as dsor://org_456/invoice/INV-1008. */
export function invoiceUri(invoice: Invoice): string {
  return formatUri({ tenant_id: invoice.tenant_id, entity: "invoice", id: invoice.id });
}
