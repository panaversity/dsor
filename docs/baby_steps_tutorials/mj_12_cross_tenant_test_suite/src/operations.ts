// The code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { Refusal } from "./envelope.ts";
import { preview, type Handler } from "./registry.ts";
import { parseUri } from "./uri.ts";

// The code holds no store of its own. The registry holds the store, and the pipeline hands
// the code the active company's invoices only, so the code cannot name another company
// (step 10's README, decision 13). Step 09's decision 12 built the operations with the
// store. Found by the Stage 2 review, and fixed from step 10 on.
/** The code behind each operation. It reads only through the company it is given. */
export function handlersFor(): Record<string, Handler> {
  return {
    "invoice.get": async (input, company) => {
      // Line ⑥ of the checklist has checked the input against
      // InvoiceGetRequest. The code no longer checks it in its own way (step 07's README,
      // outcome 2).
      // NEW IN STEP 12: the input is { invoice }, an invoice's canonical URI, and the code
      // reads the id out of it. The URI's company is the active one, because the checklist
      // refused any other before the code runs. The code still reads inside the company it is
      // given, never the one the URI names (step 12's README, decision 1).
      const { id } = parseUri((input as { invoice: string }).invoice);
      // Each refusal names its code from the §28 table, and call does the
      // rest (step 04's README, decision 5).
      // Only inside the active company. Another company's INV-2001 is
      // "not found", word for word as an invoice nobody has (DSOR-IDN-03b, DSOR-ERR-01b).
      // The store takes an id and nothing more: the company is already bound to it.
      const invoice = await company.invoices.get(id);
      if (!invoice) throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`);
      return invoice;
    },
    // invoice.issue has a contract but no code yet. Its success needs a
    // proposal, and proposals are step 22. Until then, call refuses every command before
    // its code runs (step 04's README, decision 1).
  };
}
