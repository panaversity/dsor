// A READY proposal can end, on the database (step 25c's README, claims C1 to C4,
// C7, and C8). The expiry is the database's own: its clock sets expires_at, a CHECK keeps it within
// §44's 30 days, and the trigger keeps it as it was written. The sweep's moves and releases commit
// in its one transaction, or none of them does. A real PostgreSQL, never a mock.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, createDbProposals, createDbReservations } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { ProposalDraft } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { handlersFor } from "../src/operations.ts";
import {
  callsWaiting,
  dbRegistry,
  newPool,
  ownerInvoices,
  ownerLimits,
  ownerProposals,
  tryThenRollBack,
} from "./db.ts";
import { keyed, storyDirectories, SUPERVISOR, withPlanted } from "./helpers.ts";

const observer = newPool();
const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);
// A registry whose company lives by a lifetime of one second, so a test can see an expiry.
const quick = dbRegistry(pool, storyDirectories(), handlersFor(), ownWorkFor(), {
  file: "ready-lifetimes.json",
  text: '{ "org_456": "PT1S", "org_789": "PT1S" }',
});
const proposals = createDbProposals(pool);
const reservations = createDbReservations(pool);

// intake-fte works under del_190, which the owner adds fresh before each test, with step 24's
// limits (test/owner-limits.ts).
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };

beforeAll(() => {
  ownerInvoices("add");
  ownerInvoices("credit", "31400.00");
});
afterAll(async () => {
  ownerLimits("remove");
  ownerInvoices("remove");
  await observer.end();
  await pool.end();
});
beforeEach(() => {
  ownerLimits("add");
});

/** One statement as dsor_runtime inside org_456, rolled back after, and its rows. */
async function rowsOf(sql: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(observer, sql, "org_456", values)).rows;
}

/** intake-fte prepares a draft for INV-9001, which waits at READY and holds 31,400.00 USD. */
async function prepare(on = registry): Promise<Answer> {
  const rows = await rowsOf("SELECT version FROM app.invoices WHERE id = 'INV-9001'");
  const input = {
    invoice: "dsor://org_456/invoice/INV-9001",
    expected_version: rows[0]?.["version"],
  };
  return withPlanted("tok_intake", intake, () =>
    call(on, log, { ...keyed(INTAKE), mode: "propose_only" }, "payment.create", input),
  );
}

/** dsor-scheduler sweeps org_456, named by its URI, with a fresh key. */
function sweep(on = registry): Promise<Answer> {
  return call(on, log, keyed(SCHEDULER), "proposal.expire_due", {
    company: "dsor://org_456/tenant/org_456",
  });
}

const idOf = (answer: Answer): string =>
  String("proposal" in answer ? answer.proposal : "").slice("dsor://org_456/proposal/".length);
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe("C3: the database sets each proposal's expiry", () => {
  it("Step 25c: on the database, expires_at is the company's lifetime after created_at, by the database's clock (step 25c's README, claim C3)", async () => {
    const id = idOf(await prepare());
    const rows = await rowsOf(
      "SELECT (expires_at - created_at) = interval '7 days' AS seven FROM dsor.proposals WHERE id = $1",
      [id],
    );
    expect(rows).toStrictEqual([{ seven: true }]);
    // And DSoR's store reads it back as the database holds it. Found by the sweep of small breaks:
    // K28, a store that gave created_at as the expiry, passed every test.
    const kept = await proposals.get("org_456", id);
    const lifetime = Date.parse(String(kept?.expires_at)) - Date.parse(String(kept?.created_at));
    expect(lifetime).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("Step 25c: dsor_runtime's own INSERT cannot set an expires_at more than 30 days on, or not after created_at: the CHECK refuses both (step 25c's README, decision D6)", async () => {
    const insert = `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload,
                      payload_hash, resources, requester, idempotency_key, expires_at)
                    VALUES ('org_456', 'prop_' || gen_random_uuid(), 'payment.create@1', 'execute',
                      'PROPOSED', '{}', 'sha256:' || repeat('a', 64), ARRAY[]::text[], '{}',
                      'k-check', now() + $1::interval)`;
    // In hours, as the CHECK counts: 31 days, then 30 (step 25c's README, finding L6).
    await expect(tryThenRollBack(observer, insert, "org_456", ["744 hours"])).rejects.toMatchObject(
      {
        code: "23514",
      },
    );
    await expect(tryThenRollBack(observer, insert, "org_456", ["0 seconds"])).rejects.toMatchObject(
      { code: "23514" },
    );
    await expect(
      tryThenRollBack(observer, insert, "org_456", ["720 hours"]),
    ).resolves.toBeDefined();
  });

  it("Step 25c: the owner, whom no grant stops, cannot change a proposal's expires_at: the trigger refuses it (step 25c's README, decision D7)", () => {
    expect(ownerProposals("rewrite", "expires_at")).toStrictEqual({
      code: "23514",
      message: "only the state of a proposal changes",
    });
  });

  // On a database built from nothing, no proposal was made before migration 020, so this test
  // proves nothing there. Step 25c's README shows C7 checked by hand on a database with older ones.
  it("Step 25c: migration 020 gave every proposal made before it created_at plus 7 days, and every proposal has an expiry (step 25c's README, claim C7)", async () => {
    expect(ownerProposals("backfill")).toMatchObject({ wrong: 0 });
    const empty = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.proposals WHERE expires_at IS NULL",
    );
    expect(empty).toStrictEqual([{ n: 0 }]);
  });
});

describe("C1, C4: the sweep, on the database", () => {
  it("Step 25c: on the database, the sweep expires a READY proposal past its time, with a record that names dsor-scheduler, and gives its booking back; one not yet due stays (step 25c's README, claim C4)", async () => {
    const due = idOf(await prepare(quick));
    await pause(1200);
    const fresh = idOf(await prepare(quick));
    const swept = await sweep(quick);
    expect(swept).toMatchObject({ outcome: "COMMITTED", data: { tenant_id: "org_456" } });
    expect((await proposals.get("org_456", due))?.state).toBe("EXPIRED");
    expect((await proposals.get("org_456", fresh))?.state).toBe("READY");
    expect((await reservations.get("org_456", due))?.state).toBe("released");
    expect((await reservations.get("org_456", fresh))?.state).toBe("held");
    // The whole identity, and the sweep's own call. Found by step 25c's review (finding M3): a
    // record with another mode, authority, or request id passed every test.
    const record = await rowsOf(
      `SELECT identity, correlation->>'request_id' AS request_id, reason FROM dsor.audit
        WHERE kind = 'proposal_transition' AND resources = ARRAY[$1]::text[] AND result = 'EXPIRED'`,
      [`dsor://org_456/proposal/${due}`],
    );
    expect(record).toStrictEqual([
      {
        identity: {
          mode: "direct",
          subject: "dsor-scheduler",
          actor_chain: [],
          subject_authority: { source: "token", as_of: expect.any(String) },
        },
        request_id: swept.correlation.request_id,
        reason: "waited past its lifetime",
      },
    ]);
  });

  it("Step 25c: on the database, a second sweep at once finds nothing more to expire (step 25c's README, claim C4)", async () => {
    await prepare(quick);
    await pause(1200);
    await sweep(quick);
    expect(await sweep(quick)).toMatchObject({ outcome: "COMMITTED", data: { expired: 0 } });
  });
});

describe("C4: the sweep's list, inside its company (step 25c's README, claim C4)", () => {
  // Found by step 25c's sweep of small breaks: K25, a list with no company in DSoR's own WHERE,
  // passed every test, because row-level security kept it inside the company. The owner holds
  // BYPASSRLS, so only DSoR's own WHERE filters what the store lists for it.
  it("DSOR-TEN-01b: DSoR's own WHERE alone keeps the sweep's list inside its company: read as the owner, org_456's list holds its own due proposal and not org_789's", () => {
    expect(ownerProposals("due")).toStrictEqual({ ours: true, theirs: false });
  });
});

describe("one ending at a time (step 25c's README, decision D13)", () => {
  /** A READY proposal of intake-fte's under del_190, planted with this id, booked on today's total. */
  async function plantedReady(id: string, lifetime: string): Promise<string> {
    const as_of = new Date().toISOString();
    const draft: ProposalDraft = {
      operation: "payment.create@1",
      mode: "propose_only",
      payload: { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 },
      payload_hash: `sha256:${"0".repeat(64)}`,
      resources: ["dsor://org_456/invoice/INV-9001"],
      requester: {
        identity_mode: "unattended",
        subject: "user_123",
        subject_type: "human",
        actor_chain: ["intake-fte"],
        active_tenant: "org_456",
        delegation: "del_190",
        subject_authority: { source: "role_source", as_of },
      },
      idempotency_key: `plant-${id}`,
    };
    const by = {
      mover: {
        mode: "unattended" as const,
        subject: "user_123",
        actor_chain: ["intake-fte"],
        subject_authority: { source: "role_source" as const, as_of },
      },
      cause: "planted by the test",
      correlation: { request_id: `req_${randomUUID()}` },
    };
    await proposals.create("org_456", id, draft, by, lifetime);
    expect(await proposals.move("org_456", id, "PROPOSED", "READY", by)).toBe(true);
    const day = { value: "200000", currency: "USD" };
    const amount = { value: "31400.00", currency: "USD" };
    expect(await reservations.reserve("org_456", id, "del_190", amount, day)).toBe(true);
    return id;
  }

  // Found by step 25c's review (finding M1). The sweep and the tear-up each moved a proposal, then
  // gave its booking back to the day's total, then went to the next. Here the tear-up moves the
  // first proposal, gives it back, and waits for the day's total, which another transaction holds.
  // The sweep moves the second, gives it back, and waits too. Then the tear-up holds the total and
  // waits for the second, which the sweep holds, and the sweep waits for the total: a circle, which
  // PostgreSQL breaks by failing one of them. Now one ending runs at a time in a company.
  it("Step 25c: on the database, a sweep and a tear-up of one slip at the same moment both answer, each proposal ends once, and the day gets both bookings back (step 25c's README, decision D13)", async () => {
    // The first by id waits a week; the second's lifetime has passed. Each id starts with its
    // order, and ends with this run's own number, because a proposal is never removed.
    const run = randomUUID().slice(-12);
    const first = await plantedReady(`prop_00000000-0000-4000-8000-${run}`, "P7D");
    const second = await plantedReady(`prop_ffffffff-ffff-4fff-8fff-${run}`, "PT1S");
    await pause(1200);
    const holder = await observer.connect();
    let committed = false;
    const inFlight: Promise<Answer>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await holder.query(
        "SELECT used FROM dsor.limit_counters WHERE delegation = 'del_190' FOR UPDATE",
      );
      inFlight.push(
        call(registry, log, keyed(SUPERVISOR), "delegation.revoke", {
          slip: "dsor://org_456/delegation/del_190",
          reason: "intake-fte drafted a payment it should not have",
        }),
      );
      await callsWaiting(observer, 1);
      inFlight.push(sweep());
      await callsWaiting(observer, 2);
      await holder.query("COMMIT");
      committed = true;
    } finally {
      if (!committed) await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      await Promise.allSettled(inFlight);
    }
    const [torn, swept] = await Promise.all(inFlight);
    expect(torn).toMatchObject({ outcome: "COMMITTED" });
    expect(swept).toMatchObject({ outcome: "COMMITTED" });
    for (const id of [first, second]) {
      // One move out of READY each, by one of the two, and its booking back once.
      const ends = await rowsOf(
        `SELECT result FROM dsor.audit WHERE kind = 'proposal_transition'
           AND resources = ARRAY[$1]::text[] AND result IN ('CANCELLED', 'EXPIRED')`,
        [`dsor://org_456/proposal/${id}`],
      );
      expect(ends).toHaveLength(1);
      expect((await reservations.get("org_456", id))?.state).toBe("released");
    }
  });
});

describe("C8: one sweep, one transaction", () => {
  it("Step 25c: on the database, an accident during the sweep rolls back every move and every release, with the claim (step 25c's README, decision D8)", async () => {
    const first = idOf(await prepare(quick));
    const second = idOf(await prepare(quick));
    await pause(1200);
    const shipped = ownWorkFor();
    const expire = shipped["proposal.expire_due"]!;
    const breaking = dbRegistry(
      pool,
      storyDirectories(),
      handlersFor(),
      {
        ...shipped,
        "proposal.expire_due": {
          check: expire.check,
          change: async (input, work) => {
            await expire.change(input, work);
            throw new Error("the connection dropped after the sweep");
          },
        },
      },
      { file: "ready-lifetimes.json", text: '{ "org_456": "PT1S", "org_789": "PT1S" }' },
    );
    expect(await sweep(breaking)).toMatchObject({ code: "INTERNAL_ERROR" });
    for (const id of [first, second]) {
      expect((await proposals.get("org_456", id))?.state).toBe("READY");
      expect((await reservations.get("org_456", id))?.state).toBe("held");
    }
  });
});
