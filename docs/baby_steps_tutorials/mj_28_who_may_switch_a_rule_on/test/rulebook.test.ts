// Each company's rules, in DSoR's own store, and line ⑩, which reads them at every call (step 28's
// README, claims C1, C2, C7, and C8, decisions D2 to D6). The store keeps every version of a rule
// with its status. A change to the store applies to the next call. Each change leaves its record.
// Start-up checks every version in the store, and runs the tests of the active ones.
import { describe, expect, it } from "vitest";
import { readControls, type ControlsSource } from "../src/controls.ts";
import { memoryControls, NO_CONTROLS, type RuleBy } from "../src/rulebook.ts";
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
    expect((await store.active("org_456", "payment.create")).map((v) => v.version)).toStrictEqual([
      8,
    ]);
    expect(await store.active("org_456", "payment.cancel")).toStrictEqual([]);
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
    const [read] = await store.active("org_456", "payment.create");
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
    expect(await NO_CONTROLS.active("org_456", "payment.create")).toStrictEqual([]);
    expect(await NO_CONTROLS.versions("org_456")).toStrictEqual([]);
    await expect(NO_CONTROLS.add("org_456", version9(), byCfo("x"))).rejects.toThrow(
      "this world keeps no rules",
    );
  });
});

describe("C7: each change leaves its record (step 28's README, decision D14)", () => {
  it("DSOR-AUD-01: a draft and a move each leave a control_change record: who, the person's words, the call, the rule's address, its version, and the status it left", async () => {
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
      "controls.json: org_456 has two live versions of high-value-payment: one at a time may be active or suspended",
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
