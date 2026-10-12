// A waiting proposal keeps what it waits for, on the database (step 29's README, claim C7,
// decision D4). dsor.proposals keeps it in requires, written on the move to PENDING_APPROVAL, and
// the trigger refuses any other change, for every role. The tests draft INV-9001 as intake-fte,
// under del_190, whose limits the owner keeps, in a world that reads dsor.controls.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { MoveBy, ProposalDraft } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerProposals,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { keyed, storyDirectories, withPlanted } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
const registry = dbRegistry(
  pool,
  storyDirectories(),
  handlersFor(),
  ownWorkFor(),
  readLifetimes(),
  "database",
);
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
const CFO_BY_8 = {
  approval: { role: "CFO", quorum: 1 },
  control: "high-value-payment",
  control_version: 8,
};

beforeAll(() => {
  ownerRules("clear");
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("add");
});
beforeEach(() => {
  ownerLimits("reset");
});
afterAll(async () => {
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await pool.end();
});

/** intake-fte drafts a payment of INV-9001, 31,400.00 USD, with a fresh key. */
function draft9001(): Promise<Answer> {
  return withPlanted("tok_intake", intake, () =>
    call(registry, log, keyed(INTAKE), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-9001",
      expected_version: 1,
    }),
  );
}

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** One statement as dsor_runtime, inside org_456, always rolled back: its error, or "". */
async function asRuntime(sql: string, values: unknown[] = []): Promise<string> {
  try {
    await tryThenRollBack(pool, sql, "org_456", values);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

const DRAFT: ProposalDraft = {
  operation: "payment.create@1",
  mode: "execute",
  payload: { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 },
  payload_hash: `sha256:${"d".repeat(64)}`,
  resources: ["dsor://org_456/invoice/INV-9001"],
  requester: {
    identity_mode: "direct",
    subject: "user_123",
    subject_type: "human",
    actor_chain: [],
    active_tenant: "org_456",
    subject_authority: { source: "token", as_of: "2026-10-13T09:00:00.000Z" },
  },
  idempotency_key: "k-s29-requires",
};
const BY: MoveBy = {
  mover: {
    mode: "direct",
    subject: "user_123",
    actor_chain: [],
    subject_authority: { source: "token", as_of: "2026-10-13T09:00:00.000Z" },
  },
  cause: "a test moves it",
  correlation: { request_id: "req_s29_requires", principal_id: "user_123" },
};

/** A new proposal of org_456, PROPOSED, written through the store. */
async function proposed(): Promise<string> {
  const id = `prop_${randomUUID()}`;
  await proposals.create("org_456", id, DRAFT, BY, "P7D");
  return id;
}

describe("C7: on the database, a waiting proposal keeps what it waits for (step 29's README, decision D4)", () => {
  it("Step 29: on the database, INV-9001's proposal waits for one CFO, by version 8 of high-value-payment, and keeps it", async () => {
    const answer = await draft9001();
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL", requires: [CFO_BY_8] });
    expect((await proposals.get("org_456", idOf(answer)))?.requires).toStrictEqual([CFO_BY_8]);
  });

  it("Step 29: a proposal starts waiting for nothing, and the store's move to PENDING_APPROVAL writes what it waits for", async () => {
    const id = await proposed();
    expect("requires" in (await proposals.get("org_456", id))!).toBe(false);
    expect(
      await proposals.move("org_456", id, "PROPOSED", "PENDING_APPROVAL", BY, [CFO_BY_8]),
    ).toBe(true);
    expect((await proposals.get("org_456", id))?.requires).toStrictEqual([CFO_BY_8]);
  });

  it.each([
    [
      "move a proposal to PENDING_APPROVAL that names nothing",
      "UPDATE dsor.proposals SET state = 'PENDING_APPROVAL' WHERE id = $1",
      false,
      "a proposal that waits for an approval names what it waits for",
    ],
    [
      "name an empty list",
      "UPDATE dsor.proposals SET state = 'PENDING_APPROVAL', requires = '[]' WHERE id = $1",
      false,
      "proposals_requires_list",
    ],
    [
      "change what a waiting proposal waits for",
      `UPDATE dsor.proposals SET requires = '[{"control": "x", "control_version": 1}]' WHERE id = $1`,
      true,
      "what a proposal waits for is written once, when it starts to wait",
    ],
    [
      "clear what a waiting proposal waits for, as it moves on",
      "UPDATE dsor.proposals SET state = 'EXPIRED', requires = NULL WHERE id = $1",
      true,
      "what a proposal waits for is written once, when it starts to wait",
    ],
  ])("Step 29: dsor_runtime may not %s", async (_what, sql, waiting, refusal) => {
    const id = await proposed();
    if (waiting) await proposals.move("org_456", id, "PROPOSED", "PENDING_APPROVAL", BY, [CFO_BY_8]);
    expect(await asRuntime(sql, [id])).toContain(refusal);
  });

  it("Step 29: the owner, whom no grant stops, cannot name what a proposal waits for without the move, or add one that waits already", () => {
    expect(ownerProposals("rewrite", "requires")).toStrictEqual({
      code: "23514",
      message: "what a proposal waits for is written once, when it starts to wait",
    });
    expect(ownerProposals("starts-waiting")).toStrictEqual({
      code: "23514",
      message: "a proposal starts waiting for nothing",
    });
  });
});
