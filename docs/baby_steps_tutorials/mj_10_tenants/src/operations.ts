// The code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { Refusal } from "./envelope.ts";
import type { InvoiceStore } from "./invoice.ts";
import { preview, type Handler } from "./registry.ts";

// NEW IN STEP 09: the operations are built with the store their invoices come from, as
// call is given the log (step 09's README, decision 12). The program passes the
// database; the unit tests pass memory.
/** The code behind each operation, reading invoices from this store. */
export function handlersFor(invoices: InvoiceStore): Record<string, Handler> {
  return {
    "invoice.get": async (input, tenant) => {
      // Line ⑥ of the checklist has checked the input against
      // InvoiceGetRequest, so it is { id: string } and nothing else. The code no longer
      // checks it in its own way (step 07's README, outcome 2).
      const { id } = input as { id: string };
      // Each refusal names its code from the §28 table, and call does the
      // rest (step 04's README, decision 5).
      // NEW IN STEP 10: only inside the active company. Another company's INV-2001 is
      // "not found", word for word as an invoice nobody has (DSOR-IDN-03b, DSOR-ERR-01b).
      const invoice = await invoices.get(tenant, id);
      if (!invoice) throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`);
      return invoice;
    },
    // invoice.issue has a contract but no code yet. Its success needs a
    // proposal, and proposals are step 22. Until then, call refuses every command before
    // its code runs (step 04's README, decision 1).
  };
}
