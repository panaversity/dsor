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
};

/** What a draft is made from: the invoice it pays, that invoice's vendor, and the amount. */
export type Draft = { invoice_id: string; vendor_id: string; amount: Money };

/** What a cancel found: the payment as it stands after the cancel, and whether this cancel changed it. */
export type Cancelled = { payment: Payment | undefined; changed: boolean };

// Where payments are kept, in memory or in the database. The company comes first, as for
// invoices, and the store never looks outside it (DSOR-IDN-03b).
export type PaymentStore = {
  /** Writes a draft for one company, and gives it back with the id the store gave it. */
  create: (tenant: string, draft: Draft) => Promise<Payment>;
  /** Changes one company's payment from draft to cancelled, when it is a draft. */
  cancel: (tenant: string, id: string) => Promise<Cancelled>;
};

/** Payments held in memory, for the unit tests, in the list given. */
export function memoryPayments(rows: Payment[] = []): PaymentStore {
  // One counter for every company, as the database's identity column is (step 17's README,
  // "Left open"). It starts after the rows the list already holds.
  let next = 901 + rows.length;
  return {
    create: async (tenant, draft) => {
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
      };
      rows.push(payment);
      // A copy, so the caller cannot change the stored row (step 01's lesson, for invoices).
      return structuredClone(payment);
    },
    cancel: async (tenant, id) => {
      const found = rows.find((row) => row.tenant_id === tenant && row.id === id);
      if (found === undefined) return { payment: undefined, changed: false };
      // The memory version of UPDATE ... WHERE status = 'draft': only a draft changes, and a
      // second look reports what the payment is (step 17's README, decision 9).
      const changed = found.status === "draft";
      if (changed) found.status = "cancelled";
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
