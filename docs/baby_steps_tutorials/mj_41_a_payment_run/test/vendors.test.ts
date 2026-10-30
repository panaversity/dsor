// Vendors, the accounts system's records beside its invoices, and the bind that reads one through
// its invoice (step 32's README, decisions D1 and D2). The agent drafts INV-1008, whose vendor is
// VENDOR-44: line ⑨ reads VENDOR-44 itself, in org_456, and the request never names it.
import { describe, expect, it } from "vitest";
import { readBound } from "../src/bound.ts";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import { handlersFor } from "../src/operations.ts";
import { vendors, type Vendor } from "../src/vendor.ts";
import { AGENT, contract, keyed, shippedRoles, shippedWith, withoutControls } from "./helpers.ts";
import { ruleWorldOnTuesday } from "./rule-world.ts";

const PAY_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };

/** The story's invoices, with one more, of org_456, from this vendor. */
function billsWith(vendor_id: string): Invoice[] {
  const bill = structuredClone(invoices.find((i) => i.id === "INV-1008")!);
  return [...structuredClone(invoices), { ...bill, id: "INV-9001", vendor_id }];
}

describe("C1: line ⑨ reads the vendor itself, through the invoice (step 32's README, decision D2)", () => {
  it("DSOR-MOD-03: line ⑨ reads INV-1008 and, through its vendor_id, VENDOR-44, approved, from org_456's own store", async () => {
    const bound = await readBound(
      contract("payment.create") as never,
      PAY_1008,
      memoryInvoices(),
      "org_456",
    );
    expect(bound.state["invoice"]).toMatchObject({ id: "INV-1008", vendor_id: "VENDOR-44" });
    expect(bound.state["vendor"]).toStrictEqual({
      tenant_id: "org_456",
      id: "VENDOR-44",
      status: "approved",
      version: 1,
    });
    // The records the request names are the invoice alone: the vendor is read, never asked for.
    expect(Object.keys(bound.invoices)).toStrictEqual(["invoice"]);
  });

  it("DSOR-MOD-03: a suspended vendor is read as suspended: the store's word, at the time of the read", async () => {
    const list: Vendor[] = structuredClone(vendors);
    list.find((v) => v.id === "VENDOR-44")!.status = "suspended";
    const bound = await readBound(
      contract("payment.create") as never,
      PAY_1008,
      memoryInvoices(invoices, list),
      "org_456",
    );
    expect(bound.state["vendor"]).toMatchObject({ id: "VENDOR-44", status: "suspended" });
  });

  it("DSOR-IDN-03b: a vendor the accounts system does not list is not bound, and neither is another company's: org_789's VENDOR-77", async () => {
    for (const vendor_id of ["VENDOR-99", "VENDOR-77"]) {
      const bound = await readBound(
        contract("payment.create") as never,
        { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 },
        memoryInvoices(billsWith(vendor_id)),
        "org_456",
      );
      expect(bound.state["invoice"]).toMatchObject({ id: "INV-9001", vendor_id });
      expect("vendor" in bound.state).toBe(false);
    }
  });

  it("DSOR-MOD-03: a request that names a vendor of its own is refused at line ⑥, VALIDATION_FAILED", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await w.ask(keyed(AGENT), "payment.create", {
      ...PAY_1008,
      vendor: { id: "VENDOR-44", status: "approved" },
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(w.drafted).toStrictEqual([]);
  });
});

describe("C1: start-up checks each bind (step 32's README, decision D2)", () => {
  it("Step 32: payment.create binds the invoice from its input, then the vendor through the invoice", () => {
    expect(contract("payment.create")["bind"]).toStrictEqual({
      invoice: "input.invoice",
      vendor: "state.invoice.vendor_id",
    });
  });

  it.each([
    ["an alias bound after it", { vendor: "state.invoice.vendor_id", invoice: "input.invoice" }],
    ["an alias nobody binds", { invoice: "input.invoice", vendor: "state.bill.vendor_id" }],
    [
      "a field that is not a vendor's link",
      { invoice: "input.invoice", vendor: "state.invoice.status" },
    ],
    [
      "a link through a vendor",
      {
        invoice: "input.invoice",
        vendor: "state.invoice.vendor_id",
        other: "state.vendor.vendor_id",
      },
    ],
  ])("Step 32: start-up refuses a bind through %s", (_what, bind) => {
    const changed = { ...contract("payment.create"), bind };
    expect(() => withoutControls(shippedWith(changed), handlersFor(), shippedRoles)).toThrow(
      "payment.create: the bind",
    );
  });
});
