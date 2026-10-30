// What a bundle says about money: each conversion the decision used, with its rate, the rate's
// source, and its time (DSOR-MON-05; step 33's README, claim C3, decision D6). Tuesday's sheet of
// ecb-daily, as the ECB writes it, says how much of each currency 1 EUR buys: 1.0800 USD, 0.8532
// GBP, 302.40 PKR. del_100's limits are 50,000.00 USD for one payment and 200,000.00 USD for one day,
// and the CFO's rule asks above 25,000 USD.
import { describe, expect, it } from "vitest";
import type { SealedBundle } from "../src/bundle.ts";
import { ADMIN, DEL_100, OUR_EXTENSIONS, SUPERVISOR } from "./helpers.ts";
import { ruleCall, ruleWorldOnTuesday, textOf, version9, type RuleWorld } from "./rule-world.ts";

/** The bundle of the world's last call. */
async function lastBundle(w: RuleWorld): Promise<SealedBundle> {
  const last = (await w.log.records()).at(-1)!;
  const bundle = (await w.log.bundles()).find((b) => b.decision_id === last.decision_bundle);
  expect(bundle).toBeDefined();
  return bundle!;
}

const TUESDAY = "2026-10-06T14:00:00.000Z";

describe("C3: each conversion the decision used, once, with its rate, source, and time (step 33's README, D6)", () => {
  it("DSOR-MON-05: the agent's draft of INV-2002, 9,000.00 EUR, names one conversion: 9,000.00 EUR to 9,720.00 USD at 1.08, from ecb-daily, as of Tuesday 14:00", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await w.draft("INV-2002")).toMatchObject({ outcome: "COMMITTED" });
    const bundle = await lastBundle(w);
    expect(bundle.money.conversions).toStrictEqual([
      {
        from: { value: "9000.00", currency: "EUR" },
        to: { value: "9720.00", currency: "USD" },
        rate: "1.08",
        source: "ecb-daily",
        as_of: TUESDAY,
      },
    ]);
    // And the sheet's own lines, from which the exact answer can be worked out again.
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      sheet: {
        source: "ecb-daily",
        base: "EUR",
        published_at: TUESDAY,
        rates: { EUR: "1", USD: "1.0800" },
      },
    });
  });

  it("DSOR-MON-05: the agent's draft of INV-2003, 49,000.00 GBP, passes the limit for one payment, and names the conversion it was refused on: GBP to USD at 1.0800 ÷ 0.8532, to twelve places, 1.26582278481, and 62,025.316456 USD, rounded up", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await w.draft("INV-2003")).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await lastBundle(w)).money.conversions).toStrictEqual([
      {
        from: { value: "49000.00", currency: "GBP" },
        to: { value: "62025.316456", currency: "USD" },
        rate: "1.26582278481",
        source: "ecb-daily",
        as_of: TUESDAY,
      },
    ]);
  });

  // Found while building: in every test above, a rule converted the same amount as a limit, so a
  //   limit that noted nothing went unseen. Here only the limits convert.
  it("DSOR-MON-05: under a slip whose limits are in EUR, the agent's draft of INV-1002, 8,900.50 USD, names the limits' conversion: 8,241.203704 EUR, rounded up, at 0.925925925926", async () => {
    const inEuros = {
      ...DEL_100,
      constraints: {
        per_transaction_limit: { value: "50000", currency: "EUR" },
        cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "EUR" } }],
      },
    };
    const w = await ruleWorldOnTuesday(undefined, [inEuros]);
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect((await lastBundle(w)).money.conversions).toStrictEqual([
      {
        from: { value: "8900.50", currency: "USD" },
        to: { value: "8241.203704", currency: "EUR" },
        rate: "0.925925925926",
        source: "ecb-daily",
        as_of: TUESDAY,
      },
    ]);
  });

  // Found while building: with a limit for one payment beside it, the booking's conversion is the
  //   same as the limit's, so only a slip with a limit for one day alone shows the booking's.
  it("DSOR-MON-05: under a slip with only a limit for one day, in EUR, the booking of INV-1002 is the conversion named: 8,241.203704 EUR", async () => {
    const dailyOnly = {
      ...DEL_100,
      constraints: {
        cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "EUR" } }],
      },
    };
    const w = await ruleWorldOnTuesday(undefined, [dailyOnly]);
    expect(await w.draft("INV-1002")).toMatchObject({ outcome: "COMMITTED" });
    expect((await lastBundle(w)).money.conversions).toStrictEqual([
      expect.objectContaining({
        from: { value: "8900.50", currency: "USD" },
        to: { value: "8241.203704", currency: "EUR" },
      }),
    ]);
  });

  it("DSOR-MON-05: the agent's draft of INV-1008, in USD, converts nothing: an empty list, and no sheet", async () => {
    const w = await ruleWorldOnTuesday();
    await w.draft("INV-1008");
    const bundle = await lastBundle(w);
    expect(bundle.money).toStrictEqual({ conversions: [] });
    expect(bundle.extensions?.[OUR_EXTENSIONS]).not.toHaveProperty("sheet");
  });

  it("DSOR-MON-05: the agent's draft of INV-2006, 100,000 JPY, which the sheet does not list: LIMIT_EXCEEDED, no usable rate, no conversion, and the extensions name the currency and why", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await w.draft("INV-2006")).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: expect.stringContaining("no usable rate"),
    });
    const bundle = await lastBundle(w);
    expect(bundle.money.conversions).toStrictEqual([]);
    expect(bundle.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      unconvertible: { currency: "JPY", why: "the newest sheet of ecb-daily has no JPY" },
    });
  });

  it("DSOR-MON-05: user_123's own draft of INV-2002, which no limit counts, names the CFO rule's conversion", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await w.draft("INV-2002", SUPERVISOR)).toMatchObject({ outcome: "COMMITTED" });
    expect((await lastBundle(w)).money.conversions).toStrictEqual([
      {
        from: { value: "9000.00", currency: "EUR" },
        to: { value: "9720.00", currency: "USD" },
        rate: "1.08",
        source: "ecb-daily",
        as_of: TUESDAY,
      },
    ]);
  });

  it("DSOR-MON-05: a rule that asks whether the bill covers 10,000.00 USD converts the 10,000.00 USD into the bill's EUR: 9,259.25926 EUR, rounded up, at 0.925925925926", async () => {
    const w = await ruleWorldOnTuesday();
    const rule = "dsor://org_456/rule/admin-at-10000";
    const usd = (value: string) => ({ invoice: { open_amount: { value, currency: "USD" } } });
    const text = {
      ...textOf(version9()),
      condition: 'dsor_covers(state.invoice.open_amount, dsor_money("10000", "USD"))',
      effect: { require_approval: { role: "tenant_admin", quorum: 1 } },
      authority: { system: "local", rule: "admin-at-10000" },
      owner: "admin_100",
      tests: [
        { state: usd("9999.99"), expect: "ALLOW" },
        { state: usd("10000.00"), expect: "REQUIRE_APPROVAL" },
      ],
    };
    expect(await ruleCall(w, ADMIN, "rule.draft", { draft: text }, rule)).toMatchObject({
      data: { version: 1 },
    });
    expect(await ruleCall(w, ADMIN, "rule.activate", { version: 1 }, rule)).toMatchObject({
      data: { status: "active" },
    });
    expect(await w.draft("INV-2002")).toMatchObject({ outcome: "COMMITTED" });
    const conversions = (await lastBundle(w)).money.conversions;
    expect(conversions).toContainEqual({
      from: { value: "10000", currency: "USD" },
      to: { value: "9259.25926", currency: "EUR" },
      rate: "0.925925925926",
      source: "ecb-daily",
      as_of: TUESDAY,
    });
    expect(conversions).toContainEqual(expect.objectContaining({ rate: "1.08" }));
    expect(conversions).toHaveLength(2);
  });
});
