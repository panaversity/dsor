// rule.draft: a person writes a new version of a company's rule (step 28's README, claims C3, C6,
// and C7, decisions D8, D9, and D11). Line ⑨ checks the draft as start-up checks a version, its
// owner a person of the company. DSoR gives it the next number, the status draft, and the person
// who wrote it. A draft changes nothing at line ⑩. An agent drafts nothing, whatever its slip.
import { describe, expect, it } from "vitest";
import type { Control } from "../src/controls.ts";
import {
  ADMIN,
  CFO,
  DEL_101,
  FIRM_IN_456,
  inputsWith,
  keyed,
  OUR_EXTENSIONS,
  shippedInputs,
  SUPERVISOR,
} from "./helpers.ts";
import {
  heard,
  refusalAtStart,
  RULE,
  ruleCall,
  ruleWorldOnTuesday,
  shippedRule,
  startWith,
  textOf,
  version9,
  type RuleWorld,
} from "./rule-world.ts";

/** Someone drafts a version with this text. */
function draft(w: RuleWorld, who = CFO, text: Record<string, unknown> = textOf(version9())) {
  return ruleCall(w, who, "rule.draft", { draft: text });
}

/** The versions the store keeps of the story's rule: number, status, and who wrote it. */
async function kept(w: RuleWorld): Promise<unknown[]> {
  const versions = await w.rules.versions("org_456", "high-value-payment");
  return versions.map((v) => [v.version, v.status, v.compiled_by]);
}

describe("C3: rule.draft writes the next version, a draft (step 28's README, decision D11)", () => {
  it("DSOR-CTL-02a: cfo_100 drafts version 9 of high-value-payment: DSoR gives it the next number, the status draft, and cfo_100 as the person who wrote it, and version 8 still answers line ⑩", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await draft(w)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", id: "high-value-payment", version: 9, status: "draft" },
      semantics: "atomic",
    });
    expect(await kept(w)).toStrictEqual([
      [8, "active", "policy-compiler-fte"],
      [9, "draft", "cfo_100"],
    ]);
    const [, v9] = await w.rules.versions("org_456", "high-value-payment");
    expect(v9).toStrictEqual({ ...version9(), compiled_by: "cfo_100" });
    // INV-2007, 21,000.00 USD, is below version 8's line, and version 9 is only a draft.
    expect(heard(await w.draft("INV-2007"))).toBe("COMMITTED");
  });

  it("Step 28: a new rule starts at version 1, and each draft of one rule takes the next number", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_456/rule/board-above-45000";
    const text = { ...textOf(version9()), owner: "cfo_100" };
    const first = await ruleCall(w, CFO, "rule.draft", { draft: text }, rule);
    const second = await ruleCall(w, ADMIN, "rule.draft", { draft: text }, rule);
    expect(first).toMatchObject({ data: { id: "board-above-45000", version: 1 } });
    expect(second).toMatchObject({ data: { id: "board-above-45000", version: 2 } });
  });

  it("Step 28: admin_100 drafts a version 10 that says false and names admin_100 its owner: a draft changes nothing, so the store keeps it, and INV-1008 still waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday();
    await draft(w);
    const tests = [{ expect: "ALLOW" }];
    const text = { ...textOf(version9()), condition: "false", owner: "admin_100", tests };
    expect(await draft(w, ADMIN, text)).toMatchObject({ data: { version: 10, status: "draft" } });
    expect(heard(await w.draft("INV-1008"))).toBe("PENDING_APPROVAL");
  });

  it("Step 28: a dry run of a draft checks it and keeps nothing: VALIDATED, and the store keeps version 8 alone", async () => {
    const w = await ruleWorldOnTuesday();
    const input = { rule: RULE, draft: textOf(version9()), reason: "a dry run" };
    expect(await w.ask({ ...CFO, mode: "validate_only" }, "rule.draft", input)).toMatchObject({
      outcome: "VALIDATED",
      decision: "ALLOW",
    });
    expect(await kept(w)).toStrictEqual([[8, "active", "policy-compiler-fte"]]);
  });
});

describe("C3: line ⑨ checks a draft as start-up checks a version (step 28's README, decision D11)", () => {
  const owner = (who: string) => `its owner ${who} is not a person who works in org_456`;
  it.each([
    [
      "a condition that is not CEL",
      { condition: "state.invoice.open_amount >" },
      "its condition is not CEL",
    ],
    [
      "an effect this step does not build",
      { effect: { require_step_up: { acr: "mfa" } } },
      "has the effect require_step_up, which this step does not build",
    ],
    [
      "an operation that no rule may govern",
      { operation: "invoice.get" },
      "governs invoice.get, which is a query: a query waits for nobody",
    ],
    ["no tests", { tests: [] }, "/tests must NOT have fewer than 1 items"],
    // Found by step 28's review, finding H2: loops inside loops stalled every company.
    [
      "a condition that loops over a list",
      { condition: "[1, 2, 3].all(a, [1, 2, 3].all(b, a + b > 0))" },
      "its condition loops with all, which this step refuses: a loop's time has no bound",
    ],
    ["an agent as its owner", { owner: "accounts-payable-fte" }, owner("accounts-payable-fte")],
    ["a person of org_789 as its owner", { owner: "user_700" }, owner("user_700")],
    ["an owner nobody knows", { owner: "user_900" }, owner("user_900")],
  ])(
    "DSOR-CTL-01a: a draft with %s is refused VALIDATION_FAILED, before any work, and nothing is kept",
    async (_what, fields, problem) => {
      const w = await ruleWorldOnTuesday();
      const answer = await draft(w, CFO, { ...textOf(version9()), ...fields });
      expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
      expect("message" in answer && answer.message).toContain(problem);
      expect(await kept(w)).toStrictEqual([[8, "active", "policy-compiler-fte"]]);
    },
  );

  it.each(["id", "version", "status", "compiled_by", "reviewed_by", "effective_from"])(
    "Step 28: line ⑥ refuses a draft that sets %s, which DSoR sets itself",
    async (field) => {
      const w = await ruleWorldOnTuesday();
      const answer = await draft(w, CFO, { ...textOf(version9()), [field]: "x" });
      expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(await kept(w)).toStrictEqual([[8, "active", "policy-compiler-fte"]]);
    },
  );

  // Found by step 28's own break of line ⑥: a draft that named a time it took effect counted as a
  // version switched on before, and so could make its own owner the rule's owner of record.
  it("Step 28: a draft keeps only the fields of a rule's text: past a line ⑥ that let them through, a reviewer, a start time, a status, and a number never reach the store", async () => {
    const shipped = shippedInputs.find((s) => s.file === "RuleDraftRequest.schema.json")!;
    const schema = JSON.parse(shipped.text) as { properties: { draft: Record<string, unknown> } };
    delete schema.properties.draft["propertyNames"];
    const loose = inputsWith("RuleDraftRequest.schema.json", JSON.stringify(schema));
    const w = await ruleWorldOnTuesday(undefined, [], loose);
    const forged = {
      ...textOf(version9()),
      owner: "admin_100",
      reviewed_by: "cfo_100",
      effective_from: "2026-09-01T00:00:00Z",
      status: "active",
      version: 99,
    };
    expect(await draft(w, ADMIN, forged)).toMatchObject({ data: { version: 9, status: "draft" } });
    const [, v9] = await w.rules.versions("org_456", "high-value-payment");
    expect(v9).toStrictEqual({ ...version9(), owner: "admin_100", compiled_by: "admin_100" });
  });

  it("Step 28: a draft whose text holds more than 16,384 characters as JSON is refused", async () => {
    const w = await ruleWorldOnTuesday();
    const many = Array.from({ length: 40 }, (_, i) => ({
      state: {
        invoice: { open_amount: { value: `${i}.00`, currency: "USD" } },
        note: "x".repeat(400),
      },
      expect: "ALLOW",
    }));
    const answer = await draft(w, CFO, { ...textOf(version9()), tests: many });
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"rule.draft": a draft\'s text may hold at most 16384 characters as JSON',
    });
  });
});

describe("C6: only a person who holds rule:draft drafts (step 28's README, decisions D8 and D9)", () => {
  it("Step 28: user_123, who holds no rule:draft, is refused at line ⑤", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await draft(w, SUPERVISOR)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await kept(w)).toStrictEqual([[8, "active", "policy-compiler-fte"]]);
  });

  it.each(["execute", "propose_only", "validate_only"])(
    "DSOR-CTL-02b: in %s mode, an agent drafts nothing, though cfo_100, who holds rule:draft, signed it a slip that lists it",
    async (mode) => {
      const slip = { ...DEL_101, delegator: "cfo_100", permissions: ["rule:draft", "rule:manage"] };
      const w = await ruleWorldOnTuesday(undefined, [slip]);
      const envelope =
        mode === "validate_only" ? { ...FIRM_IN_456, mode } : { ...keyed(FIRM_IN_456), mode };
      const input = { rule: RULE, draft: textOf(version9()), reason: "the agent's own idea" };
      const answer = await w.ask(envelope, "rule.draft", input);
      expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
      expect("message" in answer && answer.message).toContain("for people only");
      expect(await kept(w)).toStrictEqual([[8, "active", "policy-compiler-fte"]]);
    },
  );
});

describe("C7: a draft leaves its record (step 28's README, decision D14)", () => {
  it("DSOR-AUD-01: cfo_100's draft leaves a control_change record that names cfo_100, the reason, the rule, and version 9; the call's own record says ALLOW and names the rule", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await draft(w);
    const [change] = await w.rules.records();
    expect(change).toMatchObject({
      kind: "control_change",
      result: "draft",
      reason: "rule.draft by a test",
      resources: [RULE],
      identity: { mode: "direct", subject: "cfo_100" },
      extensions: { [OUR_EXTENSIONS]: { version: 9 } },
    });
    expect(change?.correlation.request_id).toBe(answer.correlation.request_id);
    const decision = (await w.log.records()).find(
      (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
    );
    expect(decision).toMatchObject({ authorization: "ALLOW", resources: [RULE] });
  });
});

// Found by step 28's sweep, L05 and L23: with compiled_by naming the owner, or the record naming
// cfo_100 whoever acted, every test passed, because cfo_100 wrote and owned each draft they read.
describe("C3, C7: the person who drafts is not always the owner (step 28's README, decisions D11 and D14)", () => {
  it("Step 28: admin_100 drafts a version that names cfo_100 its owner: compiled_by is admin_100, and the record names admin_100", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await draft(w, ADMIN)).toMatchObject({ data: { version: 9, status: "draft" } });
    const [, v9] = await w.rules.versions("org_456", "high-value-payment");
    expect(v9).toMatchObject({ owner: "cfo_100", compiled_by: "admin_100" });
    const [change] = await w.rules.records();
    expect(change?.identity.subject).toBe("admin_100");
  });
});

describe("C8: start-up checks a version's owner and its id (step 28's README, decisions D6, D7, and D11)", () => {
  /** A controls file with org_456's rule, these fields changed. */
  function withRule(fields: Partial<Control> & Record<string, unknown>) {
    const data = { org_456: [{ ...shippedRule(), ...fields }], org_789: [] };
    return { file: "controls.json", text: JSON.stringify(data) };
  }

  it("DSOR-CTL-01a: start-up refuses a version whose owner is not a person who works in its company", async () => {
    expect(
      await refusalAtStart(() => startWith(withRule({ owner: "accounts-payable-fte" }))),
    ).toContain(
      "controls.json: org_456's control high-value-payment: its owner accounts-payable-fte is not a person who works in org_456",
    );
  });

  it("Step 28: start-up refuses a draft that names a reviewer or a time it took effect: a draft was never switched on", async () => {
    const forged = { status: "draft", version: 9, effective_from: "2026-09-01T00:00:00Z" };
    const data = { org_456: [shippedRule(), { ...shippedRule(), ...forged }], org_789: [] };
    const file = { file: "controls.json", text: JSON.stringify(data) };
    expect(await refusalAtStart(() => startWith(file))).toContain(
      "controls.json: org_456's control high-value-payment is a draft, so it names no reviewer and no time it took effect",
    );
  });

  it("Step 28: start-up refuses a version whose id cannot end a rule's address", async () => {
    expect(await refusalAtStart(() => startWith(withRule({ id: "high value payment" })))).toContain(
      "controls.json: org_456's control high value payment: its id cannot end a rule's address, dsor://org_456/rule/<id>",
    );
  });
});
