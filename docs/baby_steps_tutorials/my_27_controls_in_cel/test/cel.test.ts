// NEW IN STEP 27: the environment a control's condition is evaluated in (decision 162).
//
// A condition is CEL: a small expression language that cannot loop forever, call the network, or
// see anything it was not handed. What it is handed is Appendix B's eight variables, and three of
// its six functions, which compare money through step 26's `exceeds` and `covers`.
//
// Rule DSOR-CTL-05: Control conditions and contract predicates MUST be CEL expressions evaluated in
// the environment of Appendix B.
// Rule DSOR-CTL-06: An expression MUST NOT have access to anything outside that environment: no
// network, no clock other than `now`, no caller-supplied state.

import { describe, expect, it } from "vitest";
import { checkCondition, evaluateCondition, type ConditionInput } from "../src/cel.ts";
import type { RateOf } from "../src/exchange.ts";

/** The CFO's condition, as org_456's control writes it. */
const CFO = 'dsor_exceeds(input.amount, dsor_money("25000", "USD"))';

/** 280 rupees and 0.80 pounds to the dollar, and nothing else. */
const STORY: RateOf = (currency) => {
  const rate = ({ USD: "1", PKR: "280", GBP: "0.80" } as Record<string, string>)[currency];

  if (rate === undefined) {
    throw new Error(`there is no rate for ${currency}`);
  }

  return rate;
};

/** The eight variables, for a payment of this amount by the agent under del_100. */
const aPaymentOf = (value: string, currency: string): ConditionInput => ({
  input: { invoice: "dsor://org_456/invoice/INV-1008", amount: { value, currency } },
  state: {},
  principal: { id: "accounts-payable-fte", type: "agent", roles: ["ap_agent"] },
  actor_chain: ["accounts-payable-fte"],
  delegation: { id: "del_100", delegator: "user_123" },
  tenant: { id: "org_456" },
  risk: "medium",
  now: new Date("2026-10-19T12:00:00.000Z"),
});

describe("the CFO's condition, in Appendix B's environment", () => {
  it("DSOR-CTL-05: 31,400.00 USD is above 25,000 USD, and 25,000.00 is not", () => {
    expect(evaluateCondition(CFO, aPaymentOf("31400.00", "USD"), STORY)).toBe(true);
    expect(evaluateCondition(CFO, aPaymentOf("25000.00", "USD"), STORY)).toBe(false);
    expect(evaluateCondition(CFO, aPaymentOf("25000.01", "USD"), STORY)).toBe(true);
  });

  it("DSOR-MON-03: dsor_exceeds converts at the rates it is given, exactly", () => {
    // 50,000,000.00 PKR is about 178,571 USD; 6,000,000.00 PKR is about 21,429 USD.
    expect(evaluateCondition(CFO, aPaymentOf("50000000.00", "PKR"), STORY)).toBe(true);
    expect(evaluateCondition(CFO, aPaymentOf("6000000.00", "PKR"), STORY)).toBe(false);
    // 7,000,000.00 PKR is exactly 25,000.00 USD: not above it, with nothing rounded.
    expect(evaluateCondition(CFO, aPaymentOf("7000000.00", "PKR"), STORY)).toBe(false);
    expect(evaluateCondition(CFO, aPaymentOf("7000000.01", "PKR"), STORY)).toBe(true);
  });

  it("DSOR-MON-03: dsor_covers is the other half, at or above", () => {
    const covers = 'dsor_covers(input.amount, dsor_money("25000", "USD"))';

    expect(evaluateCondition(covers, aPaymentOf("25000.00", "USD"), STORY)).toBe(true);
    expect(evaluateCondition(covers, aPaymentOf("24999.99", "USD"), STORY)).toBe(false);
  });

  it("DSOR-MON-03: why the threshold goes through dsor_exceeds: the naive rule lets 50,000,000 PKR through", () => {
    // The map's break for this step, measured: the rule in numbers and a currency name.
    const naive = 'double(input.amount.value) > 25000.0 && input.amount.currency == "USD"';

    expect(checkCondition(naive)).toBeUndefined();
    expect(evaluateCondition(naive, aPaymentOf("50000000.00", "PKR"), STORY)).toBe(false);
  });

  it("DSOR-MON-04: a currency with no rate cannot be evaluated, and says so", () => {
    expect(() => evaluateCondition(CFO, aPaymentOf("100.00", "XXX"), STORY)).toThrow(/XXX/);
  });

  it("DSOR-CTL-05: an amount that is not a decimal cannot be evaluated", () => {
    expect(() =>
      evaluateCondition('dsor_exceeds(input.amount, dsor_money("lots", "USD"))', aPaymentOf("1.00", "USD"), STORY),
    ).toThrow();
  });
});

describe("nothing outside the environment", () => {
  it("DSOR-CTL-06: a condition that names the request is refused, and cannot be evaluated", () => {
    // The request is the caller's. A control that read rates from it would let the agent choose
    // whether it applies.
    const planted = 'request.rates.PKR == "1000000"';

    expect(checkCondition(planted)).toMatch(/request/);
    expect(() => evaluateCondition(planted, aPaymentOf("1.00", "USD"), STORY)).toThrow();
  });

  it("DSOR-CTL-06: a variable handed in beside the eight is not seen", () => {
    const withMore = { ...aPaymentOf("1.00", "USD"), request: { rates: { PKR: "1000000" } } };

    expect(() =>
      evaluateCondition('request.rates.PKR == "1000000"', withMore as ConditionInput, STORY),
    ).toThrow(/request/);
  });

  for (const later of ["dsor_sum([])", 'dsor_in_flight("dsor://org_456/invoice/INV-1008")']) {
    it(`DSOR-CTL-05: ${later.slice(0, later.indexOf("("))}, a function this step does not have, is refused`, () => {
      expect(checkCondition(`${later} == null`)).toBeDefined();
    });
  }

  it("DSOR-CTL-05: a condition must say true or false, not an amount", () => {
    expect(checkCondition("input.amount")).toMatch(/true or false/);
  });

  it("DSOR-CTL-05: each of the eight variables can be read", () => {
    const all =
      'input.amount.currency == "USD" && state == {} && principal.id == "accounts-payable-fte" && ' +
      'actor_chain == ["accounts-payable-fte"] && delegation.id == "del_100" && tenant.id == "org_456" && ' +
      'risk == "medium" && now > timestamp("2026-01-01T00:00:00Z")';

    expect(checkCondition(all)).toBeUndefined();
    expect(evaluateCondition(all, aPaymentOf("1.00", "USD"), STORY)).toBe(true);
  });

  it("DSOR-CTL-05: no slip is null, not a map with nothing in it", () => {
    const noSlip = { ...aPaymentOf("1.00", "USD"), delegation: null };

    expect(evaluateCondition("delegation == null", noSlip, STORY)).toBe(true);
  });
});
