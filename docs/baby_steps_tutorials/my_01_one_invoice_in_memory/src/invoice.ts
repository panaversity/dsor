// NEW IN STEP 01: the first business entity, and a place to keep it.
//
// "In memory" means a plain array in this file. There is no database until step 09.
// Everything else about an invoice stays the same when the storage changes, which is
// the point of separating the shape from where it lives.

import { money, type Money } from "./money.ts";

/**
 * The values an invoice's status is allowed to take. Nothing checks the status before
 * acting on an invoice yet. Rules such as "a payment needs an issued invoice" become
 * real preconditions in step 32.
 */
export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

/** One invoice, owed by us to a vendor. */
export interface Invoice {
  id: string;
  vendor: string;
  amount: Money;
  status: InvoiceStatus;
}

// The running example of the specification. Every step of this tutorial uses the same
// company, the same vendor, and the same invoice, so the story is never restarted.
//
// The amounts go through money(), so an amount that is not a decimal string with an
// ISO 4217 code fails here, when the file is first loaded, and not later in a payment.
const invoices: readonly Invoice[] = [
  {
    id: "INV-1008",
    vendor: "VENDOR-44",
    amount: money("31400.00", "USD"),
    status: "issued",
  },
  // A second invoice, so that a test can prove getInvoice searches the list instead
  // of always handing back the first entry.
  {
    id: "INV-1009",
    vendor: "VENDOR-44",
    amount: money("2500.00", "USD"),
    status: "draft",
  },
];

/**
 * Finds one invoice by its id.
 *
 * Returns `undefined` when there is no such invoice. A missing invoice is an ordinary
 * answer, not a crash. Proper error shapes arrive in step 04.
 */
export function getInvoice(id: string): Invoice | undefined {
  return invoices.find((invoice) => invoice.id === id);
}
