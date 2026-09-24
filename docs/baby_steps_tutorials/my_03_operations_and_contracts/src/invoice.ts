// The first business entity, and a place to keep it.
//
// "In memory" means a plain array in this file. There is no database until step 09.
// Everything else about an invoice stays the same when the storage changes, which is
// the point of separating the shape from where it lives.

import { money, type Money } from "./money.ts";
// an invoice now knows its own address.
import { formatUri } from "./uri.ts";

/**
 * The values an invoice's status is allowed to take. Nothing checks the status before
 * acting on an invoice yet. Rules such as "a payment needs an issued invoice" become
 * real preconditions in step 32.
 */
export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

/**
 * One invoice, owed by us to a vendor.
 *
 * Every field is `readonly`, so a caller who is handed an invoice can read it and
 * cannot change what is stored. `readonly Invoice[]` on the list below is not enough
 * on its own: it freezes the array, not the objects inside it.
 */
export interface Invoice {
  // the permanent address, `dsor://org_456/invoice/INV-1008`.
  //
  // The type says `string`, and every string fits, so the type cannot promise this
  // is a real address. `makeInvoice` below is the only thing that builds one, and
  // it goes through formatUri. Keep it that way: an Invoice written out by hand
  // somewhere else would compile with `uri: "banana"`.
  readonly uri: string;
  readonly id: string;
  readonly vendor: string;
  readonly amount: Money;
  readonly status: InvoiceStatus;
}

// The one company in the story. Real multi-tenancy is step 10.
export const TENANT = "org_456";

// builds one invoice and its address together.
//
// The address is made from the id rather than typed out a second time. Writing
// "INV-1008" in two places is how a record ends up with an address belonging to a
// different record, and an address that points at the wrong thing is worse than no
// address at all.
function makeInvoice(id: string, vendor: string, amount: Money, status: InvoiceStatus): Invoice {
  return Object.freeze({
    uri: formatUri({ tenant: TENANT, entity: "invoice", id }),
    id,
    vendor,
    amount,
    status,
  });
}

// The running example of the specification. Every step of this tutorial uses the same
// company, the same vendor, and the same invoice, so the story is never restarted.
//
// The amounts go through money(), so an amount that is not a decimal string with an
// ISO 4217 code fails here, when the file is first loaded, and not later in a payment.
// The addresses go through formatUri() for the same reason.
//
// Object.freeze does at run time what `readonly` does at compile time. Both are
// needed, because Node deletes the types before it runs the file.
const invoices: readonly Invoice[] = Object.freeze([
  makeInvoice("INV-1008", "VENDOR-44", money("31400.00", "USD"), "issued"),
  // A second invoice, so that a test can prove getInvoice searches the list instead
  // of always handing back the first entry.
  makeInvoice("INV-1009", "VENDOR-44", money("2500.00", "USD"), "draft"),
]);

/**
 * Finds one invoice by its id.
 *
 * Returns `undefined` when there is no such invoice. A missing invoice is an ordinary
 * answer, not a crash. Proper error shapes arrive in step 04.
 */
export function getInvoice(id: string): Invoice | undefined {
  return invoices.find((invoice) => invoice.id === id);
}
