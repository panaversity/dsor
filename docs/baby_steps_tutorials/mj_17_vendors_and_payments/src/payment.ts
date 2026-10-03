// NEW IN STEP 17: payments, the second kind of business record, and the first that DSoR
// writes. payment.create makes a draft, and payment.cancel undoes it (step 17's README,
// outcomes 2 and 3). The program keeps payments in the table app.payments (postgres.ts);
// the unit tests keep them in memory (memoryPayments below).
// SHELL: the shape only. Every function says "not built yet" until the code is written.
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
export function memoryPayments(_rows: Payment[] = []): PaymentStore {
  return {
    create: async (): Promise<never> => {
      throw new Error("not built yet");
    },
    cancel: async (): Promise<never> => {
      throw new Error("not built yet");
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
