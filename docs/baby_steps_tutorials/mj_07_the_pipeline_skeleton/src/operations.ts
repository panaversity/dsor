// The code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { Refusal } from "./envelope.ts";
import { getInvoice, invoices } from "./invoice.ts";
import { preview, type Handler } from "./registry.ts";

export const handlers: Record<string, Handler> = {
  "invoice.get": (input) => {
    // NEW IN STEP 07: line ⑥ of the checklist has checked the input against
    // InvoiceGetRequest, so it is { id: string } and nothing else. The code no longer
    // checks it in its own way (step 07's README, outcome 2).
    const { id } = input as { id: string };
    // Each refusal names its code from the §28 table, and call does the
    // rest (step 04's README, decision 5).
    const invoice = getInvoice(invoices, id);
    if (!invoice) throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`);
    return invoice;
  },
  // invoice.issue has a contract but no code yet. Its success needs a
  // proposal, and proposals are step 22. Until then, call refuses every command before
  // its code runs (step 04's README, decision 1).
};
