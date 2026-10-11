// NEW IN STEP 27: the environment a control's condition runs in (DSOR-CTL-05 to DSOR-CTL-07 in
// specs/dsor/02-security.md, section 17.3, and Appendix B; step 27's README, decisions D5 and D6).
// A condition is CEL. It sees Appendix B's eight variables and three money functions, nothing
// else, and when it cannot be evaluated, the control's effect applies.
import { describe, expect, it } from "vitest";
import { checkCondition, evaluateCondition, type Facts } from "../src/cel.ts";
import type { RateSheet } from "../src/exchange.ts";
import { money, type Money } from "../src/money.ts";

// Tuesday's sheet of ecb-daily, from step 26: how much of each currency 1 EUR buys.
const TUESDAY: RateSheet = {
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00.000Z",
  rates: { EUR: "1", USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
};
// The story's control: payments above 25,000 USD need the CFO (step 27's README, decision D4).
const CFO = 'dsor_exceeds(state.invoice.open_amount, dsor_money("25000", "USD"))';

/** The facts of the agent's draft of a bill with this open amount, on Tuesday. */
function factsFor(open: Money): Facts {
  return {
    input: { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
    state: { invoice: { id: "INV-1008", vendor_id: "VENDOR-44", open_amount: open } },
    principal: { id: "accounts-payable-fte", type: "agent", roles: [] },
    actor_chain: ["accounts-payable-fte"],
    delegation: { id: "del_100", delegator: "user_123" },
    tenant: { id: "org_456" },
    risk: "high",
    now: new Date("2026-10-06T15:05:00.000Z"),
  };
}

describe("C2: a condition, checked before it runs", () => {
  it("DSOR-CTL-05: the story's condition is CEL that answers true or false, in Appendix B's environment", () => {
    expect(checkCondition(CFO)).toBeUndefined();
    expect(checkCondition('principal.type == "agent" && size(actor_chain) > 0')).toBeUndefined();
    expect(checkCondition('now > timestamp("2026-01-01T00:00:00Z")')).toBeUndefined();
  });

  it("DSOR-CTL-06: a condition that names anything outside the environment is refused: a variable, or a function that is not built yet (step 27's README, decision D5)", () => {
    expect(checkCondition("process.env.SECRET == 'x'")).toBe(
      "it names process, which is not in the environment",
    );
    expect(
      checkCondition("dsor_sum([state.invoice.open_amount]) == state.invoice.open_amount"),
    ).toMatch(/^it calls dsor_sum, which this step does not build/);
    expect(checkCondition("dsor_in_flight(input.invoice) == null")).toMatch(
      /^it calls dsor_in_flight/,
    );
  });

  it("DSOR-CTL-05: a condition that is not CEL, or that answers something other than true or false, is refused", () => {
    expect(checkCondition("state.invoice.open_amount >")).toMatch(/^it is not CEL: /);
    expect(checkCondition('"25000"')).toBe("it answers a string, not true or false");
    expect(checkCondition("size(actor_chain)")).toBe("it answers an int, not true or false");
  });
});

describe("C4: a condition, evaluated", () => {
  it("DSOR-CTL-05: dsor_exceeds converts with the sheet, exactly: INV-2004's 14,000,000.00 PKR is 50,000.00 USD, above 25,000; 25,000.00 USD is not above it, and 25,000.01 USD is", () => {
    expect(evaluateCondition(CFO, factsFor(money("14000000.00", "PKR")), TUESDAY)).toStrictEqual({
      holds: true,
    });
    expect(evaluateCondition(CFO, factsFor(money("25000.00", "USD")), TUESDAY)).toStrictEqual({
      holds: false,
    });
    expect(evaluateCondition(CFO, factsFor(money("25000.01", "USD")), TUESDAY)).toStrictEqual({
      holds: true,
    });
    expect(evaluateCondition(CFO, factsFor(money("9000.00", "EUR")), TUESDAY)).toStrictEqual({
      holds: false,
    });
  });

  it("DSOR-CTL-05: dsor_covers is at least, after converting: 50,000.00 USD covers 14,000,000.00 PKR exactly, and 49,999.99 USD does not", () => {
    const covers = 'dsor_covers(dsor_money("50000.00", "USD"), state.invoice.open_amount)';
    const less = 'dsor_covers(dsor_money("49999.99", "USD"), state.invoice.open_amount)';
    const pkr = factsFor(money("14000000.00", "PKR"));
    expect(evaluateCondition(covers, pkr, TUESDAY)).toStrictEqual({ holds: true });
    expect(evaluateCondition(less, pkr, TUESDAY)).toStrictEqual({ holds: false });
  });

  it("DSOR-CTL-05: one currency needs no sheet: 31,400.00 USD is above 25,000.00 USD with no rates at all", () => {
    expect(evaluateCondition(CFO, factsFor(money("31400.00", "USD")), undefined)).toStrictEqual({
      holds: true,
    });
  });

  it.each([
    ["no sheet for a bill in EUR", money("9000.00", "EUR"), undefined, CFO],
    ["a currency the sheet does not list", money("100000", "JPY"), TUESDAY, CFO],
    [
      "a field that is not there",
      money("100.00", "USD"),
      TUESDAY,
      'dsor_exceeds(state.payment.amount, dsor_money("25000", "USD"))',
    ],
    [
      "a currency that is no currency",
      money("100.00", "USD"),
      TUESDAY,
      'dsor_exceeds(state.invoice.open_amount, dsor_money("25000", "ABC"))',
    ],
    [
      "an amount that is no number",
      money("100.00", "USD"),
      TUESDAY,
      'dsor_exceeds(state.invoice.open_amount, dsor_money("lots", "USD"))',
    ],
    ["an answer that is not true or false", money("100.00", "USD"), TUESDAY, "state.invoice.id"],
  ] as const)(
    "DSOR-CTL-07: a condition that fails to evaluate gives an error, never true or false: %s",
    (_why, open, sheet, condition) => {
      const answer = evaluateCondition(condition, factsFor(open), sheet);
      expect(answer).toHaveProperty("error");
      expect(answer).not.toHaveProperty("holds");
    },
  );

  it("DSOR-CTL-06: the facts are the only state a condition reads: the same condition, with another open amount in the facts, answers otherwise", () => {
    const facts = factsFor(money("31400.00", "USD"));
    expect(evaluateCondition(CFO, facts, TUESDAY)).toStrictEqual({ holds: true });
    const changed = { ...facts, state: { invoice: { open_amount: money("100.00", "USD") } } };
    expect(evaluateCondition(CFO, changed, TUESDAY)).toStrictEqual({ holds: false });
  });
});
