// rule.suspend and rule.retire: the rule's owner switches the active version off, or ends a
// version for good (step 28's README, claims C2, C5, C6, and C7, decisions D10, D13, and D16).
// Only the owner of record, in person. A suspended version can be switched on again; a retired
// one never comes back. Each move applies to the next call, and leaves its record.
import { describe, expect, it } from "vitest";
import type { ControlStore } from "../src/rulebook.ts";
import { ADMIN, CFO, DEL_101, FIRM_IN_456, keyed, OUR_EXTENSIONS } from "./helpers.ts";
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

/** Someone moves this version of the story's rule, with one of the three move commands. */
function move(
  w: RuleWorld,
  name: "rule.activate" | "rule.suspend" | "rule.retire",
  version: number,
  who = CFO,
) {
  return ruleCall(w, who, name, { version });
}

/** Each version the store keeps of the story's rule, with its status. */
async function statuses(w: RuleWorld): Promise<unknown[]> {
  const versions = await w.rules.versions("org_456", "high-value-payment");
  return versions.map((v) => [v.version, v.status]);
}

/** A world in which cfo_100 drafted version 9 and switched it on. */
async function withVersion9On(): Promise<RuleWorld> {
  const w = await ruleWorldOnTuesday();
  const v9 = await drafted(w);
  await move(w, "rule.activate", v9);
  return w;
}

describe("C5: the owner suspends the active version (step 28's README, decision D13)", () => {
  it("DSOR-CTL-02a: cfo_100 suspends version 9: no rule is in force, so the agent's draft of INV-1008, 31,400.00 USD, is paid without the CFO, by the owner's choice; switched on again, the next draft, INV-1004's 27,300.00 USD, waits for the CFO", async () => {
    const w = await withVersion9On();
    expect(await move(w, "rule.suspend", 9)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", id: "high-value-payment", version: 9, status: "suspended" },
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "retired"],
      [9, "suspended"],
    ]);
    expect(heard(await w.draft("INV-1008"))).toBe("COMMITTED");
    expect(await move(w, "rule.activate", 9)).toMatchObject({
      data: { version: 9, status: "active" },
    });
    expect(heard(await w.draft("INV-1004"))).toBe("PENDING_APPROVAL");
  });

  it("DSOR-CTL-02a: admin_100, a tenant administrator who holds rule:manage, may not suspend version 8: only its owner may", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await move(w, "rule.suspend", 8, ADMIN)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"rule.suspend": admin_100 may not change rule "high-value-payment": only its owner may, in person',
    });
    expect(await statuses(w)).toStrictEqual([[8, "active"]]);
    expect(heard(await w.draft("INV-1008"))).toBe("PENDING_APPROVAL");
  });

  // Found by step 28's own break: with line ⑨'s look gone, the change's own check still refused,
  // after DSoR had said yes. A refusal of who belongs before any work (step 25's README, D7).
  it("Step 28: the refusal comes at line ⑨, before any work: admin_100's proposal to suspend version 8 ends DENIED, not FAILED", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await move(w, "rule.suspend", 8, ADMIN);
    const id = String("proposal" in answer ? answer.proposal : "")
      .split("/")
      .at(-1)!;
    expect((await w.proposals.get("org_456", id))?.state).toBe("DENIED");
  });

  it("Step 28: only an active version is suspended: a draft, a suspended version, and a retired one each hear CONFLICT", async () => {
    const w = await withVersion9On();
    const v10 = await drafted(w);
    expect(await move(w, "rule.suspend", v10)).toMatchObject({
      code: "CONFLICT",
      message: "version 10 of rule high-value-payment is draft, so it cannot be suspended",
    });
    expect(heard(await move(w, "rule.suspend", 8))).toBe("CONFLICT");
    await move(w, "rule.suspend", 9);
    expect(heard(await move(w, "rule.suspend", 9))).toBe("CONFLICT");
  });

  it("Step 28: switching on a new version while another is suspended retires the suspended one: one live version for each rule (step 28's README, decision D4)", async () => {
    const w = await withVersion9On();
    expect(heard(await move(w, "rule.suspend", 9))).toBe("COMMITTED");
    const v10 = await drafted(w);
    expect(await move(w, "rule.activate", v10)).toMatchObject({
      data: { version: 10, status: "active", retired: 9 },
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "retired"],
      [9, "retired"],
      [10, "active"],
    ]);
  });
});

describe("C5: the owner retires a version for good (step 28's README, decision D13)", () => {
  it("DSOR-CTL-02a: cfo_100 retires version 8, the active one: no rule is in force, and a retired version never comes back, neither switched on nor suspended", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await move(w, "rule.retire", 8)).toMatchObject({
      data: { version: 8, status: "retired" },
    });
    expect(heard(await w.draft("INV-1008"))).toBe("COMMITTED");
    expect(await move(w, "rule.activate", 8)).toMatchObject({
      code: "CONFLICT",
      message: "version 8 of rule high-value-payment is retired, so it cannot be active",
    });
    expect(heard(await move(w, "rule.suspend", 8))).toBe("CONFLICT");
    expect(heard(await move(w, "rule.retire", 8))).toBe("CONFLICT");
  });

  it("DSOR-CTL-02a: the owner of record retires a draft that another person wrote: cfo_100 retires admin_100's version 10, and admin_100 may not", async () => {
    const w = await ruleWorldOnTuesday();
    await drafted(w);
    const text = { ...textOf(version9()), condition: "false", owner: "admin_100" };
    const v10 = await drafted(w, ADMIN, { ...text, tests: [{ expect: "ALLOW" }] });
    expect(heard(await move(w, "rule.retire", v10, ADMIN))).toBe("AUTHORIZATION_DENIED");
    expect(await move(w, "rule.retire", v10)).toMatchObject({
      data: { version: 10, status: "retired" },
    });
    expect(await statuses(w)).toStrictEqual([
      [8, "active"],
      [9, "draft"],
      [10, "retired"],
    ]);
  });

  it("Step 28: a rule never switched on: each draft's own owner retires it, and nobody else", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_456/rule/board-above-45000";
    const text = { ...textOf(version9()), owner: "admin_100" };
    await ruleCall(w, CFO, "rule.draft", { draft: text }, rule);
    expect(heard(await ruleCall(w, CFO, "rule.retire", { version: 1 }, rule))).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(await ruleCall(w, ADMIN, "rule.retire", { version: 1 }, rule)).toMatchObject({
      data: { id: "board-above-45000", version: 1, status: "retired" },
    });
  });
});

describe("C6: an agent suspends nothing, and retires nothing (DSOR-CTL-02b; step 28's README, decision D9)", () => {
  const slip = { ...DEL_101, delegator: "cfo_100", permissions: ["rule:draft", "rule:manage"] };
  it.each([
    ["rule.suspend", "execute"],
    ["rule.suspend", "propose_only"],
    ["rule.suspend", "validate_only"],
    ["rule.retire", "execute"],
    ["rule.retire", "propose_only"],
    ["rule.retire", "validate_only"],
  ])(
    "DSOR-CTL-02a: %s in %s mode: line ⑤ refuses an agent, though cfo_100 signed it a slip that lists rule:manage, and version 8 stays active",
    async (name, mode) => {
      const w = await ruleWorldOnTuesday(undefined, [slip]);
      const envelope =
        mode === "validate_only" ? { ...FIRM_IN_456, mode } : { ...keyed(FIRM_IN_456), mode };
      const answer = await w.ask(envelope, name, { rule: RULE, version: 8, reason: "off" });
      expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
      expect("message" in answer && answer.message).toContain("for people only");
      expect(await statuses(w)).toStrictEqual([[8, "active"]]);
    },
  );
});

// Found by step 28's sweep, L21: with the suspension's change trusting line ⑨'s look, every test
// passed. The store still refused the move, with less to say.
describe("C7: a suspension checks again under the rule's lock (step 28's README, decision D15)", () => {
  it("Step 28: a version suspended by another call after line ⑨ looked is refused CONFLICT by the change's own check, which says why", async () => {
    const w = await withVersion9On();
    const before = await w.rules.versions("org_456", "high-value-payment");
    const late: ControlStore = { ...w.rules, versions: async () => structuredClone(before) };
    const other = {
      person: "cfo_100",
      as_of: new Date().toISOString(),
      words: "another call",
      correlation: { request_id: "req_other", principal_id: "cfo_100" },
    };
    await w.rules.move("org_456", "high-value-payment", 9, "active", "suspended", other);
    (w.registry as { controls: ControlStore }).controls = late;
    expect(await move(w, "rule.suspend", 9)).toMatchObject({
      code: "CONFLICT",
      message: "version 9 of rule high-value-payment is suspended, so it cannot be suspended",
    });
  });
});

describe("C7: a suspension and a retirement leave their records (step 28's README, decision D14)", () => {
  // Not titled DSOR-AUD-01: the tutorial's records do not yet pass audit-record.schema.json, as step
  // 22's tests note. Changed by step 28's review, finding L18.
  it("Step 28: each move leaves one control_change record that names cfo_100, the reason, the rule, its version, and the status it left", async () => {
    const w = await withVersion9On();
    const suspended = await move(w, "rule.suspend", 9);
    const retired = await move(w, "rule.retire", 9);
    const of = async (request_id: string) =>
      (await w.rules.records())
        .filter((r) => r.correlation.request_id === request_id)
        .map((r) => [r.result, r.identity.subject, r.reason, r.extensions[OUR_EXTENSIONS]]);
    expect(await of(suspended.correlation.request_id)).toStrictEqual([
      ["suspended", "cfo_100", "rule.suspend by a test", { version: 9, from: "active" }],
    ]);
    expect(await of(retired.correlation.request_id)).toStrictEqual([
      ["retired", "cfo_100", "rule.retire by a test", { version: 9, from: "suspended" }],
    ]);
  });
});
