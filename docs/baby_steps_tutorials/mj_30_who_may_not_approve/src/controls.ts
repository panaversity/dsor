// Each company's controls: a business rule written so that a program can check it
// (DSOR-CTL-01a, DSOR-CTL-02c, and DSOR-CTL-05 in specs/dsor/02-security.md, section 17; step 27's
// README, decisions D1 to D3, D7, D8, and D18). A control has a condition in CEL, an effect, a
// human owner, the policy it came from, and its own tests. One check, ruleProblems, checks a
// control against control.schema.json, checks its condition and what it governs, and runs its
// tests before line ⑩ may evaluate it.
// The controls live in DSoR's own store (rulebook.ts). controls.json fills a store
// in memory, and start-up runs the check on every version in a store. rule.draft and rule.activate
// run it too (step 28's README, decisions D3, D6, D11, and D12).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { millisecondsOf } from "./authority.ts";
import { checkCondition, evaluateCondition, NO_RATE, tenantOf, type Facts } from "./cel.ts";
import type { Requirement } from "./envelope.ts";
import type { RateSheet } from "./exchange.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Roles } from "./permissions.ts";
import type { MoneyPolicy } from "./policies.ts";
import { principalNamed } from "./principals.ts";
import type { InForce, PolicyInForce } from "./rulebook.ts";
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
// With every field the schema names, so a store keeps a version whole.
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
// DSoR writes it itself, from its own clock, when a version is switched on (step
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

// A rule's address ends with its id, so the id is one form only: lower-case words
// joined by dashes, from a letter to a letter or a digit, at most 64 characters. Found by step
// 28's review, finding L16: ".", "..", and "high-value-payment." passed the URI's own form, and a
// lookalike rule stood beside the real one in the agent's answer.
// not copied: this tutorial's own form for a rule's id, stricter than the URI's (step 28's README,
// decision D7).
const RULE_ID = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// Nor is a control in review built. The owner's switch-on is the review (step 28's
// README, decision D17).
const IN_REVIEW = "in_review";
// The most approvals one rule may ask for (step 28's README, decision D21).
const MOST_APPROVERS = 5;
// The effects this step builds (step 27's README, decision D8).
const BUILT = new Set(["deny", "require_approval"]);
// §44's limit at L2 on a stale control's grace, on a high or critical operation:
// 30 days (DSOR-BND-02; step 28b's README, decision D10).
const MOST_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** Why a rule's citation names a source this step cannot check, or none (step 28b's README, decision D13). */
function citationProblem(authority: Record<string, unknown>, tenant: string): string | undefined {
  const { system, uri } = authority;
  // A rule with no governed source declares local, and nothing can supersede it (DSOR-CTL-01b).
  if (system === "local") return undefined;
  if (system !== "ksor") {
    const named = JSON.stringify(String(system).slice(0, 60));
    return `its authority cites the system ${named}, and this step checks only ksor, or local for a rule with no governed source`;
  }
  // A policy of the rule's own company: the sweep asks that company's KSoR, and no other.
  const own = `ksor://${tenant}/`;
  if (typeof uri !== "string" || !uri.startsWith(own) || uri.length === own.length) {
    const named = JSON.stringify(String(uri).slice(0, 60));
    return `its authority cites ${named}, which is not a policy of ${tenant}`;
  }
  return undefined;
}

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
  // For a stale version, the version of the policy it cites, which KSoR has
  // superseded (step 28b's README, decision D11).
  superseded_version?: number;
  // Why the condition could not be evaluated, when it could not (DSOR-CTL-07).
  evaluation_error?: string;
};

/** The least a stale version answers, and why, at this time, on an operation of this risk; none for a version that is not stale. */
export function staleFloor(
  control: InForce,
  now: Date,
  risk: string,
): { floor: ControlAnswer; why: string } | undefined {
  const { stale } = control;
  if (stale === undefined) return undefined;
  // When a stale rule must ask a person, it asks for the approval its effect names. A rule whose
  // effect is deny names no approver, so it refuses (step 28b's README, decision D8).
  const ask: ControlAnswer = "deny" in control.effect ? "DENY" : "REQUIRE_APPROVAL";
  const noApprover = ask === "DENY" ? ", and its effect names no approver" : "";
  const moved = "it is stale: the policy it cites moved";
  const deny = { floor: "DENY" as const, why: `${moved}, and its on_stale says deny` };
  // The grace runs from DSoR's mark. A time that cannot be read ends it: the rule asks a person
  // (step 28b's README, decision D9).
  const ends = Date.parse(stale.since) + millisecondsOf(control.stale_grace);
  const over = !(now.getTime() < ends);
  // After its grace, on a high or critical operation: at least a person's approval
  // (DSOR-CTL-03c).
  if (over && (risk === "high" || risk === "critical")) {
    if (control.on_stale === "deny") return deny;
    const why = `${moved}, its grace ended, and it governs a ${risk}-risk operation${noApprover}`;
    return { floor: ask, why };
  }
  // During its grace, and on a low or medium operation after it: as its on_stale says (§17.4).
  if (control.on_stale === "enforce_and_flag") {
    return { floor: "ALLOW", why: `${moved}, and its on_stale says enforce_and_flag` };
  }
  if (control.on_stale === "require_approval") {
    return { floor: ask, why: `${moved}, its on_stale says require_approval${noApprover}` };
  }
  // deny, and any word the schema does not allow, which start-up and the draft refuse anyway.
  return deny;
}

/**
 * The authority as the record names it: the version's own citation, the text it
 * was built from, and for a stale version the cited version as superseded_version. Changed by step
 * 28b's review, finding M1: the record named KSoR's version in force here, and lost the fingerprint
 * of the text the version enforces (DSOR-CTL-04; step 28b's README, decision D11).
 */
function citedOf(control: InForce): {
  authority: Record<string, unknown>;
  superseded_version?: number;
} {
  const authority = structuredClone(control.authority);
  const cited = authority["version"];
  if (control.stale === undefined || typeof cited !== "number") return { authority };
  return { authority, superseded_version: cited };
}

/** A stale version that line ⑩ evaluated, as the record names it beside the controls: when DSoR marked it, and the version of its policy in force. */
export type StaleOfRecord = {
  control: string;
  version: number;
  since: string;
  in_force: PolicyInForce;
};

/**
 * Each stale version on this operation, for the record: the authority reference
 * and the version in force that DSOR-CTL-04 asks for, which the record's controls field has no
 * place for (step 28b's README, decision D11).
 */
export function staleOf(controls: readonly InForce[], operation: string): StaleOfRecord[] {
  return controls.flatMap((control) => {
    if (control.operation !== operation || control.stale === undefined) return [];
    const { id, version, stale } = control;
    return [{ control: id, version, since: stale.since, in_force: { ...stale.in_force } }];
  });
}

/** Each of these controls that governs the operation, evaluated for one call (step 27's README, decision D15: any caller). */
// Each version in force, a stale one too, which answers at least its floor
// (DSOR-CTL-03b, DSOR-CTL-03c; step 28b's README, decisions D7 to D9).
export function evaluateControls(
  controls: readonly InForce[],
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
      const { answer: own, error } = answerOf(control, facts, sheet, used);
      const floor = staleFloor(control, facts.now, facts.risk);
      const answer = floor === undefined ? own : mostRestrictive([own, floor.floor]);
      const { id, version } = control;
      const failed = error === undefined ? {} : { evaluation_error: error };
      return { id, version, outcome: answer, ...citedOf(control), ...failed };
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
      ? [
          {
            approval: { ...control.effect.require_approval },
            control: control.id,
            control_version: control.version,
          },
        ]
      : [],
  );
}

// The record keeps the reason of each control that refused: the audit record's controls field
// allows no reason, and the caller's words name none (step 27's README, decision D13). Found by
// step 27's review, finding L2.
/** A control that refused the call, and its own reason. */
export type Denial = { control: string; reason: string };

/** The id and the reason of each control whose effect refused the call. */
// And of each stale version whose floor refused it, with why, at this time, on an
// operation of this risk (step 28b's README, decision D8).
export function denialsOf(
  controls: readonly InForce[],
  outcomes: readonly ControlOutcome[],
  facts?: Pick<Facts, "now" | "risk">,
): Denial[] {
  const refused = new Set(outcomes.filter((o) => o.outcome === "DENY").map((o) => o.id));
  return controls.flatMap((control) => {
    if (!refused.has(control.id)) return [];
    const floor = facts === undefined ? undefined : staleFloor(control, facts.now, facts.risk);
    if (floor?.floor === "DENY") return [{ control: control.id, reason: floor.why }];
    return "deny" in control.effect
      ? [{ control: control.id, reason: control.effect.deny.reason }]
      : [];
  });
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

// Step 27's check of the file, in two parts. The file's own shape is read here,
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
  // And the role table, whose roles an approval may name (step 28's README,
  // decision D21).
  roles: Roles;
  // And the permission that decides who approves an operation, its contract's
  // approve_permission, and the permission that calls proposal.approve at all, its contract's own
  // (step 29's README, decision D13).
  approvePermission: (operation: string) => string | undefined;
  approveCall: string | undefined;
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
  // A rule's address ends with its id, so the id has the letters a URI's id may
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
  // An approval names a role of the role table, and at most five people. The role
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
  if (control.status === IN_REVIEW) {
    return [`${name} has the status ${IN_REVIEW}, which this step does not build`];
  }
  // A draft was never switched on, so it names no reviewer and no time. A version
  // with a time it took effect was switched on once, and its owner is the rule's owner of record
  // (step 28's README, decision D10).
  const named = control.reviewed_by !== undefined || control.effective_from !== undefined;
  if (control.status === "draft" && named) {
    return [`${name} is a draft, so it names no reviewer and no time it took effect`];
  }
  const why = context.governable(control.operation);
  if (why !== undefined) return [`${name} governs ${control.operation}, ${why}`];
  // And an approval it asks for is one that someone can give: the operation names
  // an approve_permission, and the role holds it. Otherwise every call the rule stops would wait for
  // ever (step 29's README, decision D13).
  if ("require_approval" in control.effect) {
    const { role } = control.effect.require_approval;
    const needed = context.approvePermission(control.operation);
    if (needed === undefined) {
      const none = `${control.operation}, which names no approve_permission, so no one could give it`;
      return [`${name}: its effect asks for an approval of ${none}`];
    }
    const held = context.roles.get(role);
    if (held?.has(needed) !== true) {
      const holds = `${control.operation}'s approve_permission, ${needed}`;
      return [`${name}: its effect asks for an approval by ${role}, which does not hold ${holds}`];
    }
    // And the permission to call proposal.approve, which line ⑤ checks first. Found by step 29's
    // review, finding M2: a role holding only the approve_permission passed, and could approve
    // nothing.
    const call = context.approveCall;
    if (call === undefined) {
      return [
        `${name}: its effect asks for an approval, and no contract of proposal.approve gives one`,
      ];
    }
    if (held.has(call) !== true) {
      const holds = `${call}, the permission to call proposal.approve`;
      return [`${name}: its effect asks for an approval by ${role}, which does not hold ${holds}`];
    }
  }
  // Its owner is a person who works in its company, who can switch it on in person
  // (DSOR-CTL-01a: "a named human owner"; step 28's README, decision D11).
  const owner = principalNamed(control.owner);
  const works = owner?.memberships.some((m) => m.tenant_id === tenant) === true;
  if (owner?.type !== "human" || !works) {
    return [`${name}: its owner ${control.owner} is not a person who works in ${tenant}`];
  }
  // It cites a source this step can check (step 28b's README, decision D13).
  const citation = citationProblem(control.authority, tenant);
  if (citation !== undefined) return [`${name}: ${citation}`];
  // And on a high or critical operation, a grace of at most 30 days (DSOR-BND-02;
  // step 28b's README, decision D10).
  const risk = context.riskOf(control.operation);
  const highRisk = risk === "high" || risk === "critical";
  if (highRisk && millisecondsOf(control.stale_grace) > MOST_GRACE_MS) {
    const most = `the most §44 allows at L2 on a ${risk}-risk operation`;
    return [`${name}: its stale_grace ${control.stale_grace} is longer than 30 days, ${most}`];
  }
  // Every control's condition, a draft's too, so a broken one is found now (DSOR-CTL-05).
  const broken = checkCondition(control.condition);
  if (broken !== undefined) {
    const said = broken.startsWith("it ") ? broken.slice(3) : broken;
    return [`${name}: its condition ${said}`];
  }
  if (!tests) return [];
  // Switching a control on runs its tests, and fails when one fails (DSOR-CTL-02c).
  return failedTests(control, tenant, context.policy, risk).map(
    (test) => `${name} v${control.version} fails its test ${test}`,
  );
}
