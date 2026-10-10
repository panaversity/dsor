// NEW IN STEP 14: every field has a label, and a field with no label is confidential.
//
// Measured on step 13's demo: the agent reads INV-1008 and gets `31400.00 USD`, the same line as
// the supervisor — and an agent's answer travels to a model provider outside the company. Nothing
// in the program knew which field was sensitive, because no field carried a label.
//
// Rule DSOR-CLS-01: a field with no declared classification MUST be treated as CONFIDENTIAL.
// Rule DSOR-CLS-03: every query response MUST carry a classification label equal to the highest
// classification among the fields it contains. (The label on the answer is piece 2; the ordering
// it needs is here.)

import { describe, expect, it } from "vitest";
import {
  clearanceOf,
  highestOf,
  holdsMoney,
  isAbove,
  LABELS,
  labelOf,
} from "../src/classification.ts";
import { findPerson } from "../src/people.ts";

describe("the labels", () => {
  it("DSOR-CLS-01: a field with no label is confidential", () => {
    // Nobody labelled a notes field, or an entity called "payroll" at all.
    expect(labelOf("invoice", "notes")).toBe("confidential");
    expect(labelOf("payroll", "salary")).toBe("confidential");
    // Decision 111: nor a name the table only inherits, as every JavaScript object does.
    expect(labelOf("invoice", "toString")).toBe("confidential");
    expect(labelOf("constructor", "name")).toBe("confidential");
  });

  it("restricted is in the table before any column is: a bank account", () => {
    expect(labelOf("invoice", "bank_account")).toBe("restricted");
  });

  it("the running example's invoice is labelled as the specification's own example is", () => {
    // The entity schema in §6 of 01-model.md: id, vendor (§6's vendor_id) and status internal,
    // amount confidential.
    expect(labelOf("invoice", "amount")).toBe("confidential");
    expect(labelOf("invoice", "id")).toBe("internal");
    expect(labelOf("invoice", "vendor")).toBe("internal");
    expect(labelOf("invoice", "status")).toBe("internal");
    // The two that name the row.
    expect(labelOf("invoice", "uri")).toBe("internal");
    expect(labelOf("invoice", "tenantId")).toBe("internal");
    // Decision 110: and the amount is the one field declared to hold money, as §6 declares
    // `amount: { type: money }`. Nothing else is, and a name an object only inherits is no entity.
    expect(holdsMoney("invoice", "amount")).toBe(true);
    expect(holdsMoney("invoice", "vendor")).toBe(false);
    expect(holdsMoney("constructor", "name")).toBe(false);
  });

  it("the four labels are ordered, and 'above' means strictly above", () => {
    expect(LABELS).toStrictEqual(["public", "internal", "confidential", "restricted"]);
    expect(isAbove("confidential", "internal")).toBe(true);
    expect(isAbove("restricted", "confidential")).toBe(true);
    expect(isAbove("internal", "internal")).toBe(false);
    expect(isAbove("public", "internal")).toBe(false);
  });

  it("DSOR-CLS-03: the label of a set of fields is the highest among them, and of no fields is public", () => {
    expect(highestOf(["internal", "confidential", "internal"])).toBe("confidential");
    expect(highestOf(["public", "restricted"])).toBe("restricted");
    expect(highestOf([])).toBe("public");
  });
});

describe("the clearance", () => {
  it("the agent's clearance is internal, which is below the amount", () => {
    const agent = findPerson("accounts-payable-fte");

    expect(agent?.type).toBe("agent");
    expect(clearanceOf(agent!)).toBe("internal");
    expect(isAbove(labelOf("invoice", "amount"), clearanceOf(agent!))).toBe(true);
  });

  it("an agent nobody cleared is cleared for public only — the lock stays locked", () => {
    const agent = findPerson("accounts-payable-fte")!;

    expect(clearanceOf({ ...agent, clearance: undefined })).toBe("public");
  });
});
