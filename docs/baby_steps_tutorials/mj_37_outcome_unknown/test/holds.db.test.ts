// Step 37 on the database: before payment.execute asks the bank, dsor.holds holds the payment and
// its invoice, committed with step 36's note. While the proposal is EXECUTING or OUTCOME_UNKNOWN, a
// cancel, a new draft, and a second send hear RESOURCE_HELD; a crash leaves the holds standing; the
// proposal settled frees them (DSOR-UNK-03b; step 37's README, claims C1 to C4). The tests' own
// invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds and removes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbIntents, createDbLog, inCompany, sweepIntents } from "../src/postgres.ts";
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
const intents = createDbIntents(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const CRASH = fileURLToPath(new URL("crash-while-paying.ts", import.meta.url));
const HELD = { code: "RESOURCE_HELD", retry: "after_reconciliation" };
const settle: string[] = [];

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  for (const id of settle) ownerProposals("settle", id);
  ownerInvoices("remove");
  await pool.end();
});

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

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

/** user_123 cancels this payment. */
function cancel(id: string, who: RequestEnvelope = keyed(SUPERVISOR)): Promise<Answer> {
  return call(registry, log, who, "payment.cancel", {
    payment: `dsor://org_456/payment/${id}`,
    expected_version: 1,
  });
}

/** The holds of one proposal, in this company, as dsor_runtime reads them. */
function holdsOf(proposal: string, tenant = "org_456"): Promise<unknown[]> {
  return inCompany(pool, tenant, async (client) => {
    const { rows } = await client.query(
      "SELECT resource FROM dsor.holds WHERE proposal_id = $1 ORDER BY resource",
      [proposal],
    );
    return rows.map((row) => row["resource"]);
  });
}

/** A payment of INV-9001 sent on a silent day: its id, and its proposal's. */
async function unknownPayment(): Promise<{ id: string; proposal: string }> {
  const id = await draft();
  bank.mode = "silent";
  const unknown = await send(id);
  bank.mode = "good";
  expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  settle.push(idOf(unknown));
  return { id, proposal: idOf(unknown) };
}

describe("C1: on the database, the holds are committed with the note", () => {
  it("DSOR-UNK-03b: a silent bank: dsor.holds holds the payment and INV-9001 for the unknown proposal", async () => {
    const { id, proposal } = await unknownPayment();
    expect(await holdsOf(proposal)).toStrictEqual([INV_9001, `dsor://org_456/payment/${id}`]);
  });

  it("DSOR-UNK-03b: another company reads none of org_456's holds, and dsor_runtime may not remove or change one", async () => {
    const { proposal } = await unknownPayment();
    expect(await holdsOf(proposal, "org_789")).toStrictEqual([]);
    await expect(
      inCompany(pool, "org_456", (client) =>
        client.query("DELETE FROM dsor.holds WHERE proposal_id = $1", [proposal]),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      inCompany(pool, "org_456", (client) =>
        client.query("UPDATE dsor.holds SET resource = 'x' WHERE proposal_id = $1", [proposal]),
      ),
    ).rejects.toThrow("permission denied");
  });
});

describe("C2 and C4: on the database, held until the proposal is settled", () => {
  it("DSOR-UNK-03b: while the payment is unknown, its cancel, a new draft of INV-9001, and a second send hear RESOURCE_HELD; the same key still hears OUTCOME_UNKNOWN; settled FAILED, the same cancel key cancels it", async () => {
    const id = await draft();
    const first = keyed(SUPERVISOR);
    bank.mode = "silent";
    const unknown = await send(id, first);
    bank.mode = "good";
    const proposal = idOf(unknown);
    const cancelKey = keyed(SUPERVISOR);
    expect(await cancel(id, cancelKey)).toMatchObject(HELD);
    expect(
      await call(registry, log, keyed(SUPERVISOR), "payment.create", {
        invoice: INV_9001,
        expected_version: 1,
      }),
    ).toMatchObject(HELD);
    expect(await send(id)).toMatchObject(HELD);
    expect(await send(id, first)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(bank.transfers().filter((t) => t.payment === id)).toHaveLength(1);
    ownerProposals("settle", proposal);
    expect(await cancel(id, cancelKey)).toMatchObject({ outcome: "COMMITTED" });
  });
});

describe("C1 and C2: a process killed while the bank holds the payment", () => {
  it(
    "DSOR-UNK-03b: killed with SIGKILL after the bank took the payment: before the sweep, with the proposal EXECUTING, its cancel hears RESOURCE_HELD; after the sweep too",
    { timeout: 120_000 },
    async () => {
      const id = await draft();
      const envelope = keyed(SUPERVISOR);
      const child = spawnSync(process.execPath, [CRASH, id, envelope.idempotency_key], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      const note = await intents.forClaim(
        "org_456",
        "user_123",
        "payment.execute",
        envelope.idempotency_key,
      );
      const proposal = note!.proposal_id;
      expect(await holdsOf(proposal)).toStrictEqual([INV_9001, `dsor://org_456/payment/${id}`]);
      expect(await cancel(id)).toMatchObject(HELD);
      expect(await sweepIntents(pool, ["org_456"])).toBe(1);
      settle.push(proposal);
      expect(await cancel(id)).toMatchObject(HELD);
    },
  );
});

describe("C4: on the database, a good day frees the payment", () => {
  it("DSOR-UNK-03b: a payment sent on a good day keeps its hold rows, which no longer count once COMMITTED: its cancel hears the payment's own answer, not RESOURCE_HELD", async () => {
    const id = await draft();
    const sent = await send(id);
    expect(sent).toMatchObject({ outcome: "COMMITTED" });
    expect(await holdsOf(idOf(sent))).toHaveLength(2);
    expect(await cancel(id)).not.toMatchObject({ code: "RESOURCE_HELD" });
  });
});
