// The first tests that prove a rule of the specification.
//
// A test that proves a rule starts its title with that rule's id. A test that only
// shows why a rule exists does not. The difference matters, and both kinds are here.

import { describe, expect, it } from "vitest";
import { getInvoice, issueInvoice } from "../src/invoice.ts";
import { money } from "../src/money.ts";
import { parseUri } from "../src/uri.ts";

describe("getInvoice", () => {
  it("DSOR-MON-01: INV-1008 is 31400.00 USD, an amount and a currency", () => {
    const invoice = getInvoice("INV-1008");

    // getInvoice can return undefined, so TypeScript will not let us reach
    // invoice.amount yet. Throwing here answers the compiler instead of silencing
    // it: after this line the type is Invoice, with no undefined left in it.
    // Writing `invoice!.amount` would compile too, but it only hides the question.
    if (invoice === undefined) {
      throw new Error("INV-1008 is missing from the list of invoices");
    }

    // The value is text. "31400.00" is a string, and `toBe` compares exactly, so
    // this test fails if anyone ever stores the amount as the number 31400.
    expect(invoice.amount.value).toBe("31400.00");

    // An amount with no currency is not money. 31400 of what?
    expect(invoice.amount.currency).toBe("USD");

    expect(invoice.vendor).toBe("VENDOR-44");
  });

  // Without this test, getInvoice could return invoices[0] every time and the test
  // above would still pass. A test that only ever asks for the first item does not
  // prove that anything was searched for.
  it("finds the second invoice, not only the first one in the list", () => {
    const invoice = getInvoice("INV-1009");

    if (invoice === undefined) {
      throw new Error("INV-1009 is missing from the list of invoices");
    }

    expect(invoice.id).toBe("INV-1009");
    expect(invoice.amount.value).toBe("2500.00");
  });

  // Test the "no" as carefully as the "yes".
  // The `===` in getInvoice, pinned. Without this, changing it to `startsWith` passes every
  // other test in the step: "INV-1008".startsWith("INV-9999") is false, so the one wrong id
  // already tested is the one wrong id a prefix match still refuses.
  //
  // This is not a hypothetical. The same shape — a prefix standing in for a whole match — later
  // became a real bug twice: in step 05 it let `cfo_100_evil` log in as `cfo_100`, and in step 06
  // it granted `invoice:i`. Step 01's lookup is where the shape starts.
  it("an id that is only the beginning of a real id finds nothing", () => {
    for (const id of ["INV-100", "INV-1", "INV", "I", ""]) {
      expect(getInvoice(id), JSON.stringify(id)).toBeUndefined();
    }

    // And the whole id still works, so this is not a test that refuses everything.
    expect(getInvoice("INV-1008")?.id).toBe("INV-1008");
  });

  it("returns undefined for an invoice that does not exist", () => {
    expect(getInvoice("INV-9999")).toBeUndefined();
  });

  // Step 01 froze both invoices and only tested one. INV-1009 is the draft every later step
  // issues, so it is the one whose freeze matters most.
  //
  // No rule id: DSOR-MON-01 says an amount is a decimal string with a currency code, and this
  // test asserts only that the records are frozen. It would pass with the amount stored as the
  // number 31400, because Object.isFrozen is true of any number.
  it("every invoice in the list is frozen, not just the first", () => {
    for (const id of ["INV-1008", "INV-1009"]) {
      const invoice = getInvoice(id);

      if (invoice === undefined) {
        throw new Error(`${id} is missing from the list of invoices`);
      }

      expect(Object.isFrozen(invoice), id).toBe(true);
      expect(Object.isFrozen(invoice.amount), `${id} amount`).toBe(true);
      expect(() => {
        (invoice as { status: string }).status = "paid";
      }, id).toThrow(TypeError);
      expect(invoice.status).toBe(id === "INV-1008" ? "issued" : "draft");
    }
  });

  // This test has no rule id in its title, on purpose. It does not touch our code at
  // all: it would still pass if src/ were deleted. It shows the fact about computers
  // that DSOR-MON-01 exists to protect us from. That is motivation, not proof, and a
  // title that claimed otherwise would be a lie about what the test checks.
  it("floating point loses money, which is why the rule asks for text", () => {
    // Computers store decimals in binary, and 0.1 has no exact binary form, so the
    // sum lands just beside the answer.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(0.1 + 0.2).toBe(0.30000000000000004);

    // The same mistake with our own invoice. Three late fees of ten cents each,
    // added to 31400 as numbers, do not reach 31400.30.
    expect(31400 + 0.1 + 0.1 + 0.1).not.toBe(31400.3);
    expect(31400 + 0.1 + 0.1 + 0.1).toBe(31400.299999999996);

    // Rounding the display does not repair the number underneath.
    expect((0.1 + 0.2).toFixed(2)).toBe("0.30");
    expect(0.1 + 0.2).not.toBe(0.3);

    // And toFixed is not even a reliable way to round. 1.005 is held as slightly
    // less than 1.005, so it rounds down, and a cent goes missing in plain sight.
    expect((1.005).toFixed(2)).toBe("1.00");
  });
});

// A stored amount cannot be edited from outside.
describe("the stored invoices", () => {
  it("DSOR-MON-01: a caller cannot change a stored amount", () => {
    const invoice = getInvoice("INV-1008");

    if (invoice === undefined) {
      throw new Error("INV-1008 is missing from the list of invoices");
    }

    // This one test checks two different locks.
    //
    // The compiler's lock is the `@ts-expect-error` line itself. It says "the next
    // line must not compile". If anyone removes `readonly` from Money, the line
    // starts compiling, the directive becomes unused, and `pnpm typecheck` fails
    // with TS2578. A test that runs only at compile time is still a test.
    //
    // Be aware of what that directive cannot do: it is satisfied by ANY error on the
    // next line, so a typo there would keep it happy while `readonly` was gone. That
    // is why the run-time checks below do not rely on it.
    //
    // The run-time lock is Object.freeze, and it is a separate promise, because Node
    // deletes `readonly` before it runs anything.
    expect(() => {
      // @ts-expect-error the fields are readonly, so this assignment must not compile
      invoice.amount.value = "1.00";
    }).toThrow(TypeError);

    // And the next reader still sees the real amount.
    expect(getInvoice("INV-1008")?.amount.value).toBe("31400.00");
  });

  // Freezing the Money is not enough on its own. It protects the amount object that
  // is there; it does not stop a caller putting a different one in its place.
  it("DSOR-MON-01: a caller cannot swap a stored amount for another one", () => {
    const invoice = getInvoice("INV-1008");

    if (invoice === undefined) {
      throw new Error("INV-1008 is missing from the list of invoices");
    }

    expect(Object.isFrozen(invoice)).toBe(true);
    expect(Object.isFrozen(invoice.amount)).toBe(true);

    expect(() => {
      // @ts-expect-error amount is readonly, so this assignment must not compile
      invoice.amount = money("0.01", "USD");
    }).toThrow(TypeError);

    expect(() => {
      // @ts-expect-error status is readonly, so this assignment must not compile
      invoice.status = "paid";
    }).toThrow(TypeError);

    expect(getInvoice("INV-1008")?.amount.value).toBe("31400.00");
    expect(getInvoice("INV-1008")?.status).toBe("issued");
  });
});

// every invoice carries its own permanent address.
describe("an invoice's address", () => {
  it("DSOR-RID-01a: INV-1008's address is dsor://org_456/invoice/INV-1008", () => {
    expect(getInvoice("INV-1008")?.uri).toBe("dsor://org_456/invoice/INV-1008");
    expect(getInvoice("INV-1009")?.uri).toBe("dsor://org_456/invoice/INV-1009");
  });

  // If an invoice's address ever named a different record, every log line and every
  // approval pointing at it would be pointing at the wrong invoice. No rule id: this
  // guards our own code, not a sentence of the specification.
  it("the id inside the address is the invoice's own id", () => {
    for (const id of ["INV-1008", "INV-1009"]) {
      const invoice = getInvoice(id);

      if (invoice === undefined) {
        throw new Error(`${id} is missing from the list of invoices`);
      }

      expect(parseUri(invoice.uri)).toEqual({
        tenant: "org_456",
        entity: "invoice",
        id: invoice.id,
      });
    }
  });
});

// NEW IN STEP 04: the store can change for the first time, so the store is tested for the
// first time.
//
// Step 01 gave the frozen list two tests of its own. Step 04 is the step that made it
// *writable* — `readonly Invoice[]` became `Invoice[]`, and `issueInvoice` writes to it — and
// it shipped without one. Every assertion about issuing went through callOperation, which
// tests the envelope around the change and not the change.
//
// These have no rule id. `DSOR-SCH-01` is about the envelope, not the store; what happens in
// here is ordinary correctness, and the specification's rules about a real store — a
// transaction, a precondition checked against current state — arrive with the database in
// step 09.
describe("issueInvoice", () => {
  it("an id nobody holds is not_found, and nothing is invented for it", () => {
    expect(issueInvoice("INV-9999")).toEqual({ kind: "not_found" });
    expect(getInvoice("INV-9999")).toBeUndefined();
  });

  it("an invoice that is already issued reports not_draft, and says what it is instead", () => {
    expect(issueInvoice("INV-1008")).toEqual({ kind: "not_draft", status: "issued" });

    // And it is untouched: the failed attempt did not half-apply.
    const after = getInvoice("INV-1008");

    if (after === undefined) {
      throw new Error("INV-1008 should still be there");
    }

    expect(after.status).toBe("issued");
    expect(after.amount.value).toBe("31400.00");
  });

  // Last, because it uses up the only draft. This is the test the step most needed: it proves
  // the invoice is **replaced rather than edited**, which is the claim src/invoice.ts makes
  // about why every Invoice can stay frozen while the list changes.
  it("a draft is issued once, and the copy handed out earlier never changes", () => {
    const before = getInvoice("INV-1009");

    if (before === undefined) {
      throw new Error("INV-1009 is missing from the list of invoices");
    }

    expect(before.status).toBe("draft");
    expect(Object.isFrozen(before)).toBe(true);

    const outcome = issueInvoice("INV-1009");

    if (outcome.kind !== "issued") {
      throw new Error(`expected issued, got ${outcome.kind}`);
    }

    expect(outcome.invoice.status).toBe("issued");
    expect(outcome.invoice.id).toBe("INV-1009");
    expect(getInvoice("INV-1009")?.status).toBe("issued");

    // The reference taken before the change still says draft. A record that is never edited in
    // place is a record you can hold on to without it changing under you — and a caller who
    // read it a moment ago is not silently looking at something else.
    expect(before.status).toBe("draft");
    expect(outcome.invoice).not.toBe(before);

    // A second attempt is refused by the state, not by a key or a lock.
    expect(issueInvoice("INV-1009")).toEqual({ kind: "not_draft", status: "issued" });
  });
});
