// STEP 17: payments, the first record a command makes instead of changing.
//
// A payment pays one invoice, for an amount, to that invoice's own vendor. `payment.create` makes
// it as a draft and `payment.cancel` takes it back, which is what makes `payment.create`
// compensatable: its effect can be undone by an operation that is declared in its contract and runs
// through the same door as everything else (DSOR-EXE-05c, decision 125).
//
// Like invoice.ts, every statement names its company twice: once in the WHERE clause, and once in
// the setting the second lock reads (step 11). Either alone would keep the companies apart; both
// together survive the day one of them is forgotten.

import { money, type Money } from "./money.ts";
import { theDatabase } from "./store.ts";
import { formatUri } from "./uri.ts";

export type PaymentStatus = "draft" | "cancelled";

export interface Payment {
  readonly uri: string;
  readonly tenantId: string;
  readonly id: string;
  /** The vendor's address. A payment pays the vendor of the invoice it pays, never another. */
  readonly vendor: string;
  /** The invoice's address. */
  readonly invoice: string;
  readonly amount: Money;
  readonly status: PaymentStatus;
}

interface Row {
  readonly tenant_id: string;
  readonly id: string;
  readonly vendor: string;
  readonly invoice: string;
  readonly amount_value: string;
  readonly amount_currency: string;
  readonly status: PaymentStatus;
}

const COLUMNS =
  "tenant_id, id, vendor, invoice, amount_value::text AS amount_value, amount_currency, status";

function fromRow(row: Row): Payment {
  return Object.freeze({
    uri: formatUri({ tenant: row.tenant_id, entity: "payment", id: row.id }),
    tenantId: row.tenant_id,
    id: row.id,
    vendor: formatUri({ tenant: row.tenant_id, entity: "vendor", id: row.vendor }),
    invoice: formatUri({ tenant: row.tenant_id, entity: "invoice", id: row.invoice }),
    amount: money(row.amount_value, row.amount_currency),
    status: row.status,
  });
}

export type CreateOutcome =
  | { readonly kind: "created"; readonly payment: Payment }
  | { readonly kind: "no_invoice" }
  /** STEP 17, decision 126: the invoice is in another currency, which is `currency`. */
  | { readonly kind: "wrong_currency"; readonly currency: string };

/**
 * Make a draft payment for one of this company's invoices, to that invoice's vendor.
 *
 * One statement: the vendor is read from the invoice in the same INSERT, so there is no moment
 * between reading the invoice and writing the payment for anything to change. The number and the
 * status are the database's: a sequence gives the next number, and a new payment is a draft.
 *
 * STEP 17, decision 126: and only in the invoice's currency. A USD invoice was paid in EUR,
 * and in ZZZ, which is no currency; converting is step 26's.
 */
export async function createPayment(
  tenantId: string,
  invoiceId: string,
  amount: Money,
): Promise<CreateOutcome> {
  const { rows } = await theDatabase(tenantId).query<Row>(
    `INSERT INTO public.payments (tenant_id, vendor, invoice, amount_value, amount_currency)
     SELECT i.tenant_id, i.vendor, i.id, $3::numeric, $4
       FROM public.invoices i
      WHERE i.tenant_id = $1 AND i.id = $2 AND i.amount_currency = $4
     RETURNING ${COLUMNS}`,
    [tenantId, invoiceId, amount.value, amount.currency],
  );
  const created = rows[0];

  if (created !== undefined) {
    return { kind: "created", payment: fromRow(created) };
  }

  // Nothing made: no such invoice, or one in another currency. Asked to say which.
  const { rows: found } = await theDatabase(tenantId).query<{ currency: string }>(
    "SELECT amount_currency AS currency FROM public.invoices WHERE tenant_id = $1 AND id = $2",
    [tenantId, invoiceId],
  );
  const currency = found[0]?.currency;

  return currency === undefined ? { kind: "no_invoice" } : { kind: "wrong_currency", currency };
}

export type CancelOutcome =
  | { readonly kind: "cancelled"; readonly payment: Payment }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_draft"; readonly status: Exclude<PaymentStatus, "draft"> };

/**
 * Take a draft payment back, and only a draft. A cancelled payment stays cancelled because this
 * statement changes drafts only: the application's UPDATE right on `status` could set one back to a
 * draft, and nothing in the database stops it (decision 126). The proposal's states, in step 22,
 * are where a state that cannot go back is made a rule.
 */
export async function cancelPayment(tenantId: string, id: string): Promise<CancelOutcome> {
  const { rows } = await theDatabase(tenantId).query<Row>(
    `UPDATE public.payments SET status = 'cancelled'
     WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
     RETURNING ${COLUMNS}`,
    [tenantId, id],
  );
  const cancelled = rows[0];

  if (cancelled !== undefined) {
    return { kind: "cancelled", payment: fromRow(cancelled) };
  }

  // Not a draft, or not there: asked separately, to say which. A draft found now was made after the
  // UPDATE looked, by a payment.create that took the very number this cancel named. It was not
  // there to cancel, and is reported that way.
  const { rows: found } = await theDatabase(tenantId).query<{ status: PaymentStatus }>(
    "SELECT status FROM public.payments WHERE tenant_id = $1 AND id = $2",
    [tenantId, id],
  );
  const status = found[0]?.status;

  return status === undefined || status === "draft"
    ? { kind: "not_found" }
    : { kind: "not_draft", status };
}

/**
 * An amount a payment may carry, or why not.
 *
 * `money()` checks what the specification's schema checks: a decimal and a currency code. A payment
 * needs more. Above zero, because a payment of nothing is a mistake. At most two decimal places,
 * because the column holds two and PostgreSQL would round a third away without a word: 31400.005
 * would become 31400.01. And at most sixteen digits before the point, all NUMERIC(18, 2) holds,
 * so that a seventeenth is refused here and not halfway through a statement.
 */
export function paymentAmountFrom(given: unknown): Money | string {
  if (given === null || typeof given !== "object" || Array.isArray(given)) {
    return "a payment needs an amount: an object with a value and a currency";
  }

  const parts = given as Readonly<Record<string, unknown>>;
  const value = Object.hasOwn(parts, "value") ? parts["value"] : undefined;
  const currency = Object.hasOwn(parts, "currency") ? parts["currency"] : undefined;

  if (typeof value !== "string" || typeof currency !== "string") {
    return 'an amount\'s value and currency are both text, like "31400.00" and "USD"';
  }

  let amount: Money;

  try {
    amount = money(value, currency);
  } catch (error) {
    return (error as Error).message;
  }

  if (!/^[0-9]{1,16}(\.[0-9]{1,2})?$/.test(amount.value) || /^0+(\.0+)?$/.test(amount.value)) {
    return `a payment's amount is above zero, with at most sixteen digits before the point and two after it: ${amount.value} is not`;
  }

  return amount;
}

/**
 * One company's payments, in number order, for the demo's report: what the database holds once the
 * receipts have been printed. Through the same store as every statement, so the company is said and
 * the second lock applies; not an operation, because no caller asks for it.
 */
export async function paymentsOf(tenantId: string): Promise<readonly Payment[]> {
  const { rows } = await theDatabase(tenantId).query<Row>(
    `SELECT ${COLUMNS} FROM public.payments WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );

  return Object.freeze(rows.map(fromRow));
}
