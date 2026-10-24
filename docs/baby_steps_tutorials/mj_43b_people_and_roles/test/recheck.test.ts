// The release checks everything again, on live data, before the stored request runs (step 31's
// README, claims C3, C4, and C5, decisions D1, D3, D5, D6, and D8). Hours or days pass between an
// approval and its release. Each test changes one thing in that time, and the release must see it.
import { describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { NO_BRAKES } from "../src/brakes.ts";
import { principalNamed, type Principal } from "../src/principals.ts";
import { askerNow, checkApprovals, mayRelease } from "../src/release.ts";
import type { Contract } from "../src/registry.ts";
import type { Slip } from "../src/slips.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ADMIN, AGENT, CFO, contract, DEL_100, keyed, SUPERVISOR, withPlanted } from "./helpers.ts";
import { ruleCall, ruleWorldOnTuesday, textOf, version9, type RuleWorld } from "./rule-world.ts";

/** The URI of the proposal an answer names. */
function uriOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "");
}

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return uriOf(answer).split("/").at(-1)!;
}

/** The agent drafts this bill, and cfo_100 approves it: it waits APPROVED for its release. */
async function approved(w: RuleWorld, bill = "INV-1008") {
  const answer = await w.draft(bill);
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const kept = (await w.proposals.get("org_456", idOf(answer)))!;
  const approval = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: kept.uri,
    payload_hash: kept.payload_hash,
  });
  expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return { id: idOf(answer), uri: kept.uri };
}

/** One release, with a fresh key. */
function release(w: RuleWorld, who: RequestEnvelope, uri: string) {
  return w.ask(keyed(who), "proposal.execute", { proposal: uri });
}

/** A rule's test lines at its line in USD: the line itself is allowed, a cent above it is not. */
function linesAt(value: string) {
  const usd = (amount: string) => ({
    invoice: { open_amount: { value: amount, currency: "USD" } },
  });
  const above = (Number(value) + 0.01).toFixed(2);
  return [
    { state: usd(`${value}.00`), expect: "ALLOW" },
    { state: usd(above), expect: "REQUIRE_APPROVAL" },
  ];
}

/** cfo_100 drafts this text as the next version of the CFO rule, and switches it on. */
async function switchOn(w: RuleWorld, text: Record<string, unknown>) {
  const drafted = await ruleCall(w, CFO, "rule.draft", { draft: text });
  const version = ("data" in drafted ? (drafted.data as { version: number }) : { version: 0 })
    .version;
  expect(version).toBe(9);
  const on = await ruleCall(w, CFO, "rule.activate", { version });
  expect(on).toMatchObject({ data: { status: "active", version: 9 } });
}

/** The proposal's state and its last move's cause, and what DSoR drafted. */
async function afterwards(w: RuleWorld, id: string) {
  const kept = (await w.proposals.get("org_456", id))!;
  const last = kept.transitions.at(-1)!;
  return {
    state: kept.state,
    last: `${last.from}>${last.to}`,
    cause: last.cause,
    drafted: w.drafted.length,
  };
}

/** What the release heard, the proposal, and the booking, when the release was invalidated. */
async function expectInvalidated(w: RuleWorld, answer: Answer, id: string, from: string) {
  expect(answer).toMatchObject({ code: "APPROVAL_INVALIDATED", proposal: uriOf(answer) });
  expect(uriOf(answer).endsWith(id)).toBe(true);
  expect(await afterwards(w, id)).toMatchObject({
    state: "INVALIDATED",
    last: `${from}>INVALIDATED`,
    drafted: 0,
  });
}

describe("C4: an approval counts for the role and quorum the rules ask for now (DSOR-APR-03b, D3)", () => {
  it("DSOR-APR-03b: cfo_100 switches on a version of the CFO rule that asks for two CFOs, and the agent releases INV-1008, which one CFO approved: APPROVAL_INVALIDATED, and nothing is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    await switchOn(w, {
      ...textOf(version9()),
      effect: { require_approval: { role: "CFO", quorum: 2 } },
    });
    const answer = await release(w, AGENT, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect("message" in answer && answer.message).toBe(
      `proposal ${id} is INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for 2 approvals by CFO, and 1 counts`,
    );
  });

  it("DSOR-APR-03b: a version 9 that asks a tenant administrator instead of the CFO: cfo_100's approval met another role, so it does not count", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    await switchOn(w, {
      ...textOf(version9()),
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
    });
    const answer = await release(w, AGENT, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect("message" in answer && answer.message).toBe(
      `proposal ${id} is INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for an approval by tenant_admin, and 0 counts`,
    );
  });

  it("DSOR-APR-03d: a version 9 that asks for one CFO, as version 8 did: cfo_100's approval still counts, the payment is drafted, and the record names both versions", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approved(w);
    await switchOn(w, textOf(version9()));
    expect(await release(w, AGENT, uri)).toMatchObject({ outcome: "COMMITTED" });
    expect(w.drafted.map((p) => p.invoice_id)).toEqual(["INV-1008"]);
    const record = (await w.log.records())
      .filter((r) => r.operation === "proposal.execute@1")
      .at(-1)!;
    expect(record).toMatchObject({
      controls: [{ id: "high-value-payment", version: 9, outcome: "REQUIRE_APPROVAL" }],
      extensions: {
        "org.panaversity.steps": {
          approved_under: [{ control: "high-value-payment", version: 8 }],
        },
      },
    });
  });

  it("DSOR-APR-03c: a new rule that asks a tenant administrator above 30,000 USD: INV-1008, 31,400.00 USD, is invalidated, though cfo_100 approved it", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const rule = "dsor://org_456/rule/admin-above-30000";
    const text = {
      ...textOf(version9()),
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      authority: { system: "local", rule: "admin-above-30000" },
      owner: "admin_100",
      tests: linesAt("30000"),
    };
    expect(await ruleCall(w, ADMIN, "rule.draft", { draft: text }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { status: "active" },
    });
    const answer = await release(w, AGENT, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect("message" in answer && answer.message).toBe(
      `proposal ${id} is INVALIDATED: APPROVAL_REQUIRED: admin-above-30000 version 1 asks for an approval that was not asked for when the request was made`,
    );
  });
});

describe("C5: a READY proposal that a rule now stops is invalidated (DSOR-APR-03c, D6)", () => {
  it("DSOR-APR-03c: the agent prepares INV-1009, 7,425.00 USD; cfo_100 switches on a version that asks the CFO above 5,000 USD; user_123's release is invalidated, READY to INVALIDATED", async () => {
    const w = await ruleWorldOnTuesday();
    const prepared = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });
    expect(prepared).toMatchObject({ outcome: "READY" });
    await switchOn(w, {
      ...textOf(version9()),
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("5000", "USD"))',
      tests: linesAt("5000"),
    });
    const answer = await release(w, SUPERVISOR, uriOf(prepared));
    await expectInvalidated(w, answer, idOf(prepared), "READY");
  });
});

describe("C3: every check runs again, for the person or agent that asked (DSOR-APR-03a, D1)", () => {
  it("DSOR-APR-03a: user_123 pulls the brake on the agent after cfo_100 approved INV-1008, and user_123's own release of it is invalidated: AGENT_SUSPENDED", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const pulled = await w.ask(keyed(SUPERVISOR), "control.suspend", {
      target: "dsor://org_456/agent/accounts-payable-fte",
      reason: "the agent drafted a strange payment",
    });
    expect(pulled).toMatchObject({ outcome: "COMMITTED" });
    const answer = await release(w, SUPERVISOR, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect((await afterwards(w, id)).cause).toBe(
      "the check at the release refused it: AGENT_SUSPENDED",
    );
  });

  it("DSOR-APR-03a: the directory moves user_123, who signed del_100, to ap_clerk, and user_123's release of the agent's approved INV-1008 is invalidated: the agent may only prepare now", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    w.directories.get("org_456")!.set("user_123", { status: "active", roles: ["ap_clerk"] });
    const answer = await release(w, SUPERVISOR, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect((await afterwards(w, id)).cause).toBe(
      "the check at the release refused it: AUTHORIZATION_DENIED",
    );
  });

  it("DSOR-APR-03a: INV-2004, 14,000,000.00 PKR, is exactly 50,000.00 USD on Tuesday's sheet; on Friday's, PKR 300.00, it is 50,400.00 USD, over the slip's one-payment limit: invalidated, LIMIT_EXCEEDED", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w, "INV-2004");
    await w.rates.load("org_456", {
      source: "ecb-daily",
      base: "EUR",
      published_at: "2026-10-06T15:00:00.000Z",
      rates: { USD: "1.0800", GBP: "0.8532", PKR: "300.00" },
    });
    const answer = await release(w, AGENT, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect((await afterwards(w, id)).cause).toBe(
      "the check at the release refused it: LIMIT_EXCEEDED",
    );
  });

  it("DSOR-APR-03c: the accounts system changes INV-1008 to version 2 after the approval: the release is invalidated before any work, STALE_STATE, not a failed payment", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const bill = w.bills.find((b) => b.tenant_id === "org_456" && b.id === "INV-1008")!;
    bill.version = 2;
    const answer = await release(w, AGENT, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect("message" in answer && answer.message).toBe(
      `proposal ${id} is INVALIDATED: STALE_STATE: invoice "INV-1008" is at version 2, and the request was decided on version 1`,
    );
  });

  it("DSOR-APR-03a: an approval planted in the store by user_123, who signed the agent's slip, is caught at the release: SOD_VIOLATION", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.draft("INV-1008");
    const id = idOf(drafted);
    // Not through proposal.approve, which refuses user_123 (step 30): straight into the store.
    const planted = await w.proposals.approve(
      "org_456",
      id,
      {
        id: "apr_00000000-0000-4000-8000-000000000031",
        risk: "high",
        bound_state: { mode: "predicate", versions: {} },
        approver: "user_123",
        roles: ["CFO"],
        at: new Date().toISOString(),
      },
      {
        mover: {
          mode: "direct",
          subject: "user_123",
          actor_chain: [],
          subject_authority: { source: "token", as_of: new Date().toISOString() },
        },
        cause: "planted by a test",
        correlation: { request_id: "req_planted" },
      },
    );
    expect(planted).toMatchObject({ state: "APPROVED" });
    const answer = await release(w, AGENT, uriOf(drafted));
    await expectInvalidated(w, answer, id, "APPROVED");
    expect((await afterwards(w, id)).cause).toBe(
      "the check at the release refused it: SOD_VIOLATION",
    );
  });
});

describe("C5: what an invalidated release leaves (DSOR-APR-03c, D4, D8)", () => {
  it("DSOR-DEL-06d: the invalidated INV-1008 gives its 31,400.00 USD back to del_100's day", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
    await switchOn(w, {
      ...textOf(version9()),
      effect: { require_approval: { role: "CFO", quorum: 2 } },
    });
    await release(w, AGENT, uri);
    expect(await w.reservations.get("org_456", id)).toMatchObject({ state: "released" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("0.00");
  });

  it("Step 31: an invalidated proposal is final: a second release hears CONFLICT", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    w.directories.get("org_456")!.set("user_123", { status: "active", roles: ["ap_clerk"] });
    expect(await release(w, SUPERVISOR, uri)).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect(await release(w, SUPERVISOR, uri)).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${id} is INVALIDATED, and only an APPROVED or a READY proposal is released`,
    });
  });

  it("Step 31: a check that cannot be made now leaves the proposal waiting: the directory is off and its last answer is two hours old, the release hears FRESHNESS_UNSATISFIABLE, and the same key, sent once the directory is back, releases it", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const directory = w.directories.get("org_456")!;
    directory.turn("off");
    // The role source keeps an answer for an hour by the real clock (role-sources.json, PT1H).
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 2 * 60 * 60 * 1000 });
    try {
      const once = keyed(SUPERVISOR);
      expect(await w.ask(once, "proposal.execute", { proposal: uri })).toMatchObject({
        code: "FRESHNESS_UNSATISFIABLE",
        retry: "after_delay",
      });
      expect((await afterwards(w, id)).state).toBe("APPROVED");
      expect(await w.reservations.get("org_456", id)).toMatchObject({ state: "held" });
      directory.turn("on");
      expect(await w.ask(once, "proposal.execute", { proposal: uri })).toMatchObject({
        outcome: "COMMITTED",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("C2 and C3: a dry run of a release checks again too (DSOR-OPR-06, D13)", () => {
  it("DSOR-OPR-06: after the version that asks for two CFOs, a dry run of INV-1008's release hears that it would be invalidated, with the cause, and nothing moves", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    await switchOn(w, {
      ...textOf(version9()),
      effect: { require_approval: { role: "CFO", quorum: 2 } },
    });
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "proposal.execute", {
      proposal: uri,
    });
    expect(dry).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: `proposal ${id} would be INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for 2 approvals by CFO, and 1 counts`,
    });
    expect(await afterwards(w, id)).toMatchObject({ state: "APPROVED", drafted: 0 });
    expect(await w.reservations.get("org_456", id)).toMatchObject({ state: "held" });
  });

  it("DSOR-OPR-06: a dry run counts the proposal's own booking once: under a day of 40,000 USD, INV-1008's 31,400.00 is booked already, and the dry run and the release both pass", async () => {
    const day = {
      per_transaction_limit: { value: "50000", currency: "USD" },
      cumulative_limits: [{ window: "P1D", amount: { value: "40000", currency: "USD" } }],
    };
    const w = await ruleWorldOnTuesday(undefined, [{ ...DEL_100, constraints: day }]);
    const { uri } = await approved(w);
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "proposal.execute", {
      proposal: uri,
    });
    expect(dry).toMatchObject({ outcome: "VALIDATED" });
    expect(await release(w, AGENT, uri)).toMatchObject({ outcome: "COMMITTED" });
  });
});

describe("C4: an approval counts only while it lasts, and only for its request (DSOR-APR-03b, DSOR-APR-04a)", () => {
  it("DSOR-APR-04a: a release after INV-1008's time has come, though no sweep has moved it, hears CONFLICT, and nothing is paid", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const kept = (await w.proposals.get("org_456", id))!;
    w.clock.now = Date.parse(kept.expires_at) + 1000;
    expect(await release(w, AGENT, uri)).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${id}'s time came at ${kept.expires_at}, so it is not released`,
    });
    expect(await afterwards(w, id)).toMatchObject({ state: "APPROVED", drafted: 0 });
  });

  // Found by step 31's review, finding M2: the expiry was read once, before the check again, which
  //   may wait two seconds for the company's directory.
  it("DSOR-APR-04a: a release that began a moment before INV-1008's expiry, and waited for a stuck directory, is not paid after it: CONFLICT", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const kept = (await w.proposals.get("org_456", id))!;
    w.clock.now = Date.parse(kept.expires_at) - 1000;
    // The directory takes the question and never answers, so the role source waits its two
    //   seconds, then uses the answer it kept from the draft. Meanwhile the proposal's time comes.
    w.directories.get("org_456")!.turn("stuck");
    const late = setTimeout(() => {
      w.clock.now = Date.parse(kept.expires_at) + 1000;
    }, 500);
    try {
      expect(await release(w, SUPERVISOR, uri)).toMatchObject({
        code: "CONFLICT",
        message: `proposal ${id}'s time came at ${kept.expires_at}, so it is not released`,
      });
    } finally {
      clearTimeout(late);
    }
    expect(await afterwards(w, id)).toMatchObject({ state: "APPROVED", drafted: 0 });
  });

  it("DSOR-APR-09: an approval that binds another fingerprint counts for nothing at the release", async () => {
    const w = await ruleWorldOnTuesday();
    const { id } = await approved(w);
    const kept = (await w.proposals.get("org_456", id))!;
    const given = await w.proposals.approvals("org_456", id);
    const other = given.map((a) => ({ ...a, payload_hash: `sha256:${"0".repeat(64)}` }));
    await expect(
      // Changed in step 43b: and the world's table of people, where cfo_100 is still CFO.
      checkApprovals(kept, kept.requires ?? [], other, w.registry.delegations, "org_456", w.people),
    ).rejects.toThrow("high-value-payment version 8 asks for an approval by CFO, and 0 counts");
    // Changed in step 33: the check answers what it counted, for the decision's bundle (step 33's
    //   README, D7), the ids by rule in a Map (step 33's review, finding 1).
    await expect(
      // Changed in step 43b: and the world's table of people, where cfo_100 is still CFO.
      checkApprovals(kept, kept.requires ?? [], given, w.registry.delegations, "org_456", w.people),
    ).resolves.toStrictEqual({
      approvals: given,
      satisfied: new Map([["high-value-payment", [given[0]!.id]]]),
    });
  });
});

// Found by step 31's review, finding M1: a sheet of rates that is too old is a check that cannot be
//   made now, as a directory with no recent answer is (D15). The release invalidated the payment.
describe("C5: no usable exchange rate is a 'not now', not a 'no' (step 31's README, decision D15)", () => {
  it("DSOR-MON-04: four days after INV-2004 was approved, its sheet of rates is too old: the release hears FRESHNESS_UNSATISFIABLE, the payment waits APPROVED, and the same key releases it once a fresh sheet is loaded", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w, "INV-2004");
    w.clock.now += 4 * 24 * 60 * 60 * 1000;
    const once = keyed(AGENT);
    const first = await w.ask(once, "proposal.execute", { proposal: uri });
    expect(first).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE", retry: "after_delay" });
    expect(await afterwards(w, id)).toMatchObject({ state: "APPROVED", drafted: 0 });
    expect(await w.reservations.get("org_456", id)).toMatchObject({ state: "held" });
    await w.rates.load("org_456", {
      source: "ecb-daily",
      base: "EUR",
      published_at: new Date(w.clock.now - 60 * 60 * 1000).toISOString(),
      rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
    });
    expect(await w.ask(once, "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
  });
});

// Found by step 31's review, finding M3: each of these guards held, and no test held it.
describe("C3: the guards the review found no test for (DSOR-APR-03a, DSOR-APR-03c, DSOR-APR-11)", () => {
  /** admin_100 drafts and switches on a rule of org_456's own, at this address, with this text. */
  async function adminRule(w: RuleWorld, name: string, text: Record<string, unknown>) {
    const rule = `dsor://org_456/rule/${name}`;
    const draft = {
      ...textOf(version9()),
      owner: "admin_100",
      authority: { system: "local", rule: name },
      ...text,
    };
    expect(await ruleCall(w, ADMIN, "rule.draft", { draft }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { status: "active" },
    });
  }
  const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });

  it("DSOR-APR-03c: a rule that refuses payments above 30,000 USD, switched on after the approval: INV-1008's release is invalidated, POLICY_DENIED", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    await adminRule(w, "no-payment-above-30000", {
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { deny: { reason: "the board froze large payments" } },
      tests: [
        { state: usd("30000.00"), expect: "ALLOW" },
        { state: usd("30000.01"), expect: "DENY" },
      ],
    });
    const answer = await release(w, AGENT, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect((await afterwards(w, id)).cause).toBe(
      "the check at the release refused it: POLICY_DENIED",
    );
  });

  it("DSOR-APR-03a: the rules decide for the asker, not the caller: a rule that refuses a person's own payment above 5,000 USD does not stop user_123's release of the agent's prepared INV-1009", async () => {
    const w = await ruleWorldOnTuesday();
    const prepared = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });
    expect(prepared).toMatchObject({ outcome: "READY" });
    // A rule's own tests run with no actor, as a person's own call does.
    await adminRule(w, "no-own-payment-above-5000", {
      condition:
        'size(actor_chain) == 0 && dsor_exceeds(state.invoice.open_amount, dsor_money("5000", "USD"))',
      effect: { deny: { reason: "a person pays above 5,000 USD only through the agent's slip" } },
      tests: [
        { state: usd("5000.00"), expect: "ALLOW" },
        { state: usd("5000.01"), expect: "DENY" },
      ],
    });
    expect(await release(w, SUPERVISOR, uriOf(prepared))).toMatchObject({ outcome: "COMMITTED" });
    expect(w.drafted.map((p) => p.invoice_id)).toEqual(["INV-1009"]);
  });

  it("DSOR-APR-03a: del_100 passes its date after the approval: user_123's release of INV-1008 is invalidated, DELEGATION_EXPIRED", async () => {
    // The store of slips reads the real clock it was made with, so the slip really passes its date:
    //   two seconds after the test begins.
    const soon = { ...DEL_100, expires_at: new Date(Date.now() + 2000).toISOString() };
    const w = await ruleWorldOnTuesday(undefined, [soon]);
    const { id, uri } = await approved(w);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const answer = await release(w, SUPERVISOR, uri);
    await expectInvalidated(w, answer, id, "APPROVED");
    expect((await afterwards(w, id)).cause).toBe(
      "the check at the release refused it: DELEGATION_EXPIRED",
    );
  });

  it("DSOR-APR-03a: user_150, a person who prepared INV-1009 on their own login, loses their role before user_123 releases it: invalidated, AUTHORIZATION_DENIED", async () => {
    const w = await ruleWorldOnTuesday();
    const person = (roles: string[]) =>
      ({
        id: "user_150",
        type: "human",
        memberships: [{ tenant_id: "org_456", roles }],
      }) as unknown as Principal;
    const USER_150: RequestEnvelope = { token: "tok_150", tenant: "org_456" };
    const prepared = await withPlanted(
      "tok_150",
      person(["ap_supervisor"]),
      () =>
        w.ask({ ...keyed(USER_150), mode: "propose_only" }, "payment.create", {
          invoice: "dsor://org_456/invoice/INV-1009",
          expected_version: 1,
        }),
      w.registry.people,
    );
    expect(prepared).toMatchObject({ outcome: "READY" });
    const answer = await withPlanted(
      "tok_150",
      person([]),
      () => release(w, SUPERVISOR, uriOf(prepared)),
      w.registry.people,
    );
    await expectInvalidated(w, answer, idOf(prepared), "READY");
    expect((await afterwards(w, idOf(prepared))).cause).toBe(
      "the check at the release refused it: AUTHORIZATION_DENIED",
    );
  });

  it("DSOR-APR-11: the agent's own release under a slip other than the one it asked under is refused at line ⑨", async () => {
    const w = await ruleWorldOnTuesday();
    const { id } = await approved(w);
    const kept = (await w.proposals.get("org_456", id))!;
    const target = contract("payment.create") as Contract;
    const agent = principalNamed("accounts-payable-fte")!;
    const other = { ...DEL_100, id: "del_199" } as unknown as Slip;
    const held = new Set(["invoice:read", "payment:create"]);
    await expect(
      mayRelease(kept, target, { caller: agent, slip: other, held }, async () => false),
    ).rejects.toThrow(
      `accounts-payable-fte may not release proposal ${id}: it was not asked for under accounts-payable-fte's own slip`,
    );
  });

  it("DSOR-APR-03a: an agent that works under another slip now than the one it asked under is not the asker any more: DELEGATION_REQUIRED", async () => {
    const w = await ruleWorldOnTuesday();
    const { id } = await approved(w);
    const kept = (await w.proposals.get("org_456", id))!;
    const slips = {
      ...w.registry.delegations,
      find: async () => ({ slip: { ...DEL_100, id: "del_199" }, past: false }),
    };
    await expect(
      askerNow(
        kept,
        contract("payment.create") as Contract,
        w.registry.roles,
        w.registry.roleSource,
        { slips, brakes: NO_BRAKES },
        "org_456",
      ),
    ).rejects.toThrow("accounts-payable-fte works under another slip now, and asked under del_100");
  });
});
