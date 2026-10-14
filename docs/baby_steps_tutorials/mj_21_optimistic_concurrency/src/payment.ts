// Payments, the second kind of business record, and the first that DSoR
// writes. payment.create makes a draft, and payment.cancel undoes it (step 17's README,
// outcomes 2 and 3). The program keeps payments in the table app.payments (postgres.ts);
// the unit tests keep them in memory (memoryPayments below).
import type { Money } from "./money.ts";

export type PaymentStatus = "draft" | "cancelled";

// The field names follow §6's pattern, where a link to a vendor is vendor_id (step 17's
// README, decision 15).
/** One payment of one company. */
export type Payment = {
  tenant_id: string;
  id: string;
  invoice_id: string;
  vendor_id: string;
  amount: Money;
  status: PaymentStatus;
  // NEW IN STEP 21: the payment's own version, 1 when it is drafted, and one more at each change
  // (step 21's README, decision 1).
  version: number;
};

/** What a draft is made from: the invoice it pays, that invoice's vendor, and the amount. */
export type Draft = { invoice_id: string; vendor_id: string; amount: Money };

/** What a cancel found: the payment as it stands after the cancel, and whether this cancel changed it. */
export type Cancelled = { payment: Payment | undefined; changed: boolean };

// NEW IN STEP 21: a draft is written only while its invoice still has the version the caller
// decided on. When it does not, the store writes nothing, and says which version the invoice
// has now, or none when it is gone (step 21's README, decision 6).
/** What a draft found: the payment it wrote, or the version its invoice has now. */
export type Drafted = { payment: Payment } | { invoiceVersion: number | undefined };

// Where payments are kept, in memory or in the database. The company comes first, as for
// invoices, and the store never looks outside it (DSOR-IDN-03b).
export type PaymentStore = {
  /**
   * Writes a draft for one company, made on this version of its invoice, and gives it back with
   * the id the store gave it.
   */
  create: (tenant: string, draft: Draft, invoiceVersion: number) => Promise<Drafted>;
  /** Changes one company's payment from draft to cancelled, when it is a draft at this version. */
  cancel: (tenant: string, id: string, version: number) => Promise<Cancelled>;
};

/** Payments held in memory, for the unit tests, in the list given. */
export function memoryPayments(rows: Payment[] = []): PaymentStore {
  // One counter for every company, as the database's identity column is (step 17's README,
  // "Left open"). It starts after the rows the list already holds.
  let next = 901 + rows.length;
  return {
    // NEW IN STEP 21: memory has no other writer between the code's read of the invoice and
    // this write, so the code's own comparison is the check here. The database checks again as
    // it writes (step 21's README, decision 8).
    create: async (tenant, draft, _invoiceVersion) => {
      // Field by field. The company is the store's own argument and the status is always
      // draft, so a draft cannot carry a company or a status of its own (step 17's README,
      // decision 12).
      const payment: Payment = {
        tenant_id: tenant,
        id: `PAY-${next++}`,
        invoice_id: draft.invoice_id,
        vendor_id: draft.vendor_id,
        amount: structuredClone(draft.amount),
        status: "draft",
        version: 1,
      };
      rows.push(payment);
      // A copy, so the caller cannot change the stored row (step 01's lesson, for invoices).
      return { payment: structuredClone(payment) };
    },
    cancel: async (tenant, id, version) => {
      const found = rows.find((row) => row.tenant_id === tenant && row.id === id);
      if (found === undefined) return { payment: undefined, changed: false };
      // The memory version of UPDATE ... WHERE status = 'draft': only a draft changes, and a
      // second look reports what the payment is (step 17's README, decision 9).
      // NEW IN STEP 21: and only at the version the caller decided on. The change raises the
      // version, as the database's trigger does (step 21's README, decisions 2 and 6).
      const changed = found.status === "draft" && found.version === version;
      if (changed) {
        found.status = "cancelled";
        found.version += 1;
      }
      return { payment: structuredClone(found), changed };
    },
  };
}

/** A store that writes nothing: each write throws. */
export const NO_PAYMENTS: PaymentStore = Object.freeze({
  create: async (): Promise<never> => {
    throw new Error("this registry was built without a store of payments");
  },
  cancel: async (): Promise<never> => {
    throw new Error("this registry was built without a store of payments");
  },
});
