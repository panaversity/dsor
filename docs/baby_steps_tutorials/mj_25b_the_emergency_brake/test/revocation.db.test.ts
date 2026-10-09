// Tearing up a permission slip, on the database (DSOR-DEL-04a to DSOR-DEL-04c).
// The tear-up, the cancelled proposals, their released reservations, and the record commit in
// the tear-up's own transaction, or none of them does. A real PostgreSQL, never a mock (step
// 25's README, claims C1 and C3 to C11).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import {
  createDbLog,
  createDbProposals,
  createDbReservations,
  createDbSlips,
} from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { ProposalDraft } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  dbRegistry,
  newPool,
  NO_PRIVILEGE,
  ownerInvoices,
  ownerLimits,
  ownerSlips,
  tryThenRollBack,
} from "./db.ts";
import {
  FOREIGN_URI,
  keyed,
  storyDirectories,
  SUPERVISOR,
  USER_700,
  withPlanted,
} from "./helpers.ts";
import { handlersFor } from "../src/operations.ts";

const observer = newPool();
const pool = newPool();
const log = createDbLog(pool);
const registry = dbRegistry(pool);
const proposals = createDbProposals(pool);
const reservations = createDbReservations(pool);

// intake-fte works under del_190, which user_123 signed, and which the owner adds fresh before
// each test, with step 24's limits (test/owner-limits.ts).
const INTAKE: RequestEnvelope = { token: "tok_intake", tenant: "org_456" };
const intake = {
  id: "intake-fte",
  type: "agent",
  memberships: [{ tenant_id: "org_456", roles: [] }],
} as unknown as Principal;
function asIntake<T>(run: () => Promise<T>): Promise<T> {
  return withPlanted("tok_intake", intake, run);
}

const DEL_190_URI = "dsor://org_456/delegation/del_190";
const WHY = "intake-fte drafted a payment it should not have";
const AMOUNT = { value: "31400.00", currency: "USD" };
const DAY = { value: "200000", currency: "USD" };

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
// Each test starts with del_190 active again, and the whole day's room. A torn-up slip never
// comes back through DSoR: only the owner, who adds it again, can do that.
beforeEach(() => {
  ownerLimits("add");
});

/** One statement as dsor_runtime inside a company, rolled back after, and its rows. */
async function rowsOf(
  sql: string,
  values: unknown[] = [],
  tenant = "org_456",
): Promise<Record<string, unknown>[]> {
  return (await tryThenRollBack(observer, sql, tenant, values)).rows;
}

/** INV-9001's version now. */
async function version9001(): Promise<number> {
  const rows = await rowsOf("SELECT version FROM app.invoices WHERE id = 'INV-9001'");
  return Number(rows[0]?.["version"]);
}

/** intake-fte drafts a payment for INV-9001, with a fresh key, in the mode given. */
async function draft(
  envelope: RequestEnvelope = keyed(INTAKE),
  on = registry,
  // And the lines the call runs, as each one starts.
  observe?: (line: number) => void,
): Promise<Answer> {
  const input = {
    invoice: "dsor://org_456/invoice/INV-9001",
    expected_version: await version9001(),
  };
  return asIntake(() => call(on, log, envelope, "payment.create", input, observe));
}

/** user_123 tears up del_190, with a fresh key. */
function tearUp(envelope: RequestEnvelope = keyed(SUPERVISOR), on = registry): Promise<Answer> {
  return call(on, log, envelope, "delegation.revoke", { slip: DEL_190_URI, reason: WHY });
}

const word = (answer: Answer): string =>
  "code" in answer ? answer.code : "outcome" in answer ? answer.outcome : "data";
const idOf = (answer: Answer): string =>
  String("proposal" in answer ? answer.proposal : "").slice("dsor://org_456/proposal/".length);

/** del_190's status, as dsor_runtime reads it. */
async function status190(): Promise<unknown> {
  const rows = await rowsOf("SELECT status FROM dsor.delegations WHERE id = 'del_190'");
  return rows[0]?.["status"];
}

/** A proposal of intake-fte's under del_190, made by the store, moved by hand along the picture. */
async function planted(
  path: ("PENDING_APPROVAL" | "APPROVED")[],
  // The slip it was made under: del_190, unless the test names another.
  delegation = "del_190",
): Promise<string> {
  const id = `prop_${randomUUID()}`;
  const as_of = new Date().toISOString();
  const draft: ProposalDraft = {
    operation: "payment.create@1",
    mode: "execute",
    payload: { invoice: "dsor://org_456/invoice/INV-9001", expected_version: 1 },
    payload_hash: `sha256:${"0".repeat(64)}`,
    resources: ["dsor://org_456/invoice/INV-9001"],
    requester: {
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["intake-fte"],
      active_tenant: "org_456",
      delegation,
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
  await proposals.create("org_456", id, draft, by);
  let from: "PROPOSED" | "PENDING_APPROVAL" = "PROPOSED";
  for (const to of path) {
    expect(await proposals.move("org_456", id, from, to, by)).toBe(true);
    from = to as "PENDING_APPROVAL";
  }
  return id;
}

describe("tearing up a slip, on the database", () => {
  it("DSOR-DEL-04a: on the database, user_123 tears up del_190, and intake-fte's next draft hears DELEGATION_REVOKED (DSOR-DEL-04b)", async () => {
    expect(word(await draft())).toBe("COMMITTED");
    expect(await tearUp()).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", id: "del_190", status: "revoked", cancelled: 0 },
    });
    expect(await status190()).toBe("revoked");
    expect(await draft()).toMatchObject({ code: "DELEGATION_REVOKED" });
  });

  it("DSOR-DEL-04c: on the database, the tear-up cancels the slip's PENDING_APPROVAL and APPROVED proposals, each with its record, and releases their reservations (DSOR-DEL-06d)", async () => {
    const pending = await planted(["PENDING_APPROVAL"]);
    const approved = await planted(["PENDING_APPROVAL", "APPROVED"]);
    for (const id of [pending, approved]) {
      expect(await reservations.reserve("org_456", id, "del_190", AMOUNT, DAY)).toBe(true);
    }
    const answer = await tearUp();
    expect(word(answer)).toBe("COMMITTED");
    // Changed by step 25's review (L2): the answer counts them.
    expect(answer).toMatchObject({ data: { cancelled: 2 } });
    for (const id of [pending, approved]) {
      expect((await proposals.get("org_456", id))?.state).toBe("CANCELLED");
      expect((await reservations.get("org_456", id))?.state).toBe("released");
    }
    const moves = await rowsOf(
      `SELECT result, reason, identity->>'subject' AS mover FROM dsor.audit
        WHERE kind = 'proposal_transition' AND result = 'CANCELLED' AND resources[1] = ANY($1)`,
      [[pending, approved].map((id) => `dsor://org_456/proposal/${id}`)],
    );
    expect(moves).toStrictEqual([
      { result: "CANCELLED", reason: "slip del_190 was torn up", mover: "user_123" },
      { result: "CANCELLED", reason: "slip del_190 was torn up", mover: "user_123" },
    ]);
  });

  it("Step 25: on the database, a READY proposal under the torn-up slip stays READY, and keeps its reservation (step 25's README, decision L4)", async () => {
    const prepared = await draft({ ...keyed(INTAKE), mode: "propose_only" });
    expect(word(prepared)).toBe("READY");
    expect(word(await tearUp())).toBe("COMMITTED");
    expect((await proposals.get("org_456", idOf(prepared)))?.state).toBe("READY");
    expect((await reservations.get("org_456", idOf(prepared)))?.state).toBe("held");
  });

  // Here the draft's line ③ read the slip before the tear-up, and the draft waits inside its
  // transaction, at line ⑩, on the day's total, which another transaction holds. Its proposal is
  // PROPOSED, not EXECUTING, so §13.3's sentence about a command "already EXECUTING" does not
  // describe it. DSoR moves it to READY and EXECUTING after the tear-up has committed. That fits
  // DSOR-DEL-04b: §44 gives a tear-up 60 seconds to reach new decisions, and the draft's line ③
  // decided before the tear-up. Found by step 25's review, which found this comment wrong too.
  // Left for step 29: a call like this one could reach PENDING_APPROVAL after the tear-up read its
  // list of waiting proposals, and never be cancelled (DSOR-DEL-04c). Step 29 must read the slip
  // again inside the claim, FOR SHARE, before READY or PENDING_APPROVAL.
  it("DSOR-DEL-04b: on the database, a draft already inside its transaction when the slip is torn up runs to a recorded outcome, and the next draft is refused", async () => {
    expect(word(await draft())).toBe("COMMITTED");
    const holder = await observer.connect();
    let committed = false;
    let pending: Promise<unknown> = Promise.resolve();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await holder.query(
        "SELECT used FROM dsor.limit_counters WHERE delegation = 'del_190' FOR UPDATE",
      );
      // Line ⑩ of the draft's own call has started, so its line ③ read the slip as active, and the
      // call is inside its transaction. Not a wait on the server's locks, which another database's
      // tests could end too early.
      let reached = (): void => {};
      const atLineTen = new Promise<void>((resolve) => (reached = resolve));
      const drafting = draft(keyed(INTAKE), registry, (line) => {
        if (line === 10) reached();
      });
      pending = drafting;
      await atLineTen;
      // The tear-up commits while the draft waits: they share no row.
      expect(word(await tearUp())).toBe("COMMITTED");
      await holder.query("COMMIT");
      committed = true;
      expect(word(await drafting)).toBe("COMMITTED");
    } finally {
      // A test that fails before its COMMIT rolls back, and waits for its draft, before anything
      // else runs: an owner script blocks this process, and would wait for the draft's lock for
      // ever. Found by step 25b's review.
      if (!committed) await holder.query("ROLLBACK").catch(() => {});
      holder.release();
      await Promise.allSettled([pending]);
    }
    expect(await draft()).toMatchObject({ code: "DELEGATION_REVOKED" });
  });

  it("Step 25: on the database, the tear-up's record names the person, the reason, and the call", async () => {
    const answer = await tearUp();
    const rows = await rowsOf(
      `SELECT kind, result, reason, delegation, identity, "authorization"
         FROM dsor.audit WHERE kind = 'delegation_change' AND correlation->>'request_id' = $1`,
      [answer.correlation.request_id],
    );
    expect(rows).toStrictEqual([
      {
        kind: "delegation_change",
        result: "revoked",
        reason: WHY,
        delegation: "del_190",
        identity: {
          mode: "direct",
          subject: "user_123",
          actor_chain: [],
          subject_authority: { source: "token", as_of: expect.any(String) },
        },
        authorization: null,
      },
    ]);
  });

  it("Step 25: on the database, an accident after the tear-up rolls back the slip, the cancellations, and the record, with the claim", async () => {
    const pending = await planted(["PENDING_APPROVAL"]);
    const shipped = ownWorkFor();
    const revoke = shipped["delegation.revoke"]!;
    const breaking = dbRegistry(pool, storyDirectories(), handlersFor(), {
      ...shipped,
      "delegation.revoke": {
        check: revoke.check,
        change: async (input, work) => {
          await revoke.change(input, work);
          throw new Error("the connection dropped after the tear-up");
        },
      },
    });
    const answer = await tearUp(keyed(SUPERVISOR), breaking);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await status190()).toBe("active");
    expect((await proposals.get("org_456", pending))?.state).toBe("PENDING_APPROVAL");
    const records = await rowsOf(
      "SELECT count(*)::int AS n FROM dsor.audit WHERE kind = 'delegation_change' AND correlation->>'request_id' = $1",
      [answer.correlation.request_id],
    );
    expect(records).toStrictEqual([{ n: 0 }]);
  });
});

describe("the database's own rules for torn-up slips", () => {
  it("Step 25: dsor_runtime cannot bring a torn-up slip back, or change anything but its status", async () => {
    expect(word(await tearUp())).toBe("COMMITTED");
    const back = await tryThenRollBack(
      observer,
      "UPDATE dsor.delegations SET status = 'active' WHERE id = 'del_190'",
      "org_456",
    );
    expect(back.rowCount).toBe(0);
    await expect(
      tryThenRollBack(
        observer,
        "UPDATE dsor.delegations SET delegator = 'user_700' WHERE id = 'del_190'",
        "org_456",
      ),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("Step 25: dsor_runtime may move a slip only to suspended or revoked, and only from active or suspended", async () => {
    const reopen = await tryThenRollBack(
      observer,
      "UPDATE dsor.delegations SET status = 'expired' WHERE id = 'del_190'",
      "org_456",
    ).catch((error: { code?: string }) => error);
    // A row the policy's WITH CHECK refuses is an error, 42501, not a quiet zero.
    expect(reopen).toMatchObject({ code: "42501" });
    const revoked = await tryThenRollBack(
      observer,
      "UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_190'",
      "org_456",
    );
    expect(revoked.rowCount).toBe(1);
  });

  it("DSOR-TEN-01b: on the database, inside org_789 no slip of org_456 can be torn up, by DSoR or by hand", async () => {
    expect(
      await call(registry, log, keyed(USER_700), "delegation.revoke", {
        slip: DEL_190_URI,
        reason: WHY,
      }),
    ).toMatchObject({ message: FOREIGN_URI });
    const hidden = await tryThenRollBack(
      observer,
      "UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_190'",
      "org_789",
    );
    expect(hidden.rowCount).toBe(0);
    expect(await status190()).toBe("active");
  });

  it("Step 25: on the database, a slip torn up already gives CONFLICT, and the second call leaves no change record", async () => {
    const first = await tearUp();
    const second = await tearUp();
    expect(word(first)).toBe("COMMITTED");
    expect(second).toMatchObject({ code: "CONFLICT", message: "slip del_190 is torn up already" });
    const counted = async (answer: Answer) =>
      rowsOf(
        "SELECT count(*)::int AS n FROM dsor.audit WHERE kind = 'delegation_change' AND correlation->>'request_id' = $1",
        [answer.correlation.request_id],
      );
    expect([await counted(first), await counted(second)]).toStrictEqual([[{ n: 1 }], [{ n: 0 }]]);
  });
});

describe("from step 25's sweep, on the database", () => {
  // D5: no database test planted waiting work under another slip.
  it("DSOR-DEL-04c: on the database, a waiting proposal under another slip is not touched", async () => {
    const firms = await planted(["PENDING_APPROVAL"], "del_101");
    expect(await tearUp()).toMatchObject({ data: { cancelled: 0 } });
    expect((await proposals.get("org_456", firms))?.state).toBe("PENDING_APPROVAL");
  });

  // G1: the policy lets a suspended slip be torn up, and no test tore one up on the database.
  it("DSOR-DEL-04a: on the database, a slip that the directory suspended can be torn up", async () => {
    expect(ownerLimits("suspend")).toStrictEqual({ changed: 1 });
    expect(word(await tearUp())).toBe("COMMITTED");
    expect(await status190()).toBe("revoked");
  });

  // D2: the work's look refuses a slip past its date first, and the policy does not look at dates.
  // So only the store's own statement keeps such a slip as it is.
  it("Step 25: on the database, the slips store alone does not tear up a slip past its date", async () => {
    expect(ownerLimits("past")).toStrictEqual({ changed: 1 });
    const why = {
      person: "user_123",
      as_of: new Date().toISOString(),
      words: WHY,
      correlation: { request_id: `req_${randomUUID()}` },
    };
    expect(await createDbSlips(pool).revoke("org_456", "del_190", why)).toBe(false);
    expect(await status190()).toBe("active");
  });

  // D1: as dsor_runtime, the policy refuses a torn-up slip too. The owner, whom no policy stops,
  // runs DSoR's own statement, so only its own WHERE is left.
  it("Step 25: DSoR's own status check alone: the owner, whom no policy stops, cannot tear up a torn-up slip again through DSoR's store", async () => {
    expect(word(await tearUp())).toBe("COMMITTED");
    expect(ownerSlips("revoke", "org_456", "del_190", `req_${randomUUID()}`)).toStrictEqual({
      revoked: false,
    });
  });
});

describe("from step 25's review, on the database", () => {
  // M1, on the database: the who-check is line ⑨'s, so a refusal is a DENY.
  it("DSOR-EXE-02: on the database, a refused tear-up is recorded DENY, and its proposal ends DENIED", async () => {
    const user124 = {
      id: "user_124",
      type: "human",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    } as unknown as Principal;
    const answer = await withPlanted("tok_user_124", user124, () =>
      tearUp(keyed({ token: "tok_user_124", tenant: "org_456" })),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    const rows = await rowsOf(
      `SELECT "authorization", result FROM dsor.audit
        WHERE kind = 'decision' AND correlation->>'request_id' = $1`,
      [answer.correlation.request_id],
    );
    expect(rows).toStrictEqual([{ authorization: "DENY", result: "AUTHORIZATION_DENIED" }]);
    expect((await proposals.get("org_456", idOf(answer)))?.state).toBe("DENIED");
    expect(await status190()).toBe("active");
  });

  // B2, B6, B9: row-level security alone kept these three statements inside the company. The
  // owner, whom no policy stops, runs DSoR's own get, waiting, and tear-up for org_456 beside a
  // slip of org_789 and a proposal waiting under it, so only DSoR's own WHERE is left.
  it("DSOR-TEN-01b: DSoR's own WHERE alone keeps the tear-up's three statements inside the company", async () => {
    expect(ownerSlips("filters", `req_${randomUUID()}`)).toStrictEqual({
      found: null,
      waiting: 0,
      revoked: false,
      twin: "active",
    });
  });
});
