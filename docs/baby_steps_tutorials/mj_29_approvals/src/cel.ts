// The environment a control's condition runs in (DSOR-CTL-05 to DSOR-CTL-07 in
// specs/dsor/02-security.md, section 17.3, and Appendix B; step 27's README, decisions D5 and D6).
// A condition is CEL, a small language for conditions: it cannot loop for ever, cannot call the
// network, and reads only what DSoR gives it. That is Appendix B's eight variables and three of its
// money functions, which compare and convert as step 26 does. When a condition cannot be
// evaluated, it gives an error, never true or false, and the control's effect applies.
import { Environment } from "@marcbachmann/cel-js";
import { compareAcross, isReadable, type RateSheet } from "./exchange.ts";
import { money, type Money } from "./money.ts";
import type { MoneyPolicy } from "./policies.ts";

/** What a condition may read: Appendix B's eight variables, for one call. */
export type Facts = {
  // The call's input, as line ⑥ checked it.
  input: Record<string, unknown>;
  // What line ⑨ read, by the aliases of the contract's bind: here, the invoice.
  state: Record<string, unknown>;
  principal: { id: string; type: string; roles: readonly string[] };
  actor_chain: readonly string[];
  // The slip the call runs under, or null for a person's own call.
  delegation: Record<string, unknown> | null;
  // The company, and its policy: in this tutorial, its money policy (step 26).
  tenant: { id: string; policy: { money?: Record<string, string> } };
  // The operation's risk level, from its contract.
  risk: string;
  // The decision's time, from DSoR's clock.
  now: Date;
};

// Appendix B's tenant is "Tenant id and policy". Found by step 27's review, finding L7: a condition
// saw the id only. The money policy goes in as its file writes it, without the age in milliseconds
// that DSoR works out from it.
/** The company as a condition reads it: its id, and its policy. */
export function tenantOf(id: string, policy: MoneyPolicy | undefined): Facts["tenant"] {
  if (policy === undefined) return { id, policy: {} };
  const { control_currency, rate_source, max_rate_age, on_unconvertible } = policy;
  return {
    id,
    policy: { money: { control_currency, rate_source, max_rate_age, on_unconvertible } },
  };
}

/** A condition's answer: it holds or not, or it could not be evaluated, and why. */
export type Evaluated = { holds: boolean } | { error: string };

// Appendix B's functions that later steps build. A condition that calls one is refused at start-up.
const NOT_BUILT = new Set(["dsor_sum", "dsor_in_flight", "dsor_is_new_counterparty"]);

/** How the error of a comparison with no usable rate begins: a control's test may expect it. */
export const NO_RATE = "no usable rate";

// One sheet stands in for "no rates": every conversion between two currencies fails on it.
const NO_SHEET: RateSheet = { source: "", base: "", published_at: "", rates: {} };

/** A money value that CEL hands over as a map, read back as money, or an error. */
function moneyOf(value: unknown): Money {
  const field = (key: string): unknown =>
    value instanceof Map ? value.get(key) : (value as Record<string, unknown> | null)?.[key];
  const amount = field("value");
  const currency = field("currency");
  if (typeof amount !== "string" || typeof currency !== "string") {
    throw new Error("a money value must hold a value and a currency, each a text");
  }
  return { value: amount, currency };
}

/** a against b, after conversion with the sheet, or an error when it cannot convert. */
function compared(
  a: unknown,
  b: unknown,
  sheet: RateSheet | undefined,
  used: Set<string>,
): -1 | 0 | 1 {
  const left = moneyOf(a);
  const right = moneyOf(b);
  // An amount that cannot be read is named as such, never as a missing rate (step 27's review,
  // finding L9). The words name its currency, never its value.
  for (const amount of [left, right]) {
    if (!isReadable(amount.value)) {
      throw new Error(`an amount in ${amount.currency} is not a decimal with no sign`);
    }
  }
  const answer = compareAcross(left, right, sheet ?? NO_SHEET);
  if (answer === undefined) {
    throw new Error(`${NO_RATE} compares ${left.currency} with ${right.currency}`);
  }
  // Two currencies were converted with the sheet, so the decision's record names their rates
  // (step 27's review, finding H2). One currency needs no rate.
  if (left.currency !== right.currency) used.add(left.currency).add(right.currency);
  return answer;
}

/** The environment, with the money functions bound to this sheet of rates, or to none. */
function environmentFor(sheet: RateSheet | undefined, used: Set<string> = new Set()): Environment {
  return (
    new Environment()
      .registerVariable("input", "map")
      .registerVariable("state", "map")
      .registerVariable("principal", "map")
      .registerVariable("actor_chain", "list")
      .registerVariable("delegation", "dyn")
      .registerVariable("tenant", "map")
      .registerVariable("risk", "string")
      .registerVariable("now", "google.protobuf.Timestamp")
      // money() refuses a value that is not a decimal text, and a currency not on the list.
      .registerFunction("dsor_money(string, string): map", (value: string, currency: string) => ({
        ...money(value, currency),
      }))
      // a > b, after converting a to b's currency. Multiplying across gives the same answer,
      // exactly (step 26's README, decision L5).
      .registerFunction(
        "dsor_exceeds(map, map): bool",
        (a: unknown, b: unknown) => compared(a, b, sheet, used) === 1,
      )
      // a >= b, after converting b to a's currency.
      .registerFunction(
        "dsor_covers(map, map): bool",
        (a: unknown, b: unknown) => compared(a, b, sheet, used) !== -1,
      )
  );
}

// One environment checks every condition: checking runs no function, so it needs no rates.
const checker = environmentFor(undefined);

// not copied: the CEL library's own words for a variable it does not know.
const UNKNOWN_VARIABLE = /^Unknown variable: ([A-Za-z_][A-Za-z0-9_]*)/;
// not copied: the CEL library's own words for a call that no function of the environment takes.
const NO_OVERLOAD = /found no matching overload for '(([A-Za-z_][A-Za-z0-9_]*)\([^']*\))'/;
// not copied: a call of CEL's matches(), on a string. The library runs its regular expression with
// JavaScript's engine, whose time can grow without bound, and not with CEL's RE2. A text in quotes
// that holds ".matches(" is refused too: refused when in doubt. Found by step 27's review, finding
// L10.
const MATCHES = /\.\s*matches\s*\(/;
// And CEL's loops: all, exists, exists_one, map, and filter. A loop inside a loop
// multiplies its time, and the library bounds an expression's size, not its steps. Step 28 lets a
// person write a condition over the network, so a condition that loops is refused, as matches is:
// refused when in doubt, a loop's name inside a string too (step 28's review, finding H2).
// not copied: the CEL specification's macros that run a loop, by their names.
const LOOPS = /\.\s*(all|exists_one|exists|map|filter)\s*\(/;

/** Why the condition cannot run as a control's condition, or none (DSOR-CTL-05, DSOR-CTL-06). */
export function checkCondition(condition: string): string | undefined {
  // A loop first, whatever else the condition says (step 28's review, finding H2).
  const loop = LOOPS.exec(condition)?.[1];
  if (loop !== undefined) {
    return `it loops with ${loop}, which this step refuses: a loop's time has no bound`;
  }
  const checked = checker.check(condition);
  if (!checked.valid) {
    const message = String(checked.error?.message ?? "").split("\n")[0] ?? "";
    const name = UNKNOWN_VARIABLE.exec(message)?.[1];
    if (name !== undefined) return `it names ${name}, which is not in the environment`;
    const call = NO_OVERLOAD.exec(message);
    if (call !== null && NOT_BUILT.has(call[2]!)) {
      return `it calls ${call[2]}, which this step does not build`;
    }
    if (call !== null) return `it calls ${call[1]}, which the environment does not have`;
    return `it is not CEL: ${message}`;
  }
  if (MATCHES.test(condition))
    return "it calls matches, which this step refuses: its time has no bound";
  // A map's field is "dyn": its type is known only when it runs, so the answer is checked then.
  const type = String(checked.type);
  if (type === "bool" || type === "dyn") return undefined;
  const article = "aeiou".includes(type[0] ?? "") ? "an" : "a";
  return `it answers ${article} ${type}, not true or false`;
}

/** The condition's answer for these facts, with these rates: true, false, or an error (DSOR-CTL-07). */
export function evaluateCondition(
  condition: string,
  facts: Facts,
  sheet: RateSheet | undefined,
  // Each currency it converted with the sheet is added here, for the decision's record.
  used: Set<string> = new Set(),
): Evaluated {
  try {
    const answer: unknown = environmentFor(sheet, used).evaluate(condition, facts);
    if (answer === true || answer === false) return { holds: answer };
    return { error: `it answered ${typeof answer}, not true or false` };
  } catch (thrown) {
    // Any failure is an error, never false: a missing field, a currency with no rate, a type.
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return { error: message.split("\n")[0] ?? "it could not be evaluated" };
  }
}
