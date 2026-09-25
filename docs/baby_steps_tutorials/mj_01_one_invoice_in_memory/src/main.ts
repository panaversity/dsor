// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
// NEW IN STEP 01: the program reads one invoice from memory and prints it.
import { getInvoice, invoices } from "./invoice.ts";

console.log(getInvoice(invoices, "INV-1008"));
