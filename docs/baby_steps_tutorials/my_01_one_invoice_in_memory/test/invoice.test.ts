// NEW IN STEP 01: the first tests that prove a rule of the specification.
//
// A test that proves a rule starts its title with that rule's id. A test that only
// shows why a rule exists does not. The difference matters, and both kinds are here.

import { describe, expect, it } from "vitest";
import { getInvoice } from "../src/invoice.ts";
import { money } from "../src/money.ts";

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
  it("returns undefined for an invoice that does not exist", () => {
    expect(getInvoice("INV-9999")).toBeUndefined();
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

// NEW IN STEP 01: a stored amount cannot be edited from outside.
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
