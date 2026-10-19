// The code behind each operation, keyed by the operation's name.
// A name here with no contract in contracts/ stops start-up (DSOR-OPR-01).
import { staleRefusal } from "./concurrency.ts";
import { Refusal } from "./envelope.ts";
import { pageOf, pageSize } from "./pages.ts";
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
      // The input is { invoice }, an invoice's canonical URI, and the code
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
      // Internal, because it repeats only the id the caller sent (step 14's
      // README, decision 8).
      if (!invoice)
        throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`, "internal");
      return invoice;
    },
    // A page of the company's invoices, in order of id. The caller's limit
    // is a wish, and DSoR's maximum wins (DSOR-QRY-01; step 13's README, decisions 1 and 2).
    "invoice.list": async (input, company) => {
      // Line ⑥ has checked the input against InvoiceListRequest.
      const { limit, cursor } = input as { limit?: number; cursor?: string };
      // One row more than the page holds, to know whether another page follows. The cursor
      // is a place in this company's list, never a lookup (step 13's README, decision 4).
      // The list takes a place and a count, and no company: it is bound to the active one
      // (step 10's README, decision 13). Found by the Stage 2 review, and fixed from step 13
      // on.
      const rows = await company.invoices.list(cursor, pageSize(limit) + 1);
      return pageOf(rows, limit);
    },
    // A draft payment for an issued invoice: its open amount and its vendor,
    // which DSoR reads itself. The request names only the invoice (step 17's README,
    // decisions 4 and 13).
    "payment.create": async (input, company) => {
      // Line ⑥ has checked the input against PaymentCreateRequest: an invoice's URI, in the
      // active company, because the checklist refused any other before the code runs.
      // And the version of the invoice its caller decided on (step 21's README,
      // decision 4).
      const { invoice: uri, expected_version } = input as {
        invoice: string;
        expected_version: number;
      };
      const { id } = parseUri(uri);
      const invoice = await company.invoices.get(id);
      if (!invoice) {
        throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`, "internal");
      }
      // Facts first. A decision made on another version of the invoice is
      // refused before the business rule is asked (DSOR-CON-01b; step 21's README, decision 7).
      const record = `invoice ${preview(id)}`;
      if (invoice.version !== expected_version) {
        throw staleRefusal(record, invoice.version, expected_version);
      }
      // A paid invoice has nothing to pay, and a draft invoice is not owed yet.
      //   The rule is the contract's precondition now, which line ⑨ evaluates before any work
      //   (step 17's README, decision 13; step 32's README, decision D3).
      // The code writes after line ⑩, and the record follows at line ⑪, so a
      // record that fails leaves the draft behind. Step 36 makes them commit together (step 17's
      // README, decision 1).
      // The draft is written only while the invoice still has that version.
      // A change that lands between the read above and the write is caught here (step 21's
      // README, decision 6).
      const drafted = await company.payments.create(
        { invoice_id: invoice.id, vendor_id: invoice.vendor_id, amount: invoice.open_amount },
        expected_version,
      );
      if ("payment" in drafted) return drafted.payment;
      if (drafted.invoiceVersion === undefined) {
        throw new Refusal("RESOURCE_NOT_FOUND", `no invoice ${preview(id)}`, "internal");
      }
      throw staleRefusal(record, drafted.invoiceVersion, expected_version);
    },
    // The undo of payment.create. Only a draft is cancelled. The store decides
    // in one statement, and looks again when it changed nothing (step 17's README,
    // decision 9).
    // Sends a drafted payment through the company's bank: the first command that
    //   cannot be undone. The payment is read and locked, checked, sent, and only then marked paid,
    //   so a bank that says no, or nothing, leaves it a draft. The bank's key and its wait are
    //   DSoR's, out of this code's reach (step 35's README, decisions D3, D5, and D7).
    "payment.execute": async (input, company) => {
      // expected_version is the invoice's, as for payment.create, and line ⑨ checked it against
      //   the invoice it read (step 21's README, decision 5). The payment's own version is the one
      //   read here, under its lock.
      const { invoice, payment: uri } = input as { invoice: string; payment: string };
      const { id } = parseUri(uri);
      const record = `payment ${preview(id)}`;
      const payment = await company.payments.get(id);
      if (!payment) throw new Refusal("RESOURCE_NOT_FOUND", `no ${record}`, "internal");
      // The invoice line ⑨ read and holds is the one this payment pays, or the call is refused:
      //   a second attempt at one payment must find its invoice held (DSOR-EXC-01).
      if (payment.invoice_id !== parseUri(invoice).id) {
        const why = `${record} does not pay invoice ${preview(parseUri(invoice).id)}`;
        throw new Refusal("VALIDATION_FAILED", why, "internal");
      }
      if (payment.status !== "draft") {
        const why = `${record} is ${payment.status}, not a draft, so it cannot be sent`;
        throw new Refusal("CONFLICT", why, "internal");
      }
      // An invoice is paid once: a second draft of it is never sent. Found by step 35's review,
      //   F2. One attempt at a time over the invoice makes this look safe from a second send at
      //   the same moment (DSOR-EXC-01).
      const paidAlready = await company.payments.paidFor(payment.invoice_id);
      if (paidAlready.length > 0) {
        const why = `invoice ${preview(payment.invoice_id)} is paid already, by ${paidAlready.join(", ")}`;
        throw new Refusal("CONFLICT", why, "internal");
      }
      await company.bank.send({ payment: id, vendor: payment.vendor_id, amount: payment.amount });
      const { payment: paid, changed } = await company.payments.pay(id, payment.version);
      // The lock held the row, so this cannot happen without a fault. Money has left, so the call
      //   ends OUTCOME_UNKNOWN, which keeps the attempt in flight: an accident would undo the claim,
      //   and a new attempt would get a new key and pay again (step 35's README, decision D5).
      if (!changed || !paid) {
        const why = `${record} was sent, and could not be marked paid, so its records must be checked`;
        throw new Refusal("OUTCOME_UNKNOWN", why, "internal");
      }
      return paid;
    },
    "payment.cancel": async (input, company) => {
      // Line ⑥ has checked the input against PaymentCancelRequest.
      // With the version of the payment its caller decided on (step 21's
      // README, decision 4).
      const { payment: uri, expected_version } = input as {
        payment: string;
        expected_version: number;
      };
      const { id } = parseUri(uri);
      const { payment, changed } = await company.payments.cancel(id, expected_version);
      if (!payment) {
        throw new Refusal("RESOURCE_NOT_FOUND", `no payment ${preview(id)}`, "internal");
      }
      if (!changed) {
        // Facts first, then the business rule (step 21's README, decision 7).
        if (payment.version !== expected_version) {
          throw staleRefusal(`payment ${preview(id)}`, payment.version, expected_version);
        }
        const why = "is not a draft, so it cannot be cancelled";
        throw new Refusal("CONFLICT", `payment ${preview(id)} ${why}`, "internal");
      }
      return payment;
    },
    // invoice.issue has a contract but no code: issuing an invoice is not this tutorial's
    // story. Since step 17, a command with code runs (step 17's README, outcome 8).
  };
}
