// The sweep, rule.check_authority: DSoR asks the company's KSoR which version of each policy is
// in force, and marks each rule whose policy moved stale_authority, with a record and a notice to
// its owner (step 28b's README, claims C2 and C3, decisions D2 to D6). dsor-scheduler calls it; a
// deployment's timer would call it at least once a day, which §44's 24 hours ask.
import { describe, expect, it } from "vitest";
import type { Control, ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { fakeKsor, fingerprintOf } from "../src/ksor.ts";
import type { RequestEnvelope } from "../src/request.ts";
import type { ControlStore, InForce } from "../src/rulebook.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  keyed,
  OUR_EXTENSIONS,
  POLICY,
  storyKsors,
  SUPERVISOR,
  V5_TEXT,
} from "./helpers.ts";
import {
  ADMIN_700,
  heard,
  ruleCall,
  ruleWorldOnTuesday,
  shippedRule,
  text789,
  version9,
  textOf,
  type RuleWorld,
} from "./rule-world.ts";

// dsor-scheduler, DSoR's own system login, in both companies (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const SCHEDULER_789: RequestEnvelope = { token: "tok_5c4e", tenant: "org_789" };
const ORG_456 = "dsor://org_456/tenant/org_456";
const V5 = { version: 5, content_hash: fingerprintOf(V5_TEXT) };

/** dsor-scheduler sweeps a company, org_456 unless a test names another, with a fresh key. */
function sweep(w: RuleWorld, who = SCHEDULER, company = ORG_456): Promise<Answer> {
  return w.ask(keyed(who), "rule.check_authority", { company });
}

/** org_456's KSoR in this world. */
function ksorOf(w: RuleWorld) {
  return w.ksors.get("org_456")!;
}

/** Each version of the story's rule, with its status. */
async function statuses(w: RuleWorld): Promise<unknown[]> {
  return (await w.rules.versions("org_456", "high-value-payment")).map((v) => [
    v.version,
    v.status,
  ]);
}

/** Version 8 as line ⑩ reads it, with its mark when it is stale. */
async function inForce8(w: RuleWorld): Promise<InForce | undefined> {
  const read = await w.rules.inForce("org_456", "payment.create");
  return read.find((v) => v.id === "high-value-payment" && v.version === 8);
}

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]): ControlsSource {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

describe("C2: the sweep finds a policy that moved, and marks the rule (step 28b's README, decisions D4 and D5)", () => {
  it("DSOR-CTL-03a: dsor-scheduler sweeps org_456 while KSoR has version 4 in force: it asks about one policy, and marks nothing", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await sweep(w)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", asked: 1, unanswered: 0, marked: 0 },
    });
    expect(await statuses(w)).toStrictEqual([[8, "active"]]);
    expect(await w.rules.notices()).toStrictEqual([]);
  });

  it("DSOR-CTL-03a: once the finance team publishes version 5, the next sweep marks version 8 stale_authority with version 5 in force, records it in dsor-scheduler's name, and leaves cfo_100 a notice that names both versions", async () => {
    const w = await ruleWorldOnTuesday();
    ksorOf(w).publish(POLICY, V5_TEXT);
    const answer = await sweep(w);
    expect(answer).toMatchObject({ data: { asked: 1, unanswered: 0, marked: 1 } });
    expect(await statuses(w)).toStrictEqual([[8, "stale_authority"]]);
    expect((await inForce8(w))?.stale?.in_force).toStrictEqual(V5);
    const marks = (await w.rules.records()).filter((r) => r.result === "stale_authority");
    expect(
      marks.map((r) => [r.identity.subject, r.reason, r.extensions[OUR_EXTENSIONS]]),
    ).toStrictEqual([
      [
        "dsor-scheduler",
        "the policy it cites moved in KSoR",
        { version: 8, from: "active", in_force: V5 },
      ],
    ]);
    const notices = await w.rules.notices();
    expect(notices.map((n) => [n.to, n.rule, n.version])).toStrictEqual([
      ["cfo_100", "high-value-payment", 8],
    ]);
    expect(notices[0]?.words).toBe(
      'Version 8 of rule high-value-payment cites version 4 of "ksor://org_456/finance/payment-approval-policy", and KSoR now has version 5 in force. DSoR marked it stale_authority. It still applies: for its grace of P7D as its on_stale says, require_approval, and after that, on a high-risk operation, it asks a person at least. Draft a version that cites version 5, and switch it on.',
    );
    expect(notices[0]?.correlation.request_id).toBe(answer.correlation.request_id);
  });

  it("Step 28b: a second sweep marks nothing new, and tells nobody twice", async () => {
    const w = await ruleWorldOnTuesday();
    ksorOf(w).publish(POLICY, V5_TEXT);
    await sweep(w);
    expect(await sweep(w)).toMatchObject({ data: { asked: 1, unanswered: 0, marked: 0 } });
    expect(await w.rules.notices()).toHaveLength(1);
  });

  it("Step 28b: when the policy moves again, the next sweep gives stale version 8 the newer version in force, keeps the time of its first mark, and tells cfo_100 again (decision D5)", async () => {
    const w = await ruleWorldOnTuesday();
    ksorOf(w).publish(POLICY, V5_TEXT);
    await sweep(w);
    const first = (await inForce8(w))?.stale;
    const v6 = ksorOf(w).publish(POLICY, "Payments above 15,000 USD need the CFO.");
    expect(await sweep(w)).toMatchObject({ data: { marked: 1 } });
    expect((await inForce8(w))?.stale).toStrictEqual({
      since: first?.since,
      in_force: { version: 6, content_hash: v6.content_hash },
    });
    const words = (await w.rules.notices()).map((n) => n.words);
    expect(words).toHaveLength(2);
    expect(words[1]).toBe(
      'Version 8 of rule high-value-payment is stale_authority, and its policy moved again: KSoR now has version 6 of "ksor://org_456/finance/payment-approval-policy" in force. Draft a version that cites version 6, and switch it on.',
    );
  });

  // Found by step 28b's own break of the sweep: with the mark's version in force ignored, every
  // test passed, because the store refuses a mark that changes nothing.
  it("Step 28b: when KSoR goes back to the version a stale rule cites, the rule stays stale: the sweep records version 4 in force and tells cfo_100 to draft a version that cites it (decision D6)", async () => {
    const w = await ruleWorldOnTuesday();
    ksorOf(w).publish(POLICY, V5_TEXT);
    await sweep(w);
    const v4 = {
      version: 4,
      text: "Payments above 25,000 USD.",
      content_hash: "sha256:9f2c1e7ab4d0",
    };
    w.ksors.set("org_456", fakeKsor("org_456", { [POLICY]: [v4] }));
    expect(await sweep(w)).toMatchObject({ data: { asked: 1, unanswered: 0, marked: 1 } });
    expect(await statuses(w)).toStrictEqual([[8, "stale_authority"]]);
    expect((await inForce8(w))?.stale?.in_force).toStrictEqual({
      version: 4,
      content_hash: "sha256:9f2c1e7ab4d0",
    });
    expect((await w.rules.notices()).at(-1)?.words).toBe(
      'Version 8 of rule high-value-payment is stale_authority, and its policy moved again: KSoR now has version 4 of "ksor://org_456/finance/payment-approval-policy" in force. Draft a version that cites version 4, and switch it on.',
    );
  });

  it("Step 28b: the same number with another text is a change too: KSoR's version 4 with a fingerprint that version 8 does not cite marks it stale (decision D3)", async () => {
    const changed = { version: 4, text: "Payments above 30,000 USD.", content_hash: "sha256:00ff" };
    const ksors = storyKsors();
    ksors.set("org_456", fakeKsor("org_456", { [POLICY]: [changed] }));
    const w = await ruleWorldOnTuesday(
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      ksors,
    );
    expect(await sweep(w)).toMatchObject({ data: { marked: 1 } });
    expect((await inForce8(w))?.stale?.in_force).toStrictEqual({
      version: 4,
      content_hash: "sha256:00ff",
    });
  });

  it("Step 28b: an older version in force is a change too: a KSoR that has only version 3 marks version 8 stale, with version 3 in force (decision D3)", async () => {
    const v3 = { version: 3, text: "Payments above 30,000 USD.", content_hash: "sha256:0303" };
    const ksors = storyKsors();
    ksors.set("org_456", fakeKsor("org_456", { [POLICY]: [v3] }));
    const w = await ruleWorldOnTuesday(
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      ksors,
    );
    expect(await sweep(w)).toMatchObject({ data: { marked: 1 } });
    expect((await inForce8(w))?.stale?.in_force).toStrictEqual({
      version: 3,
      content_hash: "sha256:0303",
    });
  });

  it("Step 28b: KSoR is asked about each policy once, however many rules cite it", async () => {
    const second = { ...shippedRule(), id: "second-rule", version: 1 };
    const w = await ruleWorldOnTuesday(controlsOf(shippedRule(), second));
    ksorOf(w).publish(POLICY, V5_TEXT);
    const before = ksorOf(w).asked();
    expect(await sweep(w)).toMatchObject({ data: { asked: 1, marked: 2 } });
    expect(ksorOf(w).asked() - before).toBe(1);
    expect((await w.rules.notices()).map((n) => n.rule)).toStrictEqual([
      "high-value-payment",
      "second-rule",
    ]);
  });
});

describe("C2: the sweep marks nothing it cannot confirm (step 28b's README, decisions D2 and D3)", () => {
  it("Step 28b: with KSoR off, the sweep marks nothing, and counts the policy unanswered", async () => {
    const w = await ruleWorldOnTuesday();
    ksorOf(w).publish(POLICY, V5_TEXT);
    ksorOf(w).turn("off");
    expect(await sweep(w)).toMatchObject({ data: { asked: 1, unanswered: 1, marked: 0 } });
    expect(await statuses(w)).toStrictEqual([[8, "active"]]);
  });

  it("Step 28b: a policy KSoR does not list is no answer: version 8 stays active, and the sweep counts the policy unanswered", async () => {
    const ksors = storyKsors();
    ksors.set("org_456", fakeKsor("org_456", {}));
    const w = await ruleWorldOnTuesday(
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      ksors,
    );
    expect(await sweep(w)).toMatchObject({ data: { asked: 1, unanswered: 1, marked: 0 } });
    expect(await statuses(w)).toStrictEqual([[8, "active"]]);
  });

  // Found by step 28b's own break of the sweep: with the system unchecked, every test passed,
  // because no rule cited another system and a URI.
  it("Step 28b: a rule that cites another system is never asked about: KSoR is asked about its own policies only", async () => {
    const elsewhere = {
      ...shippedRule(),
      id: "elsewhere-rule",
      version: 1,
      authority: {
        system: "sharepoint",
        uri: "sharepoint://org_456/policies/payments",
        version: 4,
        content_hash: "sha256:9f2c1e7ab4d0",
      },
    };
    const w = await ruleWorldOnTuesday(controlsOf(elsewhere));
    expect(await sweep(w)).toMatchObject({ data: { asked: 0, unanswered: 0, marked: 0 } });
    expect(ksorOf(w).asked()).toBe(0);
  });

  it("Step 28b: a rule that cites local has no policy to ask about: org_789's own rule, active, is never asked about, and never marked", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_789/rule/board-above-10000";
    await ruleCall(w, ADMIN_700, "rule.draft", { draft: text789() }, rule);
    await ruleCall(w, ADMIN_700, "rule.activate", { version: 1 }, rule);
    expect(await sweep(w, SCHEDULER_789, "dsor://org_789/tenant/org_789")).toMatchObject({
      data: { tenant_id: "org_789", asked: 0, unanswered: 0, marked: 0 },
    });
    expect(w.ksors.get("org_789")!.asked()).toBe(0);
  });
});

describe("C3: who may sweep, and what the sweep never marks (step 28b's README, decisions D4 and D6)", () => {
  it("Step 28b: the sweep never marks a suspended version or a draft, though both cite version 4", async () => {
    const w = await ruleWorldOnTuesday();
    await ruleCall(w, CFO, "rule.draft", { draft: textOf(version9()) });
    await ruleCall(w, CFO, "rule.suspend", { version: 8 });
    ksorOf(w).publish(POLICY, V5_TEXT);
    expect(await sweep(w)).toMatchObject({ data: { asked: 0, unanswered: 0, marked: 0 } });
    expect(await statuses(w)).toStrictEqual([
      [8, "suspended"],
      [9, "draft"],
    ]);
  });

  it.each([
    ["cfo_100", CFO],
    ["admin_100", ADMIN],
    ["user_123", SUPERVISOR],
    ["accounts-payable-fte", AGENT],
  ])(
    "Step 28b: line ⑤ refuses %s: the sweep is for DSoR's own system logins only, and version 8 stays active",
    async (who, envelope) => {
      const w = await ruleWorldOnTuesday();
      ksorOf(w).publish(POLICY, V5_TEXT);
      expect(await sweep(w, envelope)).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"rule.check_authority" is for DSoR's own system logins only, and ${who} is not one`,
      });
      expect(await statuses(w)).toStrictEqual([[8, "active"]]);
    },
  );

  it("Step 28b: dsor-scheduler names its own company: from org_456, a company address that names org_789 is no company here", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await sweep(w, SCHEDULER, "dsor://org_456/tenant/org_789")).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no company "org_789" here',
    });
  });

  it("Step 28b: the sweep marks under the rule's lock, and only what it saw: version 8, retired between the sweep's read and its mark, stays retired, and nobody is told", async () => {
    const w = await ruleWorldOnTuesday(undefined, [], undefined, undefined, (rules) => {
      const late: ControlStore = {
        ...rules,
        // The sweep's own read, on every operation, made before cfo_100's retirement landed.
        inForce: async (tenant, operation) => {
          const read = await rules.inForce(tenant, operation);
          if (operation !== undefined) return read;
          const by = {
            person: "cfo_100",
            as_of: new Date().toISOString(),
            words: "retired meanwhile",
            correlation: { request_id: "req_meanwhile", principal_id: "cfo_100" },
          };
          await rules.move("org_456", "high-value-payment", 8, "active", "retired", by);
          return read;
        },
      };
      return late;
    });
    ksorOf(w).publish(POLICY, V5_TEXT);
    expect(await sweep(w)).toMatchObject({ data: { asked: 1, marked: 0 } });
    expect(await statuses(w)).toStrictEqual([[8, "retired"]]);
    expect(await w.rules.notices()).toStrictEqual([]);
  });

  it("Step 28b: the sweep's answer and its own record: a committed proposal, and a decision record of rule.check_authority that says ALLOW", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await sweep(w);
    expect(heard(answer)).toBe("COMMITTED");
    const record = (await w.log.records()).find(
      (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
    );
    expect(record).toMatchObject({
      operation: "rule.check_authority@1",
      authorization: "ALLOW",
      result: "ok",
    });
  });
});
