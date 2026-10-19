// NEW IN STEP 27: the environment a control's condition is evaluated in (decision 162).
//
// A control's condition is CEL, the Common Expression Language: it works like the condition of an
// `if`, it cannot loop forever or call the network, and it sees only what it is handed. What it is
// handed is Appendix B's eight variables, and three of its six functions. The other three,
// `dsor_sum`, `dsor_in_flight` and `dsor_is_new_counterparty`, arrive with the steps that need them;
// until then a condition that names one is refused when its control is switched on.
//
// Rule DSOR-CTL-05: Control conditions and contract predicates MUST be CEL expressions evaluated in
// the environment of Appendix B.
// Rule DSOR-CTL-06: An expression MUST NOT have access to anything outside that environment: no
// network, no clock other than `now`, no caller-supplied state.

import { Environment } from "@marcbachmann/cel-js";
import { covers, exceeds, type RateOf } from "./exchange.ts";
import { money, type Money } from "./money.ts";

/** Appendix B's eight variables, as a condition sees them. */
export interface ConditionInput {
  /** The validated, canonical operation input: what §21.6 wrote down, never the raw request. */
  readonly input: Readonly<Record<string, unknown>>;
  /** The resources the contract binds. None until step 32's preconditions bind any. */
  readonly state: Readonly<Record<string, unknown>>;
  readonly principal: Readonly<Record<string, unknown>>;
  readonly actor_chain: readonly string[];
  /** The slip the command runs under, or `null` for a person's own command. */
  readonly delegation: Readonly<Record<string, unknown>> | null;
  readonly tenant: Readonly<Record<string, unknown>>;
  readonly risk: string;
  /** DSoR's own clock, the only clock a condition has. */
  readonly now: Date;
}

/**
 * An amount a condition handed back. CEL gives a function its maps as plain objects or as `Map`s,
 * and either is read the same way; anything that is not an amount is refused, by `money`, as it is
 * everywhere else in this program.
 */
function asMoney(given: unknown): Money {
  const field = (name: string): unknown =>
    given instanceof Map
      ? given.get(name)
      : given !== null && typeof given === "object"
        ? (given as Record<string, unknown>)[name]
        : undefined;
  const value = field("value");
  const currency = field("currency");

  if (typeof value !== "string" || typeof currency !== "string") {
    throw new TypeError("an amount is a map with a decimal `value` and a `currency`, as strings");
  }

  return money(value, currency);
}

/**
 * The environment, at these rates: the company's own service at a decision, a test case's pinned
 * rates when a control is switched on. Nothing else is registered, so a name a condition uses that
 * is not here is an unknown name, at the check and at the evaluation alike.
 */
function environmentAt(rates: RateOf): Environment {
  return (
    new Environment()
      .registerVariable("input", "map")
      .registerVariable("state", "map")
      .registerVariable("principal", "map")
      .registerVariable("actor_chain", "list")
      // A map, or null for a person's own command: `dyn` is CEL's word for "either".
      .registerVariable("delegation", "dyn")
      .registerVariable("tenant", "map")
      .registerVariable("risk", "string")
      .registerVariable("now", "google.protobuf.Timestamp")
      .registerFunction("dsor_money(string, string): map", (value: string, currency: string) => ({
        ...money(value, currency),
      }))
      // `a > b` after converting, and `a >= b`: step 26's exact comparisons, which multiply and
      // never divide, and throw when an amount cannot be converted (DSOR-MON-03).
      .registerFunction("dsor_exceeds(map, map): bool", (a: unknown, b: unknown) =>
        exceeds(asMoney(a), asMoney(b), rates),
      )
      .registerFunction("dsor_covers(map, map): bool", (a: unknown, b: unknown) =>
        covers(asMoney(a), asMoney(b), rates),
      )
  );
}

/** No rate at all: checking a condition converts nothing. */
const NO_RATES: RateOf = (currency) => {
  throw new Error(`no rate is asked for while a condition is only checked (${currency})`);
};

/**
 * Why this condition cannot be a control's, or `undefined` when it can: CEL this environment
 * understands, naming only its variables and functions, and saying true or false.
 */
export function checkCondition(condition: string): string | undefined {
  let checked;

  try {
    checked = environmentAt(NO_RATES).check(condition);
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }

  if (!checked.valid) {
    return checked.error?.message ?? "it is not CEL this program understands";
  }

  if (checked.type !== "bool") {
    return `it gives ${checked.type}, and a condition must say true or false`;
  }

  return undefined;
}

/**
 * Whether the condition holds, for these variables at these rates. Throws when it cannot be
 * evaluated: a missing field, a type error, an amount that cannot be converted. What a throw means
 * is the caller's to decide, and for a control it means the control applies (DSOR-CTL-07).
 *
 * Only the eight variables are passed on, by name, so a variable handed in beside them is never
 * seen (DSOR-CTL-06).
 */
export function evaluateCondition(condition: string, given: ConditionInput, rates: RateOf): boolean {
  const { input, state, principal, actor_chain, delegation, tenant, risk, now } = given;
  const answer: unknown = environmentAt(rates).evaluate(condition, {
    input,
    state,
    principal,
    actor_chain,
    delegation,
    tenant,
    risk,
    now,
  });

  if (typeof answer !== "boolean") {
    throw new TypeError(`the condition gave ${typeof answer}, not true or false`);
  }

  return answer;
}
