// The first business entity, and a place to keep it.
//
// NEW IN STEP 10: the place is PostgreSQL. Step 01's list in this file lasted nine steps; step 09
// moved the audit log out and left the invoices on purpose, so that step had one idea. This step's
// idea is the company, and "a tenant_id on every row" needs rows. Everything else about an invoice
// stays the same when the storage changes, which is the point of separating the shape from where it
// lives — and every function here now takes the company first, because there is no such thing as
// "INV-1008" any more, only "org_456's INV-1008".
//
// Rule DSOR-TEN-01a: every tenant-owned resource MUST carry its tenant_id.
// Rule DSOR-IDN-03b: an operation MUST NOT read or write across tenants.

import { money, type Money } from "./money.ts";
import { theDatabase } from "./store.ts";
import { formatUri } from "./uri.ts";

/**
 * The values an invoice's status is allowed to take. The table has the same list as a CHECK, so a
 * value outside it cannot be stored either. Rules such as "a payment needs an issued invoice" become
 * real preconditions in step 32.
 */
export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

/**
 * One invoice, owed by one company to a vendor.
 *
 * Every field is `readonly` and every invoice is frozen, so a caller who is handed one can read it
 * and cannot change what is stored — and since step 10, cannot change it because it is a copy of a
 * row, not the row.
 */
export interface Invoice {
  // The permanent address, `dsor://org_456/invoice/INV-1008`. Built from the row by `formatUri`,
  // never typed out, and the company in it is the row's own.
  readonly uri: string;
  /** NEW IN STEP 10: the company this invoice belongs to. Part of its identity, not a detail. */
  readonly tenantId: string;
  readonly id: string;
  readonly vendor: string;
  readonly amount: Money;
  readonly status: InvoiceStatus;
}

/** A row of `public.invoices`, as the driver hands it back. */
interface Row {
  readonly tenant_id: string;
  readonly id: string;
  readonly vendor: string;
  readonly amount_value: string;
  readonly amount_currency: string;
  readonly status: InvoiceStatus;
}

// `amount_value::text`, and the cast is load-bearing. The column is NUMERIC, which `pg` returns as
// text and PGlite parses into a JavaScript number — and a number is exactly what an amount must
// never be (DSOR-MON-01). Cast on the way out, both drivers hand back "31400.00", and money() is the
// only thing that ever builds an amount.
const COLUMNS =
  "tenant_id, id, vendor, amount_value::text AS amount_value, amount_currency, status";

function fromRow(row: Row): Invoice {
  return Object.freeze({
    uri: formatUri({ tenant: row.tenant_id, entity: "invoice", id: row.id }),
    tenantId: row.tenant_id,
    id: row.id,
    vendor: row.vendor,
    amount: money(row.amount_value, row.amount_currency),
    status: row.status,
  });
}

/**
 * Finds one invoice by its company and its id.
 *
 * Returns `undefined` when that company has no such invoice — including when another company has
 * one by that number. A missing invoice is an ordinary answer, not a crash.
 */
export async function getInvoice(tenantId: string, id: string): Promise<Invoice | undefined> {
  const { rows } = await theDatabase().query<Row>(
    `SELECT ${COLUMNS} FROM public.invoices WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  const row = rows[0];

  return row === undefined ? undefined : fromRow(row);
}

/**
 * What happened when an invoice was asked to be issued.
 *
 * This reports a *fact*, and says nothing about how to tell a caller. Choosing the error code
 * belongs to the layer that answers callers, in operations.ts, because a code is part of the answer
 * rather than part of the store.
 */
export type IssueOutcome =
  | { readonly kind: "issued"; readonly invoice: Invoice }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_draft"; readonly status: InvoiceStatus };

/**
 * Issues a draft invoice, in one company.
 *
 * One UPDATE with the status in its WHERE, so "is it a draft?" and "make it issued" are one
 * statement and not two — two invoices issued at once cannot both see a draft. A plain condition,
 * deliberately: this is not the precondition machinery of the contract's `predicates` (nothing reads
 * CEL until step 27) and it is not idempotency (step 20). A second issue is refused because the
 * status moved on.
 *
 * When nothing was updated, a second read says which of the two reasons it was. That read is a
 * snapshot; the fact it reports is the fact as of that moment.
 */
export async function issueInvoice(tenantId: string, id: string): Promise<IssueOutcome> {
  const { rows } = await theDatabase().query<Row>(
    `UPDATE public.invoices SET status = 'issued'
     WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
     RETURNING ${COLUMNS}`,
    [tenantId, id],
  );
  const issued = rows[0];

  if (issued !== undefined) {
    return { kind: "issued", invoice: fromRow(issued) };
  }

  const current = await getInvoice(tenantId, id);

  return current === undefined
    ? { kind: "not_found" }
    : { kind: "not_draft", status: current.status };
}
