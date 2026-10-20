// NEW IN STEP 27: switching a control on runs its test cases first (decision 162).
//
// A control is switched on only when every one of its own test cases gives the answer the case
// expects, with the rates the case pins. In this step the demo switches it on in the administrator's
// place; no operation reaches it, so the agent cannot. Step 28 makes it a command only the control's
// owner may run.
//
// Rule DSOR-CTL-02c: Activation MUST run the control's test vectors and fail if any vector fails.
// Rule DSOR-CTL-07: When a control condition fails to evaluate — missing field, type error,
// unconvertible amount — the control's effect MUST apply.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ConditionInput } from "../src/cel.ts";
import {
  controlsInForce,
  controlsOf,
  evaluateControl,
  mostRestrictive,
  switchOn,
  type Control,
} from "../src/policy-controls.ts";
import { useRateService } from "../src/rates.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  useRateService("org_456", undefined);
});

/** org_456's CFO control as migration 029 writes it, with these changes, as another id or version. */
async function aControl(
  version: number,
  changes: Record<string, unknown>,
  id = "high-value-payment",
): Promise<void> {
  await asTheOwner(async () => {
    const { rows } = await db.query<{ record: Record<string, unknown> }>(
      "SELECT record FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8",
    );
    const record = { ...rows[0]?.record, ...changes, id, version };

    await db.query(
      `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
       VALUES ('org_456', $1, $2, 'payment.create', 'in_review', $3::jsonb)`,
      [id, version, JSON.stringify(record)],
    );
  });
}

/** The rule as the map's break writes it: numbers and a currency name. */
const NAIVE = 'double(input.amount.value) > 25000.0 && input.amount.currency == "USD"';

describe("switching a control on", () => {
  it("DSOR-CTL-02c: the CFO's control runs its five test cases, passes them, and is then in force", async () => {
    const switched = await switchOn("org_456", "high-value-payment", 8);

    expect(switched.kind).toBe("switched_on");
    expect(switched.results.map((r) => [r.expected, r.got])).toStrictEqual([
      ["ALLOW", "ALLOW"],
      ["REQUIRE_APPROVAL", "REQUIRE_APPROVAL"],
      ["REQUIRE_APPROVAL", "REQUIRE_APPROVAL"],
      ["ALLOW", "ALLOW"],
      ["REQUIRE_APPROVAL", "REQUIRE_APPROVAL"],
    ]);
    expect(
      (await controlsInForce("org_456", "payment.create")).map((c) => c.version),
    ).toStrictEqual([8]);
  });

  it("DSOR-CTL-02c: the rule written in numbers fails its own cases, and is not switched on", async () => {
    // The map's break, caught before it governs anything: 50,000,000.00 PKR, which needs the CFO,
    // comes out ALLOW, and so does a currency with no rate.
    await aControl(9, { condition: NAIVE });

    const switched = await switchOn("org_456", "high-value-payment", 9);

    expect(switched.kind).toBe("refused");
    expect(switched.results.filter((r) => r.expected !== r.got).map((r) => r.case)).toStrictEqual([
      3, 5,
    ]);
    expect(switched.kind === "refused" && switched.why).toMatch(/case 3/);
    expect(await controlsInForce("org_456", "payment.create")).toStrictEqual([]);
    expect((await controlsOf("org_456")).find((c) => c.version === 9)?.status).toBe("in_review");
  });

  it("DSOR-CTL-02e: a case's rates are its own, and the company's rate service is never asked", async () => {
    // Off, the service would make every case in rupees fail; the cases pin 280 to the dollar.
    useRateService("org_456", null);

    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
  });

  it("DSOR-CTL-01a: a control that does not match control.schema.json is not switched on", async () => {
    // No owner: §17 asks for a named human who answers for it.
    await asTheOwner(() =>
      db.query(
        `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
         SELECT tenant, id, 10, operation, status, (record - 'owner') || '{"version": 10}'::jsonb
           FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`,
      ),
    );

    const switched = await switchOn("org_456", "high-value-payment", 10);

    expect(switched.kind).toBe("refused");
    expect(switched.kind === "refused" && switched.why).toMatch(/control\.schema\.json.*owner/);
  });

  it("DSOR-CTL-06: a condition that names the request is not switched on", async () => {
    await aControl(11, { condition: 'request.rates.PKR == "1000000"' });

    const switched = await switchOn("org_456", "high-value-payment", 11);

    expect(switched.kind === "refused" && switched.why).toMatch(/request/);
  });

  it("DSOR-AUT-02a: an effect this program cannot carry out is not switched on", async () => {
    // A fresh login is §26's, and this program has no way to ask for one yet.
    await aControl(12, { effect: { require_step_up: { acr: "mfa" } } });

    const switched = await switchOn("org_456", "high-value-payment", 12);

    expect(switched.kind === "refused" && switched.why).toMatch(/require_step_up/);
  });

  it("DSOR-CTL-02c: a control in force is not switched on twice, and a second version not beside it", async () => {
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("refused");

    await aControl(13, {});
    const second = await switchOn("org_456", "high-value-payment", 13);

    expect(second.kind === "refused" && second.why).toMatch(/version 8 is in force/);
  });

  it("DSOR-CTL-02c: a control that does not exist is not switched on", async () => {
    const switched = await switchOn("org_456", "no-such-control", 1);

    expect(switched.kind === "refused" && switched.why).toMatch(/no control/);
  });

  it("DSOR-MOD-01: org_789 cannot switch on org_456's control", async () => {
    const switched = await switchOn("org_789", "high-value-payment", 8);

    expect(switched.kind === "refused" && switched.why).toMatch(/no control/);
    expect(await controlsInForce("org_456", "payment.create")).toStrictEqual([]);
  });
});

describe("evaluating one control", () => {
  /** The eight variables for a payment of this amount. */
  const aPaymentOf = (value: string, currency: string): ConditionInput => ({
    input: { amount: { value, currency } },
    state: {},
    principal: { id: "accounts-payable-fte", type: "agent", roles: ["ap_agent"] },
    actor_chain: ["accounts-payable-fte"],
    delegation: null,
    tenant: { id: "org_456" },
    risk: "medium",
    now: new Date("2026-10-19T12:00:00.000Z"),
  });
  const story = (currency: string): string => {
    const rate = ({ USD: "1", PKR: "280" } as Record<string, string>)[currency];

    if (rate === undefined) {
      throw new Error(`there is no rate for ${currency}`);
    }

    return rate;
  };
  let cfo: Control;

  beforeEach(async () => {
    const [control] = await controlsOf("org_456");

    if (control === undefined) {
      throw new Error("the story has no CFO control");
    }

    cfo = control;
  });

  it("DSOR-AUT-02a: above 25,000 USD the CFO's control requires approval, by the CFO, one of them", () => {
    const evaluated = evaluateControl(cfo, aPaymentOf("31400.00", "USD"), story);

    expect(evaluated.outcome).toBe("REQUIRE_APPROVAL");
    expect(evaluated.requires).toStrictEqual({ role: "CFO", quorum: 1 });
    expect(evaluated.authority).toMatchObject({
      uri: "ksor://org_456/finance/payment-approval-policy",
      version: 4,
    });
  });

  it("DSOR-AUT-02a: at or below it, ALLOW", () => {
    expect(evaluateControl(cfo, aPaymentOf("25000.00", "USD"), story).outcome).toBe("ALLOW");
  });

  it("DSOR-CTL-07: a currency with no rate applies the control, and says why", () => {
    const evaluated = evaluateControl(cfo, aPaymentOf("100.00", "XXX"), story);

    expect(evaluated.outcome).toBe("REQUIRE_APPROVAL");
    expect(evaluated.evaluation_error).toMatch(/XXX/);
  });

  it("DSOR-CTL-07: a missing field applies the control too", () => {
    const noAmount = { ...aPaymentOf("1.00", "USD"), input: {} };

    expect(evaluateControl(cfo, noAmount, story).outcome).toBe("REQUIRE_APPROVAL");
  });

  it("DSOR-AUT-02b: the most restrictive outcome wins", () => {
    expect(mostRestrictive([])).toBe("ALLOW");
    expect(mostRestrictive(["ALLOW", "ALLOW"])).toBe("ALLOW");
    expect(mostRestrictive(["ALLOW", "REQUIRE_APPROVAL"])).toBe("REQUIRE_APPROVAL");
    expect(mostRestrictive(["REQUIRE_APPROVAL", "DENY", "ALLOW"])).toBe("DENY");
  });
});
