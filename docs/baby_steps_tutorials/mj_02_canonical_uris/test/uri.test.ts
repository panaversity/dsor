// NEW IN STEP 02: the tests for canonical URIs, the refusals first among them.
import { describe, expect, it } from "vitest";
import { formatUri, parseUri } from "../src/uri.ts";

const INVOICE_URI = "dsor://org_456/invoice/INV-1008";
const INVOICE_PARTS = { tenant_id: "org_456", entity: "invoice", id: "INV-1008" };

describe("formatUri and parseUri", () => {
  it("DSOR-RID-01a: formatUri builds dsor://{tenant_id}/{entity}/{id}", () => {
    expect(formatUri(INVOICE_PARTS)).toBe(INVOICE_URI);
  });

  it("DSOR-RID-01a: parseUri splits the URI back into its three parts", () => {
    expect(parseUri(INVOICE_URI)).toEqual(INVOICE_PARTS);
  });

  it("DSOR-RID-01a: a URI survives the round trip unchanged", () => {
    expect(formatUri(parseUri(INVOICE_URI))).toBe(INVOICE_URI);
  });

  // Test the "no" as carefully as the "yes".
  it.each([
    ["no id", "dsor://org_456/invoice"],
    ["a scheme that is not dsor", "http://org_456/invoice/INV-1008"],
    ["a fourth part", "dsor://org_456/invoice/INV-1008/extra"],
    // A lazy split("/") gives three pieces here, and one of them is "".
    ["an empty entity", "dsor://org_456//INV-1008"],
    ["an entity that starts with a capital letter", "dsor://org_456/Invoice/INV-1008"],
    ["a space inside the id", "dsor://org_456/invoice/INV 1008"],
    ["a second line after the id", "dsor://org_456/invoice/INV-1008\nextra"],
    ["an empty string", ""],
  ])("DSOR-RID-01a: parseUri refuses a URI with %s", (_why, uri) => {
    expect(() => parseUri(uri)).toThrow(TypeError);
  });

  it("DSOR-RID-01a: parseUri refuses a value that is not a string", () => {
    // Data from outside the program has no types, so the function checks at run time.
    expect(() => parseUri(1008 as unknown as string)).toThrow(TypeError);
  });

  // formatUri must never build a URI that parseUri would read differently.
  it.each([
    ["a slash inside the id", { ...INVOICE_PARTS, id: "INV/1008" }],
    ["an empty entity", { ...INVOICE_PARTS, entity: "" }],
    ["an empty tenant", { ...INVOICE_PARTS, tenant_id: "" }],
  ])("DSOR-RID-01a: formatUri refuses %s", (_why, parts) => {
    expect(() => formatUri(parts)).toThrow(TypeError);
  });

  it("DSOR-RID-01a: the refusal says what was wrong", () => {
    expect(() => parseUri("dsor://org_456/invoice")).toThrow(/not a canonical URI/);
  });
});
