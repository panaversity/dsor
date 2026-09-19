// Appendix B, proven. Runs the `high-value-payment` control's own test vectors, and
// the `payment.execute` preconditions, through a real CEL evaluator.
//
// This is a check of the specification's examples. It is not the DSoR control
// engine; that gets built in stage 4 of docs/learn/learning-path.md.
import { Environment } from "@marcbachmann/cel-js";
import { describe, expect, it } from "vitest";
import { loadExample } from "./index.js";
import { covers, exceeds, type Money, type Rates } from "./reference-money.js";

interface Vector {
  state?: unknown;
  input?: unknown;
  rates?: Record<string, string>;
  expect: string;
}
interface Control {
  condition: string;
  effect: Record<string, unknown>;
  tests: Vector[];
}
interface Contract {
  preconditions: { predicates: string[] };
}

const CONTROL_CURRENCY = "USD";

// cel-js hands maps to extension functions as Map or as plain objects.
const toMoney = (m: unknown): Money => {
  const get = (k: string): unknown =>
    m instanceof Map ? m.get(k) : (m as Record<string, unknown>)[k];
  return { value: String(get("value")), currency: String(get("currency")) };
};

function environment(rates: Rates): Environment {
  return new Environment()
    .registerVariable("state", "map")
    .registerVariable("input", "map")
    .registerFunction("dsor_money(string, string): map", (value: string, currency: string) => ({
      value,
      currency,
    }))
    .registerFunction("dsor_exceeds(map, map): bool", (a: unknown, b: unknown) =>
      exceeds(toMoney(a), toMoney(b), rates),
    )
    .registerFunction("dsor_covers(map, map): bool", (a: unknown, b: unknown) =>
      covers(toMoney(a), toMoney(b), rates),
    );
}

/** DSOR-CTL-07: a condition that fails to evaluate applies the control's effect. */
function controlOutcome(control: Control, vector: Vector): string {
  const rates = { [CONTROL_CURRENCY]: "1", ...vector.rates };
  const effect = "require_approval" in control.effect ? "REQUIRE_APPROVAL" : "DENY";
  let applies: boolean;
  try {
    applies = Boolean(
      environment(rates).evaluate(control.condition, {
        state: vector.state ?? {},
        input: vector.input ?? {},
      }),
    );
  } catch {
    applies = true;
  }
  return applies ? effect : "ALLOW";
}

const control = loadExample("control") as Control;

describe("DSOR-CTL-02c: the high-value-payment control passes its own test vectors", () => {
  it.each(control.tests)(
    "$state.payment.amount.value $state.payment.amount.currency → $expect",
    (v) => {
      expect(controlOutcome(control, v)).toBe(v.expect);
    },
  );

  it("DSOR-CTL-02d: includes a foreign-currency vector and an unconvertible one", () => {
    const currencies = control.tests.map(
      (t) => (t.state as { payment: { amount: Money } }).payment.amount.currency,
    );
    expect(currencies).toContain("PKR");
    expect(currencies).toContain("XXX");
  });

  it("DSOR-CTL-02e: every vector that converts pins its rates", () => {
    for (const t of control.tests) {
      const { currency } = (t.state as { payment: { amount: Money } }).payment.amount;
      if (currency !== CONTROL_CURRENCY && currency !== "XXX")
        expect(t.rates?.[currency]).toBeDefined();
    }
  });
});

describe("DSOR-MON-03: why thresholds go through dsor_exceeds", () => {
  it("the naive condition lets 50,000,000 PKR through", () => {
    const naive = 'input.amount.value > 25000.0 && input.amount.currency == "USD"';
    const result = environment({}).evaluate(naive, {
      state: {},
      input: { amount: { value: 50000000.0, currency: "PKR" } },
    });
    expect(result).toBe(false); // the control does not fire: the payment is allowed
  });

  it("DSOR-MON-02: decimal comparison is exact where floats are not", () => {
    const rates = { USD: "1" };
    expect(0.1 + 0.2 > 0.3).toBe(true); // the float bug
    const sum: Money = { value: "0.30", currency: "USD" };
    expect(exceeds(sum, { value: "0.3", currency: "USD" }, rates)).toBe(false);
  });
});

describe("DSOR-EXC-02: payment.execute preconditions", () => {
  const contract = loadExample("operation-contract") as Contract;
  const holds = (openAmount: string): boolean => {
    const state = {
      vendor: { status: "approved" },
      invoice: { status: "issued", open_amount: { value: openAmount, currency: "USD" } },
      payment: { status: "draft", amount: { value: "31400.00", currency: "USD" } },
    };
    const env = environment({ USD: "1" });
    return contract.preconditions.predicates.every((p) =>
      Boolean(env.evaluate(p, { state, input: {} })),
    );
  };

  it("hold when the invoice's open amount covers the payment", () => {
    expect(holds("31400.00")).toBe(true);
  });

  it("fail for a second payment while the first is in flight", () => {
    // PAY-901 is in flight, so INV-1008's open amount already excludes it.
    expect(holds("0.00")).toBe(false);
  });
});
