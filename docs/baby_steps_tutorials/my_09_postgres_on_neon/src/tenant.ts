// The one company this program serves.
//
// A file of its own, and a small one, because of who needs it. The tenant is a fact about
// *identity* — which company a caller belongs to, which records they may touch — and it started
// life in invoice.ts because that was the first file that needed it. By step 05 that meant the
// identity module imported the company id from the invoice module, which is backwards: who you
// belong to does not depend on what an invoice is.
//
// Step 10 makes more than one company possible. When it does, it replaces this one file instead
// of unpicking a constant from a module that has nothing to do with tenancy.

/** The company this deployment serves. Step 10 turns one into many. */
export const TENANT = "org_456";
