// The step's "done when", on the database: intake-fte drafts INV-9001, 31,400.00 USD to VENDOR-44,
// and it waits for the CFO, by version 8 of high-value-payment, in a world that reads
// dsor.controls. cfo_100 approves it. Then the accounts team suspends VENDOR-44 in app.vendors, and
// intake-fte releases it (DSOR-APR-03a, DSOR-APR-03c; step 32's README, claim C5, decision D11).
// A real PostgreSQL, never a mock. Each test sets VENDOR-44 back to approved.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { readLifetimes } from "../src/lifetimes.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";

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
const INV_9001 = "dsor://org_456/invoice/INV-9001";

beforeAll(() => {
  ownerRules("clear");
  ownerLimits("add");
});
beforeEach(() => {
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("reset");
  ownerInvoices("vendor", "VENDOR-44", "approved");
});
afterAll(async () => {
  ownerInvoices("vendor", "VENDOR-44", "approved");
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await pool.end();
});

/** One call as intake-fte, the planted agent. */
function asIntake(envelope: RequestEnvelope, name: string, input: unknown): Promise<Answer> {
  return withPlanted("tok_intake", intake, () => call(registry, log, envelope, name, input));
}

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** intake-fte drafts INV-9001, and cfo_100 approves it. */
async function approved(): Promise<{ id: string; uri: string }> {
  const answer = await asIntake(keyed(INTAKE), "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const kept = (await proposals.get("org_456", idOf(answer)))!;
  const approval = await call(registry, log, keyed(CFO), "proposal.approve", {
    proposal: kept.uri,
    payload_hash: kept.payload_hash,
  });
  expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return { id: idOf(answer), uri: kept.uri };
}

/** One statement, as dsor_runtime inside org_456, undone after. */
async function rows(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(pool, sql, "org_456", values)).rows;
}

describe("C5: the release reads the vendor again, on the database (step 32's README, decision D11)", () => {
  it("DSOR-APR-03c: on the database, VENDOR-44 suspended after cfo_100's approval makes INV-9001's proposal INVALIDATED at its release, its booking released, and nothing paid", async () => {
    const { id, uri } = await approved();
    expect(ownerInvoices("vendor", "VENDOR-44", "suspended")).toMatchObject({
      version: expect.any(Number),
    });
    // user_123 releases it, whose clearance lets the words through: intake-fte, an agent, would hear
    // the code alone. intake-fte's login stays planted, since the release checks the asker again.
    const released = await withPlanted("tok_intake", intake, () =>
      call(registry, log, keyed(SUPERVISOR), "proposal.execute", { proposal: uri }),
    );
    expect(released).toMatchObject({
      code: "APPROVAL_INVALIDATED",
      message: `proposal ${id} is INVALIDATED: CONFLICT: a precondition of payment.create does not hold: state.vendor.status == "approved"`,
    });
    expect((await proposals.get("org_456", id))?.state).toBe("INVALIDATED");
    expect(
      await rows("SELECT state FROM dsor.reservations WHERE proposal_id = $1", [id]),
    ).toStrictEqual([{ state: "released" }]);
    expect(
      await rows("SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001'"),
    ).toStrictEqual([{ n: 0 }]);
  });

  it("DSOR-APR-03a: on the database, with VENDOR-44 still approved, the same release drafts INV-9001", async () => {
    const { uri } = await approved();
    const released = await asIntake(keyed(INTAKE), "proposal.execute", { proposal: uri });
    expect(released).toMatchObject({ outcome: "COMMITTED" });
    expect(
      await rows("SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001'"),
    ).toStrictEqual([{ n: 1 }]);
  });
});
