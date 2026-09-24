// Run with:  pnpm start
// Node runs this TypeScript file directly. There is no build step in this tutorial.
import { greet } from "./greet.ts";
// The program reads an invoice as well as greeting.
import { getInvoice } from "./invoice.ts";

console.log(greet("accounts-payable-fte"));

// Read the invoice from the running example and print it.
// The amount is printed from its two parts, because an amount without a currency
// is not money.
const invoice = getInvoice("INV-1008");
if (invoice === undefined) {
  console.log("INV-1008: not found.");
} else {
  // NEW IN STEP 02: the address is printed first. It is how this invoice is named
  // everywhere else: in the logs, the events and the approval.
  console.log(
    `${invoice.uri}\n  ${invoice.amount.value} ${invoice.amount.currency} to ${invoice.vendor} (${invoice.status})`,
  );
}

// Asking for something that is not there is an ordinary answer.
console.log(getInvoice("INV-9999") === undefined ? "INV-9999: not found." : "INV-9999: found.");
