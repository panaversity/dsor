// STEP 27: the company's policy, as controls kept in DSoR's own store (decision 162).
//
// A control is a policy sentence translated into a condition a program can evaluate: "payments
// above 25,000 USD need the CFO" becomes `dsor_exceeds(input.amount, dsor_money("25000", "USD"))`,
// with the effect `require_approval` by the CFO. It is kept with its owner, the policy sentence and
// version it came from, and test cases that must pass before it is switched on (§17). One row per
// company, control and version, in `dsor.controls`, under the same two locks as everything there.
//
// Not to be confused with `controls.ts`, step 25's emergency brake: §18's operational controls.
//
// Rule DSOR-CTL-01a: A control MUST validate against `control.schema.json`, which requires a version,
// a condition, an effect, a status, a named human owner, and an authority reference.

import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { checkCondition, evaluateCondition, type ConditionInput } from "./cel.ts";
import type { RateOf } from "./exchange.ts";
import { theDatabase } from "./store.ts";
// NEW IN STEP 28: where a control's policy is kept, the record of a change, and its owner's inbox.
import { audit } from "./audit.ts";
import { nextRequestId } from "./envelopes.ts";
import { policySourceOf } from "./ksor.ts";
import { tell } from "./notices.ts";

// ajv-formats is CommonJS; under nodenext the callable sits on `.default`, as in audit.ts.
const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;

const read = (path: string): object =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as object;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(read("./schemas/common.schema.json"));
ajv.addSchema(read("./schemas/control.schema.json"));

const compiled = ajv.getSchema("urn:dsor:schema:1.3:control");

if (compiled === undefined) {
  throw new Error("the control schema did not compile");
}

const validateControl = compiled;

// The authority a decision's record names must be one the audit schema takes, or the record cannot
// be written and the decision goes unrecorded (decision 164).
const authorityCompiled = ajv.getSchema("urn:dsor:schema:1.3:common#/$defs/authorityReference");

if (authorityCompiled === undefined) {
  throw new Error("the authority reference schema did not compile");
}

const validateAuthority = authorityCompiled;

/**
 * Whether controls govern an operation. DSoR's own commands, the brake, the tear-up and, later,
 * a proposal's, are governed by none: the brake must work when the controls cannot be read, and
 * a `proposal.*` command may never itself require approval (DSOR-APR-08). So no control is switched
 * on for one, and the controls are not read for one (decision 164).
 */
export function governedByControls(operation: string): boolean {
  return !["control.", "delegation.", "proposal."].some((own) => operation.startsWith(own));
}

/** The six states §17 gives a control. */
export type ControlStatus =
  | "draft"
  | "in_review"
  | "active"
  | "stale_authority"
  | "suspended"
  | "retired";

/** One control, as control.schema.json says it: its record, with its status beside it. */
export interface Control {
  readonly id: string;
  readonly version: number;
  readonly status: ControlStatus;
  readonly operation: string;
  /** The whole record, status included, exactly as the schema checks it. */
  readonly record: Readonly<Record<string, unknown>>;
}

/** A copy that nothing handed out can change: the record is read from JSON, so it is plain data. */
function frozenDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) {
      frozenDeep(inner);
    }

    Object.freeze(value);
  }

  return value;
}

/** Rows as the store hands them back, made into controls. */
function controlsFrom(
  rows: readonly {
    id: string;
    version: number;
    status: ControlStatus;
    operation: string;
    record: Record<string, unknown>;
  }[],
): readonly Control[] {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: row.id,
        version: row.version,
        status: row.status,
        operation: row.operation,
        // The status is the column's, the one part of a control that changes; the record never
        // holds one (migration 028).
        record: frozenDeep({ ...row.record, status: row.status }),
      }),
    ),
  );
}

/** Every control a company has, every version, in any state, by id and version. */
export async function controlsOf(tenant: string): Promise<readonly Control[]> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    version: number;
    status: ControlStatus;
    operation: string;
    record: Record<string, unknown>;
  }>(
    `SELECT id, version, status, operation, record FROM dsor.controls
      WHERE tenant = $1 ORDER BY id, version`,
    [tenant],
  );

  return controlsFrom(rows);
}

/**
 * The controls in force on one operation in one company: the ones switched on, and the ones
 * switched on and since marked stale, which step 28 marks and which are never dropped or skipped
 * (DSOR-CTL-03b); a review found the stale ones left out (decision 164). A control waiting for
 * review, suspended or retired governs nothing. Read at every decision, never kept: a control
 * switched on a moment ago applies to the next request.
 */
export async function controlsInForce(
  tenant: string,
  operation: string,
): Promise<readonly Control[]> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    version: number;
    status: ControlStatus;
    operation: string;
    record: Record<string, unknown>;
  }>(
    `SELECT id, version, status, operation, record FROM dsor.controls
      WHERE tenant = $1 AND operation = $2 AND status IN ('active', 'stale_authority')
      ORDER BY id`,
    [tenant, operation],
  );

  return controlsFrom(rows);
}

/** The three outcomes a control can give in this step (DSOR-AUT-02a). */
export type Outcome = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

/** One control's answer about one request, as the decision's record names it. */
export interface Evaluated {
  readonly id: string;
  readonly version: number;
  readonly outcome: Outcome;
  /** The policy it came from, as the control says: the system, the sentence's address, its version. */
  readonly authority: Readonly<Record<string, unknown>>;
  /** Why the condition could not be evaluated, when it could not: then the control applied. */
  readonly evaluation_error?: string;
  /** What a `require_approval` control asks for: who, and how many of them. */
  readonly requires?: { readonly role: string; readonly quorum: number };
  /** What a `deny` control says, for the refusal. */
  readonly reason?: string;
}

/** What a control does when it applies, read from its effect; anything this step cannot do is DENY. */
function effectOf(control: Control): Pick<Evaluated, "outcome" | "requires" | "reason"> {
  const effect = control.record.effect as Record<string, Record<string, unknown>> | undefined;
  const approval = effect?.require_approval;
  const denial = effect?.deny;

  if (
    approval !== undefined &&
    typeof approval.role === "string" &&
    typeof approval.quorum === "number"
  ) {
    return {
      outcome: "REQUIRE_APPROVAL",
      requires: { role: approval.role, quorum: approval.quorum },
    };
  }

  if (denial !== undefined && typeof denial.reason === "string") {
    return { outcome: "DENY", reason: denial.reason };
  }

  // A control in force whose effect this program cannot carry out cannot be honoured, so the
  // strictest answer stands in for it. Switching such a control on is refused, below.
  return {
    outcome: "DENY",
    reason: `${control.id} v${control.version} asks for what this program cannot do`,
  };
}

/**
 * One control's answer: its effect when the condition holds, ALLOW when it does not, and its
 * effect again when the condition cannot be evaluated (DSOR-CTL-07). A currency with no rate, a
 * missing field and a type error all mean "apply": a rule that crashes is never "no rule today".
 */
export function evaluateControl(control: Control, given: ConditionInput, rates: RateOf): Evaluated {
  const applies = effectOf(control);
  const given_ = control.record.authority;
  // An authority the record cannot name would leave the decision unrecorded; one that cannot be
  // read is named as no governed source, beside the error that says why (decision 164).
  const authority: Readonly<Record<string, unknown>> =
    validateAuthority(given_) === true
      ? (given_ as Readonly<Record<string, unknown>>)
      : Object.freeze({ system: "local" });
  const condition = control.record.condition;
  const base = { id: control.id, version: control.version, authority };

  // A control whose record the schema refuses, or whose condition this environment cannot take,
  // cannot be read, so it is not trusted to say ALLOW: DENY, the strictest answer, in its place.
  // Switching such a control on is refused; this is for one an administrator wrote in force.
  const unreadable =
    typeof condition !== "string" || validateControl(control.record) !== true
      ? "does not match control.schema.json"
      : checkCondition(condition);

  if (unreadable !== undefined || typeof condition !== "string") {
    return Object.freeze({
      ...base,
      ...applies,
      outcome: "DENY",
      reason: `${control.id} v${control.version} cannot be read`,
      evaluation_error: `${control.id} v${control.version}: ${unreadable}`,
    });
  }

  try {
    return Object.freeze(
      evaluateCondition(condition, given, rates)
        ? { ...base, ...applies }
        : { ...base, outcome: "ALLOW" },
    );
  } catch (failure) {
    return Object.freeze({
      ...base,
      ...applies,
      evaluation_error: failure instanceof Error ? failure.message : String(failure),
    });
  }
}

/** DENY over any REQUIRE_*, any REQUIRE_* over ALLOW (DSOR-AUT-02b). */
export function mostRestrictive(outcomes: readonly Outcome[]): Outcome {
  return outcomes.includes("DENY")
    ? "DENY"
    : outcomes.includes("REQUIRE_APPROVAL")
      ? "REQUIRE_APPROVAL"
      : "ALLOW";
}

/** One test case's result, when a control is switched on. Cases are counted from 1. */
export interface CaseResult {
  readonly case: number;
  readonly expected: string;
  readonly got: Outcome;
  readonly evaluation_error?: string;
}

/** What switching a control on did. */
export type SwitchedOn =
  | { readonly kind: "switched_on"; readonly results: readonly CaseResult[] }
  | { readonly kind: "refused"; readonly why: string; readonly results: readonly CaseResult[] };

/**
 * The rates a test case pins, per US dollar as every rate in this program is: the dollar is 1 by
 * definition, and a currency the case does not pin has no rate (DSOR-CTL-02e). The company's rate
 * service is never asked: a case must give the same answer on every day it is run.
 */
function ratesPinnedBy(pinned: unknown): RateOf {
  const rates =
    pinned !== null && typeof pinned === "object" ? (pinned as Record<string, unknown>) : {};

  return (currency) => {
    const rate =
      currency === "USD" ? "1" : Object.hasOwn(rates, currency) ? rates[currency] : undefined;

    if (typeof rate !== "string") {
      throw new Error(`the test case pins no rate for ${currency}`);
    }

    return rate;
  };
}

/**
 * Switch a control on (DSOR-CTL-02c). It must exist in this company, be waiting (a draft or in
 * review), match control.schema.json as an active control must (DSOR-CTL-01a), have a condition this
 * environment understands (DSOR-CTL-05, DSOR-CTL-06), ask for what this program can do, and give
 * every one of its test cases the answer the case expects. Only then is its status `active`.
 *
 * Who may switch one on is step 28's. Here no operation reaches this function: the demo calls it in
 * the administrator's place.
 */
export async function switchOn(tenant: string, id: string, version: number): Promise<SwitchedOn> {
  const refused = (why: string, results: readonly CaseResult[] = []): SwitchedOn =>
    Object.freeze({ kind: "refused", why, results: Object.freeze(results) });
  const control = (await controlsOf(tenant)).find((c) => c.id === id && c.version === version);

  if (control === undefined) {
    return refused(`${tenant} has no control ${id} v${version}`);
  }

  if (!governedByControls(control.operation)) {
    return refused(
      `${id} v${version} governs ${control.operation}, one of DSoR's own commands, which no control governs`,
    );
  }

  if (control.status !== "draft" && control.status !== "in_review") {
    return refused(
      `${id} v${version} is ${control.status}; only a draft or one in review is switched on`,
    );
  }

  const asActive = { ...control.record, status: "active" };

  if (validateControl(asActive) !== true) {
    return refused(
      `${id} v${version} does not match control.schema.json: ${ajv.errorsText(validateControl.errors)}`,
    );
  }

  const condition = control.record.condition as string;
  const notCel = checkCondition(condition);

  if (notCel !== undefined) {
    return refused(`${id} v${version}'s condition cannot be a control's: ${notCel}`);
  }

  const effect = Object.keys(control.record.effect as object)[0];

  if (effect !== "deny" && effect !== "require_approval") {
    return refused(`${id} v${version} asks for ${effect}, which this program cannot carry out yet`);
  }

  // Each case with the eight variables: what it says, and nothing anybody else says. A case names
  // `input` and `state`; the rest are neutral, so a case cannot pass by who happens to be asking.
  const cases = control.record.tests as readonly Record<string, unknown>[];
  const results = cases.map((testCase, at): CaseResult => {
    const evaluated = evaluateControl(
      control,
      {
        input: (testCase.input ?? {}) as Record<string, unknown>,
        state: (testCase.state ?? {}) as Record<string, unknown>,
        principal: {},
        actor_chain: [],
        delegation: null,
        tenant: { id: tenant },
        risk: "medium",
        now: new Date(),
      },
      ratesPinnedBy(testCase.rates),
    );

    return Object.freeze({
      case: at + 1,
      expected: String(testCase.expect),
      got: evaluated.outcome,
      ...(evaluated.evaluation_error === undefined
        ? {}
        : { evaluation_error: evaluated.evaluation_error }),
    });
  });
  // A case passes on its answer, and not because its condition could not be evaluated: a condition
  // that reads a field nobody sends applies every time, and would pass every case that expects it
  // to. Only a case in XXX, ISO 4217's code for no currency, may pass that way: it is there to show
  // that an amount with no rate applies the control (decision 164).
  const failed = results.filter(
    (r) =>
      r.expected !== r.got ||
      (r.evaluation_error !== undefined && !/\bXXX\b/.test(r.evaluation_error)),
  );

  if (failed.length > 0) {
    return refused(
      `${id} v${version} failed its own test cases: ${failed
        .map((r) =>
          r.expected !== r.got
            ? `case ${r.case} expects ${r.expected} and gives ${r.got}`
            : `case ${r.case} gives ${r.got} only because it could not be evaluated: ${r.evaluation_error ?? ""}`,
        )
        .join("; ")}`,
      results,
    );
  }

  const inForce = (await controlsOf(tenant)).find(
    (c) => c.id === id && (c.status === "active" || c.status === "stale_authority"),
  );

  if (inForce !== undefined) {
    return refused(
      `${id} version ${inForce.version} is in force; one version of a control is in force at a time`,
      results,
    );
  }

  // Only out of waiting, in one statement, so two people switching it on at once do it once; the
  // index of migration 028 refuses a second version in force beside the first.
  let rows: readonly { version: number }[];

  try {
    ({ rows } = await theDatabase(tenant).query<{ version: number }>(
      `UPDATE dsor.controls SET status = 'active', switched_on_at = clock_timestamp()
        WHERE tenant = $1 AND id = $2 AND version = $3 AND status IN ('draft', 'in_review')
        RETURNING version`,
      [tenant, id, version],
    ));
  } catch (failure) {
    // Another version switched on at the same moment: migration 028's index lets one stand, and
    // this one is told so, not handed PostgreSQL's words (decision 164).
    if ((failure as { code?: unknown }).code === "23505") {
      return refused(`another version of ${id} was switched on at the same moment`, results);
    }

    throw failure;
  }

  if (rows.length !== 1) {
    return refused(`${id} v${version} changed while it was being switched on`, results);
  }

  return Object.freeze({ kind: "switched_on", results: Object.freeze(results) });
}

/**
 * How long a proposal waits for the approvals a control requires: 72 hours, §44's strictest bound
 * on an approval for a HIGH operation (decision 162). The receipt says until when; nothing moves a
 * waiting proposal on before step 29.
 */
export const WAITS_FOR_APPROVAL_MS: number = 72 * 60 * 60 * 1000;

/** NEW IN STEP 28: what one sweep found (decision 165). */
export interface Noticed {
  /** Each control it marked stale: the policy version it cites, and the one in force, if any. */
  readonly marked: readonly {
    readonly id: string;
    readonly version: number;
    readonly cites: number;
    readonly inForce: number | undefined;
  }[];
  /** Why it could not ask KSoR, when it could not; nothing after that was asked. */
  readonly couldNotAsk?: string;
}

/**
 * NEW IN STEP 28: notice the controls whose policy changed (DSOR-CTL-03a, decision 165).
 *
 * For every control in force that cites KSoR, ask KSoR for the policy's version in force. A later
 * version, the same version with other words, or a policy KSoR no longer has: the control is marked
 * `stale_authority`, a `control_change` record goes in the company's log, and its owner is told. It
 * is never switched off: a stale control is still in force (DSOR-CTL-03b). One marked stale already
 * is left as it is, so nobody is told twice. KSoR down marks nothing, and says so.
 *
 * §44 bounds this at 24 hours at L2. There is no timer in this tutorial: the program runs it, and
 * the demo does.
 */
export async function noticeStalePolicies(tenant: string): Promise<Noticed> {
  const source = policySourceOf(tenant);
  const marked: Noticed["marked"][number][] = [];

  for (const control of await controlsOf(tenant)) {
    const authority = control.record.authority as Readonly<Record<string, unknown>> | undefined;

    if (
      control.status !== "active" ||
      authority?.system !== "ksor" ||
      typeof authority.uri !== "string" ||
      typeof authority.version !== "number"
    ) {
      continue;
    }

    let inForce;

    try {
      inForce = source.current(authority.uri);
    } catch (failure) {
      return Object.freeze({
        marked: Object.freeze(marked),
        couldNotAsk: failure instanceof Error ? failure.message : String(failure),
      });
    }

    if (
      inForce !== undefined &&
      inForce.version === authority.version &&
      inForce.content_hash === authority.content_hash
    ) {
      continue;
    }

    // Only out of active, in one statement: two sweeps at once mark it, and tell its owner, once.
    const { rows } = await theDatabase(tenant).query<{ id: string }>(
      `UPDATE dsor.controls SET status = 'stale_authority'
        WHERE tenant = $1 AND id = $2 AND version = $3 AND status = 'active'
        RETURNING id`,
      [tenant, control.id, control.version],
    );

    if (rows.length !== 1) {
      continue;
    }

    const owner = String(control.record.owner);
    const now =
      inForce === undefined
        ? "KSoR no longer has it"
        : `the version in force is version ${inForce.version}`;
    const what = `${control.id} v${control.version} cites version ${authority.version} of ${authority.uri}, and ${now}`;

    await audit({
      kind: "control_change",
      // DSoR itself made this change; nobody asked for it.
      subject: "dsor",
      tenant,
      requestId: nextRequestId(),
      result: "STALE_AUTHORITY",
      reason: `${what}; marked stale, still in force, for ${owner} to review`,
    });
    tell(
      tenant,
      owner,
      `Your control ${what}. It is marked stale and is still enforced as it is: review it, and switch on a version that cites the policy in force.`,
    );
    marked.push(
      Object.freeze({
        id: control.id,
        version: control.version,
        cites: authority.version,
        inForce: inForce?.version,
      }),
    );
  }

  return Object.freeze({ marked: Object.freeze(marked) });
}
