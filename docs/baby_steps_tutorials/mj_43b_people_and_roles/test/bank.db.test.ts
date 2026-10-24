// Step 35 on the database: payment.execute marks the payment paid in app.payments only after the
// bank answers, in the claim's transaction; a silent bank leaves it a draft, its proposal
// OUTCOME_UNKNOWN in dsor.proposals, and a second attempt refused (DSOR-UNK-01b, DSOR-UNK-03a;
// step 35's README, claim C4). The tests' own invoice, INV-9001, 500.00 USD of VENDOR-44, which the
// owner adds and removes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbPayments, createDbProposals } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, ownerInvoices, ownerProposals } from "./db.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const bank = createFakeBank();
const none = undefined;
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
);
const payments = createDbPayments(pool);
const proposals = createDbProposals(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const settle: string[] = [];

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  for (const id of settle) ownerProposals("settle", id);
  ownerInvoices("remove");
  await pool.end();
});

/** user_123 drafts a payment of INV-9001, and gives its id. */
async function draft(): Promise<string> {
  const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
  return (answer as { data: { id: string } }).data.id;
}

/** user_123 sends this payment of INV-9001 through the bank. */
function execute(id: string, who: RequestEnvelope = keyed(SUPERVISOR)): Promise<Answer> {
  return call(registry, log, who, "payment.execute", {
    invoice: INV_9001,
    payment: `dsor://org_456/payment/${id}`,
    expected_version: 1,
  });
}

// A slow bank DSoR waits for, so a cancel can arrive while it sends (step 35's review, F5).
const slowBank = createFakeBank();
slowBank.mode = "slow";
slowBank.slowMs = 400;
const patient = dbRegistry(
  pool,
  none,
  none,
  none,
  none,
  none,
  none,
  none,
  new Map([["fake-bank", { bank: slowBank, waitMs: 3000 }]]),
);

describe("C4: on the database, paid only once the bank has answered", () => {
  it("DSOR-UNK-03a: on the database, a good day: COMMITTED, the row in app.payments is paid at version 2, and the bank sent once", async () => {
    const id = await draft();
    bank.mode = "good";
    expect(await execute(id)).toMatchObject({ outcome: "COMMITTED" });
    expect(await payments.get("org_456", id)).toMatchObject({ status: "paid", version: 2 });
    expect(bank.transfers().filter((t) => t.payment === id)).toHaveLength(1);
  });

  // Step 37: unchanged on the database. Line ⑨ now reads the bound payment under its lock, so the
  //   cancel waits for the send, and then the hold no longer counts: the payment is COMMITTED. In
  //   memory, with no lock, the cancel hears RESOURCE_HELD (step 37's README, decision D6).
  it("step 35's decision D7: on the database, a cancel that arrives while the bank sends waits for the payment's lock, then hears STALE_STATE: the payment moved on to paid", async () => {
    ownerInvoices("add");
    const id = await draft();
    const sending = call(patient, log, keyed(SUPERVISOR), "payment.execute", {
      invoice: INV_9001,
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    // Changed in step 43b: wait until the bank has been asked, the moment the send holds the
    //   payment's lock, not a fixed 150 ms. Found under load: the cancel came first, and heard
    //   RESOURCE_HELD. The bank records a transfer as soon as it is asked, before its slow wait.
    const asked = Date.now();
    while (!slowBank.transfers().some((t) => t.payment === id)) {
      if (Date.now() - asked > 20_000) throw new Error("the bank was never asked");
      await new Promise((done) => setTimeout(done, 10));
    }
    const cancel = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    expect(await sending).toMatchObject({ outcome: "COMMITTED" });
    expect(cancel).toMatchObject({ code: "STALE_STATE" });
    expect(await payments.get("org_456", id)).toMatchObject({ status: "paid", version: 2 });
    expect(slowBank.transfers().filter((t) => t.payment === id)).toHaveLength(1);
  });

  // Changed in step 37: the second attempt hears RESOURCE_HELD, not CONFLICT (step 37's README, D3).
  it("DSOR-UNK-01b: on the database, a silent bank: OUTCOME_UNKNOWN, the row in app.payments still a draft, its proposal OUTCOME_UNKNOWN, and a second attempt refused with RESOURCE_HELD", async () => {
    ownerInvoices("add");
    const id = await draft();
    bank.mode = "silent";
    const unknown = await execute(id);
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    const proposal = String("proposal" in unknown ? unknown.proposal : "")
      .split("/")
      .at(-1)!;
    settle.push(proposal);
    expect((await proposals.get("org_456", proposal))?.state).toBe("OUTCOME_UNKNOWN");
    expect(await payments.get("org_456", id)).toMatchObject({ status: "draft", version: 1 });
    bank.mode = "good";
    expect(await execute(id)).toMatchObject({ code: "RESOURCE_HELD" });
    expect(bank.transfers().filter((t) => t.payment === id)).toHaveLength(1);
  });
});
