// The code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { Refusal } from "./envelope.ts";
import type { InvoiceStore } from "./invoice.ts";
import { pageOf, pageSize } from "./pages.ts";
import { preview, type Handler } from "./registry.ts";
import { parseUri } from "./uri.ts";

// The operations are built with the store their invoices come from, as
// call is given the log (step 09's README, decision 12). The program passes the
// database; the unit tests pass memory.
/** The code behind each operation, reading invoices from this store. */
export function handlersFor(invoices: InvoiceStore): Record<string, Handler> {
  return {
    "invoice.get": async (input, tenant) => {
      // Line ⑥ of the checklist has checked the input against
      // InvoiceGetRequest. The code no longer checks it in its own way (step 07's README,
      // outcome 2).
      // The input is { invoice }, an invoice's canonical URI, and the code
      // reads the id out of it. The URI's company is the active one, because the checklist
      // refused any other before the code runs. The code still reads inside the company it is
      // given, never the one the URI names (step 12's README, decision 1).
      const { id } = parseUri((input as { invoice: string }).invoice);
      // Each refusal names its code from the §28 table, and call does the
      // rest (step 04's README, decision 5).
      // Only inside the active company. Another company's INV-2001 is
      // "not found", word for word as an invoice nobody has (DSOR-IDN-03b, DSOR-ERR-01b).
      const invoice = await invoices.get(tenant, id);
      if (!invoice) throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`);
      return invoice;
    },
    // A page of the company's invoices, in order of id. The caller's limit
    // is a wish, and DSoR's maximum wins (DSOR-QRY-01; step 13's README, decisions 1 and 2).
    "invoice.list": async (input, tenant) => {
      // Line ⑥ has checked the input against InvoiceListRequest.
      const { limit, cursor } = input as { limit?: number; cursor?: string };
      // One row more than the page holds, to know whether another page follows. The cursor
      // is a place in this company's list, never a lookup (step 13's README, decision 4).
      const rows = await invoices.list(tenant, cursor, pageSize(limit) + 1);
      return pageOf(rows, limit);
    },
    // invoice.issue has a contract but no code yet. Its success needs a
    // proposal, and proposals are step 22. Until then, call refuses every command before
    // its code runs (step 04's README, decision 1).
  };
}
