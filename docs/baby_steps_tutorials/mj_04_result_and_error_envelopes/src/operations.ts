// NEW IN STEP 03: the code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { getInvoice, invoices } from "./invoice.ts";
import type { Handler } from "./registry.ts";

export const handlers: Record<string, Handler> = {
  "invoice.get": (input) => {
    // The input comes from outside the program, so it has no types yet. Step 04 turns
    // this refusal into an error envelope.
    const id = (input as { id?: unknown } | null)?.id;
    if (typeof id !== "string") throw new TypeError("invoice.get needs { id: string }");
    return getInvoice(invoices, id);
  },
  // invoice.issue has a contract but no code yet. Changing an invoice needs an answer
  // for "already issued", and that answer is an error envelope, which is step 04.
};
