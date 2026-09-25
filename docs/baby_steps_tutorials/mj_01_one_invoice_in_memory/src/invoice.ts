// NEW IN STEP 01: one kind of business record, held in memory. No database yet.
// The field names are the ones in specs/dsor/01-model.md, section 6.
import { money, type Money } from "./money.ts";

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

/** Finds one invoice by id, or returns `undefined` when there is none. */
export function getInvoice(list: Invoice[], id: string): Invoice | undefined {
  // The list is passed in, so this stays a pure function. In step 09 it will move into
  // a database.
  return list.find((invoice) => invoice.id === id);
}
