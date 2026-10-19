// Step 38c on the database: alert.list reads dsor.alerts through dsor_runtime, inside the caller's
// company. user_123 sees the unsettled alert, cfo_100 sees it once escalated, user_700 of org_789
// sees none of org_456's, and the settled one drops off (DSOR-UNK-04b, DSOR-UNK-04c,
// DSOR-TEN-01a; step 38c's README, claim C8).
// The tests' own invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds and removes.
// Their registry escalates after one second, so a test can wait for it.
import { setTimeout as wait } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, ownerInvoices, ownerProposals } from "./db.ts";
import { CFO, keyed, SUPERVISOR, USER_700 } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const bank = createFakeBank();
const none = undefined;
const SECOND = {
  receivers: "ap_supervisor",
  alert_within: "PT0S",
  escalate_after: "PT1S",
  sweep_every: "PT1M",
};
const registry = dbRegistry(
  pool,
  none,
  none,
  none,
  none,
  none,
  none,
  none,
  new Map([["fake-bank", { bank, waitMs: 50 }]]),
  {
    file: "alerts.json",
    text: JSON.stringify({
      org_456: { ...SECOND, escalate_to: "cfo_100" },
      org_789: { ...SECOND, escalate_to: "user_700" },
    }),
  },
);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
// dsor-scheduler, DSoR's own login for scheduled work (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const settle: string[] = [];

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  for (const id of settle) ownerProposals("settle", id);
  ownerInvoices("remove");
  await pool.end();
});

/** The proposals a list names. */
function proposalsIn(answer: Answer): string[] {
  const { items } = (answer as unknown as { data: { items: { proposal: string }[] } }).data;
  return items.map((item) => item.proposal);
}

/** A payment of INV-9001 sent on a silent day: its proposal's address. */
async function unknownPayment(): Promise<string> {
  ownerInvoices("add");
  const drafted = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
  bank.mode = "silent";
  const unknown = await call(registry, log, keyed(SUPERVISOR), "payment.execute", {
    invoice: INV_9001,
    payment: `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`,
    expected_version: 1,
  });
  bank.mode = "good";
  expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return String("proposal" in unknown ? unknown.proposal : "");
}

describe("C8: on the database, each person sees the alerts meant for them", () => {
  it("DSOR-UNK-04c: user_123 sees the open alert and cfo_100 does not; once escalated, cfo_100 sees it; user_700 of org_789 never does; settled, it drops off", async () => {
    const proposal = await unknownPayment();
    // Every page, since other tests' unsettled alerts may be listed before this one.
    const all = async (who: RequestEnvelope): Promise<string[]> => {
      const found: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await call(registry, log, who, "alert.list", cursor ? { cursor } : {});
        found.push(...proposalsIn(page));
        cursor = (page as unknown as { data: { next_cursor?: string } }).data.next_cursor;
      } while (cursor !== undefined);
      return found;
    };
    expect(await all(SUPERVISOR)).toContain(proposal);
    expect(await all(CFO)).not.toContain(proposal);
    await wait(1100);
    await call(registry, log, keyed(SCHEDULER), "alert.escalate_due", {
      company: "dsor://org_456/tenant/org_456",
    });
    expect(await all(CFO)).toContain(proposal);
    expect(await all(USER_700)).toStrictEqual([]);
    const answer = await call(registry, log, SUPERVISOR, "alert.list", {});
    expect(answer).toMatchObject({
      classification: "internal",
      freshness: { mode: "current", connector: "dsor" },
    });
    await call(registry, log, keyed(SCHEDULER), "payment.reconcile", { proposal });
    expect(await all(SUPERVISOR)).not.toContain(proposal);
    expect(await all(CFO)).not.toContain(proposal);
  });
});
