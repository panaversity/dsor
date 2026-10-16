// NEW IN STEP 26: a slip's limits, for bills in other currencies (decision 159).
//
// Rule DSOR-MON-03: a monetary threshold in a control or delegation MUST be compared only through
// the dsor_* money functions, which convert both operands to the threshold's currency using the
// tenant's rate source.
// Rule DSOR-MON-04: when an amount cannot be converted — unknown currency, no rate, or a rate older
// than max_rate_age — the comparison MUST resolve restrictively: a control's condition evaluates to
// true, and a delegation limit is treated as exceeded.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSlipFor } from "../src/delegation.ts";
import { callOperation, type OperationAnswer, PIPELINE } from "../src/operations.ts";
import { paymentsOf } from "../src/payment.ts";
import { aRateService, MAX_RATE_AGE_MS, useRateService } from "../src/rates.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
/** 2,800,000.00 PKR, from migration 027. */
const INV_1010 = "dsor://org_456/invoice/INV-1010";
/** 45,000.00 GBP, from migration 027. */
const INV_1011 = "dsor://org_456/invoice/INV-1011";

const pay = (invoice: string, value: string, currency: string): Promise<OperationAnswer> =>
  callOperation(
    AGENT,
    "payment.create",
    { invoice, amount: { value, currency } },
    { idempotencyKey: `money-${Math.random()}` },
  );

/** A refusal's code and message, or the kind of answer it was when it was not refused. */
const outcome = (answer: OperationAnswer): string =>
  answer.kind === "error" ? `${answer.envelope.code}: ${answer.envelope.message}` : answer.kind;

/** org_456's payments, as "PAY-902 2800000.00 PKR". */
const payments = async (): Promise<string[]> =>
  (await paymentsOf("org_456")).map((p) => `${p.id} ${p.amount.value} ${p.amount.currency}`);

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
});

afterEach(() => {
  useRateService("org_456", undefined);
  vi.restoreAllMocks();
});

/** del_100 with its limit per payment and no daily limit, so that one limit is asked alone. */
const onlyTheLimitPerPayment = (): Promise<void> =>
  asTheOwner(() =>
    db.exec(`UPDATE dsor.delegations SET daily_limit_value = NULL, daily_limit_currency = NULL
              WHERE tenant = 'org_456' AND id = 'del_100'`),
  ).then(() => undefined);

describe("DSOR-MON-03: del_100's limit per payment, for a bill in another currency", () => {
  beforeEach(onlyTheLimitPerPayment);

  it("DSOR-MON-03: 2,800,000.00 PKR is 10,000.00 USD, within 50,000.00 USD a payment, and is paid", async () => {
    expect(outcome(await pay(INV_1010, "2800000.00", "PKR"))).toBe("result");
    expect(await payments()).toStrictEqual(["PAY-901 31400.00 USD", "PAY-902 2800000.00 PKR"]);
  });

  it("DSOR-MON-03: 45,000.00 GBP is above 50,000.00 USD a payment, though 45,000 is less than 50,000", async () => {
    expect(outcome(await pay(INV_1011, "45000.00", "GBP"))).toBe(
      "LIMIT_EXCEEDED: 45000.00 GBP is above del_100's limit of 50000.00 USD a payment",
    );
    expect(await payments()).toStrictEqual(["PAY-901 31400.00 USD"]);
  });

  it("DSOR-MON-03: 14,000,000.00 PKR is exactly 50,000.00 USD, within the limit, and one paisa more is not", async () => {
    expect(outcome(await pay(INV_1010, "14000000.00", "PKR"))).toBe("result");
    expect(outcome(await pay(INV_1010, "14000000.01", "PKR"))).toBe(
      "LIMIT_EXCEEDED: 14000000.01 PKR is above del_100's limit of 50000.00 USD a payment",
    );
  });

  it("DSOR-MON-03: the rate is the company's service's, and a rate in the request changes nothing", async () => {
    // The stage alone, with a request that carries its own rates: a pound worth a hundredth of a
    // dollar would make 45,000.00 GBP 450.00 USD. Nothing the caller sends is a rate.
    const stage = PIPELINE.find((s) => s.name === "check the slip's limit");
    const found = await activeSlipFor("org_456", "accounts-payable-fte");

    if (stage === undefined || found.kind !== "one") {
      throw new Error("the pipeline has no stage that checks the slip's limit, or del_100 is gone");
    }

    const checked = await stage.run({
      login: undefined,
      id: "payment.create",
      args: {},
      requestId: "req_its_own_rates",
      tenant: "org_456",
      contract: loadRegistry(contractsFromDisk()).get("payment.create"),
      delegation: found.slip,
      mode: "execute",
      given: {
        invoice: INV_1011,
        amount: { value: "45000.00", currency: "GBP", rate: "100" },
        rate: "100",
        rates: { USD: "1", GBP: "100" },
      },
    });

    expect(
      checked.kind === "refused" && checked.answer.kind === "error" && checked.answer.envelope,
    ).toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: "45000.00 GBP is above del_100's limit of 50000.00 USD a payment",
    });
  });
});

describe("DSOR-MON-04: a bill that cannot be converted counts as over del_100's limit", () => {
  beforeEach(onlyTheLimitPerPayment);

  it("DSOR-MON-04: with the rate service down, the rupee bill is refused, and a dollar bill is still paid", async () => {
    useRateService("org_456", aRateService("org_456", { down: true }));

    expect(outcome(await pay(INV_1010, "2800000.00", "PKR"))).toBe(
      "LIMIT_EXCEEDED: 2800000.00 PKR cannot be compared with del_100's limit of 50000.00 USD a payment, so it is refused: org_456's rate service did not answer",
    );
    // Two amounts in one currency need no rate, so the dollar bill does not wait for the service.
    expect(outcome(await pay(INV_1008, "31400.00", "USD"))).toBe("result");
    expect(await payments()).toStrictEqual(["PAY-901 31400.00 USD", "PAY-902 31400.00 USD"]);
  });

  it("DSOR-MON-04: with rates more than three days old, the rupee bill is refused", async () => {
    const now = Date.now();

    useRateService(
      "org_456",
      aRateService("org_456", { asOf: new Date(now - MAX_RATE_AGE_MS - 60_000).toISOString() }),
    );

    expect(outcome(await pay(INV_1010, "2800000.00", "PKR"))).toBe(
      "LIMIT_EXCEEDED: 2800000.00 PKR cannot be compared with del_100's limit of 50000.00 USD a payment, so it is refused: org_456's newest rates are more than three days old",
    );
    expect(await payments()).toStrictEqual(["PAY-901 31400.00 USD"]);
  });

  it("DSOR-MON-04: with no rate service at all, the rupee bill is refused", async () => {
    useRateService("org_456", null);

    expect(outcome(await pay(INV_1010, "2800000.00", "PKR"))).toBe(
      "LIMIT_EXCEEDED: 2800000.00 PKR cannot be compared with del_100's limit of 50000.00 USD a payment, so it is refused: org_456 has no rate service to ask",
    );
  });

  it("DSOR-MON-04: a bill in a currency the service has no rate for is refused", async () => {
    expect(outcome(await pay(INV_1008, "10.00", "EUR"))).toBe(
      "LIMIT_EXCEEDED: 10.00 EUR cannot be compared with del_100's limit of 50000.00 USD a payment, so it is refused: there is no rate for EUR",
    );
    expect(await payments()).toStrictEqual(["PAY-901 31400.00 USD"]);
  });
});
