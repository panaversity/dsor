// The tests for the invoice held in memory.
import { describe, expect, it } from "vitest";
import { money } from "../src/money.ts";
import { getInvoice, invoices } from "../src/invoice.ts";

describe("getInvoice", () => {
  // No rule id: no rule in this step is about finding a record. The map asks for it.
  it("reads INV-1008 by its id", () => {
    const invoice = getInvoice(invoices, "INV-1008");
    expect(invoice?.id).toBe("INV-1008");
    expect(invoice?.vendor_id).toBe("VENDOR-44");
    expect(invoice?.status).toBe("issued");
  });

  it("DSOR-MON-01: INV-1008 holds its amounts as money, not as numbers", () => {
    const invoice = getInvoice(invoices, "INV-1008");
    expect(invoice?.amount).toEqual({ value: "31400.00", currency: "USD" });
    expect(invoice?.open_amount).toEqual({ value: "31400.00", currency: "USD" });
  });

  // The Money type is only a shape. A hand-written { value: "3.14e4", currency: "usd" }
  // fits it and never meets money(). So every amount in the list goes back through
  // money() here, and a bad one fails this test.
  it("DSOR-MON-01: every amount in the invoice list passes money()", () => {
    for (const invoice of invoices) {
      for (const amount of [invoice.amount, invoice.open_amount]) {
        expect(money(amount.value, amount.currency)).toEqual(amount);
      }
    }
  });

  // No rule id, for the same reason. "Not found" is a normal answer, not an error.
  it("returns undefined for an id that does not exist", () => {
    expect(getInvoice(invoices, "INV-9999")).toBeUndefined();
  });

  // No rule id: a read never changes what is stored. Found by step 04's review: a caller
  // that changed an invoice it had read changed INV-1008 for everyone after it.
  it("changing a found invoice does not change the stored one", () => {
    const found = getInvoice(invoices, "INV-1008");
    if (found === undefined) throw new Error("INV-1008 is missing");
    found.status = "paid";
    found.open_amount.value = "0.00";
    expect(getInvoice(invoices, "INV-1008")).toMatchObject({
      status: "issued",
      open_amount: { value: "31400.00", currency: "USD" },
    });
  });
});
