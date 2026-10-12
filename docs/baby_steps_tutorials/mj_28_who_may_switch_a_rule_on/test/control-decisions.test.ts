// Line ⑩ checks the company's controls on every call (DSOR-AUT-02a, DSOR-AUT-02b,
// DSOR-CTL-07, and DSOR-EXE-02; step 27's README, claims C4 to C7). A control that asks for the
// CFO stops the call at PENDING_APPROVAL, with its booking, and runs no work. A control's DENY and
// a limit's DENY win over an approval. The decision's record names each control evaluated.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryBrakes } from "../src/brakes.ts";
import { memoryClaims } from "../src/claims.ts";
import { NO_CONTROLS, readControls, type ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog, type DecisionLog } from "../src/log.ts";
import { money } from "../src/money.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { readMoneyPolicies } from "../src/policies.ts";
import { memoryProposals } from "../src/proposals.ts";
import { memoryRates, type MemoryRates, type RateStore } from "../src/rates.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { memorySlips } from "../src/slips.ts";
import {
  AGENT,
  DEL_100,
  DEL_101,
  DEL_102,
  FIRM_IN_789,
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  storyDirectories,
  SUPERVISOR,
} from "./helpers.ts";

// Tuesday 2026-10-06, 15:05 UTC, an hour after the ECB's sheet of that day.
const T0 = Date.parse("2026-10-06T15:05:00.000Z");

/** One of VENDOR-44's bills to org_456, in its own currency, for this step's tests (step 26's D14). */
function bill(id: string, value: string, currency: string): Invoice {
  const amount = money(value, currency);
  const fields = { vendor_id: "VENDOR-44", amount, open_amount: amount, status: "issued" };
  return { tenant_id: "org_456", id, ...fields, version: 1 } as Invoice;
}
const BILLS = [
  bill("INV-2002", "9000.00", "EUR"),
  bill("INV-2003", "49000.00", "GBP"),
  bill("INV-2004", "14000000.00", "PKR"),
  bill("INV-2006", "100000", "JPY"),
];

/** A world in memory: the story's slips, del_100 with step 24's limits, Tuesday's sheet, and these controls. */
function world(
  controls: ControlsSource = readControls(),
  // The store of rates that line ⑩ reads, around the world's own, when a test changes it.
  around: (rates: MemoryRates) => RateStore = (rates) => rates,
) {
  const clock = { now: T0 };
  const ledger = [...structuredClone(invoices), ...structuredClone(BILLS)];
  const store = memoryInvoices(ledger);
  // The drafts the store writes, so a test can see that none was written.
  const drafted: Payment[] = [];
  const payments = memoryPayments(drafted);
  const proposals = memoryProposals(() => clock.now);
  const reservations = memoryReservations(() => clock.now);
  const rates = memoryRates(() => clock.now);
  const limits = {
    per_transaction_limit: { value: "50000", currency: "USD" },
    cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "USD" } }],
  };
  const slips = memorySlips([{ ...DEL_100, constraints: limits }, DEL_101, DEL_102]);
  const brakes = memoryBrakes();
  const registry = buildRegistry(
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
    memoryClaims(store, payments, proposals, reservations, slips, brakes, around(rates)),
    ownWorkFor(),
    brakes,
    readLifetimes(),
    readMoneyPolicies(),
    controls,
  );
  const log = createLog();
  const ask = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
    call(registry, log, who, name, input);
  return { clock, proposals, reservations, rates, drafted, ask, log, registry };
}
type World = ReturnType<typeof world>;

/** The same world, with Tuesday's sheet of ecb-daily loaded. */
async function withTuesday(
  controls?: ControlsSource,
  around?: (rates: MemoryRates) => RateStore,
): Promise<World> {
  const w = world(controls, around);
  await w.rates.load("org_456", {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:00:00.000Z",
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  return w;
}

/** Someone drafts a payment of one of org_456's bills, in this mode. */
function draft(
  w: World,
  id: string,
  who: RequestEnvelope = AGENT,
  mode: "execute" | "propose_only" | "validate_only" = "execute",
): Promise<Answer> {
  const envelope = mode === "validate_only" ? { ...who, mode } : { ...keyed(who), mode };
  const input = { invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 };
  return w.ask(envelope, "payment.create", input);
}

const idOf = (answer: Answer): string =>
  String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;

/** The decision's record of this answer. */
async function recordOf(w: World, answer: Answer) {
  return (await w.log.records()).find(
    (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
  );
}

function schemaCheck(name: string) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const file of ["common", "security-context"]) {
    const url = new URL(`../schemas/${file}.schema.json`, import.meta.url);
    ajv.addSchema(JSON.parse(readFileSync(url, "utf8")) as object);
  }
  const url = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  return ajv.compile(JSON.parse(readFileSync(url, "utf8")) as object);
}

// The story's control, as the record names it (step 27's README, decision D14).
const CFO_CONTROL = {
  id: "high-value-payment",
  version: 8,
  authority: {
    system: "ksor",
    uri: "ksor://org_456/finance/payment-approval-policy",
    rule: "high-value-payment",
    version: 4,
    content_hash: "sha256:9f2c1e7ab4d0",
  },
};
const REQUIRES = [{ approval: { role: "CFO", quorum: 1 }, control: "high-value-payment" }];

describe("C4, C6: a payment that needs the CFO waits", () => {
  it("DSOR-AUT-02a: the agent drafts INV-1008, 31,400.00 USD: the control asks for the CFO, so the call waits at PENDING_APPROVAL, with what it requires and when it expires; 31,400.00 USD is booked, and no payment is drafted", async () => {
    const w = await withTuesday();
    const answer = await draft(w, "INV-1008");
    expect(answer).toMatchObject({
      outcome: "PENDING_APPROVAL",
      requires: REQUIRES,
      semantics: "compensatable",
    });
    expect(schemaCheck("result-envelope")(answer)).toBe(true);
    const proposal = await w.proposals.get("org_456", idOf(answer));
    expect(proposal?.state).toBe("PENDING_APPROVAL");
    expect("expires_at" in answer ? answer.expires_at : undefined).toBe(proposal?.expires_at);
    expect((await w.reservations.get("org_456", idOf(answer)))?.state).toBe("held");
    expect(w.drafted).toStrictEqual([]);
  });

  it("DSOR-AUT-02a: INV-2002, 9,000.00 EUR, is 9,720.00 USD: the control allows it, and it is paid", async () => {
    const w = await withTuesday();
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });

  it("Step 27: user_123's own draft of INV-1008 waits for the CFO too: a control governs every caller of its operation (step 27's README, decision D15)", async () => {
    const w = await withTuesday();
    expect(await draft(w, "INV-1008", SUPERVISOR)).toMatchObject({ outcome: "PENDING_APPROVAL" });
  });

  it("DSOR-CTL-07: user_123's own draft of INV-2006, 100,000 JPY, which no sheet lists: the condition cannot be evaluated, so the control applies, and the record names the error", async () => {
    const w = await withTuesday();
    const answer = await draft(w, "INV-2006", SUPERVISOR);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL", requires: REQUIRES });
    expect((await recordOf(w, answer))?.controls).toStrictEqual([
      {
        ...CFO_CONTROL,
        outcome: "REQUIRE_APPROVAL",
        evaluation_error: "no usable rate compares JPY with USD",
      },
    ]);
  });

  it("Step 27: a prepared draft that needs the CFO waits at PENDING_APPROVAL, not READY; a replay of its key gives the same answer and makes no second proposal (step 27's README, decision D10)", async () => {
    const w = await withTuesday();
    const envelope = { ...keyed(AGENT), mode: "propose_only" as const };
    const input = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    const first = await w.ask(envelope, "payment.create", input);
    expect(first).toMatchObject({ outcome: "PENDING_APPROVAL", requires: REQUIRES });
    const again = await w.ask(envelope, "payment.create", input);
    const { correlation: _a, ...firstRest } = first;
    const { correlation: _b, ...againRest } = again;
    expect(againRest).toStrictEqual(firstRest);
    expect(await w.proposals.all()).toHaveLength(1);
  });

  // Found by step 27's review, finding M1: the words said that the command ran, and nothing ran.
  it("DSOR-EXE-03b: when the record of a payment that waits for the CFO cannot be written, the agent hears that the proposal was made, never that the command ran; a retry with the same key gives the waiting answer back, and nothing is drafted", async () => {
    const w = await withTuesday();
    const full: DecisionLog = {
      add: async () => {
        throw new Error("disk full");
      },
    };
    const envelope = keyed(AGENT);
    const input = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    expect(await call(w.registry, full, envelope, "payment.create", input)).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message:
        "DSoR could not record its decision after the proposal was made, and a retry with the same idempotency_key cannot make a second one",
      retry: "safe_same_key",
    });
    expect(await w.ask(envelope, "payment.create", input)).toMatchObject({
      outcome: "PENDING_APPROVAL",
    });
    expect(w.drafted).toHaveLength(0);
  });

  // Found by step 27's sweep, CL2: the memory claim gave its own waiting answer to the caller, so a
  // caller that changed it changed what a replay gives back.
  it("Step 27: a replay gives back the waiting answer as it was kept, whatever the caller did with its copy", async () => {
    const w = await withTuesday();
    const envelope = keyed(AGENT);
    const input = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    const first = await w.ask(envelope, "payment.create", input);
    if (!("requires" in first)) throw new Error("the first call does not wait");
    first.requires[0]!.approval.role = "nobody";
    expect(await w.ask(envelope, "payment.create", input)).toMatchObject({ requires: REQUIRES });
  });

  it("DSOR-OPR-06: a dry run answers VALIDATED with the decision the real call would get: REQUIRE_APPROVAL for INV-1008, ALLOW for INV-2002; it books nothing and makes no proposal (step 27's README, decision D12)", async () => {
    const w = await withTuesday();
    const needs = await draft(w, "INV-1008", AGENT, "validate_only");
    expect(needs).toMatchObject({ outcome: "VALIDATED", decision: "REQUIRE_APPROVAL" });
    expect(schemaCheck("result-envelope")(needs)).toBe(true);
    expect(await draft(w, "INV-2002", AGENT, "validate_only")).toMatchObject({
      outcome: "VALIDATED",
      decision: "ALLOW",
    });
    expect(await w.proposals.all()).toStrictEqual([]);
    expect(await w.reservations.all()).toStrictEqual([]);
  });

  it("DSOR-DEL-04c: user_123 tears up del_100: the waiting payment of INV-1008 is cancelled, and its 31,400.00 USD goes back to the day", async () => {
    const w = await withTuesday();
    const waiting = await draft(w, "INV-1008");
    const tearUp = {
      slip: "dsor://org_456/delegation/del_100",
      reason: "VENDOR-44's bank details changed",
    };
    expect(await w.ask(keyed(SUPERVISOR), "delegation.revoke", tearUp)).toMatchObject({
      outcome: "COMMITTED",
      data: { cancelled: 1 },
    });
    expect((await w.proposals.get("org_456", idOf(waiting)))?.state).toBe("CANCELLED");
    expect((await w.reservations.get("org_456", idOf(waiting)))?.state).toBe("released");
  });
});

describe("C5: DENY wins over an approval", () => {
  it("DSOR-AUT-02b: INV-2003, 49,000.00 GBP, about 62,025 USD: the control asks for the CFO, and del_100's limit refuses: LIMIT_EXCEEDED wins, nothing is booked, and the proposal ends DENIED", async () => {
    const w = await withTuesday();
    const answer = await draft(w, "INV-2003");
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await w.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await w.reservations.all()).toStrictEqual([]);
    expect((await recordOf(w, answer))?.controls).toStrictEqual([
      { ...CFO_CONTROL, outcome: "REQUIRE_APPROVAL" },
    ]);
  });

  it("DSOR-AUT-02b: with a second control that denies payments above 45,000 USD, INV-2004's 14,000,000.00 PKR, 50,000.00 USD, hears POLICY_DENIED, whose words name the operation only; the proposal ends DENIED, nothing is booked, and the record names both controls (step 27's README, decision D13)", async () => {
    const shippedControls = JSON.parse(readControls().text) as {
      org_456: Record<string, unknown>[];
    };
    const cfo = shippedControls.org_456[0]!;
    const board = {
      ...cfo,
      id: "very-high-value-payment",
      version: 1,
      condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("45000", "USD"))',
      effect: { deny: { reason: "payments above 45,000 USD go to the board" } },
      tests: [
        {
          state: { invoice: { open_amount: { value: "45000.01", currency: "USD" } } },
          expect: "DENY",
        },
      ],
    };
    const both = {
      file: "controls.json",
      text: JSON.stringify({ org_456: [cfo, board], org_789: [] }),
    };
    const w = await withTuesday(both);
    // A dry run is refused as the real call is (decision D12). Found by step 27's sweep, P15: with a
    // dry run not refused by a control's DENY, every test passed.
    expect(await draft(w, "INV-2004", AGENT, "validate_only")).toMatchObject({
      code: "POLICY_DENIED",
    });
    const answer = await draft(w, "INV-2004");
    expect(answer).toMatchObject({
      code: "POLICY_DENIED",
      message: '"payment.create" is refused by a control of org_456',
    });
    expect((await w.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await w.reservations.all()).toStrictEqual([]);
    const record = await recordOf(w, answer);
    expect(record?.controls?.map((c) => [c.id, c.outcome])).toStrictEqual([
      ["high-value-payment", "REQUIRE_APPROVAL"],
      ["very-high-value-payment", "DENY"],
    ]);
    // The record keeps the refusing control's own reason, which the words leave out. Found by step
    // 27's review, finding L2 (step 27's README, decision D13).
    expect(record?.extensions?.["org.panaversity.steps"]?.denied_by).toStrictEqual([
      { control: "very-high-value-payment", reason: "payments above 45,000 USD go to the board" },
    ]);
  });
});

describe("one sheet for one decision (step 27's review, finding H2)", () => {
  // Another sheet of ecb-daily, at 700 rupees to the euro: 14,000,000.00 PKR is 21,600.00 USD.
  const SEVEN_HUNDRED = {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:30:00.000Z",
    rates: { EUR: "1", USD: "1.0800", PKR: "700.00" },
  };

  // Found by step 27's review: the controls and the limits each read "the newest sheet", so a
  // sheet loaded between the two reads split one decision in two.
  it("Step 27: line ⑩ reads the newest sheet once: when it changes after the first read, the control and the limit still convert INV-2004 with one sheet, and the record names that sheet", async () => {
    let reads = 0;
    const w = await withTuesday(undefined, (rates) => ({
      ...rates,
      newest: async (tenant, source, maxAgeMs) => {
        reads += 1;
        if (reads > 1) return rates.newest(tenant, source, maxAgeMs);
        return { sheet: structuredClone(SEVEN_HUNDRED), fresh: true };
      },
    }));
    const answer = await draft(w, "INV-2004");
    expect(reads).toBe(1);
    // 21,600.00 USD: under 25,000.00 USD, so the control allows it, and the limit books it.
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect((await w.reservations.get("org_456", idOf(answer)))?.amount).toStrictEqual({
      value: "21600.00",
      currency: "USD",
    });
    const record = await recordOf(w, answer);
    expect(record?.controls?.map((c) => c.outcome)).toStrictEqual(["ALLOW"]);
    expect(record?.extensions?.["org.panaversity.steps"]?.conversion).toStrictEqual({
      source: "ecb-daily",
      published_at: SEVEN_HUNDRED.published_at,
      base: "EUR",
      rates: { PKR: "700.00", USD: "1.0800" },
    });
  });

  it("Step 27: user_123's own draft of INV-2004, which no limit counts, records the sheet its control converted with", async () => {
    const w = await withTuesday();
    const answer = await draft(w, "INV-2004", SUPERVISOR);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const record = await recordOf(w, answer);
    expect(record?.extensions?.["org.panaversity.steps"]?.conversion).toStrictEqual({
      source: "ecb-daily",
      published_at: "2026-10-06T14:00:00.000Z",
      base: "EUR",
      rates: { PKR: "302.40", USD: "1.0800" },
    });
  });
});

/** The shipped control, as a plain object that a test may change. */
function shippedRule(): Record<string, unknown> {
  return (JSON.parse(readControls().text) as { org_456: Record<string, unknown>[] }).org_456[0]!;
}

/** A controls file with these lists. */
function controlsOf(lists: Record<string, unknown[]>): ControlsSource {
  return { file: "controls.json", text: JSON.stringify(lists) };
}

describe("what a condition reads", () => {
  // Found by step 27's sweep, P07 to P13: line ⑩ could give a condition the agent as the principal,
  // no slip, no actor chain, no risk, the epoch, or no input, and every test passed, because no
  // control at a real call read them.
  it("Step 27: at a real call, a condition reads the call's own facts: the subject user_123 and the roles held now, the agent in the actor chain, the slip, the company, the operation's risk, the time, and the input; the agent's INV-2002 waits, and user_123's own is paid", async () => {
    const agentPayments = {
      ...shippedRule(),
      id: "agent-payments-of-inv-2002",
      version: 1,
      condition: [
        'principal.id == "user_123"',
        'principal.type == "human"',
        '"ap_supervisor" in principal.roles',
        'actor_chain == ["accounts-payable-fte"]',
        'delegation != null && delegation.id == "del_100"',
        'tenant.id == "org_456"',
        'risk == "medium"',
        'now > timestamp("2026-01-01T00:00:00Z")',
      ].join(" && "),
      tests: [{ expect: "ALLOW" }],
    };
    // The input in a control of its own, whose answer for INV-2002 is ALLOW: a condition that could
    // not read the input would err, and an error applies the effect. Found by step 27's second
    // sweep: inside the first condition, an error asked for the CFO too, so P13 survived.
    const inputNamesInv1008 = {
      ...shippedRule(),
      id: "input-names-inv-1008",
      version: 1,
      condition: 'input.invoice == "dsor://org_456/invoice/INV-1008"',
      tests: [
        { input: { invoice: "dsor://org_456/invoice/INV-2002" }, expect: "ALLOW" },
        { input: { invoice: "dsor://org_456/invoice/INV-1008" }, expect: "REQUIRE_APPROVAL" },
      ],
    };
    const controls = controlsOf({ org_456: [agentPayments, inputNamesInv1008], org_789: [] });
    const w = await withTuesday(controls);
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(await draft(w, "INV-2002", SUPERVISOR)).toMatchObject({ outcome: "COMMITTED" });
  });

  // Found by step 27's sweep, P01, P12, RT2, and K22: line ⑩ could judge org_789 by org_456's
  // rules, or convert with org_456's sheets, and a test could pin rates per USD for every company.
  it("Step 27: each company's controls are its own: firm-ap-fte's draft of org_789's INV-2002, 3,300.00 USD, meets org_789's rule only, which counts in EUR and finds no sheet of org_789's, so it waits; the agent's INV-2002 in org_456 is paid under org_456's rule", async () => {
    const cfo = shippedRule();
    const rule789 = {
      ...cfo,
      id: "org-789-high-value",
      version: 1,
      condition:
        'tenant.id == "org_789" && dsor_exceeds(state.invoice.open_amount, dsor_money("10000", "EUR"))',
      // Rates per one euro, org_789's control currency: 12,000.00 USD is 10,000.00 EUR.
      tests: [
        {
          state: { invoice: { open_amount: { value: "12000.00", currency: "USD" } } },
          rates: { USD: "1.20" },
          expect: "ALLOW",
        },
        {
          state: { invoice: { open_amount: { value: "12000.01", currency: "USD" } } },
          rates: { USD: "1.20" },
          expect: "REQUIRE_APPROVAL",
        },
      ],
    };
    const w = await withTuesday(controlsOf({ org_456: [cfo], org_789: [rule789] }));
    const answer = await w.ask(keyed(FIRM_IN_789), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-2002",
      expected_version: 1,
    });
    expect(answer).toMatchObject({
      outcome: "PENDING_APPROVAL",
      requires: [{ approval: { role: "CFO", quorum: 1 }, control: "org-789-high-value" }],
    });
    const record = await recordOf(w, answer);
    expect(record?.controls?.map((c) => [c.id, c.outcome, c.evaluation_error])).toStrictEqual([
      ["org-789-high-value", "REQUIRE_APPROVAL", "no usable rate compares USD with EUR"],
    ]);
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });

  // Found by step 27's sweep, RT1: a stale sheet converted, and every test passed. A person's call
  // meets no limit, so the control is the only check that converts.
  it("DSOR-MON-04: on Saturday, Tuesday's sheet is older than org_456's three days: user_123's own draft of INV-2002 waits for the CFO, and the record names why", async () => {
    const w = await withTuesday();
    w.clock.now = Date.parse("2026-10-10T09:00:00.000Z");
    const answer = await draft(w, "INV-2002", SUPERVISOR);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect((await recordOf(w, answer))?.controls?.map((c) => c.evaluation_error)).toStrictEqual([
      "no usable rate compares EUR with USD",
    ]);
  });

  // Found by step 27's review, finding L12: only the evaluator was tested, never a call.
  it("DSOR-CTL-06: a condition's state is DSoR's own look at line ⑨, never the caller's input: an input that carries an amount of its own is refused at line ⑥, INV-1008 waits by the 31,400.00 USD the store holds, and INV-2002 is paid by its 9,000.00 EUR", async () => {
    const w = await withTuesday();
    const lying = await w.ask(keyed(AGENT), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
      open_amount: { value: "100.00", currency: "USD" },
    });
    expect(lying).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await draft(w, "INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });

  // Found by step 27's review, finding L7: Appendix B gives tenant as "Tenant id and policy", and a
  // condition saw the id only. This tutorial's tenant policy is its money part (step 26).
  it("Step 27: a condition reads the company's id and its money policy, as Appendix B gives tenant: a control that asks for the CFO unless org_456 counts in USD allows INV-2002, at line ⑩ and in its own test", async () => {
    const shippedControls = JSON.parse(readControls().text) as {
      org_456: Record<string, unknown>[];
    };
    // Without the policy, the condition could not be evaluated, and the control would ask for the
    // CFO: an error applies the effect (DSOR-CTL-07).
    const notInUsd = {
      ...shippedControls.org_456[0]!,
      id: "not-in-usd",
      version: 1,
      condition: 'tenant.id != "org_456" || tenant.policy.money.control_currency != "USD"',
      tests: [{ expect: "ALLOW" }],
    };
    const controls = { file: "controls.json", text: JSON.stringify({ org_456: [notInUsd] }) };
    const w = await withTuesday(controls);
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });
});

describe("C7: the decision's record names each control evaluated", () => {
  it("DSOR-EXE-02: an allowed payment's record names the control, its version, its outcome, and the policy it came from; a read's record names none", async () => {
    const w = await withTuesday();
    const paid = await draft(w, "INV-2002");
    expect((await recordOf(w, paid))?.controls).toStrictEqual([
      { ...CFO_CONTROL, outcome: "ALLOW" },
    ]);
    const read = await w.ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" });
    expect(await recordOf(w, read)).not.toHaveProperty("controls");
  });

  it("DSOR-EXE-02: a waiting payment's record says PENDING_APPROVAL, ALLOW for the caller's right to ask, and REQUIRE_APPROVAL for the control", async () => {
    const w = await withTuesday();
    const waiting = await draft(w, "INV-1008");
    expect(await recordOf(w, waiting)).toMatchObject({
      authorization: "ALLOW",
      result: "PENDING_APPROVAL",
      controls: [{ ...CFO_CONTROL, outcome: "REQUIRE_APPROVAL" }],
    });
  });
});

describe("D11: a payment that waits too long expires", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  // dsor-scheduler, the system login that may call DSoR's own sweep (step 25c's README, decision
  // D11).
  const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
  const sweep = (w: World): Promise<Answer> =>
    w.ask(keyed(SCHEDULER), "proposal.expire_due", { company: "dsor://org_456/tenant/org_456" });

  it("DSOR-DEL-06d: the agent's payment of INV-1008 waits for the CFO past org_456's seven days: dsor-scheduler's sweep expires it, and its 31,400.00 USD goes back to the day (step 27's README, decision D11)", async () => {
    const w = await withTuesday();
    const id = idOf(await draft(w, "INV-1008"));
    expect((await w.proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
    w.clock.now = T0 + 7 * DAY_MS;
    const swept = await sweep(w);
    expect(swept).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", expired: 1 },
    });
    // No control governs the sweep, so its record names none. Found by step 27's sweep, P02: with
    // line ⑩'s own filter gone, every other command's record named an evaluation that never ran.
    expect(await recordOf(w, swept)).not.toHaveProperty("controls");
    const ended = await w.proposals.get("org_456", id);
    expect(ended?.state).toBe("EXPIRED");
    expect(ended?.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "EXPIRED",
      actor: "dsor-scheduler",
      cause: "waited past its lifetime",
    });
    expect((await w.reservations.get("org_456", id))?.state).toBe("released");
  });

  it("Step 27: one millisecond before its expires_at, the sweep leaves the waiting payment waiting, and its booking held (step 27's README, decision D11)", async () => {
    const w = await withTuesday();
    const id = idOf(await draft(w, "INV-1008"));
    w.clock.now = T0 + 7 * DAY_MS - 1;
    expect(await sweep(w)).toMatchObject({ data: { expired: 0 } });
    expect((await w.proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
    expect((await w.reservations.get("org_456", id))?.state).toBe("held");
  });

  it("Step 27: user_123's own waiting payment, which booked nothing, expires too, and the sweep counts it (step 27's README, decisions D11 and D15)", async () => {
    const w = await withTuesday();
    const id = idOf(await draft(w, "INV-1008", SUPERVISOR));
    expect(await w.reservations.get("org_456", id)).toBeUndefined();
    w.clock.now = T0 + 7 * DAY_MS;
    expect(await sweep(w)).toMatchObject({ data: { expired: 1 } });
    expect((await w.proposals.get("org_456", id))?.state).toBe("EXPIRED");
  });
});

describe("the earlier steps' worlds, with no controls", () => {
  it("Step 27: a world that gives no controls pays INV-1008 as step 26 did, and its record names none (step 27's README, decision D16)", async () => {
    const w = await withTuesday(NO_CONTROLS);
    const paid = await draft(w, "INV-1008");
    expect(paid).toMatchObject({ outcome: "COMMITTED" });
    expect(await recordOf(w, paid)).not.toHaveProperty("controls");
  });
});
