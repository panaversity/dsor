// The first tests that prove a rule of the specification.
//
// A test that proves a rule starts its title with that rule's id. A test that only shows why a rule
// exists does not. The difference matters, and both kinds are here.
//
// STEP 10: the invoices are rows, and every one belongs to a company — so every lookup names
// the company first. Most of these tests are step 01's, with "org_456" added where there used to be
// nothing to say.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getInvoice, issueInvoice } from "../src/invoice.ts";
import { money } from "../src/money.ts";
import { parseUri } from "../src/uri.ts";
import { aDatabase, resetInvoices } from "./support/database.ts";

let db: Awaited<ReturnType<typeof aDatabase>>;

beforeAll(async () => {
  db = await aDatabase();
});

beforeEach(async () => {
  await resetInvoices();
});

afterAll(async () => {
  await db.close();
});

/** org_456's invoice, or a thrown error that names it — so a test never reads an undefined. */
async function ours(id: string) {
  const found = await getInvoice("org_456", id);

  if (found === undefined) {
    throw new Error(`org_456 should hold ${id}`);
  }

  return found;
}

describe("getInvoice", () => {
  it("DSOR-MON-01: INV-1008 is 31400.00 USD, an amount and a currency", async () => {
    const invoice = await ours("INV-1008");

    expect(invoice.amount).toEqual({ value: "31400.00", currency: "USD" });
    expect(invoice.vendor).toBe("VENDOR-44");
    expect(invoice.status).toBe("issued");
    expect(invoice.tenantId).toBe("org_456");
  });

  it("finds the second invoice, not only the first one", async () => {
    const invoice = await ours("INV-1009");

    expect(invoice.amount).toEqual({ value: "2500.00", currency: "USD" });
    expect(invoice.status).toBe("draft");
  });

  it("an id that is only the beginning of a real id finds nothing", async () => {
    expect(await getInvoice("org_456", "INV-100")).toBeUndefined();
    expect(await getInvoice("org_456", "INV")).toBeUndefined();
  });

  it("returns undefined for an invoice that does not exist", async () => {
    expect(await getInvoice("org_456", "INV-9999")).toBeUndefined();
  });

  it("DSOR-MON-01: every invoice handed out is frozen, amount included", async () => {
    for (const id of ["INV-1008", "INV-1009"]) {
      const invoice = await ours(id);

      expect(Object.isFrozen(invoice)).toBe(true);
      expect(Object.isFrozen(invoice.amount)).toBe(true);
    }
  });

  it("floating point loses money, which is why the rule asks for text", () => {
    // 0.1 + 0.2 is the famous one; 31400.00 * 1.1 is the one that would reach a payment.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(money("31400.00", "USD").value).toBe("31400.00");
  });

  it("DSOR-MON-01: a caller cannot change a stored amount", async () => {
    const invoice = await ours("INV-1008");

    expect(() => {
      (invoice.amount as { value: string }).value = "1.00";
    }).toThrow(TypeError);

    // And the store is untouched: a fresh read says what it said before.
    expect((await ours("INV-1008")).amount.value).toBe("31400.00");
  });

  it("DSOR-MON-01: a caller cannot swap a stored amount for another one", async () => {
    const invoice = await ours("INV-1008");

    expect(() => {
      (invoice as { amount: unknown }).amount = money("1.00", "USD");
    }).toThrow(TypeError);
    expect((await ours("INV-1008")).amount.value).toBe("31400.00");
  });

  it("DSOR-RID-01a: INV-1008's address is dsor://org_456/invoice/INV-1008", async () => {
    expect((await ours("INV-1008")).uri).toBe("dsor://org_456/invoice/INV-1008");
  });

  it("the id and the company inside the address are the invoice's own", async () => {
    for (const id of ["INV-1008", "INV-1009"]) {
      const invoice = await ours(id);

      expect(parseUri(invoice.uri)).toEqual({ tenant: invoice.tenantId, entity: "invoice", id });
    }
  });
});

describe("issueInvoice", () => {
  it("an id nobody holds is not_found, and nothing is invented for it", async () => {
    expect(await issueInvoice("org_456", "INV-9999")).toEqual({ kind: "not_found" });
    expect(await getInvoice("org_456", "INV-9999")).toBeUndefined();
  });

  it("an invoice that is already issued reports not_draft, and says what it is instead", async () => {
    expect(await issueInvoice("org_456", "INV-1008")).toEqual({
      kind: "not_draft",
      status: "issued",
    });

    // And it is untouched: the failed attempt did not half-apply.
    const after = await ours("INV-1008");

    expect(after.status).toBe("issued");
    expect(after.amount.value).toBe("31400.00");
  });

  it("a draft is issued once, and the copy handed out earlier never changes", async () => {
    const before = await ours("INV-1009");

    expect(before.status).toBe("draft");

    const outcome = await issueInvoice("org_456", "INV-1009");

    if (outcome.kind !== "issued") {
      throw new Error(`expected issued, got ${outcome.kind}`);
    }

    expect(outcome.invoice.status).toBe("issued");
    expect(outcome.invoice.id).toBe("INV-1009");
    // The copy from before is a copy: frozen, and still a draft.
    expect(before.status).toBe("draft");
    // The store moved on, and a second issue is refused because of that.
    expect((await ours("INV-1009")).status).toBe("issued");
    expect(await issueInvoice("org_456", "INV-1009")).toEqual({
      kind: "not_draft",
      status: "issued",
    });
  });
});
