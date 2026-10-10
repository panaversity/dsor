// NEW IN STEP 26: each company's sheets of exchange rates, on the database (step 26's README,
// claims C5 and C8). A sheet is rows of dsor.rates, behind its company's lock, written once,
// each rate above zero and its base at 1, and its age is counted by the database's clock. A
// sheet is never removed, so each run loads a source of its own, or a time of its own.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RateSheet } from "../src/exchange.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import {
  createDbLog,
  createDbProposals,
  createDbRates,
  createDbReservations,
} from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  callsWaiting,
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerInvoices,
  ownerLimits,
  ownerRates,
  poolOfOne,
  tryThenRollBack,
} from "./db.ts";
import { keyed, storyDirectories, withPlanted } from "./helpers.ts";

const observer = newPool();
const pool = newPool();
const rates = createDbRates(pool);
afterAll(async () => {
  await observer.end();
  await pool.end();
});

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// This run's own source, so its sheets meet no sheet of another run.
const SOURCE = `ecb-test-${randomUUID().slice(0, 8)}`;

/** The database's clock now, moved by this many hours. */
async function hoursFromNow(hours: number): Promise<string> {
  const { rows } = await observer.query<{ at: Date }>(
    "SELECT now() + $1::int * interval '1 hour' AS at",
    [hours],
  );
  return rows[0]!.at.toISOString();
}

/** A sheet of this run's source, published at this time, as a loader sends it. */
function sent(published_at: string, extra: Record<string, string> = {}): RateSheet {
  return {
    source: SOURCE,
    base: "EUR",
    published_at,
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40", ...extra },
  };
}

/** One statement as dsor_runtime inside a company, rolled back after, and its rows. */
async function rowsOf(sql: string, tenant: string, values: unknown[] = []) {
  return (await tryThenRollBack(observer, sql, tenant, values)).rows;
}

describe("C8: the sheets, on the database", () => {
  it("Step 26: on the database, a sheet is kept as its source wrote it, with its base at 1, and is the newest of its source (step 26's README, decisions D3 and D9)", async () => {
    const published_at = await hoursFromNow(-2);
    expect(await rates.load("org_456", sent(published_at))).toBe("loaded");
    expect(await rates.newest("org_456", SOURCE, 3 * HOUR_MS)).toStrictEqual({
      sheet: {
        source: SOURCE,
        base: "EUR",
        published_at,
        rates: { EUR: "1", USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
      },
      fresh: true,
    });
  });

  // The program's clock ten days ahead, then ten days behind: the database's clock decides. Found
  // by step 26's review: on one machine the two clocks agree, so an age counted by the program's
  // clock passed too.
  it("Step 26: on the database, a sheet's age is counted from its publication by the database's clock, whatever the program's clock says (step 26's README, decisions L4 and D5)", async () => {
    const source = `${SOURCE}-age`;
    await rates.load("org_456", { ...sent(await hoursFromNow(-2)), source });
    for (const days of [10, -10]) {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + days * DAY_MS);
        expect((await rates.newest("org_456", source, 1 * HOUR_MS))?.fresh).toBe(false);
        expect((await rates.newest("org_456", source, 3 * HOUR_MS))?.fresh).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("Step 26: on the database, a sheet in the future is found by the database's clock, whatever the program's clock says: an hour ago loads with the program's clock ten days behind, and an hour ahead is refused with it ten days ahead (step 26's README, decisions L4 and D5)", async () => {
    const source = `${SOURCE}-clock`;
    const past = await hoursFromNow(-1);
    const ahead = await hoursFromNow(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() - 10 * DAY_MS);
      expect(await rates.wouldLoad("org_456", source, past)).toBe("loaded");
      expect(await rates.load("org_456", { ...sent(past), source })).toBe("loaded");
      expect(await rates.wouldLoad("org_456", source, past)).toBe("exists");
      vi.setSystemTime(Date.now() + 20 * DAY_MS);
      expect(await rates.wouldLoad("org_456", source, ahead)).toBe("future");
      expect(await rates.load("org_456", { ...sent(ahead), source })).toBe("future");
    } finally {
      vi.useRealTimers();
    }
  });

  // Found by step 26's review: no test loaded an older sheet after a newer one.
  it("Step 26: on the database, the newest sheet is the one published last, not the one loaded last (step 26's README, decision D4)", async () => {
    const source = `${SOURCE}-order`;
    await rates.load("org_456", { ...sent(await hoursFromNow(-1), { JPY: "160.10" }), source });
    await rates.load("org_456", { ...sent(await hoursFromNow(-2)), source });
    const newest = await rates.newest("org_456", source, 3 * HOUR_MS);
    expect(Object.keys(newest?.sheet.rates ?? {}).sort()).toStrictEqual([
      "EUR",
      "GBP",
      "JPY",
      "PKR",
      "USD",
    ]);
  });

  it("Step 26: on the database, a sheet is written once, and a sheet published after the database's clock is refused (step 26's README, decisions D5 and D6)", async () => {
    const source = `${SOURCE}-once`;
    const published_at = await hoursFromNow(-1);
    expect(await rates.load("org_456", { ...sent(published_at), source })).toBe("loaded");
    const again = { ...sent(published_at, { JPY: "160.10" }), source };
    expect(await rates.load("org_456", again)).toBe("exists");
    const kept = await rates.newest("org_456", source, 3 * HOUR_MS);
    expect(Object.keys(kept?.sheet.rates ?? {}).sort()).toStrictEqual(["EUR", "GBP", "PKR", "USD"]);
    const later = { ...sent(await hoursFromNow(1)), source };
    expect(await rates.load("org_456", later)).toBe("future");
  });

  // Found by step 26's sweep of small breaks: with the one-base index gone, every test stayed
  // green. Each second sheet shared a currency with the first, so the primary key refused it. A
  // sheet with another base and other currencies meets the index alone.
  it("Step 26: on the database, a second sheet of one source and time is refused, though its base and its currencies are all others, so two sheets never mix (step 26's README, decision D6)", async () => {
    const source = `${SOURCE}-mix`;
    const published_at = await hoursFromNow(-1);
    expect(await rates.load("org_456", { ...sent(published_at), source })).toBe("loaded");
    const other = { source, base: "JPY", published_at, rates: { CHF: "0.0054" } };
    expect(await rates.load("org_456", other)).toBe("exists");
    expect((await rates.newest("org_456", source, 3 * HOUR_MS))?.sheet.rates).toStrictEqual({
      EUR: "1",
      USD: "1.0800",
      GBP: "0.8532",
      PKR: "302.40",
    });
  });

  it("DSOR-TEN-01b: on the database, org_789 reads none of org_456's sheets, and its own store finds none", async () => {
    const source = `${SOURCE}-lock`;
    await rates.load("org_456", { ...sent(await hoursFromNow(-1)), source });
    const count = "SELECT count(*)::int AS n FROM dsor.rates WHERE source = $1";
    expect(await rowsOf(count, "org_456", [source])).toStrictEqual([{ n: 4 }]);
    expect(await rowsOf(count, "org_789", [source])).toStrictEqual([{ n: 0 }]);
    expect(await rates.newest("org_789", source, 3 * HOUR_MS)).toBeUndefined();
  });

  // Found by step 26's sweep of small breaks: with the company gone from DSoR's own WHERE, every
  // test stayed green, because the database's lock kept each sheet inside its company. The owner
  // holds BYPASSRLS, so only DSoR's own WHERE filters what the store gives it.
  it("DSOR-TEN-01b: DSoR's own WHERE alone keeps a sheet inside its company: read as the owner, org_456's newest sheet is its own, beside org_789's sheets of one source, one at the same time and one newer, and a sheet at org_789's time is not org_456's", () => {
    expect(ownerRates()).toStrictEqual({
      bypassrls: true,
      newest: { rates: { EUR: "1", USD: "1.0800" }, ours: true },
      wouldLoad: "loaded",
    });
  });

  it("Step 26: on the database, dsor_runtime may not change or remove a rate: a sheet is written once (step 26's README, decision D6)", async () => {
    await expect(
      tryThenRollBack(observer, "UPDATE dsor.rates SET per_base = 2", "org_456"),
    ).rejects.toMatchObject(NO_PRIVILEGE);
    await expect(
      tryThenRollBack(observer, "DELETE FROM dsor.rates", "org_456"),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("Step 26: on the database, dsor_runtime's own INSERT of a rate that is not above zero, or of a base not at 1, is refused by the database's CHECK (step 26's README, claim C8)", async () => {
    const insert = `INSERT INTO dsor.rates (tenant_id, source, published_at, base, currency, per_base)
                    VALUES ('org_456', $1, now() - interval '1 hour', 'EUR', $2, $3)`;
    for (const [currency, rate] of [
      ["USD", "0"],
      ["USD", "-1.08"],
      ["EUR", "1.0001"],
    ]) {
      await expect(
        tryThenRollBack(observer, insert, "org_456", [`${SOURCE}-check`, currency, rate]),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      tryThenRollBack(observer, insert, "org_456", [`${SOURCE}-check`, "USD", "1.0800"]),
    ).resolves.toBeDefined();
  });
});

describe("C5: rate.load on the database", () => {
  const log = createDbLog(pool);
  const registry = dbRegistry(pool);
  const proposals = createDbProposals(pool);
  const RATES: RequestEnvelope = { token: "tok_3b8f", tenant: "org_456" };
  /** org_456's sheet of ecb-daily, published at this time, as dsor-rates sends it. */
  const sheetAt = (published_at: string) => ({
    company: "dsor://org_456/tenant/org_456",
    source: "ecb-daily",
    base: "EUR",
    published_at,
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  /** How many rows org_456's sheets of ecb-daily hold at this time. */
  const rowsAt = async (published_at: string) =>
    rowsOf(
      "SELECT count(*)::int AS n FROM dsor.rates WHERE source = 'ecb-daily' AND published_at = $1",
      "org_456",
      [published_at],
    );

  // Found by step 26's review: both were refused inside the work, after DSoR had said yes.
  it("Step 26: on the database, a sheet that is there already, or one published after the database's clock, is refused at line ⑨: its proposal ends DENIED, and its record says DENY (step 26's README, decisions D5 and D6)", async () => {
    const published_at = await hoursFromNow(-1);
    expect(
      await call(registry, log, keyed(RATES), "rate.load", sheetAt(published_at)),
    ).toMatchObject({ outcome: "COMMITTED" });
    const again = sheetAt(published_at);
    const later = sheetAt(await hoursFromNow(1));
    for (const [sheet, code] of [
      [again, "CONFLICT"],
      [later, "VALIDATION_FAILED"],
    ] as const) {
      const answer = await call(registry, log, keyed(RATES), "rate.load", sheet);
      expect(answer).toMatchObject({ code });
      const id = String("proposal" in answer ? answer.proposal : "")
        .split("/")
        .at(-1)!;
      expect((await proposals.get("org_456", id))?.state).toBe("DENIED");
      const records = await rowsOf(
        `SELECT "authorization", result FROM dsor.audit
          WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
        "org_456",
        [answer.correlation.request_id],
      );
      expect(records).toStrictEqual([{ authorization: "DENY", result: code }]);
    }
    expect(await rowsAt(published_at)).toStrictEqual([{ n: 4 }]);
  });

  // Found by step 26's review: no test sent one sheet twice at one moment. Here the first load
  // waits inside its claim, after its insert, until the second has passed line ⑨ and waits at the
  // one-base index. Then the first commits, and the second meets it there.
  it("Step 26: on the database, two loads of one sheet at one moment, with two keys, write it once: both pass line ⑨, the first is COMMITTED, and the second meets it at the one-base index and hears CONFLICT (step 26's README, decision D6)", async () => {
    const shipped = ownWorkFor();
    const load = shipped["rate.load"]!;
    let inserted!: () => void;
    let release!: () => void;
    const insertedYet = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = dbRegistry(pool, storyDirectories(), handlersFor(), {
      ...shipped,
      "rate.load": {
        check: load.check,
        change: async (input, work) => {
          const answer = await load.change(input, work);
          inserted();
          await released;
          return answer;
        },
      },
    });
    const sheet = sheetAt(await hoursFromNow(-1));
    const first = call(holding, log, keyed(RATES), "rate.load", sheet);
    await insertedYet;
    const second = call(registry, log, keyed(RATES), "rate.load", sheet);
    await callsWaiting(observer, 1);
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(one).toMatchObject({ outcome: "COMMITTED" });
    expect(two).toMatchObject({ code: "CONFLICT" });
    // The second said yes at line ⑨ and met the first in the work, so its proposal ended FAILED.
    const id = String("proposal" in two ? two.proposal : "")
      .split("/")
      .at(-1)!;
    expect((await proposals.get("org_456", id))?.state).toBe("FAILED");
    expect(await rowsAt(sheet.published_at)).toStrictEqual([{ n: 4 }]);
  });

  // Found by step 26's review: no test broke a load halfway.
  it("Step 26: on the database, an accident after the load rolls the sheet back with the claim (step 26's README, decision D6)", async () => {
    const shipped = ownWorkFor();
    const load = shipped["rate.load"]!;
    const breaking = dbRegistry(pool, storyDirectories(), handlersFor(), {
      ...shipped,
      "rate.load": {
        check: load.check,
        change: async (input, work) => {
          await load.change(input, work);
          throw new Error("the connection dropped after the load");
        },
      },
    });
    const sheet = sheetAt(await hoursFromNow(-1));
    expect(await call(breaking, log, keyed(RATES), "rate.load", sheet)).toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(await rowsAt(sheet.published_at)).toStrictEqual([{ n: 0 }]);
  });
});

describe("C3, C7: line ⑩ on the database", () => {
  const log = createDbLog(pool);
  const registry = dbRegistry(pool);
  const reservations = createDbReservations(pool);
  // intake-fte works under del_190, which the owner adds with step 24's limits, and drafts
  // INV-9001, which the owner makes a bill of 9,000.00 EUR here (step 26's README, decision D14).
  const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
  const intake = {
    id: "intake-fte",
    type: "agent",
    memberships: [{ tenant_id: "org_456", roles: [] }],
  } as unknown as Principal;
  const RATES: RequestEnvelope = { token: "tok_3b8f", tenant: "org_456" };

  it("DSOR-MON-06: on the database, dsor-rates loads org_456's sheet of ecb-daily, and intake-fte's draft of a bill of 9,000.00 EUR converts with the claim's own rates: paid, 9,720.00 USD booked, and its record names the sheet (step 26's README, claims C3 and C7)", async () => {
    ownerInvoices("add", "9000.00", "EUR");
    ownerLimits("add");
    try {
      const published_at = await hoursFromNow(-1);
      const sheet = {
        company: "dsor://org_456/tenant/org_456",
        source: "ecb-daily",
        base: "EUR",
        published_at,
        rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
      };
      expect(await call(registry, log, keyed(RATES), "rate.load", sheet)).toMatchObject({
        outcome: "COMMITTED",
      });
      const drafted: Answer = await withPlanted("tok_intake", intake, () =>
        call(registry, log, keyed(INTAKE), "payment.create", {
          invoice: "dsor://org_456/invoice/INV-9001",
          expected_version: 1,
        }),
      );
      expect(drafted).toMatchObject({ outcome: "COMMITTED" });
      const proposal = String("proposal" in drafted ? drafted.proposal : "")
        .split("/")
        .at(-1)!;
      expect((await reservations.get("org_456", proposal))?.amount).toStrictEqual({
        value: "9720.00",
        currency: "USD",
      });
      const records = await rowsOf(
        `SELECT extensions->'org.panaversity.steps'->'conversion' AS conversion FROM dsor.audit
          WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
        "org_456",
        [drafted.correlation.request_id],
      );
      expect(records).toStrictEqual([
        {
          conversion: {
            source: "ecb-daily",
            published_at,
            base: "EUR",
            rates: { EUR: "1", USD: "1.0800" },
          },
        },
      ]);
    } finally {
      ownerLimits("remove");
      ownerInvoices("remove");
    }
  });

  // Changed by step 26's review, finding H1: the words named the bill's currency, which the
  // agent's clearance hides. Only the record names it now.
  it("DSOR-MON-04: on the database, intake-fte's draft of a bill of 100,000 JPY, which the newest sheet does not list, hears LIMIT_EXCEEDED, no usable rate, with no currency, and its record names the currency and the cause", async () => {
    ownerInvoices("add", "100000", "JPY");
    ownerLimits("add");
    try {
      // A fresh sheet of ecb-daily with no JPY, so the cause is the one this test names.
      const sheet = {
        company: "dsor://org_456/tenant/org_456",
        source: "ecb-daily",
        base: "EUR",
        published_at: await hoursFromNow(-1),
        rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
      };
      expect(await call(registry, log, keyed(RATES), "rate.load", sheet)).toMatchObject({
        outcome: "COMMITTED",
      });
      const drafted: Answer = await withPlanted("tok_intake", intake, () =>
        call(registry, log, keyed(INTAKE), "payment.create", {
          invoice: "dsor://org_456/invoice/INV-9001",
          expected_version: 1,
        }),
      );
      expect(drafted).toMatchObject({
        code: "LIMIT_EXCEEDED",
        message: `"payment.create" would pass slip del_190's limit for one payment: no usable rate`,
      });
      expect(JSON.stringify(drafted)).not.toContain("JPY");
      const records = await rowsOf(
        `SELECT extensions->'org.panaversity.steps'->'unconvertible' AS unconvertible
           FROM dsor.audit
          WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
        "org_456",
        [drafted.correlation.request_id],
      );
      expect(records).toStrictEqual([
        { unconvertible: { currency: "JPY", why: "the newest sheet of ecb-daily has no JPY" } },
      ]);
    } finally {
      ownerLimits("remove");
      ownerInvoices("remove");
    }
  });

  // Found by step 26's review: line ⑩ could read the rates through the pool, outside the claim,
  // and no test could tell. On a pool of one connection the claim holds the only one, so a read
  // outside it would wait for ever.
  it("Step 26: on the database, line ⑩ converts inside the claim, on its own connection: on a pool of one, intake-fte's draft of a bill of 9,000.00 EUR is paid (step 26's README, claim C3)", async () => {
    const one = poolOfOne();
    ownerInvoices("add", "9000.00", "EUR");
    ownerLimits("add");
    try {
      const sheet = {
        company: "dsor://org_456/tenant/org_456",
        source: "ecb-daily",
        base: "EUR",
        published_at: await hoursFromNow(-1),
        rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
      };
      expect(await call(registry, log, keyed(RATES), "rate.load", sheet)).toMatchObject({
        outcome: "COMMITTED",
      });
      const narrow = dbRegistry(one);
      const drafted: Answer = await withPlanted("tok_intake", intake, () =>
        call(narrow, createDbLog(one), keyed(INTAKE), "payment.create", {
          invoice: "dsor://org_456/invoice/INV-9001",
          expected_version: 1,
        }),
      );
      expect(drafted).toMatchObject({ outcome: "COMMITTED" });
    } finally {
      ownerLimits("remove");
      ownerInvoices("remove");
      await one.end();
    }
  });
});
