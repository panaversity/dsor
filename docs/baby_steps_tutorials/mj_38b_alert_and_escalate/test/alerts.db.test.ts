// Step 38b on the database: a proposal's move to OUTCOME_UNKNOWN writes its row in dsor.alerts in
// the same transaction, by every path, a real SIGKILL and the start-up sweep too; the settlement
// closes it; dsor-scheduler's sweep escalates it once, two sweeps at once included; the trigger
// refuses every other change, even to the owner, and each company sees only its own (DSOR-UNK-04b,
// DSOR-UNK-04c; step 38b's README, claims C1 to C4 and C7).
// The tests' own invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds and removes.
// Their registry escalates after one second, so a test can wait for it (decision D7).
import { spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbIntents, createDbLog, inCompany, sweepIntents } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, ownerAlerts, ownerInvoices, ownerProposals } from "./db.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const bank = createFakeBank();
const none = undefined;
const SECOND = {
  org_456: {
    receivers: "ap_supervisor",
    escalate_to: "cfo_100",
    alert_within: "PT0S",
    escalate_after: "PT1S",
  },
  org_789: {
    receivers: "ap_supervisor",
    escalate_to: "admin_700",
    alert_within: "PT0S",
    escalate_after: "PT1S",
  },
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
  { file: "alerts.json", text: JSON.stringify(SECOND) },
);
const intents = createDbIntents(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const CRASH = fileURLToPath(new URL("crash-while-paying.ts", import.meta.url));
// dsor-scheduler, DSoR's own login for scheduled work (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const settle: string[] = [];
/** What the escalation sweep answers. */
type Escalation = { data: { escalated: { proposal: string }[] } };

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

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** A payment of INV-9001 sent on a silent day: its proposal's id. */
async function unknownPayment(): Promise<string> {
  const id = await draft();
  bank.mode = "silent";
  const unknown = await call(registry, log, keyed(SUPERVISOR), "payment.execute", {
    invoice: INV_9001,
    payment: `dsor://org_456/payment/${id}`,
    expected_version: 1,
  });
  bank.mode = "good";
  expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return idOf(unknown);
}

/** This proposal's alert, as dsor_runtime reads it inside this company. */
function alertOf(
  proposal: string,
  company = "org_456",
): Promise<Record<string, unknown> | undefined> {
  return inCompany(pool, company, async (client) => {
    const { rows } = await client.query(
      `SELECT state, escalated_to, outcome, raised_at, escalated_at, closed_at
         FROM dsor.alerts WHERE proposal_id = $1`,
      [proposal],
    );
    return rows[0];
  });
}

/** dsor-scheduler runs the escalation sweep over org_456. */
function escalate(): Promise<Answer> {
  return call(registry, log, keyed(SCHEDULER), "alert.escalate_due", {
    company: "dsor://org_456/tenant/org_456",
  });
}

describe("C1 and C3: on the database, raised with the move, closed with the settlement", () => {
  it("DSOR-UNK-04b: PAY-901 goes unknown: its open alert is in dsor.alerts, raised by the database's clock at the move; the reconcile closes it COMMITTED", async () => {
    const proposal = await unknownPayment();
    const raised = await alertOf(proposal);
    expect(raised).toMatchObject({ state: "open", escalated_to: null, outcome: null });
    const moved = await registry.claims.proposals.get("org_456", proposal);
    expect((raised!["raised_at"] as Date).toISOString()).toBe(moved!.transitions.at(-1)!.at);
    const settled = await call(registry, log, keyed(SCHEDULER), "payment.reconcile", {
      proposal: `dsor://org_456/proposal/${proposal}`,
    });
    expect(settled).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await alertOf(proposal)).toMatchObject({ state: "closed", outcome: "COMMITTED" });
  });
});

describe("C2: on the database, after a real SIGKILL", () => {
  it(
    "DSOR-UNK-04b: the program is killed while the bank holds the payment; the start-up sweep moves the proposal to OUTCOME_UNKNOWN and raises its alert",
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
      expect(await alertOf(note!.proposal_id)).toBeUndefined();
      expect(await sweepIntents(pool, ["org_456"])).toBe(1);
      expect(await alertOf(note!.proposal_id)).toMatchObject({ state: "open" });
      settle.push(note!.proposal_id);
    },
  );
});

describe("C4: on the database, escalated once", () => {
  it("DSOR-UNK-04c: before the bound nothing is escalated; after it, two sweeps at once escalate the alert to cfo_100 once", async () => {
    const proposal = await unknownPayment();
    settle.push(proposal);
    const early = await escalate();
    expect((early as Escalation).data.escalated.map((alert) => alert.proposal)).not.toContain(
      `dsor://org_456/proposal/${proposal}`,
    );
    await wait(1100);
    const both = await Promise.all([escalate(), escalate()]);
    const named = both.flatMap((answer) =>
      (answer as Escalation).data.escalated.map((alert) => alert.proposal),
    );
    expect(named.filter((uri) => uri.endsWith(proposal))).toHaveLength(1);
    expect(await alertOf(proposal)).toMatchObject({ state: "escalated", escalated_to: "cfo_100" });
  });
});

describe("C7: the database keeps its alerts", () => {
  it("DSOR-UNK-04b: the trigger refuses the owner a reopened alert, an earlier raised_at, another person, and a removal; org_789 sees none of org_456's", async () => {
    const proposal = await unknownPayment();
    expect(ownerAlerts("backdate", proposal)).toStrictEqual({
      refused: "an alert's company, proposal, and raised_at never change",
    });
    expect(ownerAlerts("remove", proposal)).toStrictEqual({
      refused: "an alert is never removed",
    });
    await wait(1100);
    await escalate();
    expect(ownerAlerts("redirect", proposal)).toStrictEqual({
      refused: "an alert moves only from open to escalated, or to closed, once each",
    });
    await call(registry, log, keyed(SCHEDULER), "payment.reconcile", {
      proposal: `dsor://org_456/proposal/${proposal}`,
    });
    expect(ownerAlerts("reopen", proposal)).toStrictEqual({
      refused: "an alert moves only from open to escalated, or to closed, once each",
    });
    expect(await alertOf(proposal, "org_789")).toBeUndefined();
    await expect(
      pool.query("DELETE FROM dsor.alerts WHERE proposal_id = $1", [proposal]),
    ).rejects.toThrow("permission denied");
  });
});
