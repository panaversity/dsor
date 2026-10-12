// Each company's rules, in DSoR's own store, and line ⑩, which reads them at every call (step 28's
// README, claims C1, C2, C7, and C8, decisions D2 to D6). The store keeps every version of a rule
// with its status. A change to the store applies to the next call. Each change leaves its record.
// Start-up checks every version in the store, and runs the tests of the active ones.
import { describe, expect, it } from "vitest";
import { readControls, type ControlsSource } from "../src/controls.ts";
import { fingerprintOf } from "../src/ksor.ts";
import { checkRules, memoryControls, NO_CONTROLS, type RuleBy } from "../src/rulebook.ts";
import { OUR_EXTENSIONS, SUPERVISOR } from "./helpers.ts";
import {
  activeIn,
  heard,
  refusalAtStart,
  ruleWorldOnTuesday,
  shippedRule,
  startWith,
  text789,
  version9,
} from "./rule-world.ts";

/** A controls file with this text. */
function controlsOf(data: unknown): ControlsSource {
  return { file: "controls.json", text: JSON.stringify(data) };
}

/** cfo_100, on Tuesday, in their own words, on a call of their own. */
function byCfo(words: string): RuleBy {
  const correlation = { request_id: `req_${words.length}`, principal_id: "cfo_100" };
  return { person: "cfo_100", as_of: "2026-10-06T15:10:00.000Z", words, correlation };
}

describe("C1: the store keeps each version of a rule with its status (step 28's README, decisions D2 and D3)", () => {
  it("Step 28: a store in memory starts from controls.json: org_456's high-value-payment, version 8, active, and no rule of org_789", async () => {
    const store = memoryControls(readControls());
    const versions = await store.versions("org_456");
    expect(versions.map((v) => [v.id, v.version, v.status])).toStrictEqual([
      ["high-value-payment", 8, "active"],
    ]);
    expect(versions[0]).toStrictEqual(shippedRule());
    expect(await store.versions("org_789")).toStrictEqual([]);
    expect((await store.inForce("org_456", "payment.create")).map((v) => v.version)).toStrictEqual([
      8,
    ]);
    expect(await store.inForce("org_456", "payment.cancel")).toStrictEqual([]);
    expect(store.companies()).toStrictEqual(["org_456", "org_789"]);
  });

  it("Step 28: a version moves only from the status it is in; switched on, it names its reviewer and when it took effect", async () => {
    const store = memoryControls(readControls());
    await store.add("org_456", version9(), byCfo("version 9 lowers the line to 20,000"));
    expect(
      await store.move("org_456", "high-value-payment", 9, "active", "suspended", byCfo("x")),
    ).toBe(false);
    expect(
      await store.move("org_456", "high-value-payment", 9, "draft", "active", byCfo("switch on")),
    ).toBe(true);
    const [v9] = await store.versions("org_456", "high-value-payment").then((v) => v.slice(1));
    expect(v9).toMatchObject({
      version: 9,
      status: "active",
      reviewed_by: "cfo_100",
      effective_from: "2026-10-06T15:10:00.000Z",
    });
    expect(await store.hold("org_456", "high-value-payment")).toHaveLength(2);
    expect(await store.versions("org_456", "no-such-rule")).toStrictEqual([]);
  });

  // Found by step 28's own break: with a retired version allowed back, every command test passed,
  // because each command checks the status first. The store draws the moves too, as the database's
  // trigger does (step 28's README, decision D13). Changed by step 28's review, finding L14: this
  // said the database's policies drew them, and they did not.
  it("Step 28: the store makes only the moves of a version's life: a retired version never moves, a draft is never suspended, and nothing moves back to draft", async () => {
    const store = memoryControls(readControls());
    await store.add("org_456", version9(), byCfo("version 9"));
    expect(
      await store.move("org_456", "high-value-payment", 9, "draft", "suspended", byCfo("x")),
    ).toBe(false);
    expect(
      await store.move("org_456", "high-value-payment", 8, "active", "draft", byCfo("x")),
    ).toBe(false);
    expect(
      await store.move("org_456", "high-value-payment", 8, "active", "retired", byCfo("x")),
    ).toBe(true);
    expect(
      await store.move("org_456", "high-value-payment", 8, "retired", "active", byCfo("x")),
    ).toBe(false);
    expect(
      await store.move("org_456", "high-value-payment", 8, "retired", "suspended", byCfo("x")),
    ).toBe(false);
    const versions = await store.versions("org_456", "high-value-payment");
    expect(versions.map((v) => [v.version, v.status])).toStrictEqual([
      [8, "retired"],
      [9, "draft"],
    ]);
  });

  it("Step 28: the store gives back copies: a caller that changes what it read changes nothing in the store", async () => {
    const store = memoryControls(readControls());
    const [read] = await store.inForce("org_456", "payment.create");
    read!.condition = "false";
    read!.status = "retired";
    expect((await store.versions("org_456"))[0]).toStrictEqual(shippedRule());
    const added = version9();
    await store.add("org_456", added, byCfo("version 9"));
    added.condition = "false";
    expect((await store.versions("org_456"))[1]?.condition).toBe(version9().condition);
  });

  // Found by step 28's sweep, R03, R04, and R15: with each of these gone, every test passed. The
  // database refuses the first two, so a store in memory must too.
  it("Step 28: a store in memory adds only a draft, and each version once, and its reads give copies", async () => {
    const store = memoryControls(readControls());
    await expect(
      store.add("org_456", { ...version9(), status: "active" }, byCfo("x")),
    ).rejects.toThrow("a version is added as a draft");
    await store.add("org_456", version9(), byCfo("version 9"));
    await expect(store.add("org_456", version9(), byCfo("again"))).rejects.toThrow(
      "version 9 of high-value-payment is kept already",
    );
    const [read] = await store.versions("org_456");
    read!.status = "retired";
    expect((await store.versions("org_456"))[0]?.status).toBe("active");
  });

  it("Step 28: no store, NO_CONTROLS: it holds no rule, and keeps none (step 28's README, decision D18)", async () => {
    expect(await NO_CONTROLS.inForce("org_456", "payment.create")).toStrictEqual([]);
    expect(await NO_CONTROLS.versions("org_456")).toStrictEqual([]);
    await expect(NO_CONTROLS.add("org_456", version9(), byCfo("x"))).rejects.toThrow(
      "this world keeps no rules",
    );
  });
});

describe("C7: each change leaves its record (step 28's README, decision D14)", () => {
  // Not titled DSOR-AUD-01: the tutorial's records do not yet pass audit-record.schema.json, as step
  // 22's tests note. Changed by step 28's review, finding L18.
  it("Step 28: a draft and a move each leave a control_change record: who, the person's words, the call, the rule's address, its version, and the status it left", async () => {
    const store = memoryControls(readControls());
    await store.add("org_456", version9(), byCfo("version 9 lowers the line to 20,000"));
    await store.move("org_456", "high-value-payment", 8, "active", "retired", byCfo("replaced"));
    const identity = {
      mode: "direct",
      subject: "cfo_100",
      actor_chain: [],
      subject_authority: { source: "token", as_of: "2026-10-06T15:10:00.000Z" },
    };
    expect(await store.records()).toStrictEqual([
      {
        kind: "control_change",
        result: "draft",
        reason: "version 9 lowers the line to 20,000",
        correlation: byCfo("version 9 lowers the line to 20,000").correlation,
        tenant: "org_456",
        resources: ["dsor://org_456/rule/high-value-payment"],
        identity,
        extensions: { [OUR_EXTENSIONS]: { version: 9 } },
      },
      {
        kind: "control_change",
        result: "retired",
        reason: "replaced",
        correlation: byCfo("replaced").correlation,
        tenant: "org_456",
        resources: ["dsor://org_456/rule/high-value-payment"],
        identity,
        extensions: { [OUR_EXTENSIONS]: { version: 8, from: "active" } },
      },
    ]);
    // A move that finds the version in another status writes nothing.
    await store.move("org_456", "high-value-payment", 8, "active", "retired", byCfo("again"));
    expect(await store.records()).toHaveLength(2);
  });
});

describe("C2: line ⑩ reads the store at every call (step 28's README, decision D5)", () => {
  it("Step 28: a version switched on in the store applies to the next call, and a suspended one stops at once: INV-1012, 22,750.00 USD, is paid under version 8, INV-2007, 21,000.00 USD, waits for the CFO under version 9, and INV-1004, 27,300.00 USD, is paid once version 9 is suspended", async () => {
    const w = await ruleWorldOnTuesday();
    expect(heard(await w.draft("INV-1012"))).toBe("COMMITTED");
    await w.rules.add("org_456", version9(), byCfo("version 9 lowers the line to 20,000"));
    await w.rules.move("org_456", "high-value-payment", 8, "active", "retired", byCfo("replaced"));
    await w.rules.move("org_456", "high-value-payment", 9, "draft", "active", byCfo("on"));
    expect(heard(await w.draft("INV-2007"))).toBe("PENDING_APPROVAL");
    await w.rules.move("org_456", "high-value-payment", 9, "active", "suspended", byCfo("off"));
    expect(heard(await w.draft("INV-1004"))).toBe("COMMITTED");
  });

  it("DSOR-CTL-04: the decision's record names the version that answered, read from the store at the call: version 9, and no longer 8", async () => {
    const w = await ruleWorldOnTuesday();
    await w.rules.add("org_456", version9(), byCfo("version 9"));
    await w.rules.move("org_456", "high-value-payment", 8, "active", "retired", byCfo("replaced"));
    await w.rules.move("org_456", "high-value-payment", 9, "draft", "active", byCfo("on"));
    const answer = await w.draft("INV-2007");
    const record = (await w.log.records()).find(
      (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
    );
    expect(record?.controls?.map((c) => [c.id, c.version, c.outcome])).toStrictEqual([
      ["high-value-payment", 9, "REQUIRE_APPROVAL"],
    ]);
  });

  it("Step 28: a person's own call reads the store too: user_123's draft of INV-2007 waits for the CFO under version 9", async () => {
    const w = await ruleWorldOnTuesday();
    await w.rules.add("org_456", version9(), byCfo("version 9"));
    await w.rules.move("org_456", "high-value-payment", 8, "active", "retired", byCfo("replaced"));
    await w.rules.move("org_456", "high-value-payment", 9, "draft", "active", byCfo("on"));
    expect(heard(await w.draft("INV-2007", SUPERVISOR))).toBe("PENDING_APPROVAL");
  });
});

describe("C8: start-up checks every version in the store (step 28's README, decision D6)", () => {
  it("Step 28: the shipped file starts, and its active version is org_456's high-value-payment, version 8", async () => {
    const registry = await startWith(readControls());
    expect((await activeIn(registry, "org_456")).map((c) => [c.id, c.version])).toStrictEqual([
      ["high-value-payment", 8],
    ]);
  });

  it("Step 28: two live versions of one rule stop start-up: version 8 active, and version 9 suspended beside it (step 28's README, decision D4)", async () => {
    const v9 = { ...shippedRule(), version: 9, status: "suspended" };
    expect(
      await refusalAtStart(() => startWith(controlsOf({ org_456: [shippedRule(), v9] }))),
    ).toContain(
      "controls.json: org_456 has two live versions of high-value-payment: one at a time may be active, stale, or suspended",
    );
  });

  // Found by step 28's sweep, G01: with org_456's policy used for every company, every test passed,
  // because no test started with a rule of org_789's own.
  it("Step 28: start-up counts each company's tests in its own control currency: org_789's rule, in EUR, passes its tests, which pin USD per one EUR", async () => {
    const rule = { ...text789(), id: "board-above-10000", version: 1, status: "draft" };
    const file = controlsOf({ org_456: [shippedRule()], org_789: [rule] });
    const registry = await startWith(file);
    expect(registry.checkRule("org_789", rule, true)).toStrictEqual([]);
  });

  // Found by step 28's review, finding L10: with start-up checking the first company only, every
  // test passed.
  it("Step 28: start-up checks every company: a good rule of org_456 and an active rule of org_789 whose test fails stop it, and the problem names org_789", async () => {
    const [first] = text789()["tests"] as object[];
    const broken = {
      ...text789(),
      id: "board-above-10000",
      version: 1,
      status: "active",
      reviewed_by: "admin_700",
      effective_from: "2026-09-01T00:00:00Z",
      tests: [{ ...first, expect: "REQUIRE_APPROVAL" }],
    };
    const file = controlsOf({ org_456: [shippedRule()], org_789: [broken] });
    expect(await refusalAtStart(() => startWith(file))).toContain(
      "controls.json: org_789's control board-above-10000 v1 fails its test 1: expects REQUIRE_APPROVAL, gives ALLOW",
    );
  });

  it("Step 28: one version written twice stops start-up", async () => {
    expect(
      await refusalAtStart(() =>
        startWith(controlsOf({ org_456: [shippedRule(), shippedRule()] })),
      ),
    ).toContain("controls.json: org_456 has version 8 of high-value-payment twice");
  });

  it("Step 28: a version in_review stops start-up, because the owner's switch-on is the review (step 28's README, decision D17)", async () => {
    const waiting = { ...shippedRule(), id: "waiting-rule", status: "in_review" };
    expect(
      await refusalAtStart(() => startWith(controlsOf({ org_456: [shippedRule(), waiting] }))),
    ).toContain(
      "controls.json: org_456's control waiting-rule has the status in_review, which this step does not build",
    );
  });

  it("Step 28: a retired version keeps its rule text and runs no test: start-up takes a retired version 7 whose tests fail", async () => {
    const v7 = { ...shippedRule(), version: 7, status: "retired" };
    v7.tests = [{ ...v7.tests[0]!, expect: "DENY" }];
    const registry = await startWith(controlsOf({ org_456: [v7, shippedRule()] }));
    expect((await registry.controls.versions("org_456")).map((c) => c.version)).toStrictEqual([
      7, 8,
    ]);
  });
});

// The version of the payment-approval policy in force once the finance team publishes version 5,
// and once they publish version 6, as the sweep hands it to the store (step 28b's README, D5).
const V5 = {
  version: 5,
  content_hash: fingerprintOf("Payments above 20,000 USD or equivalent require CFO approval."),
};
const V6 = {
  version: 6,
  content_hash: fingerprintOf("Payments above 15,000 USD or equivalent require CFO approval."),
};
// The words of the sweep's notice to the owner, which the sweep writes and the store keeps.
const NOTICE =
  "version 8 of rule high-value-payment cites version 4 of the policy, and KSoR has version 5 in force";

/** dsor-scheduler's sweep, at this time, on a call of its own. */
function bySweep(as_of = "2026-10-07T00:00:00.000Z"): RuleBy {
  const correlation = { request_id: `req_sweep_${as_of}`, principal_id: "dsor-scheduler" };
  return { person: "dsor-scheduler", as_of, words: "its policy moved in KSoR", correlation };
}

/** A second rule of org_456 on payment.create, active, so a store holds two rules in force. */
function secondRule() {
  return { ...shippedRule(), id: "second-rule", version: 1 };
}

describe("C2: the store keeps DSoR's mark on a stale version (step 28b's README, decisions D5 and D6)", () => {
  it("DSOR-CTL-03a: the sweep's mark moves version 8 from active to stale_authority, keeps the time and the policy's version in force, writes its record, and leaves cfo_100, its owner, a notice", async () => {
    const store = memoryControls(readControls());
    const by = bySweep();
    expect(await store.mark("org_456", "high-value-payment", 8, undefined, V5, by, NOTICE)).toBe(
      true,
    );
    expect((await store.versions("org_456")).map((v) => [v.version, v.status])).toStrictEqual([
      [8, "stale_authority"],
    ]);
    const [v8] = await store.inForce("org_456", "payment.create");
    expect(v8?.stale).toStrictEqual({ since: "2026-10-07T00:00:00.000Z", in_force: V5 });
    expect((await store.records()).at(-1)).toStrictEqual({
      kind: "control_change",
      result: "stale_authority",
      reason: "its policy moved in KSoR",
      correlation: by.correlation,
      tenant: "org_456",
      resources: ["dsor://org_456/rule/high-value-payment"],
      identity: {
        mode: "direct",
        subject: "dsor-scheduler",
        actor_chain: [],
        subject_authority: { source: "token", as_of: by.as_of },
      },
      extensions: { [OUR_EXTENSIONS]: { version: 8, from: "active", in_force: V5 } },
    });
    expect(await store.notices()).toStrictEqual([
      {
        tenant_id: "org_456",
        to: "cfo_100",
        rule: "high-value-payment",
        version: 8,
        words: NOTICE,
        at: by.as_of,
        correlation: by.correlation,
      },
    ]);
  });

  it("Step 28b: a stale version whose policy moved again keeps the time of its first mark, and gets the newer version in force, a record, and a new notice (decision D5)", async () => {
    const store = memoryControls(readControls());
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    const first = { since: "2026-10-07T00:00:00.000Z", in_force: V5 };
    const later = bySweep("2026-10-08T00:00:00.000Z");
    expect(await store.mark("org_456", "high-value-payment", 8, first, V6, later, "again")).toBe(
      true,
    );
    const [v8] = await store.inForce("org_456", "payment.create");
    expect(v8?.stale).toStrictEqual({ since: "2026-10-07T00:00:00.000Z", in_force: V6 });
    const marks = (await store.records()).filter((r) => r.result === "stale_authority");
    expect(marks.map((r) => r.extensions[OUR_EXTENSIONS])).toStrictEqual([
      { version: 8, from: "active", in_force: V5 },
      { version: 8, from: "stale_authority", in_force: V6 },
    ]);
    expect((await store.notices()).map((n) => [n.to, n.words, n.at])).toStrictEqual([
      ["cfo_100", NOTICE, "2026-10-07T00:00:00.000Z"],
      ["cfo_100", "again", "2026-10-08T00:00:00.000Z"],
    ]);
  });

  it("Step 28b: a mark changes nothing when the version is not as the sweep saw it: a draft, a suspended version, a version marked meanwhile, a mark that names another version in force, or no change at all", async () => {
    const store = memoryControls(readControls());
    await store.add("org_456", version9(), byCfo("version 9"));
    const by = bySweep();
    const mark = (version: number, seen: Parameters<typeof store.mark>[3], to = V5) =>
      store.mark("org_456", "high-value-payment", version, seen, to, by, NOTICE);
    expect(await mark(9, undefined)).toBe(false);
    expect(await mark(8, undefined)).toBe(true);
    const records = (await store.records()).length;
    // Marked meanwhile: the sweep saw it active.
    expect(await mark(8, undefined)).toBe(false);
    // The sweep saw another version in force than the one the mark keeps.
    expect(await mark(8, { since: by.as_of, in_force: V6 }, V6)).toBe(false);
    // The same version in force: nothing moved.
    expect(await mark(8, { since: by.as_of, in_force: V5 }, V5)).toBe(false);
    await store.move("org_456", "high-value-payment", 8, "stale_authority", "suspended", by);
    expect(await mark(8, undefined)).toBe(false);
    expect(await mark(8, { since: by.as_of, in_force: V5 }, V6)).toBe(false);
    expect((await store.records()).length).toBe(records + 1);
    expect(await store.notices()).toHaveLength(1);
  });

  it("Step 28b: only the sweep's mark makes a version stale: a move to stale_authority is refused, and a stale version never moves back to active (decision D6)", async () => {
    const store = memoryControls(readControls());
    const by = bySweep();
    expect(
      await store.move("org_456", "high-value-payment", 8, "active", "stale_authority", by),
    ).toBe(false);
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, by, NOTICE);
    expect(
      await store.move(
        "org_456",
        "high-value-payment",
        8,
        "stale_authority",
        "active",
        byCfo("on"),
      ),
    ).toBe(false);
    expect(
      await store.switchOn("org_456", "high-value-payment", 8, "stale_authority", undefined, by),
    ).toBe(false);
    expect((await store.versions("org_456")).map((v) => v.status)).toStrictEqual([
      "stale_authority",
    ]);
  });

  it("Step 28b: a stale version is in force: line ⑩'s read gives the active versions and the stale ones, each stale one with its mark, and its owner's suspension or retirement takes it out (decision D7)", async () => {
    const file = { org_456: [shippedRule(), secondRule()], org_789: [] };
    const store = memoryControls({ file: "controls.json", text: JSON.stringify(file) });
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    const read = await store.inForce("org_456", "payment.create");
    expect(read.map((v) => [v.id, v.status, v.stale?.in_force.version])).toStrictEqual([
      ["high-value-payment", "stale_authority", 5],
      ["second-rule", "active", undefined],
    ]);
    expect("stale" in read[1]!).toBe(false);
    // Every operation, when none is named: what the sweep reads.
    expect((await store.inForce("org_456")).map((v) => v.id)).toStrictEqual([
      "high-value-payment",
      "second-rule",
    ]);
    const off = byCfo("off while version 9 is written");
    expect(
      await store.move("org_456", "high-value-payment", 8, "stale_authority", "suspended", off),
    ).toBe(true);
    expect((await store.inForce("org_456", "payment.create")).map((v) => v.id)).toStrictEqual([
      "second-rule",
    ]);
    expect(await store.move("org_456", "second-rule", 1, "active", "retired", byCfo("gone"))).toBe(
      true,
    );
    expect(await store.inForce("org_456", "payment.create")).toStrictEqual([]);
  });

  it("Step 28b: a stale version is its rule's live version: switching on a new version retires it, with its record (decision D6)", async () => {
    const store = memoryControls(readControls());
    await store.add("org_456", version9(), byCfo("version 9 cites version 5"));
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    const live = { version: 8, from: "stale_authority" as const };
    expect(
      await store.switchOn("org_456", "high-value-payment", 9, "draft", live, byCfo("on")),
    ).toBe(true);
    expect((await store.versions("org_456")).map((v) => [v.version, v.status])).toStrictEqual([
      [8, "retired"],
      [9, "active"],
    ]);
    const retired = (await store.records()).find((r) => r.result === "retired");
    expect(retired?.extensions[OUR_EXTENSIONS]).toStrictEqual({
      version: 8,
      from: "stale_authority",
    });
    // Retired, version 8 is in force no more, and its mark goes with it.
    expect((await store.inForce("org_456", "payment.create")).map((v) => v.version)).toStrictEqual([
      9,
    ]);
  });

  it("Step 28b: the mark is DSoR's, beside the rule's text: the versions read at line ⑨ and under the rule's lock carry none, and the text still passes control.schema.json and its tests", async () => {
    const registry = await startWith(readControls());
    const store = memoryControls(readControls());
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    const [kept] = await store.versions("org_456");
    expect(kept).toStrictEqual({ ...shippedRule(), status: "stale_authority" });
    expect(await store.hold("org_456", "high-value-payment")).toStrictEqual([kept]);
    expect(registry.checkRule("org_456", kept, true)).toStrictEqual([]);
  });

  // Found by step 28b's own break of the store: with the mark kept on any version in force, every
  // test passed, because no test switched a stale version on again after its owner suspended it.
  it("Step 28b: a version that was stale, then suspended, then switched on again, is in force with no mark: the old mark is history, and line ⑩ reads the version as active", async () => {
    const store = memoryControls(readControls());
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    const off = byCfo("off");
    await store.move("org_456", "high-value-payment", 8, "stale_authority", "suspended", off);
    await store.move("org_456", "high-value-payment", 8, "suspended", "active", byCfo("on"));
    const [v8] = await store.inForce("org_456", "payment.create");
    expect(v8?.status).toBe("active");
    expect("stale" in v8!).toBe(false);
  });

  it("Step 28b: the store gives back copies of its marks and notices", async () => {
    const store = memoryControls(readControls());
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    const [read] = await store.inForce("org_456", "payment.create");
    read!.stale!.in_force.version = 99;
    const [notice] = await store.notices();
    notice!.to = "admin_100";
    expect((await store.inForce("org_456", "payment.create"))[0]?.stale?.in_force).toStrictEqual(
      V5,
    );
    expect((await store.notices())[0]?.to).toBe("cfo_100");
  });

  it("Step 28b: no store, NO_CONTROLS: nothing is in force, and nothing can be marked", async () => {
    expect(await NO_CONTROLS.inForce("org_456")).toStrictEqual([]);
    await expect(
      NO_CONTROLS.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE),
    ).rejects.toThrow("this world keeps no rules");
  });
});

describe("C9: start-up and a stale version (step 28b's README, decision D14)", () => {
  it("Step 28b: start-up accepts a stale version in the store, and runs its tests as an active one's: a stale version 8 whose test 1 fails stops it", async () => {
    const { checkRule, moneyPolicies } = await startWith(readControls());
    const good = memoryControls(readControls());
    await good.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    expect(
      await checkRules({ controls: good, checkRule, moneyPolicies }, ["org_456"]),
    ).toStrictEqual([]);
    const v8 = shippedRule();
    v8.tests = [{ ...v8.tests[0]!, expect: "REQUIRE_APPROVAL" }];
    const broken = memoryControls(controlsOf({ org_456: [v8] }));
    await broken.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    expect(
      await checkRules({ controls: broken, checkRule, moneyPolicies }, ["org_456"]),
    ).toStrictEqual([
      "controls.json: org_456's control high-value-payment v8 fails its test 1: expects REQUIRE_APPROVAL, gives ALLOW",
    ]);
  });

  it("Step 28b: a stale version and an active one of one rule are two live versions, and stop start-up", async () => {
    const { checkRule, moneyPolicies } = await startWith(readControls());
    const store = memoryControls(readControls());
    await store.add("org_456", version9(), byCfo("version 9"));
    await store.mark("org_456", "high-value-payment", 8, undefined, V5, bySweep(), NOTICE);
    // A move, not a switch-on, so version 8 is not retired first.
    await store.move("org_456", "high-value-payment", 9, "draft", "active", byCfo("on"));
    expect(await checkRules({ controls: store, checkRule, moneyPolicies }, ["org_456"])).toContain(
      "controls.json: org_456 has two live versions of high-value-payment: one at a time may be active, stale, or suspended",
    );
  });

  it("Step 28b: a controls file never gives a version stale_authority: only DSoR's sweep marks a rule stale, with the time and the version in force", async () => {
    const stale = { ...shippedRule(), status: "stale_authority" };
    expect(await refusalAtStart(() => startWith(controlsOf({ org_456: [stale] })))).toContain(
      "controls.json: org_456's control high-value-payment has the status stale_authority, which only DSoR's sweep gives",
    );
  });
});
