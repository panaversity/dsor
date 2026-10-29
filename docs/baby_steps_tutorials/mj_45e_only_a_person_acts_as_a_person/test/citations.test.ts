// What a rule may cite, and how long its grace may be (step 28b's README, claim C9, decisions
// D10 and D13). A rule cites a policy of its own company in KSoR, or local, the specification's
// word for a rule with no governed source: any other source no sweep could ever check. On a high
// or critical operation, a stale rule's grace is at most 30 days, §44's limit at L2. The draft
// check and start-up check both, because both run the one check of a version (rulebook.ts).
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import { CFO, contract, shippedWith } from "./helpers.ts";
import {
  heard,
  refusalAtStart,
  ruleCall,
  ruleWorldOnTuesday,
  shippedRule,
  startWith,
  textOf,
  version9,
} from "./rule-world.ts";

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]): ControlsSource {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

/** The contracts as shipped, with payment.create at this risk. */
function paymentAt(level: string) {
  return shippedWith({ ...contract("payment.create"), risk: { level } });
}

/** Version 9's text with this authority. */
function citing(authority: Record<string, unknown>): Record<string, unknown> {
  return { ...textOf(version9()), authority };
}

/** Version 9's text with this grace. */
function graced(stale_grace: string): Record<string, unknown> {
  return { ...textOf(version9()), stale_grace };
}

const KSOR_V4 = {
  system: "ksor",
  uri: "ksor://org_456/finance/payment-approval-policy",
  rule: "high-value-payment",
  version: 4,
  content_hash: "sha256:9f2c1e7ab4d0",
};

describe("C9: a rule cites a source this step can check (step 28b's README, decision D13)", () => {
  it("Step 28b: a draft that cites a policy of org_789 is refused: org_456's rule cites org_456's own policies", async () => {
    const w = await ruleWorldOnTuesday();
    const theirs = { ...KSOR_V4, uri: "ksor://org_789/finance/payment-approval-policy" };
    expect(await ruleCall(w, CFO, "rule.draft", { draft: citing(theirs) })).toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        '"rule.draft": org_456\'s control high-value-payment: its authority cites "ksor://org_789/finance/payment-approval-policy", which is not a policy of org_456',
    });
  });

  it("Step 28b: a draft that cites a system this step cannot check is refused: no sweep could ever find it superseded", async () => {
    const w = await ruleWorldOnTuesday();
    const elsewhere = { ...KSOR_V4, system: "sharepoint", uri: "sharepoint://org_456/payments" };
    expect(await ruleCall(w, CFO, "rule.draft", { draft: citing(elsewhere) })).toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        '"rule.draft": org_456\'s control high-value-payment: its authority cites the system "sharepoint", and this step checks only ksor, or local for a rule with no governed source',
    });
  });

  it("DSOR-CTL-01b: a draft with no governed source declares local, and is taken", async () => {
    const w = await ruleWorldOnTuesday();
    const local = { system: "local", rule: "high-value-payment" };
    expect(await ruleCall(w, CFO, "rule.draft", { draft: citing(local) })).toMatchObject({
      outcome: "COMMITTED",
      data: { version: 9, status: "draft" },
    });
  });

  // Found by step 28b's review, finding L6: the rule's tests were positive only.
  it("DSOR-CTL-01b: a draft that names KSoR but no policy, no version, and no fingerprint is refused: only local leaves the policy out", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await ruleCall(w, CFO, "rule.draft", { draft: citing({ system: "ksor" }) });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect("message" in answer && answer.message).toContain("must have required property 'uri'");
  });

  it("Step 28b: a KSoR address that names no policy after the company is refused", async () => {
    const w = await ruleWorldOnTuesday();
    const bare = { ...KSOR_V4, uri: "ksor://org_456/" };
    expect(heard(await ruleCall(w, CFO, "rule.draft", { draft: citing(bare) }))).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("Step 28b: start-up refuses a rule in a file that cites another company's policy", async () => {
    const v8 = { ...shippedRule(), authority: { ...KSOR_V4, uri: "ksor://org_789/finance/x" } };
    expect(await refusalAtStart(() => startWith(controlsOf(v8)))).toContain(
      'controls.json: org_456\'s control high-value-payment: its authority cites "ksor://org_789/finance/x", which is not a policy of org_456',
    );
  });
});

describe("C9: a stale rule's grace is at most 30 days on a high or critical operation (step 28b's README, decision D10)", () => {
  it.each(["high", "critical"])(
    "DSOR-BND-02: on a %s-risk payment.create, a draft whose grace is 30 days and a second is refused, and one of 30 days is taken",
    async (level) => {
      const w = await ruleWorldOnTuesday(undefined, [], undefined, paymentAt(level));
      expect(await ruleCall(w, CFO, "rule.draft", { draft: graced("P30DT1S") })).toMatchObject({
        code: "VALIDATION_FAILED",
        message: `"rule.draft": org_456's control high-value-payment: its stale_grace P30DT1S is longer than 30 days, the most §44 allows at L2 on a ${level}-risk operation`,
      });
      expect(heard(await ruleCall(w, CFO, "rule.draft", { draft: graced("P30D") }))).toBe(
        "COMMITTED",
      );
      expect(heard(await ruleCall(w, CFO, "rule.draft", { draft: graced("PT720H") }))).toBe(
        "COMMITTED",
      );
    },
  );

  it("Step 28b: on payment.create at medium risk, as this tutorial ships it, a grace of 45 days is taken: §44 caps high and critical operations only", async () => {
    const w = await ruleWorldOnTuesday();
    expect(heard(await ruleCall(w, CFO, "rule.draft", { draft: graced("P45D") }))).toBe(
      "COMMITTED",
    );
  });

  it("DSOR-BND-02: start-up refuses a rule on a high-risk payment.create whose grace is 31 days", async () => {
    const v8 = { ...shippedRule(), stale_grace: "P31D" };
    expect(await refusalAtStart(() => startWith(controlsOf(v8), paymentAt("high")))).toContain(
      "controls.json: org_456's control high-value-payment: its stale_grace P31D is longer than 30 days, the most §44 allows at L2 on a high-risk operation",
    );
  });
});
