// NEW IN STEP 02: the address of a record, read and written.
//
// parseUri reads an address and hands back its three parts. formatUri does the
// reverse. Both refuse an address that is not allowed, and the refusals are the
// interesting half.

import { describe, expect, it } from "vitest";
import { formatUri, parseUri } from "../src/uri.ts";

describe("parseUri", () => {
  it("DSOR-RID-01a: a canonical URI is dsor://{tenant_id}/{entity}/{id}", () => {
    expect(parseUri("dsor://org_456/invoice/INV-1008")).toEqual({
      tenant: "org_456",
      entity: "invoice",
      id: "INV-1008",
    });
  });

  it("DSOR-RID-01a: an address of the wrong shape is refused", () => {
    expect(() => parseUri("dsor://org_456/invoice")).toThrow(TypeError); // no id
    expect(() => parseUri("dsor://org_456/invoice/")).toThrow(TypeError); // empty id
    expect(() => parseUri("dsor://org_456/invoice/INV 1008")).toThrow(TypeError); // a space
    expect(() => parseUri("dsor://org_456/Invoice/INV-1008")).toThrow(TypeError); // capital
    expect(() => parseUri("https://org_456/invoice/INV-1008")).toThrow(TypeError); // wrong scheme
    expect(() => parseUri("")).toThrow(TypeError);
  });

  it("DSOR-RID-01a: nothing may be hidden either side of the address", () => {
    expect(() => parseUri(" dsor://org_456/invoice/INV-1008")).toThrow(TypeError);
    expect(() => parseUri("dsor://org_456/invoice/INV-1008 and more")).toThrow(TypeError);
  });

  // This is the rule the step exists for. A company name is a perfectly good piece
  // of text, so the shape check above lets it through. Only a rule about what a
  // tenant id looks like can stop it.
  it("DSOR-RID-01b: a company name in place of a tenant id is refused", () => {
    expect(() => parseUri("dsor://acme/invoice/INV-1008")).toThrow(TypeError);
    expect(() => parseUri("dsor://acme-corp/invoice/INV-1008")).toThrow(TypeError);
    expect(() => parseUri("dsor://ACME/invoice/INV-1008")).toThrow(TypeError);
  });

  // Step 01 learned this the hard way: `readonly` is erased before Node runs the
  // file, so it stops nothing at run time. The same lesson, applied to the parts
  // parseUri hands out.
  it("DSOR-RID-01a: the parts it hands back cannot be changed", () => {
    const parsed = parseUri("dsor://org_456/invoice/INV-1008");

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      // @ts-expect-error the parts are readonly, so this assignment must not compile
      parsed.tenant = "org_999";
    }).toThrow(TypeError);
  });

  it("DSOR-RID-01b: the refusal says which half was wrong", () => {
    expect(() => parseUri("dsor://acme/invoice/INV-1008")).toThrow(/not a tenant id/);
    expect(() => parseUri("nonsense")).toThrow(/not a canonical URI/);
  });
});

describe("formatUri", () => {
  it("DSOR-RID-01a: writes the address that parseUri reads", () => {
    const parts = { tenant: "org_456", entity: "invoice", id: "INV-1008" };
    expect(formatUri(parts)).toBe("dsor://org_456/invoice/INV-1008");
    expect(parseUri(formatUri(parts))).toEqual(parts);
  });

  // formatUri must not be a back door into a bad address.
  it("DSOR-RID-01b: refuses to write an address it would not read", () => {
    expect(() => formatUri({ tenant: "acme", entity: "invoice", id: "INV-1008" })).toThrow(
      TypeError,
    );
    expect(() => formatUri({ tenant: "org_456", entity: "Invoice", id: "INV-1008" })).toThrow(
      TypeError,
    );
  });

  // A part that is not text is turned into text when the address is built, and
  // "undefined" reads like a perfectly good id. An invoice would then carry
  // dsor://org_456/invoice/undefined: canonical, permanent, and pointing at
  // nothing. Types do not stop this, because Node deletes them before it runs.
  it("DSOR-RID-01a: refuses a part that is not text", () => {
    const missing = undefined as unknown as string;
    const nothing = null as unknown as string;
    const digits = 1008 as unknown as string;
    const list = ["INV-1008"] as unknown as string;

    expect(() => formatUri({ tenant: "org_456", entity: "invoice", id: missing })).toThrow(
      TypeError,
    );
    expect(() => formatUri({ tenant: "org_456", entity: "invoice", id: nothing })).toThrow(
      TypeError,
    );
    expect(() => formatUri({ tenant: "org_456", entity: "invoice", id: digits })).toThrow(
      TypeError,
    );
    expect(() => formatUri({ tenant: "org_456", entity: "invoice", id: list })).toThrow(TypeError);
  });
});
