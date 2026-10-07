// One kind of business record. The field names are the ones in specs/dsor/01-model.md,
// section 6. The program reads invoices from the table app.invoices (postgres.ts); the
// unit tests read them from memory (memoryInvoices below).
import type { Freshness } from "./freshness.ts";
import { money, type Money } from "./money.ts";
import { formatUri } from "./uri.ts";

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export type Invoice = {
  // The company the invoice belongs to. Its identity is the pair (company,
  // id), so the object carries both, not only its row (step 10's README, decision 10).
  tenant_id: string;
  id: string;
  vendor_id: string;
  amount: Money;
  open_amount: Money; // what is still unpaid
  status: InvoiceStatus;
  // NEW IN STEP 21: the invoice's own version, 1 when it is made, and one more at each change.
  // The accounts system keeps it, not DSoR (DSOR-CNR-03b; step 21's README, decisions 1 and 2).
  version: number;
};

/** The invoices this step knows about. */
export const invoices: Invoice[] = [
  {
    tenant_id: "org_456",
    id: "INV-1008",
    vendor_id: "VENDOR-44",
    amount: money("31400.00", "USD"),
    open_amount: money("31400.00", "USD"),
    status: "issued",
    version: 1,
  },
  // Org_789's invoices, the same ones migration 002 adds. Its INV-1008 has
  // the same id as org_456's (step 10's README, decision 5).
  {
    tenant_id: "org_789",
    id: "INV-1008",
    vendor_id: "VENDOR-77",
    amount: money("99000.00", "USD"),
    open_amount: money("99000.00", "USD"),
    status: "issued",
    version: 1,
  },
  {
    tenant_id: "org_789",
    id: "INV-2001",
    vendor_id: "VENDOR-77",
    amount: money("12500.00", "USD"),
    open_amount: money("12500.00", "USD"),
    status: "issued",
    version: 1,
  },
  // More invoices, so that a list has more than one page. The same ones
  // migration 006 adds (step 13's README, decision 7).
  invoice("org_456", "INV-1001", "VENDOR-12", "1250.00", "0.00", "paid"),
  invoice("org_456", "INV-1002", "VENDOR-44", "8900.50", "8900.50", "issued"),
  invoice("org_456", "INV-1003", "VENDOR-31", "450.00", "0.00", "paid"),
  invoice("org_456", "INV-1004", "VENDOR-12", "27300.00", "27300.00", "issued"),
  invoice("org_456", "INV-1005", "VENDOR-44", "1999.99", "1999.99", "draft"),
  invoice("org_456", "INV-1006", "VENDOR-31", "640.00", "640.00", "issued"),
  invoice("org_456", "INV-1007", "VENDOR-12", "15000.00", "0.00", "paid"),
  invoice("org_456", "INV-1009", "VENDOR-44", "7425.00", "7425.00", "issued"),
  invoice("org_456", "INV-1010", "VENDOR-31", "312.40", "0.00", "cancelled"),
  invoice("org_456", "INV-1011", "VENDOR-12", "5600.00", "5600.00", "draft"),
  invoice("org_456", "INV-1012", "VENDOR-44", "22750.00", "22750.00", "issued"),
  invoice("org_789", "INV-2002", "VENDOR-77", "3300.00", "3300.00", "issued"),
  invoice("org_789", "INV-2003", "VENDOR-77", "480.25", "0.00", "paid"),
  invoice("org_789", "INV-2004", "VENDOR-77", "61000.00", "61000.00", "draft"),
];

// One invoice in US dollars, written on one line.
function invoice(
  tenant_id: string,
  id: string,
  vendor_id: string,
  amount: string,
  open: string,
  status: InvoiceStatus,
): Invoice {
  return {
    tenant_id,
    id,
    vendor_id,
    amount: money(amount, "USD"),
    open_amount: money(open, "USD"),
    status,
    version: 1,
  };
}

// By company and id together. An id alone no longer names one invoice.
/** Finds one invoice of one company and returns a copy of it, or `undefined` when there is none. */
export function getInvoice(list: Invoice[], tenant: string, id: string): Invoice | undefined {
  // The list is passed in, so this stays a pure function.
  const found = list.find((invoice) => invoice.tenant_id === tenant && invoice.id === id);
  // A copy, so a caller that changes what it was given cannot change the stored invoice.
  // A read never writes. Found by step 04's review, and fixed from step 01 on.
  return found === undefined ? undefined : structuredClone(found);
}

// Where invoices come from, in memory or in the database (step 09's
// README, decision 12). One function, so the operations never know which.
// The company comes first. The store never looks outside it (DSOR-IDN-03b).
// Each read comes back with its label, written by the store that served it
// (DSOR-FRS-01a; step 15's README, decision 5).
export type InvoiceStore = {
  /** Finds one invoice of one company: a copy of it, or `undefined` when there is none, and the read's label. */
  get: (
    tenant: string,
    id: string,
  ) => Promise<{ invoice: Invoice | undefined; freshness: Freshness }>;
  // A list reads rows in order of id, after the cursor, never more than
  // it is asked for (step 13's README, decision 4).
  /** Copies of the first `count` invoices of one company whose id comes after `after`, in order of id, and the read's label. */
  list: (
    tenant: string,
    after: string | undefined,
    count: number,
  ) => Promise<{ rows: Invoice[]; freshness: Freshness }>;
};

// NEW IN STEP 21: or the invoices of a list of the test's own, which the test may change, as
// the accounts system changes an invoice (step 21's README, decision 8).
/** The invoices above, or those of the list given, held in memory, for the unit tests. */
export function memoryInvoices(list: Invoice[] = invoices): InvoiceStore {
  return {
    // NEW IN STEP 21: a read of one invoice names its version (DSOR-FRS-01a).
    get: async (tenant, id) => {
      const invoice = getInvoice(list, tenant, id);
      const version = invoice === undefined ? {} : { resource_version: String(invoice.version) };
      return { invoice, freshness: { ...readNow(), ...version } };
    },
    list: async (tenant, after, count) => ({
      rows: listInvoices(list, tenant, after, count),
      freshness: readNow(),
    }),
  };
}

// Memory is the unit tests' system of record, read within the request, so
// current. It has no database, so its clock is the program's (step 15's README, decision 2).
/** The label of a read from memory, now. */
function readNow(): Freshness {
  return { mode: "current", observed_at: new Date().toISOString(), connector: "memory" };
}

// The memory version of the list's SQL (step 13's README, decision 4).
/** Copies of the first `count` invoices of one company whose id comes after `after`, in order of id. */
export function listInvoices(
  list: Invoice[],
  tenant: string,
  after: string | undefined,
  count: number,
): Invoice[] {
  // < compares text by its character codes, as the database's C.UTF-8 does.
  const byId = (a: Invoice, b: Invoice): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // After the cursor, never at it: the cursor's own row was the last of the page before.
  const next = (invoice: Invoice): boolean => after === undefined || invoice.id > after;
  const own = list.filter((invoice) => invoice.tenant_id === tenant && next(invoice)).sort(byId);
  return own.slice(0, count).map((invoice) => structuredClone(invoice));
}

// The store of a registry built without one. Every read is a bug, so the call fails with
// INTERNAL_ERROR: when the store is missing, the answer is no (step 10's README, decision
// 13). Found by the Stage 2 review, and fixed from step 10 on.
/** A store that reads nothing: each read throws. */
export const NO_STORE: InvoiceStore = Object.freeze({
  get: async (): Promise<never> => {
    throw new Error("this registry was built without a store of invoices");
  },
  // And no list. Found by the Stage 2 review, and fixed from step 13 on.
  list: async (): Promise<never> => {
    throw new Error("this registry was built without a store of invoices");
  },
});

// Every invoice has its canonical URI (DSOR-RID-01a). The URI names the
// invoice's own company, which the invoice carries. Step 01's constant TENANT is gone
// (step 10's README, decision 10).
/** The invoice's canonical URI, such as dsor://org_456/invoice/INV-1008. */
export function invoiceUri(invoice: Invoice): string {
  return formatUri({ tenant_id: invoice.tenant_id, entity: "invoice", id: invoice.id });
}
