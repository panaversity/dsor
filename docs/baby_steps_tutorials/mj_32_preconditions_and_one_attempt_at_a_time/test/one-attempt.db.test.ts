// One attempt at a time, on the database: line ⑨ takes the invoice's lock and looks for a proposal
// in flight, and the key proposals_one_attempt keeps a second one from being written (DSOR-EXC-01;
// step 32's README, claim C2, decisions D6 to D8). Real parallel requests, never a mock. The tests'
// own invoice, INV-9001, 500.00 USD of VENDOR-44, which the owner adds; the company has no rule
// here, so user_123 prepares it in propose_only mode, and it waits READY, in flight.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { MoveBy, ProposalDraft } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerInvoices,
  RUNTIME_URL,
  tryThenRollBack,
} from "./db.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";

const pool = newPool();
const wide = new pg.Pool({ connectionString: RUNTIME_URL, max: 10 });
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const proposals = createDbProposals(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerInvoices("remove");
  await pool.end();
  await wide.end();
});

/** user_123 asks for a draft of INV-9001, in this mode, with a fresh key, through this registry. */
function attempt(
  mode: "execute" | "propose_only" = "propose_only",
  on = registry,
): Promise<Answer> {
  const envelope: RequestEnvelope = { ...keyed(SUPERVISOR), mode };
  return call(on, log, envelope, "payment.create", { invoice: INV_9001, expected_version: 1 });
}

/** What an answer says, in one word. */
function word(answer: Answer): string {
  return "outcome" in answer ? answer.outcome : "code" in answer ? answer.code : "data";
}

/** The address an answer names. */
function addressOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "");
}

describe("C2: one attempt at a time, on the database (step 32's README, decisions D6 to D8)", () => {
  it("DSOR-EXC-01: on the database, while INV-9001 waits READY, a second attempt hears CONFLICT naming it, ends DENIED, and dsor.audit says DENY", async () => {
    const first = await attempt();
    expect(word(first)).toBe("READY");
    const second = await attempt("execute");
    expect(second).toMatchObject({
      code: "CONFLICT",
      message: `invoice INV-9001 has an attempt in flight already: proposal ${addressOf(first)}, READY`,
    });
    const id = addressOf(second).split("/").at(-1)!;
    expect((await proposals.get("org_456", id))?.state).toBe("DENIED");
    const { rows } = await tryThenRollBack(
      pool,
      `SELECT "authorization", result FROM dsor.audit
        WHERE correlation->>'request_id' = $1 AND kind = 'decision'`,
      "org_456",
      [second.correlation.request_id],
    );
    expect(rows).toStrictEqual([{ authorization: "DENY", result: "CONFLICT" }]);
  });

  it("DSOR-EXC-01: on the database, ten attempts on INV-9001 at the same moment: one waits READY, and nine hear CONFLICT", async () => {
    const world = dbRegistry(wide);
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => attempt("propose_only", world)),
    );
    const words = answers.map(word).sort();
    expect(words).toStrictEqual([...Array(9).fill("CONFLICT"), "READY"]);
    const ready = answers.find((a) => word(a) === "READY")!;
    for (const refused of answers.filter((a) => word(a) === "CONFLICT")) {
      expect((refused as { message: string }).message).toContain(addressOf(ready));
    }
  });

  it("DSOR-EXC-01: on the database, the release of the waiting attempt takes the invoice's lock and is not refused by itself", async () => {
    const first = await attempt();
    const released = await call(registry, log, keyed(SUPERVISOR), "proposal.execute", {
      proposal: addressOf(first),
    });
    expect(word(released)).toBe("COMMITTED");
  });
});

/** A proposal of INV-9001, written straight to the store, with the record it is exclusive over. */
const DRAFT: ProposalDraft = {
  operation: "payment.create@1",
  mode: "propose_only",
  payload: { invoice: INV_9001, expected_version: 1 },
  payload_hash: `sha256:${"c".repeat(64)}`,
  resources: [INV_9001],
  requester: {
    identity_mode: "direct",
    subject: "user_123",
    subject_type: "human",
    actor_chain: [],
    active_tenant: "org_456",
    subject_authority: { source: "token", as_of: "2026-10-16T09:00:00.000Z" },
  },
  idempotency_key: "k-s32-key",
  exclusive_over: INV_9001,
};
const BY: MoveBy = {
  mover: {
    mode: "direct",
    subject: "user_123",
    actor_chain: [],
    subject_authority: { source: "token", as_of: "2026-10-16T09:00:00.000Z" },
  },
  cause: "the test writes it",
  correlation: { request_id: "req_s32_key" },
};

describe("C2: the database's key, behind line ⑨ (step 32's README, decision D7)", () => {
  it("DSOR-EXC-01: with line ⑨ skipped, the key refuses a second proposal of payment.create in flight over INV-9001, and keeps the first", async () => {
    const one = `prop_${randomUUID()}`;
    const two = `prop_${randomUUID()}`;
    await proposals.create("org_456", one, { ...DRAFT, idempotency_key: one }, BY, "P7D");
    await proposals.create("org_456", two, { ...DRAFT, idempotency_key: two }, BY, "P7D");
    expect(await proposals.move("org_456", one, "PROPOSED", "READY", BY)).toBe(true);
    await expect(proposals.move("org_456", two, "PROPOSED", "READY", BY)).rejects.toMatchObject({
      code: "23505",
      constraint: "proposals_one_attempt",
    });
    expect((await proposals.get("org_456", two))?.state).toBe("PROPOSED");
    // Once the first has ended, the second may move.
    expect(await proposals.move("org_456", one, "READY", "CANCELLED", BY)).toBe(true);
    expect(await proposals.move("org_456", two, "PROPOSED", "READY", BY)).toBe(true);
  });

  it("Step 32: dsor_runtime never changes the record a proposal is exclusive over: no UPDATE of the column", async () => {
    await expect(
      tryThenRollBack(pool, "UPDATE dsor.proposals SET exclusive_over = 'x'", "org_456"),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });
});
