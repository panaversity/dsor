// proposal.execute, on the database (step 31's README, claims C1, C3, C4, C5, and C6).
// intake-fte drafts INV-9001, 31,400.00 USD, under del_190, and it waits for the CFO, by version 8
// of high-value-payment, in a world that reads dsor.controls. cfo_100 approves it, as in step 29's
// database tests. Then a release, and each change between the approval and the release. A real
// PostgreSQL, never a mock: two releases at once are two real transactions.
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
  callsWaiting,
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerProposals,
  ownerRules,
  tryThenRollBack,
} from "./db.ts";
import { CFO, keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";
import { textOf, version9 } from "./rule-world.ts";

const pool = newPool();
const log = createDbLog(pool);
const proposals = createDbProposals(pool);
// A pool of its own, to hold a lock and to watch the calls that wait for it: the registry's pool
// of two serves the two releases.
const observer = newPool();
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
  // Each test starts with INV-9001 at version 1, no payment of it, and the whole day's room.
  ownerInvoices("add", "31400.00", "USD");
  ownerLimits("reset");
});
afterAll(async () => {
  ownerRules("clear");
  ownerLimits("remove");
  ownerInvoices("remove");
  await observer.end();
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

/** intake-fte drafts INV-9001, and cfo_100 approves it: it waits APPROVED for its release. */
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

/** intake-fte releases the proposal, with this key, or a fresh one. */
function intakeReleases(uri: string, envelope: RequestEnvelope = keyed(INTAKE)): Promise<Answer> {
  return asIntake(envelope, "proposal.execute", { proposal: uri });
}

/**
 * user_123 releases the proposal, with a fresh key, while intake-fte, which asked, still has its
 * login: the release checks the asker again, and a planted login is gone outside withPlanted.
 */
function supervisorReleases(uri: string): Promise<Answer> {
  return withPlanted("tok_intake", intake, () =>
    call(registry, log, keyed(SUPERVISOR), "proposal.execute", { proposal: uri }),
  );
}

/** One statement, as dsor_runtime inside org_456, undone after. */
async function rows(sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(pool, sql, "org_456", values)).rows;
}

/** The payments of INV-9001, as app.payments keeps them. */
async function paymentsOf9001(): Promise<number> {
  const found = await rows(
    "SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001'",
    [],
  );
  return Number(found[0]!["n"]);
}

/** Every payment of org_456, as app.payments keeps them. */
async function allPayments(): Promise<number> {
  const found = await rows("SELECT count(*)::int AS n FROM app.payments", []);
  return Number(found[0]!["n"]);
}

/** The state of the proposal's booking, as dsor.reservations keeps it. */
async function bookingOf(id: string): Promise<unknown> {
  const found = await rows("SELECT state FROM dsor.reservations WHERE proposal_id = $1", [id]);
  return found[0]?.["state"];
}

/** cfo_100 drafts the next version of the CFO rule with this text, and switches it on. */
async function switchOn(text: Record<string, unknown>): Promise<void> {
  const rule = "dsor://org_456/rule/high-value-payment";
  const reason = "a stricter line, by a test";
  const drafted = await call(registry, log, keyed(CFO), "rule.draft", { rule, draft: text, reason });
  const version = (drafted as { data: { version: number } }).data.version;
  const on = await call(registry, log, keyed(CFO), "rule.activate", { rule, version, reason });
  expect(on).toMatchObject({ data: { status: "active" } });
}

describe("C1 and C6: the release, on the database (DSOR-APR-10, D4, D10)", () => {
  it("DSOR-APR-10: on the database, intake-fte releases INV-9001, which cfo_100 approved: dsor.proposals says COMMITTED, app.payments holds one draft of it, and its booking is committed", async () => {
    const { id, uri } = await approved();
    expect(await intakeReleases(uri)).toMatchObject({ outcome: "COMMITTED", proposal: uri });
    const kept = (await proposals.get("org_456", id))!;
    expect(kept.transitions.slice(-2).map((t) => [t.from, t.to, t.cause])).toStrictEqual([
      ["APPROVED", "EXECUTING", "released by intake-fte"],
      ["EXECUTING", "COMMITTED", "the work ended"],
    ]);
    expect(await paymentsOf9001()).toBe(1);
    expect(await bookingOf(id)).toBe("committed");
  });

  it("Step 31: on the database, two releases at once, with two keys, both past the gate before either moves the proposal: one is COMMITTED, the other hears CONFLICT, and app.payments holds one draft", async () => {
    const { id, uri } = await approved();
    // A third connection holds the proposal's row, so both releases read it APPROVED and wait at
    //   their move to EXECUTING. Then it lets go.
    const holder = await observer.connect();
    let answers: Answer[];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await holder.query("SELECT 1 FROM dsor.proposals WHERE id = $1 FOR UPDATE", [id]);
      // One plant around both, so intake-fte keeps its login until both have ended.
      const both = withPlanted("tok_intake", intake, () =>
        Promise.all([
          call(registry, log, keyed(INTAKE), "proposal.execute", { proposal: uri }),
          call(registry, log, keyed(SUPERVISOR), "proposal.execute", { proposal: uri }),
        ]),
      );
      await callsWaiting(observer, 2);
      await holder.query("ROLLBACK");
      answers = await both;
    } finally {
      holder.release();
    }
    const heard = answers.map((a) => ("code" in a ? `${a.code}: ${a.message}` : "COMMITTED"));
    expect(heard.sort()).toStrictEqual([
      "COMMITTED",
      `CONFLICT: proposal ${id} was released by another call`,
    ]);
    expect(await paymentsOf9001()).toBe(1);
    expect(await bookingOf(id)).toBe("committed");
  });

  it("DSOR-IDM-01c: on the database, the same release sent again with its key gives back the first answer, and drafts nothing more", async () => {
    const { uri } = await approved();
    const once = keyed(INTAKE);
    const first = await intakeReleases(uri, once);
    const again = await intakeReleases(uri, once);
    expect(again).toMatchObject({
      outcome: "COMMITTED",
      payload_hash: "payload_hash" in first ? first.payload_hash : "",
    });
    expect(await paymentsOf9001()).toBe(1);
  });
});

describe("C3 to C5: the check again, on the database (DSOR-APR-03a, 03b, 03c)", () => {
  it("DSOR-APR-03b: on the database, cfo_100 switches on a version of the CFO rule that asks for two CFOs: INV-9001's release is invalidated, nothing is drafted, and its booking is released", async () => {
    const { id, uri } = await approved();
    try {
      await switchOn({
        ...textOf(version9()),
        effect: { require_approval: { role: "CFO", quorum: 2 } },
      });
      const answer = await intakeReleases(uri);
      expect(answer).toMatchObject({ code: "APPROVAL_INVALIDATED", proposal: uri });
    } finally {
      ownerRules("clear");
    }
    expect((await proposals.get("org_456", id))?.state).toBe("INVALIDATED");
    expect(await paymentsOf9001()).toBe(0);
    expect(await bookingOf(id)).toBe("released");
  });

  it("DSOR-OPR-06: on the database, after the version that asks for two CFOs, a dry run of INV-9001's release hears that it would be invalidated, and nothing moves", async () => {
    const { id, uri } = await approved();
    try {
      await switchOn({
        ...textOf(version9()),
        effect: { require_approval: { role: "CFO", quorum: 2 } },
      });
      const dry = await withPlanted("tok_intake", intake, () =>
        call(registry, log, { ...SUPERVISOR, mode: "validate_only" }, "proposal.execute", {
          proposal: uri,
        }),
      );
      expect(dry).toMatchObject({
        code: "APPROVAL_INVALIDATED",
        message: `proposal ${id} would be INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for 2 approvals by CFO, and 1 counts`,
      });
    } finally {
      ownerRules("clear");
    }
    expect((await proposals.get("org_456", id))?.state).toBe("APPROVED");
    expect(await bookingOf(id)).toBe("held");
    expect(await paymentsOf9001()).toBe(0);
  });

  it("DSOR-APR-03c: on the database, the accounts system credits INV-9001 after the approval, version 2: invalidated before any work, STALE_STATE", async () => {
    const { id, uri } = await approved();
    ownerInvoices("credit", "31000.00");
    // user_123 releases it: intake-fte's clearance is below the reason's label, internal, so it
    //   would hear the code alone (step 14).
    const answer = await supervisorReleases(uri);
    expect(answer).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect("message" in answer && answer.message).toContain("STALE_STATE");
    expect((await proposals.get("org_456", id))?.state).toBe("INVALIDATED");
    expect(await paymentsOf9001()).toBe(0);
  });

  it("DSOR-APR-03c: on the database, a stored request changed behind the trigger's back no longer matches its fingerprint: invalidated, APPROVAL_MISMATCH, and INV-1009 is not paid", async () => {
    const { id, uri } = await approved();
    expect(ownerProposals("tamper", id)).toStrictEqual({ changed: 1 });
    const before = await allPayments();
    const answer = await supervisorReleases(uri);
    expect(answer).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    expect("message" in answer && answer.message).toBe(
      `proposal ${id} is INVALIDATED: APPROVAL_MISMATCH: proposal ${id}'s stored request does not match its fingerprint`,
    );
    expect(await allPayments()).toBe(before);
  });

  it("DSOR-APR-03c: on the database, a READY proposal that a new rule stops moves READY to INVALIDATED, which migration 027 lets the trigger take", async () => {
    ownerInvoices("add", "7425.00", "USD");
    const prepared = await asIntake({ ...keyed(INTAKE), mode: "propose_only" }, "payment.create", {
      invoice: INV_9001,
      expected_version: 1,
    });
    expect(prepared).toMatchObject({ outcome: "READY" });
    const id = idOf(prepared);
    try {
      await switchOn({
        ...textOf(version9()),
        condition: 'dsor_exceeds(state.invoice.open_amount, dsor_money("5000", "USD"))',
        tests: [
          {
            state: { invoice: { open_amount: { value: "5000.00", currency: "USD" } } },
            expect: "ALLOW",
          },
          {
            state: { invoice: { open_amount: { value: "5000.01", currency: "USD" } } },
            expect: "REQUIRE_APPROVAL",
          },
        ],
      });
      const answer = await supervisorReleases(
        String("proposal" in prepared ? prepared.proposal : ""),
      );
      expect(answer).toMatchObject({ code: "APPROVAL_INVALIDATED" });
      expect("message" in answer && answer.message).toBe(
        `proposal ${id} is INVALIDATED: APPROVAL_REQUIRED: high-value-payment version 9 asks for an approval that was not asked for when the request was made`,
      );
    } finally {
      ownerRules("clear");
    }
    const kept = (await proposals.get("org_456", id))!;
    expect(kept.transitions.at(-1)).toMatchObject({ from: "READY", to: "INVALIDATED" });
    expect(await bookingOf(id)).toBe("released");
  });
});
