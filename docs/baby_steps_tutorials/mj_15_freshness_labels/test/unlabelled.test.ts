// NEW IN STEP 14: a field with no label is confidential (DSOR-CLS-01; step 14's README,
// C1). These ask the lookup itself. What an agent and a person get when an answer holds
// such a field is asked in masking, redactions, and answer-label tests.
import { describe, expect, it } from "vitest";
import { checkClassifications, labelOf, readClassifications, type Kinds } from "../src/labels.ts";

/** The shipped labels, read the way start-up reads them. */
function shippedKinds(): Kinds {
  return checkClassifications(readClassifications()).kinds;
}

describe("C1: a field with no label is confidential", () => {
  it("DSOR-CLS-01: a field the file does not name, vendor_bank_account, is confidential", () => {
    expect(labelOf(shippedKinds(), "Invoice", "vendor_bank_account")).toBe("confidential");
  });

  it("DSOR-CLS-01: every field of a kind the file does not have is confidential", () => {
    expect(labelOf(shippedKinds(), "Vendor", "id")).toBe("confidential");
  });

  // So "confidential for everything" cannot pass the two tests above.
  // Since the Stage 2 review, a field that holds an object names its kind after its own
  // label (step 14's README, decision 1).
  it("DSOR-CLS-01: a field the file names keeps its own label", () => {
    expect(labelOf(shippedKinds(), "Invoice", "status")).toBe("internal");
    expect(labelOf(shippedKinds(), "Invoice", "amount")).toBe("confidential Money");
    expect(labelOf(shippedKinds(), "Money", "value")).toBe("confidential");
    expect(labelOf(shippedKinds(), "InvoicePage", "capped")).toBe("public Capped");
    expect(labelOf(shippedKinds(), "InvoicePage", "items")).toBe("Invoice[]");
  });

  // Every JavaScript object already has toString. A lookup in a plain object would find it.
  it("DSOR-CLS-01: a field named like something every object has, toString, is confidential", () => {
    expect(labelOf(shippedKinds(), "Invoice", "toString")).toBe("confidential");
    expect(labelOf(shippedKinds(), "toString", "id")).toBe("confidential");
  });
});
