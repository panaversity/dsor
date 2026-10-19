// Step 38 on the database: payment.reconcile asks the bank by the unknown proposal's key and
// settles it in one transaction: sent, so the proposal is COMMITTED and app.payments says paid;
// never received, so FAILED and the bill is free; an agent is refused; of two reconciles at once,
// one settles and one hears CONFLICT (DSOR-UNK-04a, DSOR-UNK-04d; step 38's README, claims C1 to C7).
// The tests' own invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds and removes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbIntents, createDbLog, inCompany, sweepIntents } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, ownerInvoices, ownerProposals } from "./db.ts";
import { AGENT, keyed, SUPERVISOR } from "./helpers.ts";

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
const intents = createDbIntents(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const CRASH = fileURLToPath(new URL("crash-while-paying.ts", import.meta.url));
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

/** user_123 drafts a payment of INV-9001, on a fresh invoice: its id. */
async function draft(): Promise<string> {
  ownerInvoices("add");
  const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
  return (answer as { data: { id: string } }).data.id;
}

/** user_123 sends this payment of INV-9001. */
function send(id: string, who: RequestEnvelope = keyed(SUPERVISOR)): Promise<Answer> {
  return call(registry, log, who, "payment.execute", {
    invoice: INV_9001,
    payment: `dsor://org_456/payment/${id}`,
    expected_version: 1,
  });
}

/** Someone reconciles this proposal. */
function reconcile(proposal: string, who: RequestEnvelope = SCHEDULER): Promise<Answer> {
  return call(registry, log, keyed(who), "payment.reconcile", {
    proposal: `dsor://org_456/proposal/${proposal}`,
  });
}

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** A payment's status and a proposal's state, as dsor_runtime reads them. */
function statusOf(payment: string, proposal: string): Promise<unknown> {
  return inCompany(pool, "org_456", async (client) => {
    const paid = await client.query("SELECT status FROM app.payments WHERE id = $1", [payment]);
    const moved = await client.query("SELECT state FROM dsor.proposals WHERE id = $1", [proposal]);
    return { payment: paid.rows[0]?.["status"], proposal: moved.rows[0]?.["state"] };
  });
}

/** A payment of INV-9001 sent and gone unknown: its id, its proposal's, and the send's envelope. */
async function unknownPayment(lost = false) {
  const id = await draft();
  const envelope = keyed(SUPERVISOR);
  const pay = bank.pay;
  if (lost) bank.pay = () => new Promise(() => {});
  else bank.mode = "silent";
  const unknown = await send(id, envelope);
  bank.pay = pay;
  bank.mode = "good";
  expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return { id, proposal: idOf(unknown), envelope };
}

describe("C1 and C2: on the database, the bank sent it", () => {
  it("DSOR-UNK-04a: dsor-scheduler reconciles: the proposal is COMMITTED and app.payments says paid, in one transaction; the cancel is not held and changes nothing; the same-key retry answers COMMITTED", async () => {
    const { id, proposal, envelope } = await unknownPayment();
    const settled = await reconcile(proposal);
    expect(settled).toMatchObject({ outcome: "COMMITTED", data: { state: "COMMITTED" } });
    expect(await statusOf(id, proposal)).toStrictEqual({ payment: "paid", proposal: "COMMITTED" });
    const cancel = await call(registry, log, keyed(SUPERVISOR), "payment.cancel", {
      payment: `dsor://org_456/payment/${id}`,
      expected_version: 1,
    });
    expect(cancel).not.toMatchObject({ code: "RESOURCE_HELD" });
    expect(cancel).not.toMatchObject({ outcome: "COMMITTED" });
    expect(await send(id, envelope)).toMatchObject({
      outcome: "COMMITTED",
      data: { status: "paid" },
    });
    expect(bank.transfers().filter((t) => t.payment === id)).toHaveLength(1);
  });
});

describe("C3: on the database, the bank never received it", () => {
  it("DSOR-UNK-04a: the order never reached the bank: FAILED, the payment a draft, and a new payment of INV-9001 is drafted", async () => {
    const { id, proposal } = await unknownPayment(true);
    expect(await reconcile(proposal)).toMatchObject({ data: { state: "FAILED" } });
    expect(await statusOf(id, proposal)).toStrictEqual({ payment: "draft", proposal: "FAILED" });
    const again = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
      invoice: INV_9001,
      expected_version: 1,
    });
    expect(again).toMatchObject({ outcome: "COMMITTED" });
  });

  it(
    "DSOR-UNK-04a: after a real SIGKILL and the start-up sweep, the bank this program can ask has no payment under the key: FAILED, and the hold lifts",
    { timeout: 120_000 },
    async () => {
      const id = await draft();
      const envelope = keyed(SUPERVISOR);
      const child = spawnSync(process.execPath, [CRASH, id, envelope.idempotency_key], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      expect(await sweepIntents(pool, ["org_456"])).toBe(1);
      const note = await intents.forClaim(
        "org_456",
        "user_123",
        "payment.execute",
        envelope.idempotency_key,
      );
      const proposal = note!.proposal_id;
      // The killed program's fake bank died with it, so this program's bank never received the
      //   order: what a real bank that never got it would say.
      expect(await reconcile(proposal)).toMatchObject({ data: { state: "FAILED" } });
      expect(await statusOf(id, proposal)).toStrictEqual({ payment: "draft", proposal: "FAILED" });
    },
  );
});

describe("C6: on the database, who may settle, and once", () => {
  it("DSOR-UNK-04d: the agent is refused, and the proposal stays OUTCOME_UNKNOWN", async () => {
    const { id, proposal } = await unknownPayment();
    settle.push(proposal);
    expect(await reconcile(proposal, AGENT)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await statusOf(id, proposal)).toStrictEqual({
      payment: "draft",
      proposal: "OUTCOME_UNKNOWN",
    });
  });

  it("DSOR-UNK-04a: two reconciles of one proposal at once: one settles it, the other hears CONFLICT, and the payment is marked paid once", async () => {
    const { id, proposal } = await unknownPayment();
    const both = await Promise.all([reconcile(proposal), reconcile(proposal, SUPERVISOR)]);
    const settled = both.filter((answer) => "outcome" in answer);
    const refused = both.filter((answer) => "code" in answer);
    expect(settled).toHaveLength(1);
    expect(refused).toMatchObject([{ code: "CONFLICT" }]);
    expect(await statusOf(id, proposal)).toStrictEqual({ payment: "paid", proposal: "COMMITTED" });
  });
});
