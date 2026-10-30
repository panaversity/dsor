// Vendors, the accounts system's records beside its invoices (step 32's README,
// decision D1). DSoR reads a vendor's status before a payment, and never writes it. The program
// reads vendors from the table app.vendors (postgres.ts); the unit tests read them from memory
// (vendors below, which memoryInvoices holds).

/** A vendor's status: the accounts team approves a vendor, or suspends one. */
export type VendorStatus = "approved" | "suspended";

/** One vendor of one company. */
export type Vendor = {
  tenant_id: string;
  id: string;
  status: VendorStatus;
  // The vendor's own version, 1 when it is made, and one more at each change, as an invoice's.
  version: number;
};

/** The vendors this step knows about, each approved: the vendors of the story's invoices. */
export const vendors: Vendor[] = [
  vendor("org_456", "VENDOR-12"),
  vendor("org_456", "VENDOR-31"),
  vendor("org_456", "VENDOR-44"),
  vendor("org_789", "VENDOR-77"),
];

// One approved vendor, written on one line.
function vendor(tenant_id: string, id: string): Vendor {
  return { tenant_id, id, status: "approved", version: 1 };
}

/** Finds one vendor of one company and returns a copy of it, or `undefined` when there is none. */
export function getVendor(list: Vendor[], tenant: string, id: string): Vendor | undefined {
  const found = list.find((one) => one.tenant_id === tenant && one.id === id);
  // A copy, so a caller that changes what it was given cannot change the stored vendor.
  return found === undefined ? undefined : structuredClone(found);
}
