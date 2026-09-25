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

// The schema's own URI pattern. Inside the dsor repository, `pnpm guard` checks that it
// still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/resourceUri/pattern
const SCHEMA_URI = /^dsor:\/\/[A-Za-z0-9_\-]+\/[a-z][a-z0-9_]*\/[A-Za-z0-9_.\-]+$/;

// Each of these has the right shape, so the schema accepts it. Only the meaning is
// wrong: the tenant part is a name, or almost an id.
const NAMES_NOT_IDS = [
  ["the company's display name", "acme"],
  ["a name with the id's prefix", "org_acme"],
  ["the name joined to digits", "acme_456"],
  ["the prefix in capital letters", "ORG_456"],
  ["the prefix with no digits", "org_"],
  ["a dash instead of the underscore", "org-456"],
  ["letters after the digits", "org_456a"],
];

describe("the tenant part is an id, never a name", () => {
  it("DSOR-RID-01b: every refused tenant below has the shape the schema accepts", () => {
    // If one did not, its test would prove DSOR-RID-01a again, not DSOR-RID-01b.
    for (const [, tenant] of NAMES_NOT_IDS) {
      expect(`dsor://${tenant}/invoice/INV-1008`).toMatch(SCHEMA_URI);
    }
  });

  it.each(NAMES_NOT_IDS)("DSOR-RID-01b: parseUri refuses %s as the tenant", (_why, tenant) => {
    expect(() => parseUri(`dsor://${tenant}/invoice/INV-1008`)).toThrow(TypeError);
  });

  it.each(NAMES_NOT_IDS)("DSOR-RID-01b: formatUri refuses %s as the tenant", (_why, tenant) => {
    expect(() => formatUri({ ...INVOICE_PARTS, tenant_id: tenant })).toThrow(TypeError);
  });

  // A leading zero is allowed on purpose: the id is opaque, so "org_0456" is simply a
  // different id from "org_456". Nothing here reads the digits as a number.
  it.each([["org_456"], ["org_1"], ["org_0456"]])(
    "DSOR-RID-01b: an id of the form org_ and digits is accepted: %s",
    (tenant) => {
      const uri = `dsor://${tenant}/invoice/INV-1008`;
      expect(parseUri(uri).tenant_id).toBe(tenant);
    },
  );

  it("DSOR-RID-01b: the refusal says the tenant must be an id", () => {
    expect(() => parseUri("dsor://acme/invoice/INV-1008")).toThrow(/tenant_id must be an id/);
  });
});
