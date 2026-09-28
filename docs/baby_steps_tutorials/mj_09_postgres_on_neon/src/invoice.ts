// One kind of business record. The field names are the ones in specs/dsor/01-model.md,
// section 6. The program reads invoices from the table app.invoices (postgres.ts); the
// unit tests read them from memory (memoryInvoices below).
import { money, type Money } from "./money.ts";
import { formatUri } from "./uri.ts";

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export type Invoice = {
  id: string;
  vendor_id: string;
  amount: Money;
  open_amount: Money; // what is still unpaid
  status: InvoiceStatus;
};

/** The invoices this step knows about. */
export const invoices: Invoice[] = [
  {
    id: "INV-1008",
    vendor_id: "VENDOR-44",
    amount: money("31400.00", "USD"),
    open_amount: money("31400.00", "USD"),
    status: "issued",
  },
];

/** Finds one invoice by id and returns a copy of it, or `undefined` when there is none. */
export function getInvoice(list: Invoice[], id: string): Invoice | undefined {
  // The list is passed in, so this stays a pure function.
  const found = list.find((invoice) => invoice.id === id);
  // A copy, so a caller that changes what it was given cannot change the stored invoice.
  // A read never writes. Found by step 04's review, and fixed from step 01 on.
  return found === undefined ? undefined : structuredClone(found);
}

// NEW IN STEP 09: where invoices come from, in memory or in the database (step 09's
// README, decision 12). One function, so the operations never know which.
/** Finds one invoice by id: a copy of it, or `undefined` when there is none. */
export type InvoiceStore = { get: (id: string) => Promise<Invoice | undefined> };

/** The invoices above, held in memory, for the unit tests. */
export function memoryInvoices(): InvoiceStore {
  return { get: async (id) => getInvoice(invoices, id) };
}

// Every invoice has its canonical URI (DSOR-RID-01a). This step knows
// one company, so every invoice belongs to it. From step 10, each record carries its own
// tenant_id, and this constant goes away.
export const TENANT = "org_456";

/** The invoice's canonical URI, such as dsor://org_456/invoice/INV-1008. */
export function invoiceUri(invoice: Invoice): string {
  return formatUri({ tenant_id: TENANT, entity: "invoice", id: invoice.id });
}
