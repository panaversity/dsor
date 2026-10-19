// STEP 26: a slip's limits, for bills in other currencies (decision 159).
//
// Rule DSOR-MON-03: a monetary threshold in a control or delegation MUST be compared only through
// the dsor_* money functions, which convert both operands to the threshold's currency using the
// tenant's rate source.
// Rule DSOR-MON-04: when an amount cannot be converted — unknown currency, no rate, or a rate older
// than max_rate_age — the comparison MUST resolve restrictively: a control's condition evaluates to
// true, and a delegation limit is treated as exceeded.
// Rule DSOR-MON-06: a cumulative limit MUST accumulate in the limit's own currency, converting each
// reservation at the rate in force when the reservation is taken.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSlipFor } from "../src/delegation.ts";
import { refusal } from "../src/envelopes.ts";
import { callOperation, type OperationAnswer, PIPELINE } from "../src/operations.ts";
import { paymentsOf } from "../src/payment.ts";
import { aRateService, MAX_RATE_AGE_MS, useRateService } from "../src/rates.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import { usedToday } from "../src/reservation.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { makeDoor } from "./support/door.ts";
import { onOneDay } from "./support/one-day.ts";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
/** 2,800,000.00 PKR, from migration 027. */
const INV_1010 = "dsor://org_456/invoice/INV-1010";
/** 45,000.00 GBP, from migration 027. */
const INV_1011 = "dsor://org_456/invoice/INV-1011";

const pay = (
  invoice: string,
  value: string,
  currency: string,
  mode?: string,
): Promise<OperationAnswer> =>
  callOperation(
    AGENT,
    "payment.create",
    { invoice, amount: { value, currency } },
    { idempotencyKey: `money-${Math.random()}`, ...(mode === undefined ? {} : { mode }) },
  );

/** How much of del_100's day is taken. */
const theDay = (): Promise<string> => usedToday("org_456", "del_100");

/** Four dollar payments within 50,000.00 each, which leave del_100's day 1.00 USD from full. */
async function fillTheDayToOneDollarShort(): Promise<void> {
  for (const value of ["50000.00", "50000.00", "50000.00", "49999.00"]) {
    expect(outcome(await pay(INV_1008, value, "USD")), value).toBe("result");
  }

  expect(await theDay()).toBe("199999.00");
}

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

describe("DSOR-MON-06: del_100's day counts a bill in another currency in dollars", () => {
  it("DSOR-MON-06: 2,800,000.00 PKR is paid under both of del_100's limits, and the day counts 10,000.00 USD", (context) =>
    onOneDay(context, async () => {
      expect(outcome(await pay(INV_1010, "2800000.00", "PKR"))).toBe("result");
      expect(await theDay()).toBe("10000.00");
    }));

  it("DSOR-MON-06: 1,000,000.00 PKR counts as 3,571.43 USD, rounded up", (context) =>
    onOneDay(context, async () => {
      expect(outcome(await pay(INV_1010, "1000000.00", "PKR"))).toBe("result");
      expect(await theDay()).toBe("3571.43");
    }));

  it("DSOR-MON-06: 280.00 PKR takes the day's last dollar, and one hundredth of a rupee more is refused", (context) =>
    onOneDay(context, async () => {
      await fillTheDayToOneDollarShort();

      // 280.00 PKR is 1.00 USD exactly: the day is full, and not past.
      expect(outcome(await pay(INV_1010, "280.00", "PKR"))).toBe("result");
      expect(await theDay()).toBe("200000.00");

      // 0.01 PKR is 0.0000357... USD, and the day counts it as 0.01. Rounded down, it would count
      // as nothing, and fit in a full day.
      expect(outcome(await pay(INV_1010, "0.01", "PKR"))).toBe(
        "LIMIT_EXCEEDED: 0.01 PKR would take del_100 past its limit of 200000.00 USD a day",
      );
      expect(await theDay()).toBe("200000.00");
    }));

  it("DSOR-MON-06: a rupee payment that fails gives back what it booked, though the rate has moved since", (context) =>
    onOneDay(context, async () => {
      // The handler moves the rupee to 28 to the dollar, then refuses as nothing done, so the
      // payment is FAILED and its reservation released. 1,000,000.00 PKR booked 3,571.43 USD,
      // rounded up; given back at the new rate it would be 35,714.29 (decision 160: an amount that
      // converts with a remainder, so a release that rounded again would leave a cent behind).
      const door = makeDoor(PIPELINE, {
        "payment.create": (_args, _contract, askedBy, _tenant, _hash, requestId) => {
          useRateService("org_456", aRateService("org_456", { rates: { PKR: "28" } }));

          return {
            kind: "error",
            askedBy,
            envelope: refusal("RESOURCE_NOT_FOUND", "no such invoice", requestId, askedBy),
          };
        },
      });

      expect(outcome(await pay(INV_1008, "31400.00", "USD"))).toBe("result");

      const answer = await door(
        AGENT,
        "payment.create",
        { invoice: INV_1010, amount: { value: "1000000.00", currency: "PKR" } },
        { idempotencyKey: "pay-and-the-rate-moves" },
      );

      expect(outcome(answer)).toBe("RESOURCE_NOT_FOUND: no such invoice");
      expect(await theDay()).toBe("31400.00");
    }));
});

describe("DSOR-MON-04: a bill that cannot be converted counts as over del_100's day", () => {
  it("DSOR-MON-04: with only a daily limit and the rate service down, a rupee bill is refused, and the day books nothing", async () => {
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations
                  SET per_transaction_limit_value = NULL, per_transaction_limit_currency = NULL
                WHERE tenant = 'org_456' AND id = 'del_100'`),
    );
    useRateService("org_456", aRateService("org_456", { down: true }));

    expect(outcome(await pay(INV_1010, "2800000.00", "PKR"))).toBe(
      "LIMIT_EXCEEDED: 2800000.00 PKR cannot be compared with del_100's limit of 200000.00 USD a day, so it is refused: org_456's rate service did not answer",
    );
    expect(await theDay()).toBe("0.00");
  });
});

describe("DSOR-OPR-06: a dry run of a bill in another currency", () => {
  it("DSOR-OPR-06: a dry run counts the converted amount, rounded up, and books nothing", (context) =>
    onOneDay(context, async () => {
      await fillTheDayToOneDollarShort();

      expect(outcome(await pay(INV_1010, "280.00", "PKR", "validate_only"))).toBe("result");
      // 280.01 PKR is 1.0000357... USD, counted as 1.01: one cent past the day.
      expect(outcome(await pay(INV_1010, "280.01", "PKR", "validate_only"))).toBe(
        "LIMIT_EXCEEDED: 280.01 PKR would take del_100 past its limit of 200000.00 USD a day",
      );
      expect(await theDay()).toBe("199999.00");
    }));
});

describe("decision 160: what the review found untested", () => {
  it("DSOR-MON-04: a dry run of a bill that cannot be converted is refused too, and books nothing", async () => {
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations
                  SET per_transaction_limit_value = NULL, per_transaction_limit_currency = NULL
                WHERE tenant = 'org_456' AND id = 'del_100'`),
    );
    useRateService("org_456", aRateService("org_456", { down: true }));

    expect(outcome(await pay(INV_1010, "2800000.00", "PKR", "validate_only"))).toBe(
      "LIMIT_EXCEEDED: 2800000.00 PKR cannot be compared with del_100's limit of 200000.00 USD a day, so it is refused: org_456's rate service did not answer",
    );
    expect(await theDay()).toBe("0.00");
  });

  it("DSOR-MON-03: rates planted in the request's arguments, through the door, change nothing", async () => {
    // Fields a contract does not name survive validation (decision 155), so these reach §21.10.
    const answer = await callOperation(
      AGENT,
      "payment.create",
      {
        invoice: INV_1011,
        amount: { value: "45000.00", currency: "GBP", rate: "100" },
        rate: "100",
        rates: { USD: "1", GBP: "100" },
      },
      { idempotencyKey: "planted-rates" },
    );

    expect(outcome(answer)).toBe(
      "LIMIT_EXCEEDED: 45000.00 GBP is above del_100's limit of 50000.00 USD a payment",
    );
  });
});
