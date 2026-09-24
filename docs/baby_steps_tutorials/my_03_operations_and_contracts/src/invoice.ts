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
// NEW IN STEP 03: the list is no longer frozen, because invoice.issue has to change
// it. That is a guarantee this step gives up, and it is worth saying out loud: nothing
// in the test suite would have caught it, because the step 01 tests freeze-check each
// invoice and never the list.
//
// What is kept: every Invoice is still frozen, so a caller holding one cannot edit it,
// and the array stays private to this module so issueInvoice is the only way to change
// anything. A real store, with a real transaction, arrives in step 09.
const invoices: Invoice[] = [
  makeInvoice("INV-1008", "VENDOR-44", money("31400.00", "USD"), "issued"),
  // A second invoice, so that a test can prove getInvoice searches the list instead
  // of always handing back the first entry.
  makeInvoice("INV-1009", "VENDOR-44", money("2500.00", "USD"), "draft"),
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

/**
 * Issues a draft invoice, or refuses.
 *
 * NEW IN STEP 03: the first thing in this tutorial that changes state.
 *
 * Returns `undefined` when there is no such invoice, the same ordinary answer
 * getInvoice gives. Throws when the invoice is real but not a draft, the same refusal
 * style as money() and parseUri. Both become error envelopes with a code in step 04.
 *
 * The invoice is replaced rather than edited, because every Invoice is frozen. That is
 * not a workaround: a record that is never edited in place is a record you can hold on
 * to without it changing under you.
 */
export function issueInvoice(id: string): Invoice | undefined {
  const at = invoices.findIndex((invoice) => invoice.id === id);
  const current = invoices[at];

  if (current === undefined) {
    return undefined;
  }

  // A plain `if`, deliberately. This is not the precondition machinery of the
  // contract's `predicates` — nothing reads CEL until step 27 — and it is not
  // idempotency, which is step 20. A second issue is refused because the status moved
  // on, not because a key was replayed.
  if (current.status !== "draft") {
    throw new TypeError(`${id} is ${current.status}, and only a draft invoice can be issued`);
  }

  const issued = makeInvoice(current.id, current.vendor, current.amount, "issued");
  invoices[at] = issued;

  return issued;
}
