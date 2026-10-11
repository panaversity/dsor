// NEW IN STEP 27: each company's controls: a business rule written so that a program can check it
// (DSOR-CTL-01a, DSOR-CTL-02c, and DSOR-CTL-05 in specs/dsor/02-security.md, section 17; step 27's
// README, decisions D1 to D3, D7, D8, and D18). A control has a condition in CEL, an effect, a
// human owner, the policy it came from, and its own tests. controls.json gives each company its
// list. Start-up checks each control against control.schema.json, checks its condition and what it
// governs, and runs its tests before line ⑩ may evaluate it. One that fails stops start-up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { checkCondition, evaluateCondition, type Facts } from "./cel.ts";
import type { RateSheet } from "./exchange.ts";
import { keysWrittenTwice } from "./json.ts";
import type { MoneyPolicies } from "./policies.ts";
import { isTenantId } from "./uri.ts";

/** What a control can answer: its effect, or ALLOW (DSOR-AUT-02a). */
export type ControlAnswer = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

/** One test of a control: the facts it gives, the rates it pins, and the answer it expects. */
type ControlTest = {
  input?: Record<string, unknown>;
  state?: Record<string, unknown>;
  // Units of each currency for one unit of the company's control currency (decision D7).
  rates?: Record<string, string>;
  expect: string;
};

/** One control, as control.schema.json shapes it, once start-up has checked it. */
export type Control = {
  id: string;
  version: number;
  status: string;
  operation: string;
  condition: string;
  effect: { deny: { reason: string } } | { require_approval: { role: string; quorum: number } };
  authority: Record<string, unknown>;
  owner: string;
  tests: ControlTest[];
};

/** Each company's controls that line ⑩ evaluates, by company. */
export type ControlBook = ReadonlyMap<string, readonly Control[]>;

/** The controls file, as it was read from disk: its name and its text. */
export type ControlsSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../controls.json", import.meta.url));

/** Reads the controls file: this step's own, unless another is named. */
export function readControls(path: string = SHIPPED): ControlsSource {
  return { file: "controls.json", text: readFileSync(path, "utf8") };
}

// A world that tests another idea, with no rule of the company in its way (decision D16).
/** No controls at all. */
export const NO_CONTROLS: ControlsSource = Object.freeze({ file: "controls.json", text: "{}" });

/** Why a control may not govern this operation, or none (decision D18). */
export type Governable = (operation: string) => string | undefined;

// The specification's schemas, copied byte for byte (step 03's README, decision 3).
const SCHEMAS = new URL("../schemas/", import.meta.url);
function loadSchema(file: string): object {
  return JSON.parse(readFileSync(new URL(file, SCHEMAS), "utf8")) as object;
}
// As registry.ts builds its checker: name every problem, and never change what is checked.
const ajv = new Ajv2020({
  allErrors: true,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
  strict: false,
});
ajv.addSchema(loadSchema("common.schema.json"));
ajv.addSchema(loadSchema("control.schema.json"));
const validateControl = ajv.compile({ $ref: "urn:dsor:schema:1.3:control" });

// Line ⑩ evaluates these. A stale control is never skipped (DSOR-CTL-03b, step 28's rule; decision
// D3). A draft, a control in review, a suspended one, and a retired one wait.
const EVALUATED = new Set(["active", "stale_authority"]);
// The effects this step builds (decision D8).
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
): { answer: ControlAnswer; error?: string } {
  const evaluated = evaluateCondition(control.condition, facts, sheet);
  // A condition that cannot be evaluated applies the effect (DSOR-CTL-07).
  if ("error" in evaluated) return { answer: effectOf(control), error: evaluated.error };
  return { answer: evaluated.holds ? effectOf(control) : "ALLOW" };
}

/** Each failing test of a control, numbered from 1, run with the rates it pins (DSOR-CTL-02c). */
function failedTests(control: Control, tenant: string, currency: string, risk: string): string[] {
  const failed: string[] = [];
  control.tests.forEach((test, index) => {
    // A test gives its input and its state. It is no caller's call, so it names no one.
    const facts: Facts = {
      input: test.input ?? {},
      state: test.state ?? {},
      principal: { id: "", type: "", roles: [] },
      actor_chain: [],
      delegation: null,
      tenant: { id: tenant },
      risk,
      now: new Date(),
    };
    // Its pinned rates, per one unit of the company's control currency (decision D7).
    const rates = { [currency]: "1", ...test.rates };
    const sheet: RateSheet = { source: "test", base: currency, published_at: "", rates };
    const { answer } = answerOf(control, facts, sheet);
    if (answer !== test.expect) {
      failed.push(`${index + 1}: expects ${test.expect}, gives ${answer}`);
    }
  });
  return failed;
}

/** Checks each company's controls, runs the tests of each one line ⑩ evaluates, and names every problem. */
export function checkControls(
  source: ControlsSource,
  governable: Governable,
  riskOf: (operation: string) => string,
  policies: MoneyPolicies,
): { controls: ControlBook; problems: string[] } {
  const { file, text } = source;
  const book = new Map<string, Control[]>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { controls: book, problems: [`${file}: not valid JSON`] };
  }
  // A list and null are objects in JavaScript too. Neither one names a company.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const problem = `${file}: must be an object that gives each company its list of controls`;
    return { controls: book, problems: [problem] };
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
    // A test's rates count in the company's control currency, so a company needs its policy.
    const policy = policies.get(tenant);
    if (policy === undefined) {
      problems.push(`${file}: ${tenant} has controls, and no money policy to count them in`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`${file}: ${tenant} must give a list of controls`);
      continue;
    }
    const kept: Control[] = [];
    const ids = new Set<string>();
    list.forEach((raw: unknown, index) => {
      const id = (raw as { id?: unknown } | null)?.id;
      const name = `${tenant}'s control ${typeof id === "string" ? id : String(index + 1)}`;
      // The specification's shape first (DSOR-CTL-01a).
      if (!validateControl(raw)) {
        for (const error of validateControl.errors ?? []) {
          problems.push(`${file}: ${name}${error.instancePath} ${error.message ?? "is wrong"}`);
        }
        return;
      }
      const control = raw as Control;
      if (ids.has(control.id)) {
        problems.push(`${file}: ${tenant} has two controls with the id ${control.id}`);
        return;
      }
      ids.add(control.id);
      const effect = Object.keys(control.effect)[0] ?? "";
      if (!BUILT.has(effect)) {
        problems.push(`${file}: ${name} has the effect ${effect}, which this step does not build`);
        return;
      }
      const why = governable(control.operation);
      if (why !== undefined) {
        problems.push(`${file}: ${name} governs ${control.operation}, ${why}`);
        return;
      }
      // Every control's condition, a draft's too, so a broken one is found now (DSOR-CTL-05).
      const broken = checkCondition(control.condition);
      if (broken !== undefined) {
        const said = broken.startsWith("it ") ? broken.slice(3) : broken;
        problems.push(`${file}: ${name}: its condition ${said}`);
        return;
      }
      // Kept in the file, and never evaluated (decision D3).
      if (!EVALUATED.has(control.status)) return;
      // Switching a control on runs its tests, and fails when one fails (DSOR-CTL-02c).
      const risk = riskOf(control.operation);
      const failed = failedTests(control, tenant, policy.control_currency, risk);
      if (failed.length > 0) {
        for (const test of failed) {
          problems.push(`${file}: ${name} v${control.version} fails its test ${test}`);
        }
        return;
      }
      kept.push(structuredClone(control));
    });
    book.set(tenant, kept);
  }
  return { controls: book, problems };
}
