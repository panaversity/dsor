// NEW IN STEP 27: each company's controls, checked at start-up (DSOR-CTL-01a, DSOR-CTL-05, and
// DSOR-CTL-02c in specs/dsor/02-security.md, section 17; step 27's README, claims C1 to C3). A
// control must pass control.schema.json, its condition must be CEL in Appendix B's environment, it
// may govern only a command with the company's own code, and its tests must pass before it is
// switched on. When one does not, start-up refuses to start.
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { readControls, type ControlsSource } from "../src/controls.ts";
import { memoryInvoices } from "../src/invoice.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments } from "../src/payment.ts";
import { readMoneyPolicies } from "../src/policies.ts";
import { buildRegistry } from "../src/registry.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memorySlips } from "../src/slips.ts";
import {
  refusal,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  STORY_SLIPS,
  storyDirectories,
} from "./helpers.ts";

/** A registry of the shipped contracts and code, with these controls. */
function startWith(controls: ControlsSource) {
  return buildRegistry(
    shipped,
    handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(),
    memoryPayments([]),
    memorySlips(STORY_SLIPS),
    storyDirectories(),
    readRoleSettings(),
    undefined,
    ownWorkFor(),
    undefined,
    readLifetimes(),
    readMoneyPolicies(),
    controls,
  );
}

/** A controls file with this text. */
function controlsOf(data: unknown): ControlsSource {
  return { file: "controls.json", text: JSON.stringify(data) };
}

// The shipped control, as a plain object that a test may change.
const SHIPPED = (JSON.parse(readControls().text) as { org_456: Record<string, unknown>[] })
  .org_456[0]!;
/** org_456's one control, the shipped one with these fields changed. */
function withOne(fields: Record<string, unknown>): ControlsSource {
  return controlsOf({ org_456: [{ ...SHIPPED, ...fields }], org_789: [] });
}
const QUICK =
  'double(state.invoice.open_amount.value) > 25000.0 && state.invoice.open_amount.currency == "USD"';

describe("C1: each control, against control.schema.json", () => {
  it("DSOR-CTL-01a: the shipped file passes, and line ⑩'s book holds org_456's high-value-payment, version 8, and nothing for org_789", () => {
    const { controls } = startWith(readControls());
    expect(controls.get("org_456")?.map((c) => [c.id, c.version, c.operation])).toStrictEqual([
      ["high-value-payment", 8, "payment.create"],
    ]);
    expect(controls.get("org_789") ?? []).toStrictEqual([]);
  });

  it.each([
    [
      "no owner",
      { owner: undefined },
      "org_456's control high-value-payment must have required property 'owner'",
    ],
    [
      "no authority",
      { authority: undefined },
      "org_456's control high-value-payment must have required property 'authority'",
    ],
    [
      "a status it does not know",
      { status: "live" },
      "org_456's control high-value-payment/status must be equal to one of the allowed values",
    ],
    [
      "an effect with two answers",
      { effect: { deny: { reason: "x" }, require_approval: { role: "CFO", quorum: 1 } } },
      "org_456's control high-value-payment/effect must NOT have more than 1 properties",
    ],
    [
      "an active control with no reviewer",
      { reviewed_by: undefined },
      "org_456's control high-value-payment must have required property 'reviewed_by'",
    ],
    [
      "no tests at all",
      { tests: [] },
      "org_456's control high-value-payment/tests must NOT have fewer than 1 items",
    ],
  ])(
    "DSOR-CTL-01a: start-up refuses a control that control.schema.json refuses: %s",
    (_what, fields, problem) => {
      expect(refusal(() => startWith(withOne(fields)))).toContain(`controls.json: ${problem}`);
    },
  );

  it("DSOR-CTL-01a: start-up refuses a file that is not an object of companies, a company id that is not one, a company with no money policy, and two controls with one id", () => {
    expect(refusal(() => startWith(controlsOf([])))).toContain(
      "controls.json: must be an object that gives each company its list of controls",
    );
    expect(refusal(() => startWith(controlsOf({ acme: [] })))).toContain(
      'controls.json: "acme" is not a company id like org_456',
    );
    expect(refusal(() => startWith(controlsOf({ org_999: [] })))).toContain(
      "controls.json: org_999 has controls, and no money policy to count them in",
    );
    expect(refusal(() => startWith(controlsOf({ org_456: [SHIPPED, SHIPPED] })))).toContain(
      "controls.json: org_456 has two controls with the id high-value-payment",
    );
  });
});

describe("C2: the condition, the operation, and the effect", () => {
  it.each([
    ["is not CEL", "state.invoice.open_amount >", "its condition is not CEL"],
    ["answers a string", '"25000"', "its condition answers a string, not true or false"],
    [
      "names a variable outside the environment",
      "secrets.limit == 1",
      "its condition names secrets, which is not in the environment",
    ],
    [
      "calls a function this step does not build",
      "dsor_in_flight(input.invoice) == null",
      "its condition calls dsor_in_flight, which this step does not build",
    ],
  ])("DSOR-CTL-05: start-up refuses a control whose condition %s", (_what, condition, problem) => {
    expect(refusal(() => startWith(withOne({ condition })))).toContain(
      `controls.json: org_456's control high-value-payment: ${problem}`,
    );
  });

  it.each([
    ["a query", "invoice.get", "governs invoice.get, which is a query: a query waits for nobody"],
    [
      "DSoR's own command",
      "delegation.revoke",
      "governs delegation.revoke, which is DSoR's own: it must answer at once",
    ],
    [
      "an operation no contract has",
      "payment.refund",
      "governs payment.refund, which no contract has",
    ],
  ])(
    "Step 27: start-up refuses a control that governs %s (step 27's README, decision D18)",
    (_what, operation, problem) => {
      expect(refusal(() => startWith(withOne({ operation })))).toContain(
        `controls.json: org_456's control high-value-payment ${problem}`,
      );
    },
  );

  // Found while building step 27: the registry read a contract's risk as text, so a condition saw
  // "[object Object]" where Appendix B gives the operation's risk level.
  it("DSOR-CTL-05: a condition reads `risk`, the risk level of the operation it governs: medium for payment.create", () => {
    const byRisk = {
      condition: 'risk == "medium"',
      effect: { deny: { reason: "every medium-risk payment is refused" } },
      tests: [{ expect: "DENY" }],
    };
    expect(refusal(() => startWith(withOne(byRisk)))).toBe("");
  });

  it("DSOR-AUT-02a: start-up takes the two effects this step builds, deny and require_approval, and refuses require_step_up and require_verification (step 27's README, decision D8)", () => {
    const deny = { effect: { deny: { reason: "payments above 25,000 USD are not allowed" } } };
    const denying = {
      ...deny,
      tests: [{ state: (SHIPPED["tests"] as { state: unknown }[])[1]!.state, expect: "DENY" }],
    };
    expect(startWith(withOne(denying)).controls.get("org_456")?.[0]?.effect).toStrictEqual(
      deny.effect,
    );
    expect(
      refusal(() => startWith(withOne({ effect: { require_step_up: { acr: "mfa" } } }))),
    ).toContain(
      "controls.json: org_456's control high-value-payment has the effect require_step_up, which this step does not build",
    );
    expect(refusal(() => startWith(withOne({ effect: { require_verification: {} } })))).toContain(
      "controls.json: org_456's control high-value-payment has the effect require_verification, which this step does not build",
    );
  });
});

describe("C3: the tests, run before a control is switched on", () => {
  it('DSOR-CTL-02c: the quick rule, "over 25000 and in USD", fails its own test of 50,000,000.00 PKR, so start-up refuses to start, and names the test', () => {
    expect(refusal(() => startWith(withOne({ condition: QUICK })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 3: expects REQUIRE_APPROVAL, gives ALLOW",
    );
  });

  it("DSOR-CTL-02c: a test whose expectation is wrong stops start-up too: 25,000.00 USD expected to need the CFO", () => {
    const tests = structuredClone(SHIPPED["tests"]) as { expect: string }[];
    tests[0]!.expect = "REQUIRE_APPROVAL";
    expect(refusal(() => startWith(withOne({ tests })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 1: expects REQUIRE_APPROVAL, gives ALLOW",
    );
  });

  it("DSOR-CTL-07: at start-up too, a test in a currency with no pinned rate cannot be evaluated, so it gives the effect: 100.00 XXX expected ALLOW fails", () => {
    const tests = structuredClone(SHIPPED["tests"]) as { expect: string }[];
    tests[4]!.expect = "ALLOW";
    expect(refusal(() => startWith(withOne({ tests })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 5: expects ALLOW, gives REQUIRE_APPROVAL",
    );
  });

  it("Step 27: a test's pinned rates are per one unit of the company's control currency, USD for org_456: 6,000,000.00 PKR at 280 is 21,428.57 USD and allowed, and at 200 it is 30,000 USD (step 27's README, decision D7)", () => {
    const tests = structuredClone(SHIPPED["tests"]) as { rates?: Record<string, string> }[];
    tests[3]!.rates = { PKR: "200" };
    expect(refusal(() => startWith(withOne({ tests })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 4: expects ALLOW, gives REQUIRE_APPROVAL",
    );
  });

  it("Step 27: a draft's tests do not run and line ⑩ never sees it; a stale_authority control is tested and kept (step 27's README, decision D3)", () => {
    const draft = { ...SHIPPED, id: "draft-rule", status: "draft", condition: QUICK };
    const started = startWith(controlsOf({ org_456: [SHIPPED, draft], org_789: [] }));
    expect(started.controls.get("org_456")?.map((c) => c.id)).toStrictEqual(["high-value-payment"]);
    expect(
      refusal(() => startWith(withOne({ status: "stale_authority", condition: QUICK }))),
    ).toContain("controls.json: org_456's control high-value-payment v8 fails its test 3");
    const stale = startWith(withOne({ status: "stale_authority" }));
    expect(stale.controls.get("org_456")?.map((c) => c.status)).toStrictEqual(["stale_authority"]);
  });
});
