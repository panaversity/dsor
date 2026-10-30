// What step 28's tests share: a world in memory whose company keeps its rules in a store. Not a
// test file itself. The registry and the claims are given the same store, as with the brakes, so
// a change that a command makes is the change that line ⑩ reads (step 28's README, decision D5).
import { readRoleSettings } from "../src/authority.ts";
import { memoryBrakes } from "../src/brakes.ts";
import { memoryClaims } from "../src/claims.ts";
import { readControls, type Control, type ControlsSource } from "../src/controls.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import type { FakeKsor } from "../src/ksor.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { memoryReservations, type MemoryReservations } from "../src/limits.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import { money } from "../src/money.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import type { RoleTableSource } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { readMoneyPolicies } from "../src/policies.ts";
import { memoryProposals, type MemoryProposals } from "../src/proposals.ts";
import { memoryRates, type MemoryRates } from "../src/rates.ts";
import { buildRegistry, type ContractSource, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  checkRules,
  memoryControls,
  type ControlStore,
  type MemoryControls,
} from "../src/rulebook.ts";
import { memorySlips } from "../src/slips.ts";
import {
  AGENT,
  DEL_100,
  DEL_101,
  DEL_102,
  keyed,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  STORY_SLIPS,
  storyDirectories,
  storyKsors,
  type StorySlip,
} from "./helpers.ts";

// Tuesday 2026-10-06, 15:05 UTC, an hour after the ECB's sheet of that day.
export const T0: number = Date.parse("2026-10-06T15:05:00.000Z");

/** One of VENDOR-44's bills to org_456, in its own currency. */
function bill(id: string, value: string, currency: string): Invoice {
  const amount = money(value, currency);
  const fields = { vendor_id: "VENDOR-44", amount, open_amount: amount, status: "issued" };
  return { tenant_id: "org_456", id, ...fields, version: 1 } as Invoice;
}
// Step 27's bills, and INV-2007, 21,000.00 USD: above version 9's 20,000 and below version 8's
// 25,000, so it shows which version answered.
const BILLS = [
  bill("INV-2002", "9000.00", "EUR"),
  bill("INV-2003", "49000.00", "GBP"),
  bill("INV-2004", "14000000.00", "PKR"),
  bill("INV-2006", "100000", "JPY"),
  bill("INV-2007", "21000.00", "USD"),
];

/** A world in memory for step 28's tests, and what a test reads in it. */
export type RuleWorld = {
  clock: { now: number };
  rates: MemoryRates;
  rules: MemoryControls;
  drafted: Payment[];
  proposals: MemoryProposals;
  reservations: MemoryReservations;
  ask: (who: RequestEnvelope, name: string, input: unknown) => Promise<Answer>;
  draft: (id: string, who?: RequestEnvelope) => Promise<Answer>;
  log: MemoryLog;
  registry: Registry;
  // And each company's KSoR, whose switches a test turns (step 28b's README, decision D1).
  ksors: Map<string, FakeKsor>;
};

/** A world in memory: the story's slips, del_100 with step 24's limits, and these rules. */
export function ruleWorld(
  controls: ControlsSource = readControls(),
  // And these slips beside the story's, or in place of the story's slip with the same id.
  more: readonly StorySlip[] = [],
  // And these input schemas, the shipped ones unless a test changes one.
  inputs: ContractSource[] = shippedInputs,
  // And these contracts, the shipped ones unless a test changes one.
  contracts: ContractSource[] = shipped,
  // And the store that the registry and the claims are given, around the world's own, when a test
  // changes how it answers.
  around: (rules: MemoryControls) => ControlStore = (rules) => rules,
  // And this role table, the shipped one unless a test changes a role.
  roles: RoleTableSource = shippedRoles,
  // And each company's KSoR: the story's, unless a test gives another (step 28b's README,
  // decision D1).
  ksors: Map<string, FakeKsor> = storyKsors(),
): RuleWorld {
  const clock = { now: T0 };
  const store = memoryInvoices([...structuredClone(invoices), ...structuredClone(BILLS)]);
  const drafted: Payment[] = [];
  const payments = memoryPayments(drafted);
  const proposals = memoryProposals(() => clock.now);
  const reservations = memoryReservations(() => clock.now);
  const rates = memoryRates(() => clock.now);
  const limits = {
    per_transaction_limit: { value: "50000", currency: "USD" },
    cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "USD" } }],
  };
  // A slip of the test's own takes the place of the story's slip with its id.
  const story = [{ ...DEL_100, constraints: limits }, DEL_101, DEL_102];
  const kept = story.filter((slip) => !more.some((m) => m.id === slip.id));
  const slips = memorySlips([...kept, ...more]);
  const brakes = memoryBrakes();
  const rules = memoryControls(controls);
  const given = around(rules);
  const registry = buildRegistry(
    contracts,
    handlersFor(),
    roles,
    inputs,
    shippedLabels,
    store,
    payments,
    slips,
    storyDirectories(),
    readRoleSettings(),
    memoryClaims(store, payments, proposals, reservations, slips, brakes, rates, given),
    ownWorkFor(),
    brakes,
    readLifetimes(),
    readMoneyPolicies(),
    given,
    ksors,
  );
  const log = createLog();
  const ask = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
    call(registry, log, who, name, input);
  /** The agent, or another caller, drafts a payment of one of org_456's bills, with a fresh key. */
  const draft = (id: string, who: RequestEnvelope = AGENT): Promise<Answer> =>
    ask(keyed(who), "payment.create", {
      invoice: `dsor://org_456/invoice/${id}`,
      expected_version: 1,
    });
  return {
    clock,
    rates,
    rules,
    drafted,
    proposals,
    reservations,
    ask,
    draft,
    log,
    registry,
    ksors,
  };
}

/** The same world, with Tuesday's sheet of ecb-daily loaded. */
export async function ruleWorldOnTuesday(
  controls?: ControlsSource,
  more?: readonly StorySlip[],
  inputs?: ContractSource[],
  contracts?: ContractSource[],
  around?: (rules: MemoryControls) => ControlStore,
  roles?: RoleTableSource,
  ksors?: Map<string, FakeKsor>,
): Promise<RuleWorld> {
  const w = ruleWorld(controls, more, inputs, contracts, around, roles, ksors);
  await w.rates.load("org_456", {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:00:00.000Z",
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  return w;
}

/** The shipped rule, org_456's high-value-payment version 8, as a plain object a test may change. */
export function shippedRule(): Control {
  const file = JSON.parse(readControls().text) as { org_456: Control[] };
  return structuredClone(file.org_456[0]!);
}

// cfo_100's version 9 of high-value-payment: above 20,000 USD, the CFO. Its tests move with its
// line: 5,000,000.00 PKR at 280 is 17,857.14 USD, below it.
/** cfo_100's version 9, a draft, as a test or rule.draft writes it. */
export function version9(): Control {
  const v9 = shippedRule();
  v9.version = 9;
  v9.status = "draft";
  v9.condition = 'dsor_exceeds(state.invoice.open_amount, dsor_money("20000", "USD"))';
  delete v9.reviewed_by;
  delete v9.effective_from;
  const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });
  const pkr = (value: string) => ({ invoice: { open_amount: { value, currency: "PKR" } } });
  v9.tests = [
    { state: usd("20000.00"), expect: "ALLOW" },
    { state: usd("20000.01"), expect: "REQUIRE_APPROVAL" },
    { state: pkr("50000000.00"), rates: { PKR: "280" }, expect: "REQUIRE_APPROVAL" },
    { state: pkr("5000000.00"), rates: { PKR: "280" }, expect: "ALLOW" },
    v9.tests[4]!,
  ];
  return v9;
}

// The story's rule, by its address (step 28's README, decision D7).
export const RULE = "dsor://org_456/rule/high-value-payment";

// org_789's tenant administrator, who may draft and manage org_789's rules (step 28's README,
// decision D19).
export const ADMIN_700: RequestEnvelope = { token: "tok_a700", tenant: "org_789" };

// A rule of org_789's own, counted in its control currency, EUR: above 10,000.00 EUR, the CFO. Its
// tests pin USD per one EUR, as org_789's money policy counts: 11,000.00 USD at 1.08 is 10,185.19
// EUR, above the line, and 10,000.00 USD is 9,259.26 EUR, below it.
/** The text of org_789's own rule, owned by admin_700, as rule.draft takes it. */
export function text789(): Record<string, unknown> {
  const eur = (value: string) => ({ invoice: { open_amount: { value, currency: "EUR" } } });
  const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });
  return {
    operation: "payment.create",
    condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("10000", "EUR"))',
    effect: { require_approval: { role: "CFO", quorum: 1 } },
    authority: { system: "local", rule: "board-above-10000" },
    owner: "admin_700",
    on_stale: "require_approval",
    stale_grace: "P7D",
    tests: [
      { state: eur("10000.00"), expect: "ALLOW" },
      { state: eur("10000.01"), expect: "REQUIRE_APPROVAL" },
      { state: usd("11000.00"), rates: { USD: "1.0800" }, expect: "REQUIRE_APPROVAL" },
      { state: usd("10000.00"), rates: { USD: "1.0800" }, expect: "ALLOW" },
    ],
  };
}

/** The text of a version, as rule.draft takes it: without the six fields DSoR sets itself. */
export function textOf(control: Control): Record<string, unknown> {
  const { id: _id, version: _version, status: _status, ...rest } = control;
  const { compiled_by: _writer, reviewed_by: _reviewer, effective_from: _from, ...text } = rest;
  return text;
}

/** Someone asks for one of the four rule commands, with a fresh key, on this rule. */
export function ruleCall(
  w: RuleWorld,
  who: RequestEnvelope,
  name: "rule.draft" | "rule.activate" | "rule.suspend" | "rule.retire",
  fields: Record<string, unknown>,
  rule: string = RULE,
): Promise<Answer> {
  return w.ask(keyed(who), name, { rule, ...fields, reason: `${name} by a test` });
}

/** What one answer says, in one line: its outcome or its code. */
export function heard(answer: Answer): string {
  if ("code" in answer) return answer.code;
  if ("outcome" in answer) return answer.outcome;
  return "answered";
}

/** A registry of these contracts, its store filled from this file, as start-up checks it. It throws the refusal that names every problem. */
export async function startWith(
  controls: ControlsSource,
  contracts: ContractSource[] = shipped,
): Promise<Registry> {
  const rules = memoryControls(controls);
  const registry = buildRegistry(
    contracts,
    handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(),
    memoryPayments([]),
    memorySlips(STORY_SLIPS),
    storyDirectories(),
    readRoleSettings(),
    undefined,
    ownWorkFor(),
    undefined,
    readLifetimes(),
    readMoneyPolicies(),
    rules,
  );
  const problems = await checkRules(registry, rules.companies());
  if (problems.length > 0) {
    throw new Error(`the rules refused to start:\n  ${problems.join("\n  ")}`);
  }
  return registry;
}

/** The message of the refusal this start-up throws, or "" when it starts. */
export async function refusalAtStart(start: () => Promise<unknown>): Promise<string> {
  try {
    await start();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

/** The active versions of a company's rules, as the store keeps them. */
export async function activeIn(registry: Registry, tenant: string): Promise<Control[]> {
  return (await registry.controls.versions(tenant)).filter((c) => c.status === "active");
}
