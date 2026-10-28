// What step 33's hostile review found, each written red first, and a test for each break of the
// review that no test caught (step 33's README, "The reviews"). The agent drafts INV-1008,
// 31,400.00 USD to VENDOR-44, which waits for the CFO; cfo_100 approves it; the agent releases it.
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { bundleProblems, type SealedBundle } from "../src/bundle.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { rateBetween } from "../src/exchange.ts";
import type { Freshness } from "../src/freshness.ts";
import { invoices, memoryInvoices, type Invoice, type InvoiceStore } from "../src/invoice.ts";
import { fingerprintOf } from "../src/ksor.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { memoryProposals } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import type { RuleBy } from "../src/rulebook.ts";
import { memorySlips } from "../src/slips.ts";
import { vendors, type Vendor } from "../src/vendor.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  DEL_100,
  DEL_101,
  DEL_102,
  OUR_EXTENSIONS,
  SUPERVISOR,
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  storyDirectories,
  withoutControls,
} from "./helpers.ts";
import { ruleCall, ruleWorldOnTuesday, textOf, version9, type RuleWorld } from "./rule-world.ts";

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });

/** The bundle of the world's last call. */
async function lastBundle(w: { log: RuleWorld["log"] }): Promise<SealedBundle> {
  const last = (await w.log.records()).at(-1)!;
  const bundle = (await w.log.bundles()).find((b) => b.decision_id === last.decision_bundle);
  expect(bundle).toBeDefined();
  return bundle!;
}

/** The URI of the proposal an answer names, and its id. */
function proposalOf(answer: Answer): { uri: string; id: string } {
  const uri = String("proposal" in answer ? answer.proposal : "");
  return { uri, id: uri.split("/").at(-1)! };
}

/** The agent drafts INV-1008, or another bill, and the given people approve it. */
async function approvedBy(w: RuleWorld, people: RequestEnvelope[], bill = "INV-1008") {
  const drafted = await w.draft(bill);
  expect(drafted).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const { uri, id } = proposalOf(drafted);
  const kept = (await w.proposals.get("org_456", id))!;
  for (const who of people) {
    await w.ask(keyed(who), "proposal.approve", { proposal: uri, payload_hash: kept.payload_hash });
  }
  expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
  return { uri, id, hash: kept.payload_hash };
}

/** admin_100 drafts and switches on a rule of org_456's own, by this id, with these fields. */
async function adminRule(w: RuleWorld, id: string, fields: Record<string, unknown>) {
  const rule = `dsor://org_456/rule/${id}`;
  const draft = {
    ...textOf(version9()),
    authority: { system: "local", rule: id },
    owner: "admin_100",
    ...fields,
  };
  expect(await ruleCall(w, ADMIN, "rule.draft", { draft }, rule)).toMatchObject({
    data: { version: 1 },
  });
  expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
    data: { status: "active" },
  });
}

describe("finding 1: data the company may hold never leaves a payment without its evidence", () => {
  it("DSOR-AUD-03a: a vendor whose id no address can name, VENDOR 44 with a space, is not followed: user_123's draft of INV-1002 hears CONFLICT, keeps a valid bundle, and nothing is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    w.vendors.push({ tenant_id: "org_456", id: "VENDOR 44", status: "approved", version: 1 });
    w.bills.find((b) => b.tenant_id === "org_456" && b.id === "INV-1002")!.vendor_id = "VENDOR 44";
    const answer = await w.draft("INV-1002", SUPERVISOR);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining('state.vendor.status == "approved"'),
    });
    const bundle = await lastBundle(w);
    expect(bundleProblems(bundle)).toStrictEqual([]);
    expect(bundle.state.map((s) => s.uri)).toStrictEqual(["dsor://org_456/invoice/INV-1002"]);
    expect(w.drafted).toStrictEqual([]);
  });

  it("DSOR-AUD-03a: a rule of admin_100's named constructor, which allows the payment: the agent's release of INV-1008 is committed, with a valid bundle", async () => {
    const w = await ruleWorldOnTuesday();
    await adminRule(w, "constructor", {
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("90000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      tests: [
        { state: usd("90000.00"), expect: "ALLOW" },
        { state: usd("90000.01"), expect: "REQUIRE_APPROVAL" },
      ],
    });
    const { uri } = await approvedBy(w, [CFO]);
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const bundle = await lastBundle(w);
    expect(bundleProblems(bundle)).toStrictEqual([]);
    const rule = bundle.authority.controls.find((c) => c.id === "constructor");
    expect(rule).toMatchObject({ outcome: "ALLOW" });
    expect(rule).not.toHaveProperty("satisfied_by");
  });

  it("DSOR-APR-03b: a rule named constructor that asks a tenant administrator: approved by cfo_100 and admin_100, the release is committed, not an INTERNAL_ERROR, and the rule names admin_100's approval", async () => {
    const w = await ruleWorldOnTuesday();
    await adminRule(w, "constructor", {
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      tests: [
        { state: usd("30000.00"), expect: "ALLOW" },
        { state: usd("30000.01"), expect: "REQUIRE_APPROVAL" },
      ],
    });
    const { uri, id } = await approvedBy(w, [CFO, ADMIN]);
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const given = await w.proposals.approvals("org_456", id);
    const admins = given.find((a) => a.approvers[0]!.principal === "admin_100")!.id;
    const bundle = await lastBundle(w);
    expect(
      bundle.authority.controls.find((c) => c.id === "constructor")?.satisfied_by,
    ).toStrictEqual([admins]);
  });

  it("DSOR-EXE-03b: a bundle DSoR could not keep stops the work before it runs: VENDOR-44's version reads 1.5, which no bundle may hold, and user_123's draft of INV-1002 drafts nothing", async () => {
    const w = await ruleWorldOnTuesday();
    w.vendors.find((v) => v.tenant_id === "org_456" && v.id === "VENDOR-44")!.version = 1.5;
    const answer = await w.draft("INV-1002", SUPERVISOR);
    expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(w.drafted).toStrictEqual([]);
  });
});

describe("finding 1, at a release: the check before the work runs there too", () => {
  // Found by a break of the fix: with no check before a release's work, every test stayed green.
  it("DSOR-EXE-03b: VENDOR-44's version reads 1.5 after cfo_100's approval: the agent's release of INV-1008 drafts nothing, and the proposal still waits APPROVED", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, id } = await approvedBy(w, [CFO]);
    w.vendors.find((v) => v.tenant_id === "org_456" && v.id === "VENDOR-44")!.version = 1.5;
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
    });
    expect(w.drafted).toStrictEqual([]);
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
  });
});

describe("findings 3 to 5 and 17: a release's bundle says what the release did", () => {
  it("DSOR-MON-05: a release finds its booking again and books nothing, so its bundle names no booking's conversion: del_100's only limit is 200,000.00 EUR a day, and Wednesday's sheet differs from Tuesday's", async () => {
    const dailyInEuros = {
      ...DEL_100,
      constraints: {
        cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "EUR" } }],
      },
    };
    const w = await ruleWorldOnTuesday(undefined, [dailyInEuros]);
    const drafted = await w.draft("INV-1008");
    expect((await lastBundle(w)).money.conversions).toMatchObject([
      { to: { value: "29074.074075", currency: "EUR" } },
    ]);
    const { uri, id } = proposalOf(drafted);
    w.clock.now = Date.parse("2026-10-07T15:05:00.000Z");
    await w.rates.load("org_456", {
      source: "ecb-daily",
      base: "EUR",
      published_at: "2026-10-07T14:00:00.000Z",
      rates: { USD: "1.2000", GBP: "0.8600", PKR: "300.00" },
    });
    const kept = (await w.proposals.get("org_456", id))!;
    await w.ask(keyed(CFO), "proposal.approve", { proposal: uri, payload_hash: kept.payload_hash });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    expect((await w.reservations.get("org_456", id))?.amount).toStrictEqual({
      value: "29074.074075",
      currency: "EUR",
    });
    expect((await lastBundle(w)).money.conversions).toStrictEqual([]);
  });

  it("DSOR-AUD-03a: user_123 releases the agent's approved INV-1008: the bundle names the request it decided, the agent's, under del_100, and who released it in this tutorial's extensions", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approvedBy(w, [CFO]);
    expect(await w.ask(keyed(SUPERVISOR), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const bundle = await lastBundle(w);
    expect(bundle).toMatchObject({
      operation: "payment.create@1",
      identity: { mode: "unattended", subject: "user_123", actor_chain: ["accounts-payable-fte"] },
      authority: { delegation: "del_100" },
    });
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      released_by: { mode: "direct", subject: "user_123", actor_chain: [] },
    });
  });

  it("DSOR-AUD-03a: the agent sends its release of INV-1008 again with its key: the replay's bundle names payment.create@1 and its semantics, as the first release's does", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approvedBy(w, [CFO]);
    const once = keyed(AGENT);
    await w.ask(once, "proposal.execute", { proposal: uri });
    const first = await lastBundle(w);
    expect(await w.ask(once, "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const replay = await lastBundle(w);
    expect([replay.operation, replay.execution.semantics]).toStrictEqual([
      first.operation,
      first.execution.semantics,
    ]);
    expect(replay.operation).toBe("payment.create@1");
    expect(replay.execution.result).toBe("not_executed");
  });

  it("DSOR-AUD-03a: a dry run of the agent's release names the proposal it would release, and no key of execution", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri } = await approvedBy(w, [CFO]);
    await w.ask({ ...AGENT, mode: "validate_only" }, "proposal.execute", { proposal: uri });
    const bundle = await lastBundle(w);
    expect(bundle.proposal).toBe(uri);
    expect(bundle.execution).not.toHaveProperty("idempotency_key");
  });

  it("DSOR-IDM-04: the key of a payment's execution, in its bundle, is its proposal's id, at the draft and at the release", async () => {
    const w = await ruleWorldOnTuesday();
    const { uri, id } = await approvedBy(w, [CFO]);
    const draftBundle = (await w.log.bundles())[0]!;
    expect(draftBundle.execution.idempotency_key).toBe(id);
    await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri });
    expect((await lastBundle(w)).execution).toMatchObject({
      idempotency_key: id,
      result: "committed",
    });
  });
});

describe("finding 6: no check reads the agent's words, wherever a check looks", () => {
  const WORDS = { purpose: "weekly payment run", rationale: "the CFO agreed by phone" };
  const saying = (who: RequestEnvelope): RequestEnvelope =>
    ({ ...who, agent_asserted: WORDS }) as RequestEnvelope;

  it("DSOR-AUD-07: a rule that refuses whenever the agent's words reach the input or the state never refuses: the agent's draft of INV-1008 with words still waits for the CFO", async () => {
    const w = await ruleWorldOnTuesday();
    await adminRule(w, "words-in-the-facts", {
      condition: "has(input.agent_asserted) || has(state.agent_asserted)",
      effect: { deny: { reason: "the agent's words reached a condition" } },
      tests: [
        { input: { agent_asserted: { purpose: "x" } }, expect: "DENY" },
        { state: usd("31400.00"), expect: "ALLOW" },
      ],
    });
    const answer = await w.ask(saying(keyed(AGENT)), "payment.create", INV_1008);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  });

  it("DSOR-AUD-07: the words do not open line ⑤: the agent's invoice.issue with words is refused, AUTHORIZATION_DENIED, as without them", async () => {
    const w = await ruleWorldOnTuesday();
    const issue = { invoice: "dsor://org_456/invoice/INV-1011", expected_version: 1 };
    const plain = await w.ask(keyed(AGENT), "invoice.issue", issue);
    const said = await w.ask(saying(keyed(AGENT)), "invoice.issue", issue);
    expect(plain).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(said).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "message" in plain ? plain.message : "",
    });
  });

  it("DSOR-AUD-07: the words do not unmask the answer: the agent's invoice.get of INV-1008 with words hides the same fields as without them", async () => {
    const w = await ruleWorldOnTuesday();
    const read = { invoice: "dsor://org_456/invoice/INV-1008" };
    const plain = await w.ask(AGENT, "invoice.get", read);
    const said = await w.ask(saying(AGENT), "invoice.get", read);
    const shown = (a: Answer) => ({
      data: "data" in a ? a.data : undefined,
      redactions: (a as { redactions?: unknown }).redactions,
    });
    expect((plain as { redactions?: unknown[] }).redactions?.length).toBeGreaterThan(0);
    expect(shown(said)).toStrictEqual(shown(plain));
  });
});

describe("finding 7: every conversion a limit used is named", () => {
  const slipWith = (perPayment: string, daily: string) => ({
    ...DEL_100,
    constraints: {
      per_transaction_limit: { value: "50000", currency: perPayment },
      cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: daily } }],
    },
  });

  it("DSOR-MON-05: a limit for one payment in EUR beside a limit for one day in USD: INV-1002's bundle names the one conversion, into EUR", async () => {
    const w = await ruleWorldOnTuesday(undefined, [slipWith("EUR", "USD")]);
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect((await lastBundle(w)).money.conversions).toStrictEqual([
      {
        from: { value: "8900.50", currency: "USD" },
        to: { value: "8241.203704", currency: "EUR" },
        rate: "0.925925925926",
        source: "ecb-daily",
        as_of: "2026-10-06T14:00:00.000Z",
      },
    ]);
  });

  it("DSOR-MON-05: a limit for one payment in EUR and one for a day in GBP: INV-1002's bundle names two conversions, one into each", async () => {
    const w = await ruleWorldOnTuesday(undefined, [slipWith("EUR", "GBP")]);
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect((await lastBundle(w)).money.conversions.map((c) => [c.to, c.rate])).toStrictEqual([
      [{ value: "8241.203704", currency: "EUR" }, "0.925925925926"],
      [{ value: "7031.395", currency: "GBP" }, "0.79"],
    ]);
  });
});

describe("finding 8: the bundle names only the approvals the release counted", () => {
  it("DSOR-AUD-03a: admin_100 approved INV-2012 under admin-above-30000, which cfo_100 then retires: the release counts cfo_100's approval alone, and the bundle names cfo_100 alone", async () => {
    const w = await ruleWorldOnTuesday();
    await adminRule(w, "admin-above-30000", {
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("30000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      tests: [
        { state: usd("30000.00"), expect: "ALLOW" },
        { state: usd("30000.01"), expect: "REQUIRE_APPROVAL" },
      ],
    });
    const { uri, id } = await approvedBy(w, [CFO, ADMIN]);
    expect(
      await ruleCall(
        w,
        ADMIN,
        "rule.retire",
        { version: 1 },
        "dsor://org_456/rule/admin-above-30000",
      ),
    ).toMatchObject({ data: { status: "retired" } });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: uri })).toMatchObject({
      outcome: "COMMITTED",
    });
    const given = await w.proposals.approvals("org_456", id);
    const cfos = given.find((a) => a.approvers[0]!.principal === "cfo_100")!.id;
    const bundle = await lastBundle(w);
    expect(bundle.approval).toMatchObject({ id: cfos, approvers: ["cfo_100"] });
    expect(bundle.authority.controls.map((c) => [c.id, c.satisfied_by])).toStrictEqual([
      ["high-value-payment", [cfos]],
    ]);
  });
});

describe("finding 9: a read is named with its own label", () => {
  /** A world with no company rule whose store labels every read of VENDOR-44 as this one. */
  function cachedWorld(label: Freshness) {
    const ledger: Invoice[] = structuredClone(invoices);
    const suppliers: Vendor[] = structuredClone(vendors);
    const inner = memoryInvoices(ledger, suppliers);
    const store: InvoiceStore = {
      get: inner.get,
      list: inner.list,
      vendor: async (tenant, id) => ({ ...(await inner.vendor(tenant, id)), freshness: label }),
    };
    const rows: Payment[] = [];
    const payments = memoryPayments(rows);
    const slips = memorySlips([DEL_100, DEL_101, DEL_102]);
    const registry = withoutControls(
      shipped,
      handlersFor(),
      shippedRoles,
      shippedInputs,
      shippedLabels,
      store,
      payments,
      slips,
      storyDirectories(),
      readRoleSettings(),
      memoryClaims(store, payments, memoryProposals(), memoryReservations(), slips),
    );
    const log = createLog();
    return {
      log,
      rows,
      ask: (who: RequestEnvelope, name: string, input: unknown) =>
        call(registry, log, who, name, input),
    };
  }

  it("DSOR-AUD-03a: VENDOR-44 read from a cache, OBSERVATIONAL, at its own time: the draft hears FRESHNESS_UNSATISFIABLE, and the bundle names the read as it was", async () => {
    const at = "2026-10-06T09:00:00.000Z";
    const w = cachedWorld({ mode: "observational", observed_at: at, connector: "cache" });
    expect(await w.ask(keyed(AGENT), "payment.create", INV_1008)).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
    });
    expect((await lastBundle(w)).state[1]).toStrictEqual({
      uri: "dsor://org_456/vendor/VENDOR-44",
      version: 1,
      observed_at: at,
      freshness: "OBSERVATIONAL",
    });
    expect(w.rows).toStrictEqual([]);
  });
});

describe("findings 11, 12, and 14: the shape of the agent's words", () => {
  const saying = (asserted: unknown): RequestEnvelope =>
    ({ ...keyed(AGENT), agent_asserted: asserted }) as RequestEnvelope;
  const SKILL = {
    uri: "viking://agent/skills/vendor-payment",
    version: 3,
    hash: "sha256:c0ffee5k111",
  };

  it.each([
    ["a line separator", { rationale: "first second" }],
    ["a paragraph separator", { rationale: "first second" }],
    ["a right-to-left override", { purpose: "weekly ‮payment run" }],
    ["a zero-width space", { task_id: "task​17" }],
    [
      "a skill version past the largest a version column holds",
      { skill: { ...SKILL, version: 2147483648 } },
    ],
    [
      "a skill address of 513 characters",
      { skill: { ...SKILL, uri: `viking://${"a".repeat(504)}` } },
    ],
    ["a skill hash of 201 characters", { skill: { ...SKILL, hash: `sha256:${"a".repeat(194)}` } }],
    ["a skill hash with a space in it", { skill: { ...SKILL, hash: "sha256:c0ffee 5k111" } }],
  ])(
    "DSOR-AUD-03b: an agent_asserted with %s is refused at line ①, VALIDATION_FAILED",
    async (_why, asserted) => {
      const w = await ruleWorldOnTuesday();
      expect(await w.ask(saying(asserted), "payment.create", INV_1008)).toMatchObject({
        code: "VALIDATION_FAILED",
        message: expect.stringContaining("agent_asserted"),
      });
    },
  );

  it("DSOR-AUD-06: a field that is not one of the four is refused without its name, so no word of the agent's reaches the record's reason", async () => {
    const w = await ruleWorldOnTuesday();
    const named = "cfo_100 approved this by phone at 07:41";
    const answer = await w.ask(saying({ [named]: true }), "payment.create", INV_1008);
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    const record = (await w.log.records()).at(-1)!;
    expect(JSON.stringify(record)).not.toContain("cfo_100 approved");
  });

  it("DSOR-AUD-06: a rationale with spaces around it is kept as sent, spaces and all", async () => {
    const w = await ruleWorldOnTuesday();
    const rationale = "  the weekly payment run  ";
    await w.ask(saying({ rationale }), "payment.create", INV_1008);
    expect((await lastBundle(w)).agent_asserted).toStrictEqual({ rationale });
  });
});

describe("finding 15: the other breaks no test caught", () => {
  it("DSOR-AUD-03a: a stale rule's bundle names the policy's version in force, in this tutorial's extensions", async () => {
    const w = await ruleWorldOnTuesday();
    const v5 = {
      version: 5,
      content_hash: fingerprintOf("Payments above 20,000 USD or equivalent require CFO approval."),
    };
    const at = Date.now();
    const by: RuleBy = {
      person: "dsor-scheduler",
      as_of: new Date(at).toISOString(),
      words: "its policy moved in KSoR",
      correlation: { request_id: `req_sweep_${at}`, principal_id: "dsor-scheduler" },
    };
    expect(await w.rules.mark("org_456", "high-value-payment", 8, undefined, v5, by, "stale")).toBe(
      true,
    );
    await w.draft("INV-1008");
    expect((await lastBundle(w)).extensions?.[OUR_EXTENSIONS]).toMatchObject({
      stale: [expect.objectContaining({ control: "high-value-payment" })],
    });
  });

  it("DSOR-MON-05: a rate is rounded half up at its twelfth place: 1.000000000001 ÷ 2 is 0.500000000001", () => {
    const sheet = {
      source: "test",
      base: "CHF",
      published_at: "",
      rates: { CHF: "2", USD: "1.000000000001" },
    };
    expect(rateBetween("CHF", "USD", { ...sheet, rates: { ...sheet.rates } })).toBe(
      "0.500000000001",
    );
  });

  it("DSOR-APR-02a: a vendor the accounts system no longer lists when cfo_100 approves is not bound by the approval", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.draft("INV-1008");
    const { uri, id } = proposalOf(drafted);
    w.vendors.splice(
      w.vendors.findIndex((v) => v.tenant_id === "org_456" && v.id === "VENDOR-44"),
      1,
    );
    const kept = (await w.proposals.get("org_456", id))!;
    await w.ask(keyed(CFO), "proposal.approve", { proposal: uri, payload_hash: kept.payload_hash });
    const [approval] = await w.proposals.approvals("org_456", id);
    expect(approval?.bound_state.versions).toStrictEqual({ "dsor://org_456/invoice/INV-1008": 1 });
  });
});
