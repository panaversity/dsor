// The address of a record, read and written.
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

    // The three above are wrong from their first letter. A pattern can also be broken so
    // that it only has to find an id somewhere inside the text, which is what these pin:
    // a real id with something in front of it, a real id with something after it, and the
    // prefix on its own with no digits. Without them the `^`, the `$` and the `+` could
    // each be dropped with nothing complaining.
    expect(() => parseUri("dsor://xorg_456/invoice/INV-1008")).toThrow(TypeError);
    expect(() => parseUri("dsor://org_456x/invoice/INV-1008")).toThrow(TypeError);
    expect(() => parseUri("dsor://notorg_456/invoice/INV-1008")).toThrow(TypeError);
    expect(() => parseUri("dsor://org_/invoice/INV-1008")).toThrow(TypeError);
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
  // The three parts must come OUT OF the address, not from somewhere convenient. Every address
  // in this whole step uses the entity `invoice`, so replacing `match[2]` with the constant
  // `"invoice"` used to pass every test in the step — and a payment address then parsed as an
  // invoice.
  // That is lesson 10: the expected value was a literal that also appeared in the input.
  it("DSOR-RID-01a: each part comes out of the address, not from a default", () => {
    for (const entity of ["invoice", "payment", "vendor", "journal_entry"]) {
      expect(parseUri(`dsor://org_456/${entity}/X-1`).entity, entity).toBe(entity);
    }

    // The tenant pattern is this deployment's own `org_<digits>` convention, so the values that
    // can vary here are narrower than for the other two parts.
    for (const tenant of ["org_456", "org_999", "org_1", "org_00"]) {
      expect(parseUri(`dsor://${tenant}/invoice/INV-1`).tenant, tenant).toBe(tenant);
    }

    for (const id of ["INV-1008", "PAY-901", "X", "a_b.c-1"]) {
      expect(parseUri(`dsor://org_456/invoice/${id}`).id, id).toBe(id);
    }
  });

  // formatUri reads each part exactly once, through an own-property gate. Both halves were found
  // by attacking it: an object that only *inherits* its parts used to mint a valid address, and a
  // part that is a getter was read twice, so it could answer differently the second time.
  it("DSOR-RID-01a: a part the object only inherits is refused", () => {
    const honest = { tenant: "org_456", entity: "invoice", id: "INV-1008" };

    expect(formatUri(honest)).toBe("dsor://org_456/invoice/INV-1008");

    // Owns nothing, inherits everything, and reads exactly like the honest object.
    const inherited = Object.create(honest) as typeof honest;

    expect(inherited.id).toBe("INV-1008");
    expect(() => formatUri(inherited)).toThrow(/only inherits/);

    for (const key of ["tenant", "entity", "id"] as const) {
      const mixed: Record<string, unknown> = { ...honest };

      delete mixed[key];

      const partly = Object.create({ [key]: honest[key] }) as typeof honest;

      Object.assign(partly, mixed);
      expect(() => formatUri(partly), key).toThrow(/only inherits/);
    }
  });

  it("DSOR-RID-01a: each part is read once, so a getter cannot answer twice", () => {
    let reads = 0;
    const twoFaced = {
      tenant: "org_456",
      entity: "invoice",
      get id(): string {
        reads += 1;

        return reads === 1 ? "INV-1008" : "INV-9999";
      },
    };

    expect(formatUri(twoFaced)).toBe("dsor://org_456/invoice/INV-1008");
    expect(reads).toBe(1);
  });

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

  // What the round-trip compare can and cannot be tested for, stated plainly.
  //
  // The compare was this step's original fix: `${...}` turns anything into text, so a missing id
  // became the string "undefined" and produced a perfectly valid-looking address. Reading each
  // part through an own-property, must-be-text gate now catches that **earlier** — and it catches
  // more, because it also refuses a part the object merely inherits.
  //
  // Which leaves the compare unreachable. Every string that would read back differently —
  // a slash inside a part, a leading or trailing newline — makes parseUri refuse the address
  // first. No input this function accepts can now make the comparison fail. It stays as the last
  // line of defence and because it is the lesson, and this comment is here so nobody mistakes an
  // unkillable guard for a tested one.
  it("DSOR-RID-01a: a part that is not text is refused before an address is built", () => {
    const cases = [
      ["tenant", { tenant: { toString: () => "org_456" }, entity: "invoice", id: "INV-1008" }],
      ["entity", { tenant: "org_456", entity: ["invoice"], id: "INV-1008" }],
      ["id", { tenant: "org_456", entity: "invoice", id: { toString: () => "INV-1008" } }],
      ["a missing id", { tenant: "org_456", entity: "invoice" }],
    ] as const;

    for (const [which, parts] of cases) {
      expect(() => formatUri(parts as never), which).toThrow(TypeError);
    }

    // And the addresses that would not read back are refused by parseUri, one layer down.
    for (const id of ["INV-1008\n", "\nINV-1008", "INV/1008"]) {
      expect(() => formatUri({ tenant: "org_456", entity: "invoice", id }), id).toThrow(
        /not a canonical URI/,
      );
    }
  });
});
