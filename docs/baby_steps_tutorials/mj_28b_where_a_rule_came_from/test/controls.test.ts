// Each company's controls, checked at start-up (DSOR-CTL-01a, DSOR-CTL-05, and
// DSOR-CTL-02c in specs/dsor/02-security.md, section 17; step 27's README, claims C1 to C3). A
// control must pass control.schema.json, its condition must be CEL in Appendix B's environment, it
// may govern only a command with the company's own code, and its tests must pass before it is
// switched on. When one does not, start-up refuses to start.
// Since step 28, start-up checks every version in a store, which the file fills (step 28's README,
// decision D6).
import { describe, expect, it } from "vitest";
import type { Facts } from "../src/cel.ts";
import {
  denialsOf,
  evaluateControls,
  mostRestrictive,
  readControls,
  requirementsOf,
  type Control,
  type ControlsSource,
} from "../src/controls.ts";
import type { RateSheet } from "../src/exchange.ts";
import { money, type Money } from "../src/money.ts";
import { shipped } from "./helpers.ts";
import { activeIn, refusalAtStart, shippedRule, startWith } from "./rule-world.ts";

// Start-up checks a store, filled from the file, and a read of a store waits. So
// each test waits for start-up (step 28's README, decision D6).

/** A controls file with this text. */
function controlsOf(data: unknown): ControlsSource {
  return { file: "controls.json", text: JSON.stringify(data) };
}

// The shipped control, as a plain object that a test may change.
const SHIPPED = (JSON.parse(readControls().text) as { org_456: Record<string, unknown>[] })
  .org_456[0]!;
/** The shipped control as it was before anyone switched it on: no reviewer, and no time. */
function neverOn(): Record<string, unknown> {
  const { reviewed_by: _reviewer, effective_from: _from, ...text } = SHIPPED;
  return text;
}

/** org_456's one control, the shipped one with these fields changed. */
function withOne(fields: Record<string, unknown>): ControlsSource {
  return controlsOf({ org_456: [{ ...SHIPPED, ...fields }], org_789: [] });
}
const QUICK =
  'double(state.invoice.open_amount.value) > 25000.0 && state.invoice.open_amount.currency == "USD"';

// Found by step 27's sweep, K19 to K21: with each check of the file itself gone, every test passed.
// A file cut short by a bad edit started DSoR with no rule at all.
describe("the file itself", () => {
  it("Step 27: a controls.json that is not JSON stops start-up, named: a file cut short does not start DSoR with no rules", async () => {
    expect(await refusalAtStart(() => startWith(controlsOf(undefined)))).toContain(
      "controls.json: not valid JSON",
    );
    expect(
      await refusalAtStart(() => startWith({ file: "controls.json", text: '{"org_456": [' })),
    ).toContain("controls.json: not valid JSON");
  });

  it("Step 27: a key written twice stops start-up: org_456 written twice, once with its rule and once with none", async () => {
    const rule = JSON.stringify(SHIPPED);
    const twice = `{"org_456": [${rule}], "org_789": [], "org_456": []}`;
    expect(await refusalAtStart(() => startWith({ file: "controls.json", text: twice }))).toContain(
      'controls.json: "org_456" is written twice in one object',
    );
  });

  it("Step 27: a company that gives no list stops start-up, named", async () => {
    expect(
      await refusalAtStart(() => startWith(controlsOf({ org_456: {}, org_789: [] }))),
    ).toContain("controls.json: org_456 must give a list of controls");
  });
});

describe("C1: each control, against control.schema.json", () => {
  // Changed in step 28: the book is a store.
  it("DSOR-CTL-01a: the shipped file passes, and line ⑩'s store holds org_456's high-value-payment, version 8, and nothing for org_789", async () => {
    const registry = await startWith(readControls());
    const active = await activeIn(registry, "org_456");
    expect(active.map((c) => [c.id, c.version, c.operation])).toStrictEqual([
      ["high-value-payment", 8, "payment.create"],
    ]);
    expect(await activeIn(registry, "org_789")).toStrictEqual([]);
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
    async (_what, fields, problem) => {
      expect(await refusalAtStart(() => startWith(withOne(fields)))).toContain(
        `controls.json: ${problem}`,
      );
    },
  );

  it("DSOR-CTL-01a: start-up refuses a file that is not an object of companies, a company id that is not one, a company with no money policy, and two controls with one id", async () => {
    expect(await refusalAtStart(() => startWith(controlsOf([])))).toContain(
      "controls.json: must be an object that gives each company its list of controls",
    );
    expect(await refusalAtStart(() => startWith(controlsOf({ acme: [] })))).toContain(
      'controls.json: "acme" is not a company id like org_456',
    );
    expect(await refusalAtStart(() => startWith(controlsOf({ org_999: [] })))).toContain(
      "controls.json: org_999 has controls, and no money policy to count them in",
    );
    // Changed in step 28: a rule has versions, and one version is kept once.
    expect(
      await refusalAtStart(() => startWith(controlsOf({ org_456: [SHIPPED, SHIPPED] }))),
    ).toContain("controls.json: org_456 has version 8 of high-value-payment twice");
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
  ])(
    "DSOR-CTL-05: start-up refuses a control whose condition %s",
    async (_what, condition, problem) => {
      expect(await refusalAtStart(() => startWith(withOne({ condition })))).toContain(
        `controls.json: org_456's control high-value-payment: ${problem}`,
      );
    },
  );

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
    // Found by step 27's sweep, R03: with this check gone, every test passed.
    [
      "a command with no code",
      "invoice.issue",
      "governs invoice.issue, which has no code of the company's",
    ],
  ])(
    "Step 27: start-up refuses a control that governs %s (step 27's README, decision D18)",
    async (_what, operation, problem) => {
      expect(await refusalAtStart(() => startWith(withOne({ operation })))).toContain(
        `controls.json: org_456's control high-value-payment ${problem}`,
      );
    },
  );

  // Found while building step 27: the registry read a contract's risk as text, so a condition saw
  // "[object Object]" where Appendix B gives the operation's risk level.
  it("DSOR-CTL-05: a condition reads `risk`, the risk level of the operation it governs: medium for payment.create", async () => {
    const byRisk = {
      condition: 'risk == "medium"',
      effect: { deny: { reason: "every medium-risk payment is refused" } },
      tests: [{ expect: "DENY" }],
    };
    expect(await refusalAtStart(() => startWith(withOne(byRisk)))).toBe("");
  });

  it("DSOR-AUT-02a: start-up takes the two effects this step builds, deny and require_approval, and refuses require_step_up and require_verification (step 27's README, decision D8)", async () => {
    const deny = { effect: { deny: { reason: "payments above 25,000 USD are not allowed" } } };
    const denying = {
      ...deny,
      tests: [{ state: (SHIPPED["tests"] as { state: unknown }[])[1]!.state, expect: "DENY" }],
    };
    const [kept] = await activeIn(await startWith(withOne(denying)), "org_456");
    expect(kept?.effect).toStrictEqual(deny.effect);
    expect(
      await refusalAtStart(() =>
        startWith(withOne({ effect: { require_step_up: { acr: "mfa" } } })),
      ),
    ).toContain(
      "controls.json: org_456's control high-value-payment has the effect require_step_up, which this step does not build",
    );
    expect(
      await refusalAtStart(() => startWith(withOne({ effect: { require_verification: {} } }))),
    ).toContain(
      "controls.json: org_456's control high-value-payment has the effect require_verification, which this step does not build",
    );
  });
});

/** The shipped contracts, with these predicates in one contract's preconditions. */
function predicatesIn(id: string, predicates: string[]) {
  return shipped.map((s) => {
    const data = JSON.parse(s.text) as { id: string; preconditions?: Record<string, unknown> };
    if (data.id !== id) return s;
    const changed = { ...data, preconditions: { ...data.preconditions, predicates } };
    return { file: s.file, text: JSON.stringify(changed) };
  });
}

describe("a contract's predicates (step 27's review, finding M3)", () => {
  // Found by step 27's review: payment.create's contract took the predicate false, start-up
  // accepted it, and INV-2002 was paid. No step evaluates a predicate before step 32.
  it("Step 27: start-up refuses a predicate on an operation that runs code, because no predicate is evaluated before step 32 (step 27's README, decision D20)", async () => {
    const contracts = predicatesIn("payment.create", ["false"]);
    expect(await refusalAtStart(() => startWith(withOne({}), contracts))).toContain(
      "payment.create: it lists predicates, which no step evaluates before step 32",
    );
  });

  it("DSOR-CTL-05: start-up checks each contract predicate as CEL in Appendix B's environment: invoice.issue's own passes, and one that names anything else is refused", async () => {
    expect((await startWith(withOne({}))).contracts.has("invoice.issue")).toBe(true);
    const contracts = predicatesIn("invoice.issue", ['caller_hint == "cfo"']);
    expect(await refusalAtStart(() => startWith(withOne({}), contracts))).toContain(
      'invoice.issue: its predicate "caller_hint == \\"cfo\\"" names caller_hint, which is not in the environment',
    );
  });
});

describe("C3: the tests, run before a control is switched on", () => {
  it('DSOR-CTL-02c: the quick rule, "over 25000 and in USD", fails its own test of 50,000,000.00 PKR, so start-up refuses to start, and names the test', async () => {
    expect(await refusalAtStart(() => startWith(withOne({ condition: QUICK })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 3: expects REQUIRE_APPROVAL, gives ALLOW",
    );
  });

  it("DSOR-CTL-02c: a test whose expectation is wrong stops start-up too: 25,000.00 USD expected to need the CFO", async () => {
    const tests = structuredClone(SHIPPED["tests"]) as { expect: string }[];
    tests[0]!.expect = "REQUIRE_APPROVAL";
    expect(await refusalAtStart(() => startWith(withOne({ tests })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 1: expects REQUIRE_APPROVAL, gives ALLOW",
    );
  });

  // Found by step 27's review, finding M4: a test that gives no state cannot be evaluated, so the
  // effect applied, and a test that expected the effect passed. The quick rule switched on behind a
  // test that tested nothing.
  it("DSOR-CTL-02c: a test passes only by evaluating its condition: the quick rule behind one test with no state, which expects the CFO, does not switch on (step 27's README, decision D19)", async () => {
    const vacuous = withOne({ condition: QUICK, tests: [{ expect: "REQUIRE_APPROVAL" }] });
    expect(await refusalAtStart(() => startWith(vacuous))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 1: expects REQUIRE_APPROVAL, and its condition cannot be evaluated: ",
    );
    // The shipped control as it is: its test 5, in a currency with no rate, passes by its error.
    expect(await activeIn(await startWith(withOne({})), "org_456")).toHaveLength(1);
  });

  it("DSOR-CTL-07: at start-up too, a test in a currency with no pinned rate cannot be evaluated, so it gives the effect: 100.00 XXX expected ALLOW fails", async () => {
    const tests = structuredClone(SHIPPED["tests"]) as { expect: string }[];
    tests[4]!.expect = "ALLOW";
    expect(await refusalAtStart(() => startWith(withOne({ tests })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 5: expects ALLOW, gives REQUIRE_APPROVAL",
    );
  });

  it("Step 27: a test's pinned rates are per one unit of the company's control currency, USD for org_456: 6,000,000.00 PKR at 280 is 21,428.57 USD and allowed, and at 200 it is 30,000 USD (step 27's README, decision D7)", async () => {
    const tests = structuredClone(SHIPPED["tests"]) as { rates?: Record<string, string> }[];
    tests[3]!.rates = { PKR: "200" };
    expect(await refusalAtStart(() => startWith(withOne({ tests })))).toContain(
      "controls.json: org_456's control high-value-payment v8 fails its test 4: expects ALLOW, gives REQUIRE_APPROVAL",
    );
  });

  // Changed by step 27's review, finding M2: a stale control was evaluated as if it were active, and
  // §17.4 says that it behaves per its on_stale, which this step does not build.
  // Found by step 27's sweep, K23 and K24: with the status checked before the condition, or with
  // the other statuses evaluated, every test passed.
  // Changed in step 28: in_review is not built, and stops start-up (rulebook.test.ts).
  it.each(["draft", "suspended", "retired"])(
    "Step 27: a %s control's condition is checked at start-up, and line ⑩ never sees the control (step 27's README, decision D3)",
    async (status) => {
      // Changed in step 28: a draft was never switched on, so it names no reviewer and no time.
      const base = status === "draft" ? neverOn() : SHIPPED;
      const waiting = { ...base, id: "waiting-rule", status, condition: QUICK };
      const started = await startWith(controlsOf({ org_456: [SHIPPED, waiting], org_789: [] }));
      expect((await activeIn(started, "org_456")).map((c) => c.id)).toStrictEqual([
        "high-value-payment",
      ]);
      const broken = { ...waiting, condition: "state.invoice.open_amount >" };
      expect(
        await refusalAtStart(() =>
          startWith(controlsOf({ org_456: [SHIPPED, broken], org_789: [] })),
        ),
      ).toContain("controls.json: org_456's control waiting-rule: its condition is not CEL");
    },
  );

  // Changed in step 28b: a stale control is evaluated now, so start-up takes one from the store,
  // and a file can never give the status, which only DSoR's sweep gives (step 28b's README,
  // decision D14).
  it("Step 27: a draft's tests do not run and line ⑩ never sees it; a stale_authority control in a file stops start-up (step 27's README, decision D3)", async () => {
    const draft = { ...neverOn(), id: "draft-rule", status: "draft", condition: QUICK };
    const started = await startWith(controlsOf({ org_456: [SHIPPED, draft], org_789: [] }));
    expect((await activeIn(started, "org_456")).map((c) => c.id)).toStrictEqual([
      "high-value-payment",
    ]);
    expect(await refusalAtStart(() => startWith(withOne({ status: "stale_authority" })))).toContain(
      "controls.json: org_456's control high-value-payment has the status stale_authority, which only DSoR's sweep gives",
    );
  });
});

// Tuesday's sheet of ecb-daily, from step 26: how much of each currency 1 EUR buys.
const TUESDAY: RateSheet = {
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00.000Z",
  rates: { EUR: "1", USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
};
/** The facts of the agent's draft of a bill with this open amount. */
function factsFor(open: Money): Facts {
  return {
    input: {},
    state: { invoice: { open_amount: open } },
    principal: { id: "user_123", type: "human", roles: ["ap_supervisor"] },
    actor_chain: ["accounts-payable-fte"],
    delegation: { id: "del_100" },
    tenant: { id: "org_456", policy: {} },
    risk: "medium",
    now: new Date("2026-10-06T15:05:00.000Z"),
  };
}
// A second control, for these tests only: org_456 refuses any payment above 45,000 USD.
const DENY_ABOVE_45K = {
  ...SHIPPED,
  id: "very-high-value-payment",
  version: 1,
  condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("45000", "USD"))',
  effect: { deny: { reason: "payments above 45,000 USD go to the board" } },
} as unknown as Control;

// A deny control that refuses payments above 60,000 USD only.
const QUICK_60K = 'dsor_exceeds(state.invoice.open_amount, dsor_money("60000", "USD"))';

describe("C5: line ⑩'s answer from several controls", () => {
  // Changed in step 28: the shipped control itself, as the store keeps it.
  const cfo = [shippedRule()];

  it("DSOR-AUT-02a: a control answers its effect when its condition holds, and ALLOW when it does not: 31,400.00 USD needs the CFO, 9,000.00 EUR is allowed, and the deny control answers DENY", async () => {
    const answers = (open: Money, controls: readonly Control[]) =>
      evaluateControls(controls, "payment.create", factsFor(open), TUESDAY).map((o) => o.outcome);
    expect(answers(money("31400.00", "USD"), cfo)).toStrictEqual(["REQUIRE_APPROVAL"]);
    expect(answers(money("9000.00", "EUR"), cfo)).toStrictEqual(["ALLOW"]);
    expect(answers(money("50000.00", "USD"), [DENY_ABOVE_45K])).toStrictEqual(["DENY"]);
  });

  it("DSOR-AUT-02b: the most restrictive answer wins: DENY over REQUIRE_APPROVAL, and REQUIRE_APPROVAL over ALLOW, in any order; no answer at all is ALLOW", async () => {
    expect(mostRestrictive(["ALLOW", "REQUIRE_APPROVAL", "ALLOW"])).toBe("REQUIRE_APPROVAL");
    expect(mostRestrictive(["REQUIRE_APPROVAL", "DENY", "ALLOW"])).toBe("DENY");
    expect(mostRestrictive(["DENY", "REQUIRE_APPROVAL"])).toBe("DENY");
    expect(mostRestrictive(["ALLOW"])).toBe("ALLOW");
    expect(mostRestrictive([])).toBe("ALLOW");
  });

  it("DSOR-AUT-02b: INV-2004's 14,000,000.00 PKR, 50,000.00 USD, meets both controls: the CFO's asks for an approval, the second denies, and DENY wins", async () => {
    const outcomes = evaluateControls(
      [...cfo, DENY_ABOVE_45K],
      "payment.create",
      factsFor(money("14000000.00", "PKR")),
      TUESDAY,
    );
    expect(outcomes.map((o) => [o.id, o.outcome])).toStrictEqual([
      ["high-value-payment", "REQUIRE_APPROVAL"],
      ["very-high-value-payment", "DENY"],
    ]);
    expect(mostRestrictive(outcomes.map((o) => o.outcome))).toBe("DENY");
  });

  it("Step 27: only the controls that govern the call's operation answer it", async () => {
    const onCancel = { ...DENY_ABOVE_45K, operation: "payment.cancel" } as Control;
    expect(
      evaluateControls([onCancel], "payment.create", factsFor(money("50000.00", "USD")), TUESDAY),
    ).toStrictEqual([]);
  });

  it("DSOR-CTL-07: a control whose condition cannot be evaluated answers its effect, and its outcome names the error, the control, and the policy it came from, for the decision's record (step 27's README, decision D14)", async () => {
    const [outcome] = evaluateControls(
      cfo,
      "payment.create",
      factsFor(money("100000", "JPY")),
      TUESDAY,
    );
    expect(outcome).toStrictEqual({
      id: "high-value-payment",
      version: 8,
      outcome: "REQUIRE_APPROVAL",
      authority: SHIPPED["authority"],
      evaluation_error: "no usable rate compares JPY with USD",
    });
  });

  it("Step 27: what a waiting payment requires: each control that asked for an approval, its role, and its quorum (step 27's README, decision D10)", async () => {
    const outcomes = evaluateControls(
      cfo,
      "payment.create",
      factsFor(money("31400.00", "USD")),
      TUESDAY,
    );
    expect(requirementsOf(cfo, outcomes)).toStrictEqual([
      { approval: { role: "CFO", quorum: 1 }, control: "high-value-payment" },
    ]);
    const allowed = evaluateControls(
      cfo,
      "payment.create",
      factsFor(money("100.00", "USD")),
      TUESDAY,
    );
    expect(requirementsOf(cfo, allowed)).toStrictEqual([]);
  });

  // Found by step 27's review, finding L2: the record kept no reason for a refusal.
  it("Step 27: the reasons a refusal's record keeps: each deny control that refused, and never one that allowed (step 27's README, decision D13)", async () => {
    const sixty = { ...DENY_ABOVE_45K, id: "board-above-60000", condition: QUICK_60K } as Control;
    const controls = [...cfo, DENY_ABOVE_45K, sixty];
    const outcomes = evaluateControls(
      controls,
      "payment.create",
      factsFor(money("50000.00", "USD")),
      TUESDAY,
    );
    expect(outcomes.map((o) => o.outcome)).toStrictEqual(["REQUIRE_APPROVAL", "DENY", "ALLOW"]);
    expect(denialsOf(controls, outcomes)).toStrictEqual([
      { control: "very-high-value-payment", reason: "payments above 45,000 USD go to the board" },
    ]);
  });
});
