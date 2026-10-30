// Each company's controls: a business rule written so that a program can check it
// (DSOR-CTL-01a, DSOR-CTL-02c, and DSOR-CTL-05 in specs/dsor/02-security.md, section 17; step 27's
// README, decisions D1 to D3, D7, D8, and D18). A control has a condition in CEL, an effect, a
// human owner, the policy it came from, and its own tests. One check, ruleProblems, checks a
// control against control.schema.json, checks its condition and what it governs, and runs its
// tests before line ⑩ may evaluate it.
// NEW IN STEP 28: the controls live in DSoR's own store (rulebook.ts). controls.json fills a store
// in memory, and start-up runs the check on every version in a store. rule.draft and rule.activate
// run it too (step 28's README, decisions D3, D6, D11, and D12).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { checkCondition, evaluateCondition, NO_RATE, tenantOf, type Facts } from "./cel.ts";
import type { Requirement } from "./envelope.ts";
import type { RateSheet } from "./exchange.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Roles } from "./permissions.ts";
import type { MoneyPolicy } from "./policies.ts";
import { principalNamed } from "./principals.ts";
import { isTenantId } from "./uri.ts";

/** What a control can answer: its effect, or ALLOW (DSOR-AUT-02a). */
export type ControlAnswer = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

/** One test of a control: the facts it gives, the rates it pins, and the answer it expects. */
type ControlTest = {
  input?: Record<string, unknown>;
  state?: Record<string, unknown>;
  // Units of each currency for one unit of the company's control currency (step 27's README,
  // decision D7).
  rates?: Record<string, string>;
  expect: string;
};

/** One control, as control.schema.json shapes it, once start-up has checked it. */
// NEW IN STEP 28: with every field the schema names, so a store keeps a version whole.
export type Control = {
  id: string;
  version: number;
  status: string;
  operation: string;
  condition: string;
  effect: { deny: { reason: string } } | { require_approval: { role: string; quorum: number } };
  authority: Record<string, unknown>;
  owner: string;
  // Who wrote its condition. DSoR sets it to the person who drafts a version.
  compiled_by?: string;
  // The human who reviewed it. DSoR sets it to the owner who switches the version on.
  reviewed_by?: string;
  on_stale: string;
  stale_grace: string;
  tests: ControlTest[];
  // When it took effect. DSoR sets it when the version is switched on.
  effective_from?: string;
  extensions?: Record<string, unknown>;
};

/** The controls file, as it was read from disk: its name and its text. */
export type ControlsSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../controls.json", import.meta.url));

/** Reads the controls file: this step's own, unless another is named. */
export function readControls(path: string = SHIPPED): ControlsSource {
  return { file: "controls.json", text: readFileSync(path, "utf8") };
}

/** Why a control may not govern this operation, or none (step 27's README, decision D18). */
export type Governable = (operation: string) => string | undefined;

// The specification's schemas, copied byte for byte (step 03's README, decision 3).
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
// As registry.ts builds its checker: name every problem, and never change what is checked.
// validateFormats is off, as in slips.ts, because ajv knows no formats without a package of its
// own, and warns at start-up. So effective_from's "date-time" is not checked here.
// NEW IN STEP 28: DSoR writes it itself, from its own clock, when a version is switched on (step
// 28's README, decision D12).
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
  validateFormats: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
ajv.addSchema(loadSchema("control.schema.json"));
const validateControl = ajv.compile({ $ref: "urn:dsor:schema:1.3:control" });

// A stale control behaves per its on_stale while its stale_grace lasts (§17.4), which step 28b
// builds. Until then start-up refuses one: it is never skipped, and never evaluated as if it were
// active (DSOR-CTL-03b). Found by step 27's review, finding M2: it was evaluated as active, so a
// stale control whose on_stale says deny allowed a payment.
const STALE = "stale_authority";
// NEW IN STEP 28: a rule's address ends with its id, so the id is one form only: lower-case words
// joined by dashes, from a letter to a letter or a digit, at most 64 characters. Found by step
// 28's review, finding L16: ".", "..", and "high-value-payment." passed the URI's own form, and a
// lookalike rule stood beside the real one in the agent's answer.
// not copied: this tutorial's own form for a rule's id, stricter than the URI's (step 28's README,
// decision D7).
const RULE_ID = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// NEW IN STEP 28: nor is a control in review built. The owner's switch-on is the review (step 28's
// README, decision D17).
const IN_REVIEW = "in_review";
// NEW IN STEP 28: the most approvals one rule may ask for (step 28's README, decision D21).
const MOST_APPROVERS = 5;
// The effects this step builds (step 27's README, decision D8).
const BUILT = new Set(["deny", "require_approval"]);

/** The answer a control's effect gives. */
export function effectOf(control: Control): "DENY" | "REQUIRE_APPROVAL" {
  return "deny" in control.effect ? "DENY" : "REQUIRE_APPROVAL";
}

/** What the control answers for these facts and rates: its effect when the condition holds or fails. */
export function answerOf(
  control: Control,
  facts: Facts,
  sheet: RateSheet | undefined,
  used?: Set<string>,
): { answer: ControlAnswer; error?: string } {
  const evaluated = evaluateCondition(control.condition, facts, sheet, used);
  // A condition that cannot be evaluated applies the effect (DSOR-CTL-07).
  if ("error" in evaluated) return { answer: effectOf(control), error: evaluated.error };
  return { answer: evaluated.holds ? effectOf(control) : "ALLOW" };
}

/** One control's answer at line ⑩, as the decision's record names it (DSOR-EXE-02; step 27's README, decision D14). */
export type ControlOutcome = {
  id: string;
  version: number;
  outcome: ControlAnswer;
  // The policy it came from. The record keeps it: DSOR-CTL-04, step 28's rule, met early.
  authority: Record<string, unknown>;
  // Why the condition could not be evaluated, when it could not (DSOR-CTL-07).
  evaluation_error?: string;
};

/** Each of these controls that governs the operation, evaluated for one call (step 27's README, decision D15: any caller). */
export function evaluateControls(
  controls: readonly Control[],
  operation: string,
  facts: Facts,
  sheet: RateSheet | undefined,
  // Each currency a condition converted with the sheet is added here, for the decision's record
  // (step 27's review, finding H2).
  used?: Set<string>,
): ControlOutcome[] {
  return controls
    .filter((control) => control.operation === operation)
    .map((control) => {
      const { answer, error } = answerOf(control, facts, sheet, used);
      const { id, version, authority } = control;
      const failed = error === undefined ? {} : { evaluation_error: error };
      return { id, version, outcome: answer, authority: structuredClone(authority), ...failed };
    });
}

// DENY over any REQUIRE_*, and any REQUIRE_* over ALLOW (DSOR-AUT-02b). A step 24 limit is a DENY
// too, and line ⑩ checks it after the controls (step 27's README, decision D9).
const ORDER: readonly ControlAnswer[] = ["ALLOW", "REQUIRE_APPROVAL", "DENY"];

/** The most restrictive of these answers, or ALLOW when there are none (DSOR-AUT-02b). */
export function mostRestrictive(answers: readonly ControlAnswer[]): ControlAnswer {
  let most: ControlAnswer = "ALLOW";
  for (const answer of answers) {
    if (ORDER.indexOf(answer) > ORDER.indexOf(most)) most = answer;
  }
  return most;
}

/** The role and quorum of each control that asked for an approval (step 27's README, decision D10). */
export function requirementsOf(
  controls: readonly Control[],
  outcomes: readonly ControlOutcome[],
): Requirement[] {
  const asked = new Set(outcomes.filter((o) => o.outcome === "REQUIRE_APPROVAL").map((o) => o.id));
  return controls.flatMap((control) =>
    asked.has(control.id) && "require_approval" in control.effect
      ? [{ approval: { ...control.effect.require_approval }, control: control.id }]
      : [],
  );
}

// The record keeps the reason of each control that refused: the audit record's controls field
// allows no reason, and the caller's words name none (step 27's README, decision D13). Found by
// step 27's review, finding L2.
/** A control that refused the call, and its own reason. */
export type Denial = { control: string; reason: string };

/** The id and the reason of each control whose effect refused the call. */
export function denialsOf(
  controls: readonly Control[],
  outcomes: readonly ControlOutcome[],
): Denial[] {
  const refused = new Set(outcomes.filter((o) => o.outcome === "DENY").map((o) => o.id));
  return controls.flatMap((control) =>
    refused.has(control.id) && "deny" in control.effect
      ? [{ control: control.id, reason: control.effect.deny.reason }]
      : [],
  );
}

/** Each failing test of a control, numbered from 1, run with the rates it pins (DSOR-CTL-02c). */
function failedTests(
  control: Control,
  tenant: string,
  policy: MoneyPolicy,
  risk: string,
): string[] {
  const currency = policy.control_currency;
  const failed: string[] = [];
  control.tests.forEach((test, index) => {
    // A test gives its input and its state. It is no caller's call, so it names no one.
    const facts: Facts = {
      input: test.input ?? {},
      state: test.state ?? {},
      principal: { id: "", type: "", roles: [] },
      actor_chain: [],
      delegation: null,
      tenant: tenantOf(tenant, policy),
      risk,
      now: new Date(),
    };
    // Its pinned rates, per one unit of the company's control currency (step 27's README, decision
    // D7).
    const rates = { [currency]: "1", ...test.rates };
    const sheet: RateSheet = { source: "test", base: currency, published_at: "", rates };
    const { answer, error } = answerOf(control, facts, sheet);
    // A test passes only by evaluating its condition. An error passes only when its cause is a
    // currency with no usable rate: that is the test DSOR-CTL-02d asks for (step 27's README,
    // decision D19). Found by step 27's review, finding M4: a test with no state erred, so the
    // effect applied, and the quick rule switched on behind a test that expected the effect and
    // tested nothing.
    if (error !== undefined && !error.startsWith(NO_RATE)) {
      failed.push(
        `${index + 1}: expects ${test.expect}, and its condition cannot be evaluated: ${error}`,
      );
      return;
    }
    if (answer !== test.expect) {
      failed.push(`${index + 1}: expects ${test.expect}, gives ${answer}`);
    }
  });
  return failed;
}

// NEW IN STEP 28: step 27's check of the file, in two parts. The file's own shape is read here,
// when a store in memory is filled from it. Each control is checked by ruleProblems below, at
// start-up, for every version in a store (step 28's README, decisions D3 and D6).
/** Each company's list of controls in a controls file, unchecked, and every problem with the file itself. */
export function readRules(source: ControlsSource): {
  rules: Map<string, unknown[]>;
  problems: string[];
} {
  const { file, text } = source;
  const rules = new Map<string, unknown[]>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rules, problems: [`${file}: not valid JSON`] };
  }
  // A list and null are objects in JavaScript too. Neither one names a company.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const problem = `${file}: must be an object that gives each company its list of controls`;
    return { rules, problems: [problem] };
  }
  // JSON.parse keeps the last of two lines for one key, and says nothing.
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [tenant, list] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`${file}: ${tenant} must give a list of controls`);
      continue;
    }
    rules.set(tenant, list as unknown[]);
  }
  return { rules, problems };
}

/** What the check of a control needs to know: what may be governed, an operation's risk, and the company's money policy. */
export type RuleContext = {
  governable: Governable;
  riskOf: (operation: string) => string;
  policy: MoneyPolicy;
  // NEW IN STEP 28: and the role table, whose roles an approval may name (step 28's README,
  // decision D21).
  roles: Roles;
};

/** The name of a control in a problem: its company, and its id, or its place in a list. */
export function ruleName(tenant: string, raw: unknown, place: number): string {
  const id = (raw as { id?: unknown } | null)?.id;
  return `${tenant}'s control ${typeof id === "string" ? id : String(place)}`;
}

/**
 * Every problem with one control of a company, each named, and the problems of its tests when
 * they are asked for. Empty when the control may be kept, and switched on.
 */
export function ruleProblems(
  name: string,
  raw: unknown,
  tenant: string,
  context: RuleContext,
  // Whether to run its tests: for an active control at start-up, and at a switch-on.
  tests: boolean,
): string[] {
  // The specification's shape first (DSOR-CTL-01a).
  if (!validateControl(raw)) {
    return (validateControl.errors ?? []).map(
      (error) => `${name}${error.instancePath} ${error.message ?? "is wrong"}`,
    );
  }
  const control = raw as Control;
  // NEW IN STEP 28: a rule's address ends with its id, so the id has the letters a URI's id may
  // have (step 28's README, decision D7).
  if (!RULE_ID.test(control.id)) {
    const form = "lower-case letters, digits, and dashes, start with a letter";
    return [
      `${name}: its id must be ${form}, end with a letter or a digit, and hold at most 64 characters`,
    ];
  }
  const effect = Object.keys(control.effect)[0] ?? "";
  if (!BUILT.has(effect)) {
    return [`${name} has the effect ${effect}, which this step does not build`];
  }
  // NEW IN STEP 28: an approval names a role of the role table, and at most five people. The role
  // reaches the agent's answer, so it is never free text, and a quorum nobody can meet holds every
  // payment for ever. Found by step 28's review, finding L15 (step 28's README, decision D21).
  if ("require_approval" in control.effect) {
    const { role, quorum } = control.effect.require_approval;
    if (!context.roles.has(role)) {
      const asked = JSON.stringify(role.slice(0, 60));
      return [
        `${name}: its effect asks for an approval by ${asked}, which is no role of the role table`,
      ];
    }
    if (quorum > MOST_APPROVERS) {
      const most = `this step allows at most ${MOST_APPROVERS}`;
      return [`${name}: its effect asks for ${quorum} approvals, and ${most}`];
    }
  }
  if (control.status === STALE) {
    return [`${name} has the status ${STALE}, whose on_stale this step does not build`];
  }
  if (control.status === IN_REVIEW) {
    return [`${name} has the status ${IN_REVIEW}, which this step does not build`];
  }
  // NEW IN STEP 28: a draft was never switched on, so it names no reviewer and no time. A version
  // with a time it took effect was switched on once, and its owner is the rule's owner of record
  // (step 28's README, decision D10).
  const named = control.reviewed_by !== undefined || control.effective_from !== undefined;
  if (control.status === "draft" && named) {
    return [`${name} is a draft, so it names no reviewer and no time it took effect`];
  }
  const why = context.governable(control.operation);
  if (why !== undefined) return [`${name} governs ${control.operation}, ${why}`];
  // NEW IN STEP 28: its owner is a person who works in its company, who can switch it on in person
  // (DSOR-CTL-01a: "a named human owner"; step 28's README, decision D11).
  const owner = principalNamed(control.owner);
  const works = owner?.memberships.some((m) => m.tenant_id === tenant) === true;
  if (owner?.type !== "human" || !works) {
    return [`${name}: its owner ${control.owner} is not a person who works in ${tenant}`];
  }
  // Every control's condition, a draft's too, so a broken one is found now (DSOR-CTL-05).
  const broken = checkCondition(control.condition);
  if (broken !== undefined) {
    const said = broken.startsWith("it ") ? broken.slice(3) : broken;
    return [`${name}: its condition ${said}`];
  }
  if (!tests) return [];
  // Switching a control on runs its tests, and fails when one fails (DSOR-CTL-02c).
  const risk = context.riskOf(control.operation);
  return failedTests(control, tenant, context.policy, risk).map(
    (test) => `${name} v${control.version} fails its test ${test}`,
  );
}
