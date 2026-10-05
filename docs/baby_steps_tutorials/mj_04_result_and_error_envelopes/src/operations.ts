// The code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { Refusal } from "./envelope.ts";
import { getInvoice, invoices } from "./invoice.ts";
import { preview, type Handler } from "./registry.ts";

export const handlers: Record<string, Handler> = {
  "invoice.get": (input) => {
    // The input comes from outside the program, so it has no types yet.
    const id = (input as { id?: unknown } | null)?.id;
    // NEW IN STEP 04: each refusal names its code from the §28 table, and call does the
    // rest (step 04's README, decision 5).
    if (typeof id !== "string") {
      throw new Refusal("VALIDATION_FAILED", "invoice.get needs { id: string }");
    }
    const invoice = getInvoice(invoices, id);
    if (!invoice) throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`);
    return invoice;
  },
  // NEW IN STEP 04: invoice.issue has a contract but no code yet. Its success needs a
  // proposal, and proposals are step 22. Until then, call refuses every command before
  // its code runs (step 04's README, decision 1).
};
