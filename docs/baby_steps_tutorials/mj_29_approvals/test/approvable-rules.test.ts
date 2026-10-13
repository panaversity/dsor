// A rule asks only for an approval that someone can give (step 29's README, claim C8, decisions
// D13). A rule that asks for an approval on an operation whose contract names no
// approve_permission, or by a role that does not hold it, would hold every payment it stops for
// ever. A draft and start-up refuse it. And no rule governs proposal.approve, which is DSoR's own:
// a proposal.* command never itself waits for an approval (DSOR-APR-08).
import { describe, expect, it } from "vitest";
import type { Control } from "../src/controls.ts";
import { CFO, contract, rolesFile, shippedWith, STARTING_ROLES } from "./helpers.ts";
import {
  refusalAtStart,
  ruleCall,
  ruleWorldOnTuesday,
  shippedRule,
  startWith,
  textOf,
  version9,
  type RuleWorld,
} from "./rule-world.ts";

/** cfo_100 drafts the next version of high-value-payment, with these fields changed. */
function draft(w: RuleWorld, fields: Record<string, unknown>) {
  return ruleCall(w, CFO, "rule.draft", { draft: { ...textOf(version9()), ...fields } });
}

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]) {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

describe("C8: a rule asks only for an approval that someone can give (step 29's README, decision D13)", () => {
  it("Step 29: cfo_100's draft that asks for an approval by ap_supervisor is refused VALIDATION_FAILED: ap_supervisor does not hold payment:approve, so nobody could give it", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await draft(w, {
      effect: { require_approval: { role: "ap_supervisor", quorum: 1 } },
    });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect("message" in answer && answer.message).toContain(
      "its effect asks for an approval by ap_supervisor, which does not hold payment.create's approve_permission, payment:approve",
    );
  });

  // Found by step 29's review, finding M2: a role needs two permissions to approve, and the check
  // asked for one. A role holding only the one checked passed every test.
  it.each([
    [
      "only proposal:approve",
      ["proposal:approve"],
      "which does not hold payment.create's approve_permission, payment:approve",
    ],
    [
      "only payment:approve",
      ["payment:approve"],
      "which does not hold proposal:approve, the permission to call proposal.approve",
    ],
  ])(
    "Step 29: a draft that asks for an approval by a role holding %s is refused: nobody holding it could give the approval",
    async (_what, permissions, problem) => {
      const roles = rolesFile({ ...STARTING_ROLES, approver_clerk: permissions });
      const w = await ruleWorldOnTuesday(undefined, undefined, undefined, undefined, undefined, roles);
      const answer = await draft(w, {
        effect: { require_approval: { role: "approver_clerk", quorum: 1 } },
      });
      expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
      expect("message" in answer && answer.message).toContain(
        `its effect asks for an approval by approver_clerk, ${problem}`,
      );
    },
  );

  it("Step 29: start-up refuses a rule that asks for an approval by a role that cannot give it", async () => {
    const byClerk = {
      ...shippedRule(),
      effect: { require_approval: { role: "ap_clerk", quorum: 1 } },
    };
    expect(await refusalAtStart(() => startWith(controlsOf(byClerk)))).toContain(
      "org_456's control high-value-payment: its effect asks for an approval by ap_clerk, which does not hold payment.create's approve_permission, payment:approve",
    );
  });

  it("Step 29: start-up refuses the shipped rule when payment.create's contract names no approve_permission: no one could approve the payments it stops", async () => {
    const { authorization: _named, ...rest } = contract("payment.create");
    const without = { ...rest, authorization: { permission: "payment:create" } };
    expect(
      await refusalAtStart(() => startWith(controlsOf(shippedRule()), shippedWith(without))),
    ).toContain(
      "org_456's control high-value-payment: its effect asks for an approval of payment.create, which names no approve_permission, so no one could give it",
    );
  });

  it("DSOR-APR-08: no rule governs proposal.approve: a draft of one is refused, as DSoR's own, so an approval never waits for an approval", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await draft(w, { operation: "proposal.approve" });
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect("message" in answer && answer.message).toContain(
      "governs proposal.approve, which is DSoR's own: it must answer at once",
    );
  });
});
