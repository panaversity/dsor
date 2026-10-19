// Step 36 on the database: before payment.execute asks the bank, the note is committed in
// dsor.intents, with the claim and the proposal at EXECUTING. A process killed while the bank holds
// the payment leaves all three behind; a retry with the same key hears OUTCOME_UNKNOWN, a new key
// is refused, and the sweep at start-up ends the note and the proposal OUTCOME_UNKNOWN
// (DSOR-EXE-03a, DSOR-EXE-03b, DSOR-EXE-04b; step 36's README, claims C1 to C6). The tests' own
// invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds and removes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bankKeyOf, createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import {
  createDbIntents,
  createDbLog,
  createDbProposals,
  inCompany,
  sweepIntents,
} from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, ownerIntents, ownerInvoices, ownerProposals } from "./db.ts";
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
// The payment's status, read without its lock, which the claim may hold while the bank sends.
async function statusOf(id: string): Promise<unknown> {
  return inCompany(pool, "org_456", async (client) => {
    const { rows } = await client.query("SELECT status FROM app.payments WHERE id = $1", [id]);
    return rows[0]?.["status"];
  });
}
// How many notes org_456 has.
async function notes(): Promise<unknown> {
  return inCompany(pool, "org_456", async (client) => {
    const { rows } = await client.query("SELECT count(*)::int AS n FROM dsor.intents");
    return rows[0]?.["n"];
  });
}
const proposals = createDbProposals(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
const CRASH = fileURLToPath(new URL("crash-while-paying.ts", import.meta.url));
const settle: string[] = [];

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  for (const id of settle) ownerProposals("settle", id);
  ownerInvoices("remove");
  await pool.end();
});

/** user_123 drafts a payment of INV-9001, on a fresh invoice, and gives its id. */
async function draft(): Promise<string> {
  ownerInvoices("add");
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

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The transfers the tests' bank made for one payment. */
function sentFor(id: string): number {
  return bank.transfers().filter((t) => t.payment === id).length;
}

describe("C1: on the database, the note is committed before the bank is asked", () => {
  it("DSOR-EXE-03a: when the bank is asked, another connection already reads the note, the claim's proposal at EXECUTING, and the payment still a draft; afterwards the note is ended committed", async () => {
    const id = await draft();
    const envelope = keyed(SUPERVISOR);
    let seen: { note: unknown; state: unknown; status: unknown } | undefined;
    const pay = bank.pay;
    bank.pay = async (key, order) => {
      bank.pay = pay;
      const note = await intents.forClaim(
        "org_456",
        "user_123",
        "payment.execute",
        envelope.idempotency_key,
      );
      const state = (await proposals.get("org_456", note?.proposal_id ?? ""))?.state;
      seen = { note, state, status: await statusOf(id) };
      return pay(key, order);
    };
    const sent = await execute(id, envelope);
    expect(sent).toMatchObject({ outcome: "COMMITTED" });
    expect(seen).toMatchObject({
      note: {
        proposal_id: idOf(sent),
        tenant_id: "org_456",
        operation: "payment.execute@1",
        principal: "user_123",
        claim_operation: "payment.execute",
        idempotency_key: envelope.idempotency_key,
        connector: "fake-bank",
      },
      state: "EXECUTING",
      status: "draft",
    });
    expect(seen?.note).not.toHaveProperty("outcome");
    expect(await intents.get("org_456", idOf(sent))).toMatchObject({ outcome: "committed" });
    expect(sentFor(id)).toBe(1);
  });

  it("DSOR-EXE-03a: on the database, a command that reaches no bank writes no note", async () => {
    const before = await notes();
    await draft();
    expect(await notes()).toBe(before);
  });
});

describe("C2: on the database, no note, no payment", () => {
  it("DSOR-EXE-03b: dsor_runtime may not add a note: EVIDENCE_STORE_UNAVAILABLE, the bank never asked, and nothing kept, so the same key later pays once", async () => {
    const id = await draft();
    const envelope = keyed(SUPERVISOR);
    ownerIntents("revoke");
    let refused: Answer;
    try {
      refused = await execute(id, envelope);
    } finally {
      ownerIntents("grant");
    }
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE", retry: "safe_same_key" });
    expect(sentFor(id)).toBe(0);
    expect(await statusOf(id)).toBe("draft");
    expect(
      await intents.forClaim("org_456", "user_123", "payment.execute", envelope.idempotency_key),
    ).toBeUndefined();
    expect(await execute(id, envelope)).toMatchObject({ outcome: "COMMITTED" });
    expect(sentFor(id)).toBe(1);
  });
});

describe("C3: on the database, the note ends with its proposal", () => {
  it("DSOR-EXE-03a: on the database, a bank that said it sent nothing, after the note: FAILED, the note failed, the same key gives the same answer without the bank, and a new key pays once", async () => {
    const id = await draft();
    const envelope = keyed(SUPERVISOR);
    bank.mode = "broken";
    const refused = await execute(id, envelope);
    bank.mode = "good";
    expect(refused).toMatchObject({ code: "CONNECTOR_UNAVAILABLE", retry: "safe_same_key" });
    expect((await proposals.get("org_456", idOf(refused)))?.state).toBe("FAILED");
    expect(await intents.get("org_456", idOf(refused))).toMatchObject({ outcome: "failed" });
    expect(await execute(id, envelope)).toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    expect(sentFor(id)).toBe(0);
    expect(await execute(id)).toMatchObject({ outcome: "COMMITTED" });
    expect(sentFor(id)).toBe(1);
  });

  it("DSOR-EXE-04b: on the database, a silent bank ends the note outcome_unknown, with its proposal", async () => {
    const id = await draft();
    bank.mode = "silent";
    const unknown = await execute(id);
    bank.mode = "good";
    settle.push(idOf(unknown));
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(await intents.get("org_456", idOf(unknown))).toMatchObject({
      outcome: "outcome_unknown",
    });
  });

  it("DSOR-EXE-04b: on the database, the same key sent again while the bank still holds the payment hears OUTCOME_UNKNOWN, and nothing runs twice", async () => {
    const id = await draft();
    const envelope = keyed(SUPERVISOR);
    let again: Answer | undefined;
    const pay = bank.pay;
    bank.pay = async (key, order) => {
      bank.pay = pay;
      again = await execute(id, envelope);
      return pay(key, order);
    };
    const sent = await execute(id, envelope);
    expect(sent).toMatchObject({ outcome: "COMMITTED" });
    expect(again).toMatchObject({
      code: "OUTCOME_UNKNOWN",
      retry: "after_reconciliation",
      proposal: `dsor://org_456/proposal/${idOf(sent)}`,
    });
    expect(sentFor(id)).toBe(1);
  });
});

describe("C4: a note is evidence: only its outcome is ever written, once", () => {
  it("DSOR-EXE-03a: the trigger refuses, even to the owner, a change to what a note says, a second outcome, and taking an outcome back; dsor_runtime may not remove one", async () => {
    const id = await draft();
    const sent = await execute(id);
    const note = idOf(sent);
    expect(ownerIntents("rewrite", note)).toStrictEqual({
      refused: "an intent record is never changed",
    });
    expect(ownerIntents("end-again", note)).toStrictEqual({
      refused: "an intent record ends once",
    });
    expect(ownerIntents("unend", note)).toStrictEqual({ refused: "an intent record ends once" });
    await expect(
      pool.query("DELETE FROM dsor.intents WHERE proposal_id = $1", [note]),
    ).rejects.toThrow("permission denied");
  });
});

describe("C5 and C6: a process killed while the bank holds the payment", () => {
  it(
    // Changed in step 37: a new key hears RESOURCE_HELD, not CONFLICT (step 37's README, D3).
    "DSOR-EXE-04b: killed with SIGKILL after the bank took the payment: the note open and the proposal EXECUTING; the same key hears OUTCOME_UNKNOWN, a new key RESOURCE_HELD, and the bank is not asked again; the sweep ends both OUTCOME_UNKNOWN, and the claim keeps it",
    { timeout: 120_000 },
    async () => {
      const id = await draft();
      const envelope = keyed(SUPERVISOR);
      const child = spawnSync(process.execPath, [CRASH, id, envelope.idempotency_key], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      // The bank took the payment, under the key DSoR made from the proposal.
      const note = await intents.forClaim(
        "org_456",
        "user_123",
        "payment.execute",
        envelope.idempotency_key,
      );
      expect(note).toBeDefined();
      expect(note).not.toHaveProperty("outcome");
      const proposal = note!.proposal_id;
      expect(child.stdout).toBe(`SENT ${bankKeyOf("org_456", proposal)}\n`);
      expect((await proposals.get("org_456", proposal))?.state).toBe("EXECUTING");
      expect(await statusOf(id)).toBe("draft");
      // Before the sweep: the claim has no answer, and its note says why.
      expect(await execute(id, envelope)).toMatchObject({
        code: "OUTCOME_UNKNOWN",
        retry: "after_reconciliation",
        proposal: `dsor://org_456/proposal/${proposal}`,
      });
      expect(await execute(id)).toMatchObject({ code: "RESOURCE_HELD" });
      expect(sentFor(id)).toBe(0);
      // The sweep, as start-up runs it.
      expect(await sweepIntents(pool, ["org_456"])).toBe(1);
      settle.push(proposal);
      expect((await proposals.get("org_456", proposal))?.state).toBe("OUTCOME_UNKNOWN");
      expect(await intents.get("org_456", proposal)).toMatchObject({
        outcome: "outcome_unknown",
      });
      expect(await execute(id, envelope)).toMatchObject({
        code: "OUTCOME_UNKNOWN",
        proposal: `dsor://org_456/proposal/${proposal}`,
      });
      // A second sweep finds nothing left to end.
      expect(await sweepIntents(pool, ["org_456"])).toBe(0);
      expect(sentFor(id)).toBe(0);
    },
  );
});

// The review's findings on the database (step 36's README, "What the review found").
describe("the review, on the database", () => {
  it("DSOR-EXE-04b: H1: the bank sent, then the note cannot be ended: OUTCOME_UNKNOWN, never INTERNAL_ERROR; the same key hears it again, and the bank sent once", async () => {
    const id = await draft();
    const envelope = keyed(SUPERVISOR);
    ownerIntents("break-end");
    let unknown: Answer;
    try {
      unknown = await execute(id, envelope);
    } finally {
      ownerIntents("mend-end");
    }
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    const proposal = idOf(unknown);
    expect((await proposals.get("org_456", proposal))?.state).toBe("EXECUTING");
    expect(await intents.get("org_456", proposal)).not.toHaveProperty("outcome");
    expect(await execute(id, envelope)).toMatchObject({
      code: "OUTCOME_UNKNOWN",
      proposal: `dsor://org_456/proposal/${proposal}`,
    });
    expect(sentFor(id)).toBe(1);
    expect(await sweepIntents(pool, ["org_456"])).toBe(1);
    settle.push(proposal);
  });

  it("DSOR-EXE-03b: M1: the checkpoint's COMMIT fails: EVIDENCE_STORE_UNAVAILABLE, the bank never asked, nothing kept, and the same key later pays once", async () => {
    const id = await draft();
    const envelope = keyed(SUPERVISOR);
    ownerIntents("break-commit");
    let refused: Answer;
    try {
      refused = await execute(id, envelope);
    } finally {
      ownerIntents("mend-commit");
    }
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE", retry: "safe_same_key" });
    expect(sentFor(id)).toBe(0);
    expect(
      await intents.forClaim("org_456", "user_123", "payment.execute", envelope.idempotency_key),
    ).toBeUndefined();
    expect(await execute(id, envelope)).toMatchObject({ outcome: "COMMITTED" });
    expect(sentFor(id)).toBe(1);
  });

  it(
    "DSOR-EXE-04b: M2: a release killed while the bank holds the payment: the note names the release's own claim; the same release key hears OUTCOME_UNKNOWN; the sweep answers that claim",
    { timeout: 120_000 },
    async () => {
      const id = await draft();
      const prepared = await call(
        registry,
        log,
        { ...keyed(SUPERVISOR), mode: "propose_only" },
        "payment.execute",
        { invoice: INV_9001, payment: `dsor://org_456/payment/${id}`, expected_version: 1 },
      );
      expect(prepared).toMatchObject({ outcome: "READY" });
      const uri = String("proposal" in prepared ? prepared.proposal : "");
      const release = keyed(SUPERVISOR);
      const child = spawnSync(process.execPath, [CRASH, id, release.idempotency_key, uri], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      const note = await intents.forClaim(
        "org_456",
        "user_123",
        "proposal.execute",
        release.idempotency_key,
      );
      expect(note).toMatchObject({ proposal_id: idOf(prepared), operation: "payment.execute@1" });
      const again = () => call(registry, log, release, "proposal.execute", { proposal: uri });
      expect(await again()).toMatchObject({ code: "OUTCOME_UNKNOWN", proposal: uri });
      expect(await sweepIntents(pool, ["org_456"])).toBe(1);
      settle.push(idOf(prepared));
      expect((await proposals.get("org_456", idOf(prepared)))?.state).toBe("OUTCOME_UNKNOWN");
      expect(await again()).toMatchObject({ code: "OUTCOME_UNKNOWN", proposal: uri });
      expect(sentFor(id)).toBe(0);
    },
  );
});
