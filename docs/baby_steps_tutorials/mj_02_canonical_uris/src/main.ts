// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// The program reads one invoice from memory and prints it.
import { getInvoice, invoices } from "./invoice.ts";
import { formatUri, parseUri } from "./uri.ts";

const invoice = getInvoice(invoices, "INV-1008");
console.log(invoice);

// NEW IN STEP 02: the invoice's permanent address, and the address read back.
if (invoice) {
  const uri = formatUri({ tenant_id: "org_456", entity: "invoice", id: invoice.id });
  console.log(uri);
  console.log(parseUri(uri));
}
