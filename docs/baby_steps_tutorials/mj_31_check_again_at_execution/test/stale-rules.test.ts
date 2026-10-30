// A stale rule at line ⑩ (step 28b's README, claims C4 to C7, decisions D7 to D9 and D11). Line ⑩
// evaluates every version in force, the stale ones too. During its grace a stale version answers
// as its on_stale says. After it, on a high or critical operation, it answers at least
// REQUIRE_APPROVAL. The record names the policy in force, and the version a stale rule cites.
// The tests mark a rule with the store's own mark, as the sweep does (rulebook.ts).
import { describe, expect, it } from "vitest";
import { staleFloor, type Control, type ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { fingerprintOf } from "../src/ksor.ts";
import type { InForce, RuleBy } from "../src/rulebook.ts";
import { contract, OUR_EXTENSIONS, shippedWith } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, shippedRule, type RuleWorld } from "./rule-world.ts";

const DAY = 24 * 60 * 60 * 1000;
// The version of the payment-approval policy in force once the finance team publishes version 5.
const V5 = {
  version: 5,
  content_hash: fingerprintOf("Payments above 20,000 USD or equivalent require CFO approval."),
};

/** A controls file with these rules of org_456. */
function controlsOf(...rules: Control[]): ControlsSource {
  return { file: "controls.json", text: JSON.stringify({ org_456: rules, org_789: [] }) };
}

/** Version 8 with another on_stale, and another grace when one is given. */
function v8(on_stale: string, stale_grace = "P7D"): Control {
  return { ...shippedRule(), on_stale, stale_grace };
}

/** dsor-scheduler's sweep, marking at this time. */
function bySweep(at: number): RuleBy {
  const correlation = { request_id: `req_sweep_${at}`, principal_id: "dsor-scheduler" };
  const as_of = new Date(at).toISOString();
  return { person: "dsor-scheduler", as_of, words: "its policy moved in KSoR", correlation };
}

/** The sweep marks this rule's version stale, at this time: now, unless a test says otherwise. */
async function markStale(w: RuleWorld, id = "high-value-payment", version = 8, at = Date.now()) {
  const marked = await w.rules.mark("org_456", id, version, undefined, V5, bySweep(at), "stale");
  if (!marked) throw new Error(`version ${version} of ${id} was not marked`);
}

/** The contracts as shipped, with payment.create at this risk. */
function paymentAt(level: string) {
  return shippedWith({ ...contract("payment.create"), risk: { level } });
}

/** The decision record of this answer. */
async function recordOf(w: RuleWorld, answer: Answer) {
  const records = await w.log.records();
  const found = records.find(
    (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
  );
  if (found === undefined) throw new Error("no decision record");
  return found;
}

describe("C4: line ⑩ evaluates a stale version at every call (step 28b's README, decision D7)", () => {
  it("DSOR-CTL-03b: a stale version is never skipped: once version 8 is marked stale, INV-1008's 31,400.00 USD still waits for the CFO, and the record names version 8", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(v8("enforce_and_flag")));
    await markStale(w);
    const answer = await w.draft("INV-1008");
    expect(answer).toMatchObject({
      outcome: "PENDING_APPROVAL",
      requires: [{ approval: { role: "CFO", quorum: 1 }, control: "high-value-payment" }],
    });
    const record = await recordOf(w, answer);
    expect(record.controls?.map((c) => [c.id, c.version, c.outcome])).toStrictEqual([
      ["high-value-payment", 8, "REQUIRE_APPROVAL"],
    ]);
  });

  it("DSOR-CTL-03b: a stale rule is evaluated for a person's own call too: user_123's draft of INV-1008 waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(v8("enforce_and_flag")));
    await markStale(w);
    const { SUPERVISOR } = await import("./helpers.ts");
    expect(heard(await w.draft("INV-1008", SUPERVISOR))).toBe("PENDING_APPROVAL");
  });
});

describe("C5: during its grace, a stale version answers as its on_stale says (step 28b's README, decision D8)", () => {
  it("Step 28b: enforce_and_flag: during its grace, version 8 answers as before: INV-1012's 22,750.00 USD is paid, and INV-1008's 31,400.00 USD waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(v8("enforce_and_flag")));
    await markStale(w);
    expect(heard(await w.draft("INV-1012"))).toBe("COMMITTED");
    expect(heard(await w.draft("INV-1008"))).toBe("PENDING_APPROVAL");
  });

  it("Step 28b: require_approval: during its grace, every payment version 8 governs waits for the CFO: before the mark INV-1009's 7,425.00 USD is paid, and after it INV-1012's 22,750.00 USD and INV-1006's 640.00 USD each wait for one CFO", async () => {
    const w = await ruleWorldOnTuesday();
    expect(heard(await w.draft("INV-1009"))).toBe("COMMITTED");
    await markStale(w);
    for (const id of ["INV-1012", "INV-1006"]) {
      expect(await w.draft(id)).toMatchObject({
        outcome: "PENDING_APPROVAL",
        requires: [{ approval: { role: "CFO", quorum: 1 }, control: "high-value-payment" }],
      });
    }
  });

  it("Step 28b: deny: during its grace, version 8 refuses every payment it governs: INV-1006's 640.00 USD is refused, and the record says the rule is stale", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(v8("deny")));
    await markStale(w);
    const answer = await w.draft("INV-1006");
    expect(answer).toMatchObject({ code: "POLICY_DENIED" });
    const record = await recordOf(w, answer);
    const ours = record.extensions?.[OUR_EXTENSIONS] as { denied_by?: unknown } | undefined;
    expect(ours?.denied_by).toStrictEqual([
      {
        control: "high-value-payment",
        reason: "it is stale: the policy it cites moved, and its on_stale says deny",
      },
    ]);
  });

  it("Step 28b: a stale rule whose effect is deny names no approver, so under require_approval it refuses: before the mark, the hold on INV-1004 lets INV-1009 through; once stale, it refuses INV-1006 too", async () => {
    const hold: Control = {
      ...shippedRule(),
      id: "hold-inv-1004",
      version: 1,
      condition: 'input.invoice == "dsor://org_456/invoice/INV-1004"',
      effect: { deny: { reason: "INV-1004 is on hold" } },
      on_stale: "require_approval",
      tests: [
        { input: { invoice: "dsor://org_456/invoice/INV-1004" }, expect: "DENY" },
        { input: { invoice: "dsor://org_456/invoice/INV-1006" }, expect: "ALLOW" },
      ],
    };
    const w = await ruleWorldOnTuesday(controlsOf(shippedRule(), hold));
    expect(heard(await w.draft("INV-1009"))).toBe("COMMITTED");
    await markStale(w, "hold-inv-1004", 1);
    const answer = await w.draft("INV-1006");
    expect(answer).toMatchObject({ code: "POLICY_DENIED" });
    const ours = (await recordOf(w, answer)).extensions?.[OUR_EXTENSIONS] as {
      denied_by?: unknown;
    };
    expect(ours.denied_by).toStrictEqual([
      {
        control: "hold-inv-1004",
        reason:
          "it is stale: the policy it cites moved, its on_stale says require_approval, and its effect names no approver",
      },
    ]);
  });
});

describe("C6: after its grace, on a high or critical operation, at least REQUIRE_APPROVAL (step 28b's README, decision D9)", () => {
  it.each(["high", "critical"])(
    "DSOR-CTL-03c: after its grace, on a %s-risk payment.create, a stale version 8 with enforce_and_flag answers at least REQUIRE_APPROVAL: INV-1012's 22,750.00 USD waits for the CFO",
    async (level) => {
      const w = await ruleWorldOnTuesday(
        controlsOf(v8("enforce_and_flag")),
        undefined,
        undefined,
        paymentAt(level),
      );
      await markStale(w, "high-value-payment", 8, Date.now() - 8 * DAY);
      expect(await w.draft("INV-1012")).toMatchObject({
        outcome: "PENDING_APPROVAL",
        requires: [{ approval: { role: "CFO", quorum: 1 }, control: "high-value-payment" }],
      });
    },
  );

  it("DSOR-CTL-03c: after its grace, on a high-risk payment.create, deny stays DENY: at least REQUIRE_APPROVAL is never less than the on_stale", async () => {
    const w = await ruleWorldOnTuesday(
      controlsOf(v8("deny")),
      undefined,
      undefined,
      paymentAt("high"),
    );
    await markStale(w, "high-value-payment", 8, Date.now() - 8 * DAY);
    expect(heard(await w.draft("INV-1012"))).toBe("POLICY_DENIED");
  });

  it("Step 28b: during its grace, on a high-risk payment.create, enforce_and_flag still answers as before: INV-1012 is paid", async () => {
    const w = await ruleWorldOnTuesday(
      controlsOf(v8("enforce_and_flag")),
      undefined,
      undefined,
      paymentAt("high"),
    );
    await markStale(w);
    expect(heard(await w.draft("INV-1012"))).toBe("COMMITTED");
  });

  it("Step 28b: after its grace, on payment.create at medium risk, as this tutorial ships it, enforce_and_flag goes on: INV-1012 is paid (decision D9)", async () => {
    const w = await ruleWorldOnTuesday(controlsOf(v8("enforce_and_flag")));
    await markStale(w, "high-value-payment", 8, Date.now() - 8 * DAY);
    expect(heard(await w.draft("INV-1012"))).toBe("COMMITTED");
  });

  it("Step 28b: the grace runs from DSoR's mark: marked 6 days and 23 hours ago, version 8 is in its grace and INV-1012 is paid; marked 7 days and a minute ago, INV-1012 waits for the CFO", async () => {
    const high = paymentAt("high");
    const inGrace = await ruleWorldOnTuesday(
      controlsOf(v8("enforce_and_flag")),
      [],
      undefined,
      high,
    );
    await markStale(inGrace, "high-value-payment", 8, Date.now() - 7 * DAY + 60 * 60 * 1000);
    expect(heard(await inGrace.draft("INV-1012"))).toBe("COMMITTED");
    const after = await ruleWorldOnTuesday(controlsOf(v8("enforce_and_flag")), [], undefined, high);
    await markStale(after, "high-value-payment", 8, Date.now() - 7 * DAY - 60 * 1000);
    expect(heard(await after.draft("INV-1012"))).toBe("PENDING_APPROVAL");
  });
});

describe("C6: the floor a stale version answers at least, at the edge of its grace (step 28b's README, decisions D8 and D9)", () => {
  const since = "2026-10-07T00:00:00.000Z";
  const stale = (on_stale: string, effect: Control["effect"] = shippedRule().effect): InForce => ({
    ...v8(on_stale, "PT1H"),
    effect,
    status: "stale_authority",
    stale: { since, in_force: V5 },
  });
  const at = (ms: number) => new Date(Date.parse(since) + ms);
  const HOUR = 60 * 60 * 1000;

  it("Step 28b: a version that is not stale has no floor", () => {
    expect(staleFloor(shippedRule(), at(0), "high")).toBeUndefined();
  });

  it("Step 28b: the grace ends at the mark's time and the grace, to the millisecond: a millisecond before, enforce_and_flag adds nothing on a high operation; at the end, it asks for the approval its effect names", () => {
    expect(staleFloor(stale("enforce_and_flag"), at(HOUR - 1), "high")?.floor).toBe("ALLOW");
    expect(staleFloor(stale("enforce_and_flag"), at(HOUR), "high")?.floor).toBe("REQUIRE_APPROVAL");
    expect(staleFloor(stale("enforce_and_flag"), at(HOUR), "critical")?.floor).toBe(
      "REQUIRE_APPROVAL",
    );
  });

  it.each([
    ["enforce_and_flag", "medium", "ALLOW"],
    ["enforce_and_flag", "low", "ALLOW"],
    ["require_approval", "medium", "REQUIRE_APPROVAL"],
    ["deny", "low", "DENY"],
    ["deny", "high", "DENY"],
  ])(
    "Step 28b: %s after its grace on a %s operation answers at least %s",
    (on_stale, risk, floor) => {
      expect(staleFloor(stale(on_stale), at(2 * HOUR), risk)?.floor).toBe(floor);
    },
  );

  it("Step 28b: a deny rule's least request for a person is DENY, during its grace under require_approval and after it on a high operation", () => {
    const hold = { deny: { reason: "on hold" } };
    expect(staleFloor(stale("require_approval", hold), at(0), "medium")?.floor).toBe("DENY");
    expect(staleFloor(stale("enforce_and_flag", hold), at(2 * HOUR), "high")?.floor).toBe("DENY");
  });

  it("Step 28b: a grace that cannot be read has ended: the rule asks for a person", () => {
    const odd = { ...stale("enforce_and_flag"), stale_grace: "seven days" };
    expect(staleFloor(odd, at(0), "high")?.floor).toBe("REQUIRE_APPROVAL");
  });
});

describe("C7: the record names the policy in force (step 28b's README, decision D11)", () => {
  // Changed by step 28b's review, finding M1: the record named KSoR's version 5 and its fingerprint
  // as the authority, and lost the fingerprint of the text that version 8 enforces. An auditor who
  // follows §17.4's chain, from the control to its authority, reached a text the control does not
  // enforce. The authority stays the version's own citation now.
  it("DSOR-CTL-04: the decision's record names stale version 8 by id and version, with the authority it cites, version 4 and its fingerprint, marked superseded_version 4; and beside it, the policy's version 5 in force, with its fingerprint, and the time of the mark", async () => {
    const w = await ruleWorldOnTuesday();
    const at = Date.now() - 60 * 1000;
    await markStale(w, "high-value-payment", 8, at);
    const record = await recordOf(w, await w.draft("INV-1008"));
    expect(record.controls).toStrictEqual([
      {
        id: "high-value-payment",
        version: 8,
        outcome: "REQUIRE_APPROVAL",
        authority: shippedRule().authority,
        superseded_version: 4,
      },
    ]);
    const ours = record.extensions?.[OUR_EXTENSIONS] as { stale?: unknown } | undefined;
    expect(ours?.stale).toStrictEqual([
      {
        control: "high-value-payment",
        version: 8,
        since: new Date(at).toISOString(),
        in_force: V5,
      },
    ]);
  });

  it("DSOR-CTL-04: an up-to-date rule's record names its own citation, no superseded_version, and no stale rule beside it", async () => {
    const w = await ruleWorldOnTuesday();
    const record = await recordOf(w, await w.draft("INV-1008"));
    const ours = record.extensions?.[OUR_EXTENSIONS] as { stale?: unknown } | undefined;
    expect(ours?.stale).toBeUndefined();
    expect(record.controls).toStrictEqual([
      {
        id: "high-value-payment",
        version: 8,
        outcome: "REQUIRE_APPROVAL",
        authority: shippedRule().authority,
      },
    ]);
  });
});
