// NEW IN STEP 26: money done right (DSOR-MON-02 to DSOR-MON-04, and DSOR-MON-06, in
// specs/dsor/01-model.md, section 9; step 26's README, claims C1 to C7). A company names where its
// exchange rates come from and how old one may be. DSoR keeps each sheet of rates as its source
// wrote it, compares two currencies exactly by multiplying across, and when it cannot convert, the
// slip's limit counts as exceeded. The database's own tests are in rates.db.test.ts.
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { memoryBrakes } from "../src/brakes.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { memoryReservations } from "../src/limits.ts";
import { createLog } from "../src/log.ts";
import { compareAcross, convertUp, exceeds, type RateSheet } from "../src/exchange.ts";
import { money, type Money } from "../src/money.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { checkMoneyPolicies, readMoneyPolicies, type PoliciesSource } from "../src/policies.ts";
import { logins } from "../src/principals.ts";
import { memoryProposals } from "../src/proposals.ts";
import { memoryRates } from "../src/rates.ts";
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
  refusal,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  storyDirectories,
  SUPERVISOR,
} from "./helpers.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
// Tuesday 2026-10-06, 15:00 UTC: an hour after the ECB's sheet of that day. The world's clock
// starts here, and a test moves it on.
const T0 = Date.parse("2026-10-06T15:00:00.000Z");
const PER_DAY = { value: "200000", currency: "USD" };

/** VENDOR-44's bills in other currencies, for this step's tests only (decision D14). */
function bill(id: string, value: string, currency: string, tenant = "org_456"): Invoice {
  const amount = money(value, currency);
  return {
    tenant_id: tenant,
    id,
    vendor_id: "VENDOR-44",
    amount,
    open_amount: amount,
    status: "issued",
    version: 1,
  } as Invoice;
}
// An amount in ABC, which money() would refuse: only a connector could send it.
const ABC: Money = { value: "100.00", currency: "ABC" };
const BILLS: Invoice[] = [
  bill("INV-2002", "9000.00", "EUR"),
  bill("INV-2003", "49000.00", "GBP"),
  bill("INV-2004", "14000000.00", "PKR"),
  // And two more, for the tests of a booking and of a currency that no sheet lists.
  bill("INV-2005", "9000.00", "GBP"),
  bill("INV-2006", "100000", "JPY"),
  // And a bill in ABC, three capitals that are no currency.
  { ...bill("INV-2007", "100.00", "EUR"), amount: ABC, open_amount: ABC },
  // And org_789's own bill, for the tests of each company's own policy and sheets.
  bill("INV-7002", "9000.00", "GBP", "org_789"),
];

// del_100's limits, step 24's: 50,000.00 USD for one payment, and 200,000.00 USD for one day.
const BOTH_LIMITS = {
  per_transaction_limit: { value: "50000", currency: "USD" },
  cumulative_limits: [{ window: "P1D", amount: PER_DAY }],
};
// del_102's limits in org_789, the same in org_789's own control currency, EUR.
const IN_EUR = {
  per_transaction_limit: { value: "50000", currency: "EUR" },
  cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "EUR" } }],
};

/** What a test may change in its world: the companies' money policies, and del_100's limits. */
type Settings = { policies?: PoliciesSource; limits?: Record<string, unknown> };

/** A world in memory with one clock: the story's slips, del_100 and del_102 with limits. */
function world({ policies = readMoneyPolicies(), limits = BOTH_LIMITS }: Settings = {}) {
  const clock = { now: T0 };
  const ledger = [...structuredClone(invoices), ...structuredClone(BILLS)];
  const store = memoryInvoices(ledger);
  const payments = memoryPayments([]);
  const proposals = memoryProposals(() => clock.now);
  const reservations = memoryReservations(() => clock.now);
  const rates = memoryRates(() => clock.now);
  const slips = memorySlips([
    { ...DEL_100, constraints: limits },
    DEL_101,
    { ...DEL_102, constraints: IN_EUR },
  ]);
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
    memoryClaims(store, payments, proposals, reservations, slips, brakes, rates),
    ownWorkFor(),
    brakes,
    readLifetimes(),
    policies,
  );
  const log = createLog();
  const ask = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
    call(registry, log, who, name, input);
  return { clock, ledger, proposals, reservations, rates, ask, registry, log };
}

/** The shipped money policies, with these fields changed for one company. */
function policiesWith(tenant: string, fields: Record<string, unknown>): PoliciesSource {
  const shipped = readMoneyPolicies();
  const policies = JSON.parse(shipped.text) as Record<string, Record<string, unknown>>;
  policies[tenant] = { ...policies[tenant], ...fields };
  return { file: shipped.file, text: JSON.stringify(policies) };
}

/** The decision's record of this answer. */
async function recordOf(w: ReturnType<typeof world>, answer: Answer) {
  return (await w.log.records()).find(
    (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
  );
}

// Where a decision's record names the sheet that line ⑩ converted with (decision L7), and, when
// no rate was usable, the currency and the cause (step 26's review, finding H1).
const CONVERSION = ["extensions", "org.panaversity.steps", "conversion"];
const UNCONVERTIBLE = ["extensions", "org.panaversity.steps", "unconvertible"];

// dsor-rates: a login of the specification's subject type "system", in both companies, whose
// role, rate_loader, holds rate:load (step 26's README, decision D1). And dsor-scheduler, whose
// role does not.
const RATES: RequestEnvelope = { token: "tok_3b8f", tenant: "org_456" };
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
// Tuesday's sheet, as dsor-rates sends it: without its base's own line (decision D9).
const LOAD = {
  company: "dsor://org_456/tenant/org_456",
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00.000Z",
  rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
};
const idOf = (answer: Answer): string =>
  String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;

describe("C6: each company's money policy, at start-up", () => {
  const problemsOf = (text: string): string[] =>
    checkMoneyPolicies({ file: "money-policies.json", text }, logins.values()).problems;
  const policy = (fields: Record<string, unknown> = {}): Record<string, unknown> => ({
    control_currency: "USD",
    rate_source: "ecb-daily",
    max_rate_age: "P3D",
    on_unconvertible: "restrictive",
    ...fields,
  });
  const both = (org456: unknown, org789: unknown = policy()): string =>
    JSON.stringify({ org_456: org456, org_789: org789 });

  it("Step 26: the shipped file gives org_456 USD, ecb-daily, and P3D, and org_789 EUR, ecb-daily, and P7D, and start-up takes it (step 26's README, claim C6)", () => {
    const { policies, problems } = checkMoneyPolicies(readMoneyPolicies(), logins.values());
    expect(problems).toStrictEqual([]);
    expect(Object.fromEntries(policies)).toStrictEqual({
      org_456: {
        control_currency: "USD",
        rate_source: "ecb-daily",
        max_rate_age: "P3D",
        on_unconvertible: "restrictive",
        maxAgeMs: 3 * DAY_MS,
      },
      org_789: {
        control_currency: "EUR",
        rate_source: "ecb-daily",
        max_rate_age: "P7D",
        on_unconvertible: "restrictive",
        maxAgeMs: 7 * DAY_MS,
      },
    });
  });

  it("Step 26: start-up refuses a policy that the specification's schema refuses: a field missing, a field more, a currency not in capitals, a strict answer that is not restrictive, an age that is not a duration (step 26's README, claim C6)", () => {
    const missing: Record<string, unknown> = policy();
    delete missing["rate_source"];
    expect(problemsOf(both(missing))).toStrictEqual([
      "money-policies.json: org_456 must have required property 'rate_source'",
    ]);
    expect(problemsOf(both(policy({ fee: "0.01" })))).toStrictEqual([
      "money-policies.json: org_456 must NOT have additional properties",
    ]);
    expect(problemsOf(both(policy({ control_currency: "usd" })))).toStrictEqual([
      'money-policies.json: org_456/control_currency must match pattern "^[A-Z]{3}$"',
    ]);
    expect(problemsOf(both(policy({ on_unconvertible: "permissive" })))).toStrictEqual([
      "money-policies.json: org_456/on_unconvertible must be equal to constant",
    ]);
    expect(problemsOf(both(policy({ max_rate_age: "3 days" })))).toStrictEqual([
      'money-policies.json: org_456/max_rate_age must match pattern "^P(?!$)([0-9]+D)?(T([0-9]+H)?([0-9]+M)?([0-9]+S)?)?$"',
    ]);
  });

  it("Step 26: start-up refuses a max_rate_age over P7D, the most §44 allows at L2, and takes P7D and zero (step 26's README, decision D11)", () => {
    expect(
      problemsOf(both(policy({ max_rate_age: "P8D" }), policy({ max_rate_age: "PT169H" }))),
    ).toStrictEqual([
      'money-policies.json: org_456\'s max_rate_age "P8D" is over 7 days, the most §44 allows at L2 (DSOR-MON-04)',
      'money-policies.json: org_789\'s max_rate_age "PT169H" is over 7 days, the most §44 allows at L2 (DSOR-MON-04)',
    ]);
    expect(
      problemsOf(both(policy({ max_rate_age: "P7D" }), policy({ max_rate_age: "PT0S" }))),
    ).toStrictEqual([]);
  });

  it("Step 26: start-up refuses a control currency that is three capitals and no currency (step 26's README, claim C6)", () => {
    expect(problemsOf(both(policy({ control_currency: "ABC" })))).toStrictEqual([
      'money-policies.json: org_456\'s control_currency "ABC" is not an ISO 4217 currency',
    ]);
  });

  it("Step 26: a registry built with a broken policies file refuses to start, and names the problem (step 26's README, claim C6)", () => {
    const broken = { file: "money-policies.json", text: both(policy({ max_rate_age: "P8D" })) };
    expect(refusal(() => world({ policies: broken }))).toContain(
      'money-policies.json: org_456\'s max_rate_age "P8D" is over 7 days',
    );
  });

  it("Step 26: start-up refuses a file that is not an object of companies, a company written twice, a company id that is not one, a company with no policy, and a policy for a company where no login works (step 26's README, claim C6)", () => {
    expect(problemsOf("[]")).toStrictEqual([
      "money-policies.json: must be an object that gives each company its money policy",
    ]);
    expect(problemsOf("not json")).toStrictEqual(["money-policies.json: not valid JSON"]);
    const p = JSON.stringify(policy());
    expect(problemsOf(`{ "org_456": ${p}, "org_456": ${p}, "org_789": ${p} }`)).toStrictEqual([
      'money-policies.json: "org_456" is written twice in one object',
    ]);
    expect(problemsOf(`{ "org_456": ${p}, "org_789": ${p}, "acme": ${p} }`)).toStrictEqual([
      'money-policies.json: "acme" is not a company id like org_456',
    ]);
    expect(problemsOf(`{ "org_456": ${p} }`)).toStrictEqual([
      "money-policies.json: org_789, where logins work, has no money policy",
    ]);
    expect(problemsOf(`{ "org_456": ${p}, "org_789": ${p}, "org_999": ${p} }`)).toStrictEqual([
      "money-policies.json: org_999 has a money policy, and no login works there",
    ]);
  });
});

// The ECB's sheet of Tuesday 2026-10-06, as the source writes it: how much of each currency 1 EUR
// buys. The base's own rate is 1 (step 26's README, decisions D3 and D9).
const TUESDAY: RateSheet = {
  source: "ecb-daily",
  base: "EUR",
  published_at: "2026-10-06T14:00:00.000Z",
  rates: { EUR: "1", USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
};
const USD = (value: string) => money(value, "USD");

describe("C1: two currencies, compared exactly", () => {
  it("DSOR-MON-02: 14,000,000.00 PKR is exactly 50,000.00 USD, and 14,000,000.01 PKR is more, by multiplying across with no rounding", () => {
    expect(compareAcross(money("14000000.00", "PKR"), USD("50000"), TUESDAY)).toBe(0);
    expect(exceeds(money("14000000.00", "PKR"), USD("50000"), TUESDAY)).toBe(false);
    expect(compareAcross(money("14000000.01", "PKR"), USD("50000"), TUESDAY)).toBe(1);
    expect(exceeds(money("14000000.01", "PKR"), USD("50000"), TUESDAY)).toBe(true);
  });

  it("DSOR-MON-03: each bill is compared with the limit in the limit's currency, with the company's rates: 9,000.00 EUR is within 50,000.00 USD, and 49,000.00 GBP is not, though 49,000 is less than 50,000", () => {
    expect(exceeds(money("9000.00", "EUR"), USD("50000"), TUESDAY)).toBe(false);
    expect(exceeds(money("49000.00", "GBP"), USD("50000"), TUESDAY)).toBe(true);
    expect(compareAcross(USD("50000"), money("49000.00", "GBP"), TUESDAY)).toBe(-1);
  });

  it("Step 26: a currency that the sheet has no rate for cannot be compared: no answer, never a guess (step 26's README, claim C2)", () => {
    expect(compareAcross(money("100.00", "JPY"), USD("50000"), TUESDAY)).toBeUndefined();
    expect(exceeds(money("100.00", "JPY"), USD("50000"), TUESDAY)).toBeUndefined();
    expect(exceeds(USD("100"), money("100.00", "JPY"), TUESDAY)).toBeUndefined();
  });

  it("Step 26: one currency needs no rate: USD is compared with USD by an empty sheet (step 26's README, decision D10)", () => {
    const empty: RateSheet = { ...TUESDAY, rates: {} };
    expect(compareAcross(USD("31400.00"), USD("50000"), empty)).toBe(-1);
    expect(exceeds(USD("50000.01"), USD("50000"), empty)).toBe(true);
  });

  // Found by step 26's sweep of small breaks: with the zero check gone, every test stayed green,
  // because line ⑥'s schema and the database's CHECK keep a zero away. With a USD of zero, every
  // bill in EUR fits a USD limit, and books nothing.
  it("Step 26: a rate of zero is no rate: nothing is compared or converted with it, so no bill becomes worth nothing (step 26's README, claim C2)", () => {
    const zero = (currency: string): RateSheet => ({
      ...TUESDAY,
      rates: { ...TUESDAY.rates, [currency]: "0.0000" },
    });
    expect(exceeds(money("9000.00", "EUR"), USD("50000"), zero("USD"))).toBeUndefined();
    expect(convertUp(money("9000.00", "EUR"), "USD", zero("USD"))).toBeUndefined();
    expect(convertUp(money("9000.00", "GBP"), "USD", zero("GBP"))).toBeUndefined();
  });

  // Found by step 26's sweep of small breaks: a line the sheet inherits is not one of its own.
  // Object.prototype gets such a line when a package with a bug writes to it.
  it("Step 26: only the sheet's own lines are rates: a JPY line it inherits is none (step 26's README, claim C2)", () => {
    const inherited = Object.assign(
      Object.create({ JPY: "160.10" }) as Record<string, string>,
      TUESDAY.rates,
    );
    const sheet: RateSheet = { ...TUESDAY, rates: inherited };
    expect(exceeds(money("100000", "JPY"), USD("50000"), sheet)).toBeUndefined();
  });
});

describe("C3: a booking, converted into the limit's currency", () => {
  it("DSOR-MON-06: a booking is converted into the limit's currency, rounded up at the sixth decimal place: 9,000.00 GBP is 11,392.405064 USD, and 9,000.00 EUR is 9,720.00 USD", () => {
    // 9,000 × 1.0800 ÷ 0.8532 = 11,392.4050632911…, up at the sixth decimal place.
    expect(convertUp(money("9000.00", "GBP"), "USD", TUESDAY)).toStrictEqual(USD("11392.405064"));
    expect(convertUp(money("9000.00", "EUR"), "USD", TUESDAY)).toStrictEqual(USD("9720.00"));
    expect(convertUp(money("14000000.00", "PKR"), "USD", TUESDAY)).toStrictEqual(USD("50000.00"));
    // And one currency is kept as it is, with no rate at all. Found by step 26's sweep of small
    // breaks: with Tuesday's sheet, a conversion of USD into USD gave the same answer.
    const empty: RateSheet = { ...TUESDAY, rates: {} };
    expect(convertUp(USD("31400.00"), "USD", empty)).toStrictEqual(USD("31400.00"));
  });

  it("Step 26: a booking with no rate is not converted: no answer (step 26's README, claim C2)", () => {
    expect(convertUp(money("100.00", "JPY"), "USD", TUESDAY)).toBeUndefined();
  });
});

describe("C5, C8: each company's sheets, in memory", () => {
  // What the loader sends: the sheet without its base's own line, which DSoR adds (decision D9).
  const SENT: RateSheet = { ...TUESDAY, rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" } };
  const HOUR = 60 * 60 * 1000;

  it("Step 26: a sheet is kept as its source wrote it, with its base at 1, and is the newest sheet of its source (step 26's README, decisions D3 and D9)", async () => {
    const clock = { now: T0 };
    const rates = memoryRates(() => clock.now);
    expect(await rates.load("org_456", SENT)).toBe("loaded");
    expect(await rates.newest("org_456", "ecb-daily", 3 * DAY_MS)).toStrictEqual({
      sheet: TUESDAY,
      fresh: true,
    });
    // A newer sheet is the newest from then on, and the older one stays.
    const wednesday = {
      ...SENT,
      published_at: "2026-10-07T14:00:00.000Z",
      rates: { USD: "1.0900" },
    };
    clock.now = T0 + DAY_MS;
    expect(await rates.load("org_456", wednesday)).toBe("loaded");
    expect((await rates.newest("org_456", "ecb-daily", 3 * DAY_MS))?.sheet.rates).toStrictEqual({
      EUR: "1",
      USD: "1.0900",
    });
    expect(await rates.all()).toHaveLength(2);
  });

  it("Step 26: a sheet's age counts from its publication, by the store's clock: fresh up to max_rate_age, and not after (step 26's README, decision D5)", async () => {
    const clock = { now: T0 };
    const rates = memoryRates(() => clock.now);
    await rates.load("org_456", SENT);
    const published = Date.parse(SENT.published_at);
    clock.now = published + 3 * DAY_MS;
    expect((await rates.newest("org_456", "ecb-daily", 3 * DAY_MS))?.fresh).toBe(true);
    clock.now = published + 3 * DAY_MS + 1;
    expect((await rates.newest("org_456", "ecb-daily", 3 * DAY_MS))?.fresh).toBe(false);
  });

  it("Step 26: a sheet is written once: the same source and time again is refused, and so is a time after the store's clock (step 26's README, decisions D5 and D6)", async () => {
    const clock = { now: T0 };
    const rates = memoryRates(() => clock.now);
    await rates.load("org_456", SENT);
    expect(await rates.load("org_456", { ...SENT, rates: { USD: "9.9999" } })).toBe("exists");
    expect((await rates.newest("org_456", "ecb-daily", 3 * DAY_MS))?.sheet.rates["USD"]).toBe(
      "1.0800",
    );
    const tomorrow = { ...SENT, published_at: new Date(T0 + HOUR).toISOString() };
    expect(await rates.load("org_456", tomorrow)).toBe("future");
    expect(await rates.all()).toHaveLength(1);
  });

  // Found by step 26's review: with no copy, every test stayed green.
  it("Step 26: the store gives a copy of its sheet, so a caller that changes the copy changes nothing in the store (step 26's README, decision D6)", async () => {
    const rates = memoryRates(() => T0);
    await rates.load("org_456", SENT);
    const first = await rates.newest("org_456", "ecb-daily", 3 * DAY_MS);
    (first!.sheet.rates as Record<string, string>)["USD"] = "9.9999";
    expect((await rates.newest("org_456", "ecb-daily", 3 * DAY_MS))?.sheet.rates["USD"]).toBe(
      "1.0800",
    );
  });

  it("Step 26: each company keeps its own sheets: org_789 finds none of org_456's, and another source finds none (step 26's README, decision D2)", async () => {
    const rates = memoryRates(() => T0);
    await rates.load("org_456", SENT);
    expect(await rates.newest("org_789", "ecb-daily", 7 * DAY_MS)).toBeUndefined();
    expect(await rates.newest("org_456", "fed-noon", 7 * DAY_MS)).toBeUndefined();
  });
});
describe("C5: rate.load", () => {
  it("Step 26: dsor-rates loads org_456's sheet of ecb-daily: written once, with its base at 1, as its source wrote it, and the answer counts its currencies (step 26's README, claim C5)", async () => {
    const w = world();
    expect(await w.ask(keyed(RATES), "rate.load", LOAD)).toMatchObject({
      outcome: "COMMITTED",
      data: {
        tenant_id: "org_456",
        source: "ecb-daily",
        base: "EUR",
        published_at: "2026-10-06T14:00:00.000Z",
        currencies: 4,
      },
    });
    expect(await w.rates.newest("org_456", "ecb-daily", 3 * DAY_MS)).toStrictEqual({
      sheet: TUESDAY,
      fresh: true,
    });
  });

  it("Step 26: only DSoR's own system logins that hold rate:load load rates: user_123 and the agent are refused at line ⑤, and so is dsor-scheduler, whose role does not grant it (step 26's README, decisions D1 and D12)", async () => {
    const w = world();
    for (const [who, id] of [
      [SUPERVISOR, "user_123"],
      [AGENT, "accounts-payable-fte"],
    ] as const) {
      expect(await w.ask(keyed(who), "rate.load", LOAD)).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"rate.load" is for DSoR's own system logins only, and ${id} is not one`,
      });
    }
    expect(await w.ask(keyed(SCHEDULER), "rate.load", LOAD)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"rate.load" needs rate:load, which the caller does not hold',
    });
    expect(await w.rates.all()).toStrictEqual([]);
  });

  it("Step 26: a sheet from a source that org_456's money policy does not name is refused at line ⑨, and its proposal ends DENIED (step 26's README, decision D8)", async () => {
    const w = world();
    const answer = await w.ask(keyed(RATES), "rate.load", { ...LOAD, source: "fed-noon" });
    expect(answer).toMatchObject({
      code: "POLICY_DENIED",
      message:
        'org_456 takes its rates from ecb-daily, as its money policy says, not from "fed-noon"',
    });
    expect((await w.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await w.rates.all()).toStrictEqual([]);
  });

  it("Step 26: a sheet is written once, and a sheet published after the clock is refused (step 26's README, decisions D5 and D6)", async () => {
    const w = world();
    expect(await w.ask(keyed(RATES), "rate.load", LOAD)).toMatchObject({ outcome: "COMMITTED" });
    const again = { ...LOAD, rates: { USD: "9.9999" } };
    expect(await w.ask(keyed(RATES), "rate.load", again)).toMatchObject({
      code: "CONFLICT",
      message:
        "a sheet of ecb-daily published at 2026-10-06T14:00:00.000Z is loaded already: a sheet is written once",
    });
    const later = { ...LOAD, published_at: "2026-10-06T16:00:00.000Z" };
    expect(await w.ask(keyed(RATES), "rate.load", later)).toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        "a sheet of ecb-daily published at 2026-10-06T16:00:00.000Z is in the future, by DSoR's clock",
    });
    expect(await w.rates.all()).toHaveLength(1);
  });

  // Found by step 26's review: both were refused inside the work, after DSoR had said yes, so the
  // proposal ended FAILED, the record said ALLOW, and a dry run answered VALIDATED.
  it("Step 26: a sheet that is there already, or one published after the clock, is refused at line ⑨, before any work: its proposal ends DENIED, its record says DENY, and a dry run hears the same (step 26's README, decisions D5 and D6)", async () => {
    const w = world();
    await loaded(w);
    const again = { ...LOAD, rates: { USD: "9.9999" } };
    const later = { ...LOAD, published_at: "2026-10-06T16:00:00.000Z" };
    for (const [sheet, code] of [
      [again, "CONFLICT"],
      [later, "VALIDATION_FAILED"],
    ] as const) {
      const answer = await w.ask(keyed(RATES), "rate.load", sheet);
      expect(answer).toMatchObject({ code });
      expect((await w.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
      expect(await recordOf(w, answer)).toMatchObject({ authorization: "DENY", result: code });
      const dry = { ...RATES, mode: "validate_only" as const };
      expect(await w.ask(dry, "rate.load", sheet)).toMatchObject({ code });
    }
    expect(await w.rates.all()).toHaveLength(1);
  });

  // Found by step 26's review: nothing showed that only the real call writes a sheet.
  it("DSOR-OPR-06: a dry run of rate.load writes no sheet, and neither does a prepared one, whose proposal waits READY (step 26's README, claim C5)", async () => {
    const w = world();
    const dry = { ...RATES, mode: "validate_only" as const };
    expect(await w.ask(dry, "rate.load", LOAD)).toMatchObject({ outcome: "VALIDATED" });
    const prepared = { ...keyed(RATES), mode: "propose_only" as const };
    expect(await w.ask(prepared, "rate.load", LOAD)).toMatchObject({ outcome: "READY" });
    expect(await w.rates.all()).toStrictEqual([]);
  });

  it.each([
    [
      "its base among its rates",
      { rates: { EUR: "1", USD: "1.0800" } },
      "the sheet lists its base, EUR, among its rates: one EUR always buys one EUR",
    ],
    [
      "a currency that is three capitals and no currency",
      { rates: { ABC: "2.5" } },
      "ABC is not an ISO 4217 currency",
    ],
    ["a base that is no currency", { base: "XYZ" }, "the base XYZ is not an ISO 4217 currency"],
    [
      "a time that is no date",
      { published_at: "2026-02-30T14:00:00Z" },
      "published_at 2026-02-30T14:00:00Z is not a time",
    ],
  ])(
    "Step 26: a sheet with %s is refused at line ⑨ (step 26's README, claim C5)",
    async (_what, change, message) => {
      const w = world();
      expect(await w.ask(keyed(RATES), "rate.load", { ...LOAD, ...change })).toMatchObject({
        code: "VALIDATION_FAILED",
        message,
      });
      expect(await w.rates.all()).toStrictEqual([]);
    },
  );

  it.each([
    ["a rate of zero", { rates: { USD: "0.0000" } }],
    ["a rate below zero", { rates: { USD: "-1.08" } }],
    ["no rates at all", { rates: {} }],
    ["a time with no Z", { published_at: "2026-10-06T14:00:00+02:00" }],
    ["a field more", { fee: "0.01" }],
  ])(
    "Step 26: a sheet with %s is refused at line ⑥ (step 26's README, claim C5)",
    async (_what, change) => {
      const w = world();
      expect(await w.ask(keyed(RATES), "rate.load", { ...LOAD, ...change })).toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(await w.rates.all()).toStrictEqual([]);
    },
  );

  it("Step 26: the sheet's company must be the call's own: org_789's URI is refused as foreign, and another id in org_456's URI is no company (step 26's README, claim C5)", async () => {
    const w = world();
    const foreign = { ...LOAD, company: "dsor://org_789/tenant/org_789" };
    expect(await w.ask(keyed(RATES), "rate.load", foreign)).toMatchObject({
      code: "TENANT_MISMATCH",
    });
    const other = { ...LOAD, company: "dsor://org_456/tenant/org_789" };
    expect(await w.ask(keyed(RATES), "rate.load", other)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no company "org_789" here',
    });
  });
});

/** dsor-rates loads this sheet, with a fresh key: Tuesday's, unless the test gives another. */
async function loaded(w: ReturnType<typeof world>, sheet: unknown = LOAD): Promise<void> {
  expect(await w.ask(keyed(RATES), "rate.load", sheet)).toMatchObject({ outcome: "COMMITTED" });
}

/** The agent drafts a payment of one of org_456's bills, with a fresh key, in this mode. */
function draft(
  w: ReturnType<typeof world>,
  id: string,
  mode: "execute" | "propose_only" | "validate_only" = "execute",
): Promise<Answer> {
  const envelope = mode === "validate_only" ? { ...AGENT, mode } : { ...keyed(AGENT), mode };
  return w.ask(envelope, "payment.create", {
    invoice: `dsor://org_456/invoice/${id}`,
    expected_version: 1,
  });
}

const FOR_ONE_PAYMENT = `"payment.create" would pass slip del_100's limit for one payment`;
const FOR_ONE_DAY = `"payment.create" would pass slip del_100's limit for one day`;
// Wednesday's sheet, published at 14:00, which leaves out GBP.
const WEDNESDAY = {
  ...LOAD,
  published_at: "2026-10-07T14:00:00.000Z",
  rates: { USD: "1.0900", PKR: "305.10" },
};
const used = (w: ReturnType<typeof world>): Promise<string> =>
  w.reservations.used("org_456", "del_100", "USD");

describe("C1, C4: line ⑩, in two currencies", () => {
  it("DSOR-MON-03: the agent drafts INV-2002, 9,000.00 EUR, within del_100's 50,000.00 USD for one payment: it is paid, and 9,720.00 USD is booked on the day's total in USD", async () => {
    const w = world();
    await loaded(w);
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
    expect(await used(w)).toBe("9720.00");
  });

  it("DSOR-MON-03: INV-2003, 49,000.00 GBP, is about 62,025 USD, so the agent's draft hears LIMIT_EXCEEDED for one payment, though 49,000 is less than 50,000, and nothing is booked", async () => {
    const w = world();
    await loaded(w);
    const answer = await draft(w, "INV-2003");
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: FOR_ONE_PAYMENT });
    expect((await w.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await used(w)).toBe("0.00");
  });

  it("DSOR-MON-02: INV-2004, 14,000,000.00 PKR, is exactly 50,000.00 USD: at the limit is within it, and it is paid", async () => {
    const w = world();
    await loaded(w);
    expect(await draft(w, "INV-2004")).toMatchObject({ outcome: "COMMITTED" });
    expect(await used(w)).toBe("50000.00");
  });

  it("Step 26: INV-1008, in the limit's own USD, is paid with no sheet at all: one currency needs no rate (step 26's README, decision D10)", async () => {
    const w = world();
    expect(await draft(w, "INV-1008")).toMatchObject({ outcome: "COMMITTED" });
    expect(await used(w)).toBe("31400.00");
  });
});

// What the agent hears when no rate is usable. The words name no currency: the bill's currency is
// above the agent's clearance (DSOR-CLS-02a). And nothing of the company's money policy, which
// classifications.json does not label (DSOR-CLS-01). The decision's record names the currency and
// the cause. Changed by step 26's review, finding H1: the words named the bill's currency.
const NO_RATE = `${FOR_ONE_PAYMENT}: no usable rate`;

/** Nothing in the agent's answer names a currency, the company's source, or its age. */
function namesNothingHidden(answer: Answer): void {
  for (const hidden of ["EUR", "GBP", "JPY", "ABC", "ecb-daily", "fed-noon", "P3D", "P7D"]) {
    expect(JSON.stringify(answer)).not.toContain(hidden);
  }
}

describe("C2: no usable rate, so the strict answer wins", () => {
  it("DSOR-MON-04: with no sheet of ecb-daily, INV-2002 hears LIMIT_EXCEEDED, no usable rate, with no amount and no currency; nothing is booked, and the record names the currency and the cause", async () => {
    const w = world();
    const answer = await draft(w, "INV-2002");
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
    expect(JSON.stringify(answer)).not.toContain("9000");
    namesNothingHidden(answer);
    expect((await w.proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await used(w)).toBe("0.00");
    expect(await recordOf(w, answer)).toHaveProperty(UNCONVERTIBLE, {
      currency: "EUR",
      why: "org_456 has no sheet of ecb-daily",
    });
  });

  it("DSOR-MON-04: a dry run with no sheet hears what the real call hears, and its record names the currency and the cause too", async () => {
    const w = world();
    const answer = await draft(w, "INV-2003", "validate_only");
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
    namesNothingHidden(answer);
    expect(await recordOf(w, answer)).toHaveProperty(UNCONVERTIBLE, {
      currency: "GBP",
      why: "org_456 has no sheet of ecb-daily",
    });
  });

  it("DSOR-MON-04: on Saturday at 09:00 Tuesday's sheet is older than org_456's P3D, so INV-2002 hears LIMIT_EXCEEDED, no usable rate", async () => {
    const w = world();
    await loaded(w);
    w.clock.now = Date.parse("2026-10-10T09:00:00.000Z");
    const answer = await draft(w, "INV-2002");
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
    namesNothingHidden(answer);
    expect(await recordOf(w, answer)).toHaveProperty(UNCONVERTIBLE, {
      currency: "EUR",
      why: "the newest sheet of ecb-daily is older than P3D",
    });
  });

  it("DSOR-MON-04: Wednesday's sheet leaves out GBP, so a bill in GBP hears LIMIT_EXCEEDED on Thursday, though Tuesday's sheet had GBP: one conversion takes both its rates from the newest sheet (step 26's README, decision D4)", async () => {
    const w = world();
    await loaded(w);
    w.clock.now = Date.parse("2026-10-07T15:00:00.000Z");
    await loaded(w, WEDNESDAY);
    w.clock.now = Date.parse("2026-10-08T09:00:00.000Z");
    const answer = await draft(w, "INV-2005");
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
    namesNothingHidden(answer);
    expect(await recordOf(w, answer)).toHaveProperty(UNCONVERTIBLE, {
      currency: "GBP",
      why: "the newest sheet of ecb-daily has no GBP",
    });
  });

  it.each([
    ["INV-2006", "JPY", "a currency that no sheet lists"],
    ["INV-2007", "ABC", "three capitals that are no currency"],
  ])(
    "DSOR-MON-04: a bill of %s, in %s, %s, hears LIMIT_EXCEEDED, no usable rate",
    async (invoice, currency) => {
      const w = world();
      await loaded(w);
      const answer = await draft(w, invoice);
      expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
      namesNothingHidden(answer);
      expect(await recordOf(w, answer)).toHaveProperty(UNCONVERTIBLE, {
        currency,
        why: `the newest sheet of ecb-daily has no ${currency}`,
      });
    },
  );

  // Found by step 26's review: in another currency, an amount with seven places after the point
  // was read, though step 24 refuses one in the limit's own currency. 0.0000000 EUR booked nothing,
  // which the database's reservations refuse as a bug.
  it.each([["-9000.00"], ["9000.0000001"], ["0.0000000"]])(
    "DSOR-MON-04: an open amount of %s EUR, which DSoR cannot read to six places, fits no limit: LIMIT_EXCEEDED for one payment, and nothing is booked (step 24's README, decision 11)",
    async (value) => {
      const w = world();
      await loaded(w);
      const inv2002 = w.ledger.find((i) => i.tenant_id === "org_456" && i.id === "INV-2002")!;
      inv2002.open_amount = { value, currency: "EUR" };
      expect(await draft(w, "INV-2002")).toMatchObject({
        code: "LIMIT_EXCEEDED",
        message: FOR_ONE_PAYMENT,
      });
      expect(await used(w)).toBe("0.00");
    },
  );

  // Found by step 26's sweep of small breaks: with a rate that cannot be used let through the limit
  // for one payment, every test stayed green, because the limit for one day refused it next. Line
  // ⑥ and the database's CHECK keep a rate of zero away, so only a store with no CHECK holds one.
  it("DSOR-MON-04: with a USD of zero in the store, INV-2002 fits no limit: LIMIT_EXCEEDED for one payment, and nothing is booked", async () => {
    const w = world();
    await w.rates.load("org_456", { ...TUESDAY, rates: { USD: "0.0000" } });
    expect(await draft(w, "INV-2002")).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: FOR_ONE_PAYMENT,
    });
    expect(await used(w)).toBe("0.00");
  });
});

// The sheet dsor-rates loads for org_789, the same as org_456's, through org_789's own login.
const RATES_789: RequestEnvelope = { token: "tok_3b8f", tenant: "org_789" };
const LOAD_789 = { ...LOAD, company: "dsor://org_789/tenant/org_789" };

/** firm-ap-fte drafts a payment of org_789's INV-7002, 9,000.00 GBP, under del_102. */
function draftIn789(w: ReturnType<typeof world>): Promise<Answer> {
  return w.ask(keyed(FIRM_IN_789), "payment.create", {
    invoice: "dsor://org_789/invoice/INV-7002",
    expected_version: 1,
  });
}

// Found by step 26's review: with line ⑩ held to org_456's policy, to org_456's sheets, or to the
// source ecb-daily, every test stayed green. Both companies name ecb-daily, and no test converted
// anything in org_789.
describe("C2, C6: each company's own policy, source, and sheets", () => {
  it("DSOR-MON-03: firm-ap-fte's draft of INV-7002, 9,000.00 GBP, in org_789, converts only with org_789's own sheets: with only org_456's sheet it is refused, and with its own it is paid, 10,548.523207 EUR booked", async () => {
    const w = world();
    await loaded(w);
    const refused = await draftIn789(w);
    expect(refused).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: `"payment.create" would pass slip del_102's limit for one payment: no usable rate`,
    });
    expect(await recordOf(w, refused)).toHaveProperty(UNCONVERTIBLE, {
      currency: "GBP",
      why: "org_789 has no sheet of ecb-daily",
    });
    expect(await w.ask(keyed(RATES_789), "rate.load", LOAD_789)).toMatchObject({
      outcome: "COMMITTED",
    });
    const paid = await draftIn789(w);
    expect(paid).toMatchObject({ outcome: "COMMITTED" });
    expect((await w.reservations.get("org_789", idOf(paid)))?.amount).toStrictEqual({
      value: "10548.523207",
      currency: "EUR",
    });
  });

  it("DSOR-MON-04: each company's own max_rate_age: on Saturday at 09:00 Tuesday's sheet is too old for org_456's P3D, and still fresh for org_789's P7D", async () => {
    const w = world();
    await loaded(w);
    expect(await w.ask(keyed(RATES_789), "rate.load", LOAD_789)).toMatchObject({
      outcome: "COMMITTED",
    });
    w.clock.now = Date.parse("2026-10-10T09:00:00.000Z");
    const refused = await draft(w, "INV-2002");
    expect(refused).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
    expect(await recordOf(w, refused)).toHaveProperty(
      [...UNCONVERTIBLE, "why"],
      "the newest sheet of ecb-daily is older than P3D",
    );
    expect(await draftIn789(w)).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-MON-03: line ⑩ converts only with the source that the company's policy names: with org_456's naming fed-noon, a fresh sheet of ecb-daily converts nothing", async () => {
    const w = world({ policies: policiesWith("org_456", { rate_source: "fed-noon" }) });
    await w.rates.load("org_456", TUESDAY);
    const refused = await draft(w, "INV-2002");
    expect(refused).toMatchObject({ code: "LIMIT_EXCEEDED", message: NO_RATE });
    namesNothingHidden(refused);
    expect(await recordOf(w, refused)).toHaveProperty(UNCONVERTIBLE, {
      currency: "EUR",
      why: "org_456 has no sheet of fed-noon",
    });
  });

  it("Step 26: rate.load takes only the source of the company's own policy: with org_789's naming fed-noon, a sheet of ecb-daily for org_789 is refused, and org_456's is loaded (step 26's README, decision D8)", async () => {
    const w = world({ policies: policiesWith("org_789", { rate_source: "fed-noon" }) });
    expect(await w.ask(keyed(RATES_789), "rate.load", LOAD_789)).toMatchObject({
      code: "POLICY_DENIED",
      message:
        'org_789 takes its rates from fed-noon, as its money policy says, not from "ecb-daily"',
    });
    await loaded(w);
    expect(await w.rates.all()).toHaveLength(1);
  });

  // Found by step 26's review: with the newest sheet taken as the one loaded last, every test stayed
  // green, because no test loaded an older sheet after a newer one.
  it("Step 26: the newest sheet is the one published last, not the one loaded last: Tuesday's, loaded after Wednesday's, is not used (step 26's README, decision D4)", async () => {
    const w = world();
    w.clock.now = Date.parse("2026-10-07T15:00:00.000Z");
    await loaded(w, WEDNESDAY);
    await loaded(w);
    const paid = await draft(w, "INV-2002");
    expect(paid).toMatchObject({ outcome: "COMMITTED" });
    expect(await used(w)).toBe("9810.00");
    expect(await recordOf(w, paid)).toHaveProperty(
      [...CONVERSION, "published_at"],
      "2026-10-07T14:00:00.000Z",
    );
  });
});

describe("C3: a booking, in the limit's currency", () => {
  it("DSOR-MON-06: a prepared draft of INV-2005, 9,000.00 GBP, books 11,392.405064 USD at Tuesday's rates, rounded up; a tear-up on Wednesday, under Wednesday's rates, gives back exactly that", async () => {
    const w = world();
    await loaded(w);
    const prepared = await draft(w, "INV-2005", "propose_only");
    expect(prepared).toMatchObject({ outcome: "READY" });
    expect((await w.reservations.get("org_456", idOf(prepared)))?.amount).toStrictEqual({
      value: "11392.405064",
      currency: "USD",
    });
    w.clock.now = Date.parse("2026-10-07T15:00:00.000Z");
    await loaded(w, WEDNESDAY);
    const tearUp = {
      slip: "dsor://org_456/delegation/del_100",
      reason: "VENDOR-44's bank details are in question",
    };
    expect(await w.ask(keyed(SUPERVISOR), "delegation.revoke", tearUp)).toMatchObject({
      outcome: "COMMITTED",
    });
    expect((await w.reservations.get("org_456", idOf(prepared)))?.state).toBe("released");
    w.clock.now = T0;
    expect(await used(w)).toBe("0.00");
  });

  it("DSOR-MON-06: one total for the day, in the limit's currency: after 20 bills of 9,000.00 EUR, 194,400.00 USD, INV-1008's 31,400.00 USD hears LIMIT_EXCEEDED for one day", async () => {
    const w = world();
    await loaded(w);
    for (let i = 0; i < 20; i++) {
      expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
    }
    expect(await used(w)).toBe("194400.00");
    expect(await draft(w, "INV-1008")).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: FOR_ONE_DAY,
    });
    expect(await used(w)).toBe("194400.00");
  });

  // Found by step 26's review: no slip had a limit for one day only, so line ⑩'s list of the
  // limits in another currency was never tried without the limit for one payment.
  it("DSOR-MON-06: a slip with a limit for one day only converts too: with no sheet INV-2002 hears LIMIT_EXCEEDED for one day, no usable rate, and with Tuesday's 9,720.00 USD is booked", async () => {
    const w = world({ limits: { cumulative_limits: [{ window: "P1D", amount: PER_DAY }] } });
    expect(await draft(w, "INV-2002")).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: `${FOR_ONE_DAY}: no usable rate`,
    });
    await loaded(w);
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
    expect(await used(w)).toBe("9720.00");
    // And an amount that cannot be read names the one limit the slip has.
    const inv2002 = w.ledger.find((i) => i.tenant_id === "org_456" && i.id === "INV-2002")!;
    inv2002.open_amount = { value: "9000.0000001", currency: "EUR" };
    expect(await draft(w, "INV-2002")).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: FOR_ONE_DAY,
    });
  });

  it("Step 26: a slip with no limits has none to pass: an open amount that cannot be read is drafted, as step 24 drafts it (step 24's README, decision 11)", async () => {
    const w = world({ limits: {} });
    const inv2002 = w.ledger.find((i) => i.tenant_id === "org_456" && i.id === "INV-2002")!;
    inv2002.open_amount = { value: "9000.0000001", currency: "EUR" };
    expect(await draft(w, "INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-MON-06: at the day's limit is within it, across currencies too: four drafts of INV-2004, each exactly 50,000.00 USD, fill 200,000.00 USD, and a fifth hears LIMIT_EXCEEDED for one day", async () => {
    const w = world();
    await loaded(w);
    for (let i = 0; i < 4; i++) {
      expect(await draft(w, "INV-2004")).toMatchObject({ outcome: "COMMITTED" });
    }
    expect(await used(w)).toBe("200000.00");
    expect(await draft(w, "INV-2004")).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: FOR_ONE_DAY,
    });
  });

  it("DSOR-OPR-06: a dry run converts as the real call would, and books nothing: INV-2002 is VALIDATED, and INV-2003 hears LIMIT_EXCEEDED", async () => {
    const w = world();
    await loaded(w);
    expect(await draft(w, "INV-2002", "validate_only")).toMatchObject({ outcome: "VALIDATED" });
    expect(await draft(w, "INV-2003", "validate_only")).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await used(w)).toBe("0.00");
  });
});

describe("C7: the record of a conversion", () => {
  it("Step 26: a decision that converted records the sheet's source, its time, its base, and the two rates it used, a refusal's too; one that did not convert records none (step 26's README, decision L7)", async () => {
    const w = world();
    await loaded(w);
    const paid = await draft(w, "INV-2002");
    const refused = await draft(w, "INV-2003");
    const usd = await draft(w, "INV-1008");
    const records = await w.log.records();
    const recordOf = (answer: Answer) =>
      records.find(
        (r) => r.kind === "decision" && r.correlation.request_id === answer.correlation.request_id,
      );
    // Exactly these, so a line more is seen. Found by step 26's sweep of small breaks: a record of
    // the whole sheet passed toMatchObject.
    const conversion = ["extensions", "org.panaversity.steps", "conversion"];
    expect(recordOf(paid)).toHaveProperty(conversion, {
      source: "ecb-daily",
      published_at: "2026-10-06T14:00:00.000Z",
      base: "EUR",
      rates: { EUR: "1", USD: "1.0800" },
    });
    expect(recordOf(refused)).toMatchObject({ result: "LIMIT_EXCEEDED" });
    expect(recordOf(refused)).toHaveProperty([...conversion, "rates"], {
      GBP: "0.8532",
      USD: "1.0800",
    });
    expect(recordOf(usd)?.extensions?.["org.panaversity.steps"]).not.toHaveProperty("conversion");
  });
});
