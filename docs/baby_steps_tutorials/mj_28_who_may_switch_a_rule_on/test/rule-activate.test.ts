// rule.activate: the rule's owner switches a version on (step 28's README, claims C2, C4, C6, and
// C7, decisions D10, D12, D15, and D16). Only the version's own owner, who is the rule's owner of
// record too, in person. The switch-on runs the version's tests first (DSOR-CTL-02c). It retires
// the live version, and the next call meets the new one. An agent switches nothing on.
import { describe, expect, it } from "vitest";
import type { ControlStore } from "../src/rulebook.ts";
import {
  ADMIN,
  CFO,
  contract,
  DEL_101,
  FIRM_IN_456,
  keyed,
  OUR_EXTENSIONS,
  shippedWith,
  SUPERVISOR,
} from "./helpers.ts";
import {
  heard,
  RULE,
  ruleCall,
  ruleWorldOnTuesday,
  textOf,
  version9,
  type RuleWorld,
} from "./rule-world.ts";

/** Someone drafts a version with this text, and DSoR answers with its number. */
async function drafted(w: RuleWorld, who = CFO, text = textOf(version9())): Promise<number> {
  const answer = await ruleCall(w, who, "rule.draft", { draft: text });
  if (!("data" in answer)) throw new Error(`the draft was refused: ${heard(answer)}`);
  return (answer.data as { version: number }).version;
}

/** Someone switches this version of the story's rule on. */
function activate(w: RuleWorld, version: number, who = CFO) {
  return ruleCall(w, who, "rule.activate", { version });
}

/** Each version the store keeps of the story's rule, with its status. */
async function statuses(w: RuleWorld): Promise<unknown[]> {
  const versions = await w.rules.versions("org_456", "high-value-payment");
  return versions.map((v) => [v.version, v.status]);
}

// Step 27's quick rule, version 11: it compares the number and forgets the currency.
const QUICK =
  'double(state.invoice.open_amount.value) > 20000.0 && state.invoice.open_amount.currency == "USD"';

describe("C4: the owner switches a version on (step 28's README, decisions D10 and D12)", () => {
  it("DSOR-CTL-02a: cfo_100, the rule's owner, switches version 9 on: it is active, names cfo_100 its reviewer and DSoR's time, version 8 is retired, and the agent's next draft, INV-2007's 21,000.00 USD, waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday();
    expect(heard(await w.draft("INV-1012"))).toBe("COMMITTED");
    const v9 = await drafted(w);
    expect(await activate(w, v9)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", id: "high-value-payment", version: 9, status: "active" },
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "retired"],
      [9, "active"],
    ]);
    const [, active] = await w.rules.versions("org_456", "high-value-payment");
    expect(active).toMatchObject({ reviewed_by: "cfo_100", effective_from: expect.any(String) });
    expect(heard(await w.draft("INV-2007"))).toBe("PENDING_APPROVAL");
  });

  it("DSOR-CTL-02a: admin_100 may not switch on version 10, the condition false, which names admin_100 its owner: the rule's owner of record is cfo_100, so INV-1008 still waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday();
    await drafted(w);
    const text = { ...textOf(version9()), condition: "false", owner: "admin_100" };
    const v10 = await drafted(w, ADMIN, { ...text, tests: [{ expect: "ALLOW" }] });
    expect(await activate(w, v10, ADMIN)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"rule.activate": admin_100 may not change rule "high-value-payment": only its owner may, in person',
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "active"],
      [9, "draft"],
      [10, "draft"],
    ]);
    expect(heard(await w.draft("INV-1008"))).toBe("PENDING_APPROVAL");
  });

  it("DSOR-CTL-02a: cfo_100, the owner of record, may not switch on version 10 either: it names admin_100, and a rule never passes to a new owner in this step", async () => {
    const w = await ruleWorldOnTuesday();
    await drafted(w);
    const text = { ...textOf(version9()), owner: "admin_100" };
    const v10 = await drafted(w, ADMIN, text);
    expect(await activate(w, v10)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"rule.activate": version 10 of rule high-value-payment names another owner, and only its own owner may switch it on',
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "active"],
      [9, "draft"],
      [10, "draft"],
    ]);
  });

  it("DSOR-CTL-02a: a rule that was never switched on has no owner of record, so each version's own owner decides: admin_100 switches on version 1 of a new rule, and cfo_100 may not", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_456/rule/board-above-45000";
    const text = { ...textOf(version9()), owner: "admin_100" };
    expect(await ruleCall(w, CFO, "rule.draft", { draft: text }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(heard(await ruleCall(w, CFO, "rule.activate", { version: 1 }, rule))).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { id: "board-above-45000", version: 1, status: "active" },
    });
  });
});

describe("C4: a switch-on runs the version's tests first (DSOR-CTL-02c)", () => {
  it("DSOR-CTL-02c: a version with the quick rule fails its test 3, 50,000,000.00 PKR: the switch-on is refused VALIDATION_FAILED, before any work, nothing changes, and rupees still wait for the CFO under version 8", async () => {
    const w = await ruleWorldOnTuesday();
    const quick = await drafted(w, CFO, { ...textOf(version9()), condition: QUICK });
    const answer = await activate(w, quick);
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect("message" in answer && answer.message).toContain(
      "org_456's control high-value-payment v9 fails its test 3: expects REQUIRE_APPROVAL, gives ALLOW",
    );
    expect(await statuses(w)).toStrictEqual([
      [8, "active"],
      [9, "draft"],
    ]);
    expect(heard(await w.draft("INV-2004"))).toBe("PENDING_APPROVAL");
  });

  it("DSOR-CTL-02c: a dry run of a switch-on runs the tests too, and changes nothing: VALIDATED for version 9, refused for the quick rule", async () => {
    const w = await ruleWorldOnTuesday();
    const v9 = await drafted(w);
    const v10 = await drafted(w, CFO, { ...textOf(version9()), condition: QUICK });
    const dry = (version: number) =>
      w.ask({ ...CFO, mode: "validate_only" }, "rule.activate", {
        rule: RULE,
        version,
        reason: "a dry run",
      });
    expect(await dry(v9)).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    expect(await dry(v10)).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await statuses(w)).toStrictEqual([
      [8, "active"],
      [9, "draft"],
      [10, "draft"],
    ]);
  });
});

describe("C4: the answers of a switch-on that cannot happen (step 28's README, decision D16)", () => {
  it("Step 28: the owner hears RESOURCE_NOT_FOUND for a version that is not there, and CONFLICT for a version active already or retired; a person who may not change the rule hears AUTHORIZATION_DENIED for each, and for a rule that is not there", async () => {
    const w = await ruleWorldOnTuesday();
    const v9 = await drafted(w);
    await activate(w, v9);
    expect(await activate(w, 12)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: "no version 12 of rule high-value-payment",
    });
    expect(await activate(w, 9)).toMatchObject({
      code: "CONFLICT",
      message: "version 9 of rule high-value-payment is active, so it cannot be active",
    });
    expect(await activate(w, 8)).toMatchObject({
      code: "CONFLICT",
      message: "version 8 of rule high-value-payment is retired, so it cannot be active",
    });
    for (const version of [12, 9, 8]) {
      expect(heard(await activate(w, version, ADMIN))).toBe("AUTHORIZATION_DENIED");
    }
    const nowhere = "dsor://org_456/rule/no-such-rule";
    expect(heard(await ruleCall(w, CFO, "rule.activate", { version: 1 }, nowhere))).toBe(
      "AUTHORIZATION_DENIED",
    );
  });
});

describe("C6: an agent switches nothing on (DSOR-CTL-02b; step 28's README, decision D9)", () => {
  // firm-ap-fte, under a slip that cfo_100 signed, which lists rule:manage.
  const slip = { ...DEL_101, delegator: "cfo_100", permissions: ["rule:draft", "rule:manage"] };

  it.each(["execute", "propose_only", "validate_only"])(
    "DSOR-CTL-02b: in %s mode, line ⑤ refuses an agent that asks to switch a version on, though cfo_100 signed it a slip that lists rule:manage",
    async (mode) => {
      const w = await ruleWorldOnTuesday(undefined, [slip]);
      const v9 = await drafted(w);
      const envelope =
        mode === "validate_only" ? { ...FIRM_IN_456, mode } : { ...keyed(FIRM_IN_456), mode };
      const answer = await w.ask(envelope, "rule.activate", {
        rule: RULE,
        version: v9,
        reason: "the agent's own idea",
      });
      expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
      expect("message" in answer && answer.message).toContain("for people only");
      expect(await statuses(w)).toStrictEqual([
        [8, "active"],
        [9, "draft"],
      ]);
    },
  );

  it("DSOR-CTL-02b: past line ⑤ too, an agent is never the owner: with rule.activate open to agents, the agent under cfo_100's slip passes line ⑤, and line ⑨ refuses it", async () => {
    const open = { ...contract("rule.activate"), extensions: {} };
    const w = await ruleWorldOnTuesday(undefined, [slip], undefined, shippedWith(open));
    const v9 = await drafted(w);
    const answer = await ruleCall(w, FIRM_IN_456, "rule.activate", { version: v9 });
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"rule.activate": firm-ap-fte may not change rule "high-value-payment": only its owner may, in person',
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "active"],
      [9, "draft"],
    ]);
  });

  // Found by step 28's own break: with "in person" gone, every other test passed. An agent can name
  // itself a version's owner only by a hand edit, which the draft's check and start-up refuse.
  it("DSOR-CTL-02b: a person decides, never an agent: a version that a hand edit gave firm-ap-fte as its owner, of a rule never switched on, is not switched on by firm-ap-fte, even with rule.activate open to agents", async () => {
    const open = { ...contract("rule.activate"), extensions: {} };
    const w = await ruleWorldOnTuesday(undefined, [slip], undefined, shippedWith(open));
    const planted = { ...version9(), id: "agent-made", version: 1, owner: "firm-ap-fte" };
    await w.rules.add("org_456", planted, byOther());
    const rule = "dsor://org_456/rule/agent-made";
    const answer = await ruleCall(w, FIRM_IN_456, "rule.activate", { version: 1 }, rule);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"rule.activate": firm-ap-fte may not change rule "agent-made": only its owner may, in person',
    });
    const [kept] = await w.rules.versions("org_456", "agent-made");
    expect(kept?.status).toBe("draft");
  });

  it("Step 28: user_123, who holds no rule:manage, is refused at line ⑤", async () => {
    const w = await ruleWorldOnTuesday();
    const v9 = await drafted(w);
    const answer = await activate(w, v9, SUPERVISOR);
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect("message" in answer && answer.message).toContain("rule:manage");
  });
});

describe("C7: a switch-on and its records (step 28's README, decisions D14 and D15)", () => {
  it("DSOR-AUD-01: a switch-on leaves two control_change records, version 8 retired and version 9 switched on, each naming cfo_100, the reason, and the status it left", async () => {
    const w = await ruleWorldOnTuesday();
    const v9 = await drafted(w);
    const answer = await activate(w, v9);
    const records = (await w.rules.records()).filter(
      (r) => r.correlation.request_id === answer.correlation.request_id,
    );
    expect(records.map((r) => [r.result, r.extensions[OUR_EXTENSIONS]])).toStrictEqual([
      ["retired", { version: 8, from: "active" }],
      ["active", { version: 9, from: "draft" }],
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        reason: "rule.activate by a test",
        resources: [RULE],
        identity: { mode: "direct", subject: "cfo_100" },
      });
    }
    expect(answer).toMatchObject({ data: { retired: 8 } });
  });

  it("Step 28: the change checks again under the rule's lock: a version switched on by another call after line ⑨ looked is refused CONFLICT, and nothing moves twice (step 28's README, decision D15)", async () => {
    const w = await ruleWorldOnTuesday();
    const v9 = await drafted(w);
    // A store whose look at line ⑨ is a moment old: it still sees version 9 as a draft, while the
    // change, under the lock, sees that another call switched it on meanwhile.
    const store = w.rules;
    const before = await store.versions("org_456", "high-value-payment");
    await store.move("org_456", "high-value-payment", 8, "active", "retired", byOther());
    await store.move("org_456", "high-value-payment", v9, "draft", "active", byOther());
    const late: ControlStore = { ...store, versions: async () => structuredClone(before) };
    (w.registry as { controls: ControlStore }).controls = late;
    const answer = await activate(w, v9);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: "version 9 of rule high-value-payment is active, so it cannot be active",
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "retired"],
      [9, "active"],
    ]);
    expect((await store.records()).filter((r) => r.result === "active")).toHaveLength(1);
  });
});

/** cfo_100, on another call. */
function byOther() {
  const correlation = { request_id: "req_other", principal_id: "cfo_100" };
  return { person: "cfo_100", as_of: new Date().toISOString(), words: "another call", correlation };
}
