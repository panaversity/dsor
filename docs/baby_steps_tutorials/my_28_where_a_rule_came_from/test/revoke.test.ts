// STEP 25: tearing up a permission slip (decision 142).
//
// Rule DSOR-DEL-04a: a delegation MUST be revocable by its delegator and by a tenant administrator.
// Rule DSOR-DEL-04c: on revocation or expiry, every proposal created under the delegation that is
// PENDING_APPROVAL or APPROVED MUST move to CANCELLED.
// Rule DSOR-DEL-06d: a reservation MUST be released when its proposal reaches FAILED, REJECTED,
// EXPIRED, CANCELLED, REVOKED, or INVALIDATED.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog, type AuditRecord } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { revokeSlip } from "../src/delegation.ts";
import { money } from "../src/money.ts";
import { PIPELINE } from "../src/operations.ts";
import type { Context } from "../src/pipeline.ts";
import {
  moveProposalThrough,
  movesOf,
  propose,
  proposalsOf,
  type ProposalState,
  stateOf,
} from "../src/proposal.ts";
import { reserve, usedToday } from "../src/reservation.ts";
import { theDatabase, useDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, BY_A_TEST, resetTheStory } from "./support/database.ts";
import { callOperation, makeDoor } from "./support/door.ts";

const SUPERVISOR = { loggedInAs: "user_123" };

/**
 * STEP 25, decision 157: the last decision in org_456's log. A command that gets past §21.8
 * leaves the records of its proposal's moves after its decision, so the log's last record is not it.
 */
const lastDecision = async (): Promise<AuditRecord | undefined> =>
  (await theLog("org_456")).filter((r) => r.kind === "decision").at(-1);
const CFO = { loggedInAs: "cfo_100" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const DEL_100 = "dsor://org_456/delegation/del_100";
const PAY = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "2500.00", currency: "USD" },
};

/** del_100's status, read as the application. */
const statusOfDel100 = async (): Promise<string | undefined> => {
  const { rows } = await theDatabase("org_456").query<{ status: string }>(
    "SELECT status FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_100'",
  );

  return rows[0]?.status;
};

/** Decision 156: any slip's status in org_456, read as the application. */
const statusOf = async (id: string): Promise<string | undefined> => {
  const { rows } = await theDatabase("org_456").query<{ status: string }>(
    "SELECT status FROM dsor.delegations WHERE tenant = 'org_456' AND id = $1",
    [id],
  );

  return rows[0]?.status;
};

/**
 * Decision 156: run `run` while the first `times` statements that contain `sql` fail, as a store
 * that went away would; then put the store back.
 */
async function whileFailing<T>(sql: string, times: number, run: () => Promise<T>): Promise<T> {
  const connection = overPGlite(db);
  let failed = 0;

  useDatabase({
    async query<R>(text: string, params?: unknown[], tenant?: string) {
      if (failed < times && text.includes(sql)) {
        failed += 1;

        throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
      }

      return connection.query<R>(text, params, tenant);
    },
  });

  try {
    return await run();
  } finally {
    useDatabase(connection);
  }
}

/**
 * A proposal `actor` asked for, as `requester` says, walked to a state, as approvals one day will.
 * Decision 156: any requester, so a test can make proposals under another slip, or none.
 */
async function aProposal(
  requester: Readonly<Record<string, unknown>>,
  actor: string,
  path: readonly ProposalState[],
): Promise<string> {
  const id = await propose(
    {
      tenant: "org_456",
      operation: "payment.create@1",
      mode: "execute",
      payload: "{}",
      payloadHash: "sha256:0",
      requester: JSON.stringify(requester),
      idempotencyKey: `revoke-${Math.random()}`,
      actor,
      cause: "payment.create@1 invoked",
    },
    BY_A_TEST,
  );
  const steps = path.slice(1).map((to, i) => [path[i] as ProposalState, to, `to ${to}`] as const);

  if (steps.length > 0) {
    await moveProposalThrough("org_456", id, steps, "dsor", null, BY_A_TEST);
  }

  return id;
}

/** A proposal the agent made under del_100, walked to a state, as approvals one day will. */
function underDel100(path: readonly ProposalState[]): Promise<string> {
  return aProposal(
    {
      mode: "unattended",
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      delegation: "del_100",
    },
    "accounts-payable-fte",
    path,
  );
}

/** A slip in org_456 that cfo_100 signed, for an agent of no one's, as an owner would add one. */
async function aSlipSignedByCfo(): Promise<void> {
  await asTheOwner(() =>
    db.exec(`INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status, expires_at)
             VALUES ('org_456', 'del_200', 'cfo_100', 'another-agent', ARRAY['invoice:read'],
                     'active', '2099-12-31T23:59:59Z')`),
  );
}

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
});

describe("delegation.revoke: the person who signed a slip tears it up", () => {
  it("DSOR-DEL-04a: user_123 revokes del_100, and the agent's next command is refused", async () => {
    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "the agent is paying the wrong invoices",
    });

    expect(answer.kind === "result" && answer.envelope.data?.["status"]).toBe("revoked");
    expect(await statusOfDel100()).toBe("revoked");

    // With no active slip, the agent's command runs under nobody's authority, and is refused at §21.3.
    const refused = await callOperation(AGENT, "payment.create", PAY);

    expect(refused.kind === "error" && refused.envelope.code).toBe("DELEGATION_REQUIRED");
  });

  it("DSOR-DEL-04a: the record says who revoked it, and why", async () => {
    await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "the agent is paying the wrong invoices",
    });

    const { rows } = await theDatabase("org_456").query<{
      revoked_by: string;
      revoked_reason: string;
    }>(
      "SELECT revoked_by, revoked_reason FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_100'",
    );

    expect(rows).toStrictEqual([
      { revoked_by: "user_123", revoked_reason: "the agent is paying the wrong invoices" },
    ]);
  });

  it("DSOR-DEL-04a: cfo_100, who did not sign del_100, may not revoke it", async () => {
    const answer = await callOperation(CFO, "delegation.revoke", {
      target: DEL_100,
      reason: "not mine to revoke",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(
      /only the person who signed del_100/,
    );
    // Decision 156: refused at §21.9, by the signer check the title names, so the log says DENY. The
    // words alone do not show it: the statement asks who signed the slip too, and refuses in the same
    // words after §21.11 has recorded ALLOW. Without this line the test stayed green with the signer
    // check deleted, as it did when §21.5 refused her for want of delegation:revoke.
    expect((await lastDecision())?.authorization).toBe("DENY");
    expect(await statusOfDel100()).toBe("active");
  });

  it("DSOR-DEL-04a: the agent may not revoke its own slip", async () => {
    const answer = await callOperation(AGENT, "delegation.revoke", {
      target: DEL_100,
      reason: "tearing up my own slip",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(await statusOfDel100()).toBe("active");
  });

  it("DSOR-DEL-04a: a slip revoked already, or one that does not exist, changes nothing and is refused", async () => {
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "once" });

    const again = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "twice",
    });
    const nowhere = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_999",
      reason: "no such slip",
    });

    expect(again.kind === "error" && again.envelope.code).toBe("CONFLICT");
    // Decision 156: as a slip someone else signed; that none exists is not said (DSOR-ERR-01b).
    expect(nowhere.kind === "error" && nowhere.envelope.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-DEL-04a: user_123 revokes del_100 while it is suspended", async () => {
    // Decision 156: §21.9, the statement, the slips' policy and the contract all asked for an active
    // slip, so a suspended one was refused CONFLICT, "not active", and its signer could not tear it up
    // before someone made it active again. DSOR-DEL-04a makes no exception for a slip's status. Today
    // only an owner can suspend a slip; DSOR-IDN-07 will.
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.delegations SET status = 'suspended' WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    );

    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "it must not come back",
    });

    expect(answer.kind === "result" && answer.envelope.data?.["status"]).toBe("revoked");
    expect(await statusOfDel100()).toBe("revoked");
  });

  it("DSOR-DEL-04a: a revocation without a reason is refused, and the slip stays active", async () => {
    const answer = await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100 });

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(await statusOfDel100()).toBe("active");
  });
});

describe("what was waiting under the slip", () => {
  it("DSOR-DEL-04c: proposals waiting for approval or approved under del_100 move to CANCELLED, with the cause", async () => {
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);
    const approved = await underDel100(["PROPOSED", "PENDING_APPROVAL", "APPROVED"]);

    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    expect(await stateOf("org_456", waiting)).toBe("CANCELLED");
    expect(await stateOf("org_456", approved)).toBe("CANCELLED");
    expect((await movesOf("org_456", waiting)).at(-1)?.cause).toBe(
      "del_100 was revoked by user_123",
    );
  });

  it("DSOR-DEL-04c: each proposal a revocation cancels has a record of its move, in the name of the person who revoked", async () => {
    // STEP 25, decision 157: a move to CANCELLED is a move like any other, so it has its
    // record in the log, written by the statement that revokes the slip and makes the move.
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);
    const approved = await underDel100(["PROPOSED", "PENDING_APPROVAL", "APPROVED"]);
    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "stop",
    });

    if (answer.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
    }

    // This file keeps the log between tests, so the records are this revocation's.
    const cancellations = (await theLog("org_456")).filter(
      (r) =>
        r.kind === "proposal_transition" &&
        r.result === "CANCELLED" &&
        r.correlation.request_id === answer.envelope.correlation.request_id,
    );

    expect(cancellations.map((r) => r.reason)).toStrictEqual([
      "PENDING_APPROVAL -> CANCELLED by dsor: del_100 was revoked by user_123",
      "APPROVED -> CANCELLED by dsor: del_100 was revoked by user_123",
    ]);

    for (const [record, id] of [
      [cancellations[0], waiting],
      [cancellations[1], approved],
    ] as const) {
      // In user_123's name, by the revocation's own request; about the proposal it moved.
      expect(record).toMatchObject({
        identity: { mode: "direct", subject: "user_123", actor_chain: [] },
        correlation: { request_id: answer.envelope.correlation.request_id },
        resources: [`dsor://org_456/proposal/${id}`],
        operation: "payment.create@1",
        payload_hash: "sha256:0",
      });
      // And the move names it.
      expect((await movesOf("org_456", id)).at(-1)?.record).toBe(record?.record_id);
    }
  });

  /**
   * STEP 25, decision 157: the store, running `meanwhile` just after each of the first
   * `times` reads of what waits under del_100, as approvals one day will, and counting every read.
   */
  function afterEachRead(
    times: number,
    meanwhile: () => Promise<unknown>,
  ): { readonly reads: () => number } {
    const connection = overPGlite(db);
    let reads = 0;
    const wrapped = {
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        const result = await connection.query<T>(sql, params, tenant);

        if (
          sql.includes("(p.requester::jsonb ->> 'delegation') = $2") &&
          !sql.includes("WITH waiting")
        ) {
          reads += 1;

          if (reads <= times) {
            useDatabase(connection);

            try {
              await meanwhile();
            } finally {
              useDatabase(wrapped);
            }
          }
        }

        return result;
      },
    };

    useDatabase(wrapped);

    return { reads: () => reads };
  }

  /** STEP 25, decision 157: a new proposal starts waiting under del_100 after each read. */
  const newWorkAfterEachRead = (times: number): { readonly reads: () => number } =>
    afterEachRead(times, () => underDel100(["PROPOSED", "PENDING_APPROVAL"]));

  it("DSOR-DEL-04c: a proposal that starts waiting while the slip is revoked is cancelled too, with its record", async () => {
    // STEP 25, decision 157: the revocation reads what waits, to write each cancellation's
    // record, and then writes. A proposal that starts waiting in between is not in what it read: it
    // revokes only if what waits is still what it read, and otherwise reads again.
    await underDel100(["PROPOSED", "PENDING_APPROVAL"]);

    const store = newWorkAfterEachRead(1);
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "delegation.revoke", {
        target: DEL_100,
        reason: "stop",
      });
    } finally {
      useDatabase(overPGlite(db));
    }

    if (answer.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
    }

    // Read twice: the second time, the late one was there too.
    expect(store.reads()).toBe(2);
    // Both payments waiting under del_100 are cancelled, the one that started late included.
    expect(
      (await proposalsOf("org_456"))
        .filter((p) => p.operation === "payment.create@1")
        .map((p) => p.state),
    ).toStrictEqual(["CANCELLED", "CANCELLED"]);
    // And each has the record of its move, from this revocation.
    expect(
      (await theLog("org_456")).filter(
        (r) =>
          r.kind === "proposal_transition" &&
          r.result === "CANCELLED" &&
          r.correlation.request_id === answer.envelope.correlation.request_id,
      ),
    ).toHaveLength(2);
  });

  it("DSOR-DEL-04c: a proposal that stops waiting while the slip is revoked is left as it went, and the rest are cancelled", async () => {
    // STEP 25, decision 157, found by a review: the other half of "still what was read". A
    // proposal that left PENDING_APPROVAL after the read is in what was read and no longer waits:
    // its move to CANCELLED would be its second move out of PENDING_APPROVAL, which the database
    // refuses, and the revocation would fail whole. So it reads again.
    const rejected = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);
    const approved = await underDel100(["PROPOSED", "PENDING_APPROVAL", "APPROVED"]);
    const store = afterEachRead(1, () =>
      moveProposalThrough(
        "org_456",
        rejected,
        [["PENDING_APPROVAL", "REJECTED", "rejected by cfo_100"]],
        "dsor",
        null,
        BY_A_TEST,
      ),
    );
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "delegation.revoke", {
        target: DEL_100,
        reason: "stop",
      });
    } finally {
      useDatabase(overPGlite(db));
    }

    expect(answer.kind).toBe("result");
    expect(store.reads()).toBe(2);
    expect(await statusOfDel100()).toBe("revoked");
    expect(await stateOf("org_456", rejected)).toBe("REJECTED");
    expect(await stateOf("org_456", approved)).toBe("CANCELLED");
  });

  it("DSOR-DEL-04c: a slip that has ended is told so at once, even while what waits under it changes", async () => {
    // STEP 25, decision 157, found by a review: "it had ended" was read off "what waits is
    // the same", so a slip that had ended while new work kept arriving was read five times, and
    // answered "it kept changing". Called directly: through the door, §21.9 refuses first.
    await revokeSlip("org_456", "del_100", "user_123", "the first", {
      subject: "user_123",
      requestId: "req_the_first",
    });
    // Waiting under a slip already revoked, as only a test can make one before step 29.
    await underDel100(["PROPOSED", "PENDING_APPROVAL"]);

    const store = newWorkAfterEachRead(Number.POSITIVE_INFINITY);
    let revoked;

    try {
      revoked = await revokeSlip("org_456", "del_100", "user_123", "the second", {
        subject: "user_123",
        requestId: "req_the_second",
      });
    } finally {
      useDatabase(overPGlite(db));
    }

    expect(revoked).toStrictEqual({ kind: "ended" });
    expect(store.reads()).toBe(1);
  });

  it("DSOR-DEL-04c: a revocation that keeps finding new work waiting revokes nothing, and answers CONFLICT", async () => {
    // STEP 25, decision 157: it reads again at most five times. Every time, something new
    // waits; so it gives up, and nothing is changed: not the slip, and nothing under it.
    await underDel100(["PROPOSED", "PENDING_APPROVAL"]);

    const store = newWorkAfterEachRead(Number.POSITIVE_INFINITY);
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "delegation.revoke", {
        target: DEL_100,
        reason: "stop",
      });
    } finally {
      useDatabase(overPGlite(db));
    }

    if (answer.kind !== "error") {
      throw new Error(`expected CONFLICT, got ${JSON.stringify(answer)}`);
    }

    expect(store.reads()).toBe(5);
    expect(answer.envelope.code).toBe("CONFLICT");
    expect(answer.envelope.message).toBe(
      "what waits under del_100 changed each of the 5 times it was read; nothing was revoked",
    );
    expect(await statusOfDel100()).toBe("active");
    expect(
      (await proposalsOf("org_456")).filter((p) => p.state === "PENDING_APPROVAL"),
    ).toHaveLength(6);
    expect(
      (await theLog("org_456")).some(
        (r) =>
          r.kind === "proposal_transition" &&
          r.result === "CANCELLED" &&
          r.correlation.request_id === answer.envelope.correlation.request_id,
      ),
    ).toBe(false);
  });

  it("DSOR-DEL-04c: a proposal already finished, or prepared and READY, is left as it is", async () => {
    const done = await underDel100(["PROPOSED", "READY", "EXECUTING", "COMMITTED"]);
    const prepared = await underDel100(["PROPOSED", "READY"]);

    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    expect(await stateOf("org_456", done)).toBe("COMMITTED");
    // §26.2 has no move from READY to CANCELLED; step 31's proposal.execute checks the slip again.
    expect(await stateOf("org_456", prepared)).toBe("READY");
  });

  it("DSOR-DEL-06d: a cancelled proposal's reservation is released, and its amount given back to the day", async () => {
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);

    await reserve(
      "org_456",
      waiting,
      "del_100",
      money("40000.00", "USD"),
      money("200000.00", "USD"),
    );
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-06d: a cancelled proposal's reservation is released even when the first try fails", async () => {
    // Decision 156: the door tries a settlement twice (decision 140). The revocation tried once,
    // under a comment that said it settled as the door does, and one failure kept the amount held.
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);

    await reserve(
      "org_456",
      waiting,
      "del_100",
      money("40000.00", "USD"),
      money("200000.00", "USD"),
    );
    await whileFailing("UPDATE dsor.reservations", 1, () =>
      callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" }),
    );

    expect(await stateOf("org_456", waiting)).toBe("CANCELLED");
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-DEL-04a: a revocation whose reply is lost after it committed is found by its records: its signer is told the slip is revoked, and what it cancelled gives its amount back to the day", async () => {
    // STEP 25, decision 157, found by a review: the statement that revokes commits, and its
    // reply is lost. The records of its cancels are looked for and found, so it happened, and
    // `revokeSlip` says so when `rows` is undefined. With that half of its condition deleted, every
    // test stayed green, and the revocation answered AUTHORIZATION_DENIED, its own proposal was
    // recorded FAILED, and 40,000.00 USD stayed held against the day.
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);
    const approved = await underDel100(["PROPOSED", "PENDING_APPROVAL", "APPROVED"]);

    await reserve(
      "org_456",
      approved,
      "del_100",
      money("40000.00", "USD"),
      money("200000.00", "USD"),
    );

    const connection = overPGlite(db);
    let lost = 0;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        // The statement that revokes runs, and its reply never arrives.
        if (lost === 0 && sql.includes("WITH waiting AS")) {
          lost += 1;
          await connection.query(sql, params, tenant);

          throw Object.assign(new Error("the reply was lost"), { code: "ECONNRESET" });
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "delegation.revoke", {
        target: DEL_100,
        reason: "stop",
      });
    } finally {
      useDatabase(connection);
    }

    expect(lost).toBe(1);
    expect(answer.kind === "result" && answer.envelope.data).toMatchObject({
      status: "revoked",
      cancelled: 2,
    });
    expect(await statusOfDel100()).toBe("revoked");
    expect(await stateOf("org_456", waiting)).toBe("CANCELLED");
    expect(await stateOf("org_456", approved)).toBe("CANCELLED");
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
    // And the revocation's own proposal is COMMITTED, not FAILED: it was done.
    expect(
      (await proposalsOf("org_456")).find((p) => p.operation === "delegation.revoke@1")?.state,
    ).toBe("COMMITTED");
  });

  it("DSOR-DEL-04c: proposals under another slip, or asked for directly, are left as they are", async () => {
    // Decision 156: one line of the statement keeps the cancelling to the revoked slip, and no test
    // held it. Without it, user_123 revoking del_100 cancelled a payment approved under del_200,
    // which cfo_100 signed, and gave its amount back to the day.
    await aSlipSignedByCfo();

    const mine = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);
    const another = await aProposal(
      {
        mode: "unattended",
        subject: "cfo_100",
        actor_chain: ["another-agent"],
        delegation: "del_200",
      },
      "another-agent",
      ["PROPOSED", "PENDING_APPROVAL", "APPROVED"],
    );
    const direct = await aProposal(
      { mode: "direct", subject: "cfo_100", actor_chain: [] },
      "cfo_100",
      ["PROPOSED", "PENDING_APPROVAL"],
    );

    await reserve(
      "org_456",
      another,
      "del_200",
      money("40000.00", "USD"),
      money("200000.00", "USD"),
    );

    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "stop",
    });

    expect(answer.kind === "result" && answer.envelope.data?.["cancelled"]).toBe(1);
    expect(await stateOf("org_456", mine)).toBe("CANCELLED");
    expect(await stateOf("org_456", another)).toBe("APPROVED");
    expect(await stateOf("org_456", direct)).toBe("PENDING_APPROVAL");
    expect(await usedToday("org_456", "del_200")).toBe("40000.00");
  });
});

describe("what the application may do to a slip", () => {
  it("DSOR-DEL-04a: it may only change a slip to revoked, even writing the SQL itself", async () => {
    // Not back to active, and not to anything else.
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    const { rows: back } = await theDatabase("org_456").query(
      "UPDATE dsor.delegations SET status = 'active' WHERE tenant = 'org_456' AND id = 'del_100' RETURNING id",
    );

    expect(back).toStrictEqual([]);
    expect(await statusOfDel100()).toBe("revoked");

    await resetTheStory();
    await expect(
      theDatabase("org_456").query(
        "UPDATE dsor.delegations SET status = 'suspended' WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      theDatabase("org_456").query(
        "UPDATE dsor.delegations SET permissions = ARRAY['payment:create'] WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("DSOR-DEL-04a: a suspended slip may become revoked, and never active again, even writing the SQL itself", async () => {
    // Decision 156: the policy lets the application reach a suspended slip now, to revoke it. Its
    // second half still lets it leave only revoked, with who revoked it, when and why.
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.delegations SET status = 'suspended' WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    );

    await expect(
      theDatabase("org_456").query(
        "UPDATE dsor.delegations SET status = 'active' WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await statusOfDel100()).toBe("suspended");

    const { rows } = await theDatabase("org_456").query(
      "UPDATE dsor.delegations SET status = 'revoked', revoked_by = 'user_123', revoked_at = clock_timestamp(), revoked_reason = 'suspended, and torn up' WHERE tenant = 'org_456' AND id = 'del_100' RETURNING id",
    );

    expect(rows).toHaveLength(1);
  });
});

// STEP 25, decision 143: who may revoke is decided at §21.9, before the decision is recorded.

describe("§21.9: the target's own rules, decided and recorded", () => {
  it("DSOR-DEL-04a: user_123, who may revoke slips, may not revoke one cfo_100 signed, and the log says DENY", async () => {
    // Decision 143: this was refused in the handler, after §21.11 had recorded ALLOW.
    await aSlipSignedByCfo();

    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_200",
      reason: "not mine",
    });
    const last = await lastDecision();

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(last?.authorization).toBe("DENY");
    expect(last?.result).toBe("AUTHORIZATION_DENIED");

    const { rows } = await theDatabase("org_456").query<{ status: string }>(
      "SELECT status FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_200'",
    );

    expect(rows).toStrictEqual([{ status: "active" }]);
  });

  it("DSOR-DEL-04a: a slip revoked already, or none, is refused and recorded as the DENY it is", async () => {
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "once" });
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "twice" });

    expect((await lastDecision())?.result).toBe("CONFLICT");

    await callOperation(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_999",
      reason: "no such slip",
    });

    expect((await lastDecision())?.result).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-DEL-04a: cfo_100 revokes del_200, which she signed", async () => {
    // Decision 156: §21.5 refused her, because the approver's role had no delegation:revoke, before
    // §21.9 asked who signed the slip. So a slip an approver signed could be revoked by nobody.
    await aSlipSignedByCfo();

    const answer = await callOperation(CFO, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_200",
      reason: "the agent no longer needs it",
    });

    expect(answer.kind === "result" && answer.envelope.data?.["status"]).toBe("revoked");
    expect((await lastDecision())?.authorization).toBe("ALLOW");

    const { rows } = await theDatabase("org_456").query<{ status: string; revoked_by: string }>(
      "SELECT status, revoked_by FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_200'",
    );

    expect(rows).toStrictEqual([{ status: "revoked", revoked_by: "cfo_100" }]);
  });

  it("DSOR-ERR-01b: a slip that does not exist and one someone else signed are refused in the same words", async () => {
    // Decision 156: §21.9 asked "is it there?" before "is it yours?". user_123 got RESOURCE_NOT_FOUND
    // for del_999 and AUTHORIZATION_DENIED for del_200, so a dry run, which costs no key, told
    // user_123 which slips exist in the company and that someone else signed them. Nobody may read a
    // slip, so neither may be told.
    await aSlipSignedByCfo();

    const seen = new Set<string>();

    for (const mode of ["execute", "validate_only"] as const) {
      for (const id of ["del_200", "del_999"]) {
        const answer = await callOperation(
          SUPERVISOR,
          "delegation.revoke",
          { target: `dsor://org_456/delegation/${id}`, reason: "is it there?" },
          mode === "execute" ? undefined : { mode },
        );

        expect(answer.kind === "error" && answer.envelope.code, `${id}, ${mode}`).toBe(
          "AUTHORIZATION_DENIED",
        );
        // The slip's id is the caller's own words; every other word must be the same.
        seen.add(answer.kind === "error" ? answer.envelope.message.replaceAll(id, "<slip>") : "");
      }
    }

    expect([...seen]).toHaveLength(1);
  });

  it("DSOR-DEL-04a: a dry run of a revocation by someone who did not sign the slip is refused too", async () => {
    await aSlipSignedByCfo();

    const answer = await callOperation(
      SUPERVISOR,
      "delegation.revoke",
      { target: "dsor://org_456/delegation/del_200", reason: "would I be allowed?" },
      { mode: "validate_only" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-DEL-04a: a slip that cannot be read is no answer: the revocation is refused, recorded, and the slip stays active", async () => {
    // Decision 156: §21.9's catch could carry on instead, with every test green, and before the
    // statement asked who signed the slip, user_123 then revoked del_200, which cfo_100 signed,
    // whenever that one read failed.
    await aSlipSignedByCfo();

    const answer = await whileFailing("SELECT delegator, status FROM dsor.delegations", 1, () =>
      callOperation(SUPERVISOR, "delegation.revoke", {
        target: "dsor://org_456/delegation/del_200",
        reason: "while the store is away",
      }),
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect((await lastDecision())?.authorization).toBe("DENY");
    expect(await statusOf("del_200")).toBe("active");
  });

  it("DSOR-DEL-04a: with §21.9 gone, the statement still revokes only its signer's slip", async () => {
    // Decision 156: §21.9 was the only lock. Through a door built without it, user_123 revoked
    // del_200, which cfo_100 signed. The statement now asks who signed it too, and the handler
    // refuses in §21.9's words; the decision on the record says ALLOW, which only §21.9 can prevent.
    await aSlipSignedByCfo();

    const withoutTheStage = PIPELINE.map((stage) =>
      stage.name === "check the target"
        ? Object.freeze({
            ...stage,
            run: (context: Context) => ({ kind: "carry_on" as const, context }),
          })
        : stage,
    );
    const answer = await makeDoor(withoutTheStage)(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_200",
      reason: "around §21.9",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(
      /only the person who signed del_200/,
    );
    expect(await statusOf("del_200")).toBe("active");
  });

  it("DSOR-DEL-04a: a revocation overtaken by another after §21.9 is told the slip is revoked already, not that its signer did not sign it", async () => {
    // Decision 156: when the statement changes nothing, it asks whether the slip is the caller's, to
    // tell "it has ended" (CONFLICT) from "it is not yours" (AUTHORIZATION_DENIED). Through the real
    // pipeline only a race reaches that question: §21.9 found del_100 active, and another revocation
    // landed before the statement ran. No test reached it. With the question answering "not yours"
    // every time, every test stayed green, and user_123, del_100's own signer, lost the race and was
    // told that user_123 did not sign it.
    const overtaken = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: async (context: Context) => {
              const done = await stage.run(context);

              // user_123's other revocation lands here, after this one's decision and before its
              // handler, as two sent at once can. STEP 25, decision 157: in a request of its
              // own, as the records of what it cancels say.
              await revokeSlip("org_456", "del_100", "user_123", "the first of two", {
                subject: "user_123",
                requestId: "req_the_first_of_two",
              });

              return done;
            },
          })
        : stage,
    );
    const answer = await makeDoor(overtaken)(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "the second of two",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("CONFLICT");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(
      /del_100 is revoked or expired already/,
    );

    // And it changed nothing: the slip keeps the reason of the revocation that landed.
    const { rows } = await theDatabase("org_456").query<{ status: string; revoked_reason: string }>(
      "SELECT status, revoked_reason FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_100'",
    );

    expect(rows).toStrictEqual([{ status: "revoked", revoked_reason: "the first of two" }]);
  });
});

describe("a revocation says who", () => {
  it("DSOR-DEL-04a: the application cannot write a revocation with no one's name on it", async () => {
    // Decision 143: the slips' policy lets a slip become revoked only with who revoked it.
    // Decision 156: it asks when and why too, so this statement gives both, and the name is all it
    // leaves out. Without them it was refused with the who clause deleted.
    await expect(
      theDatabase("org_456").query(
        `UPDATE dsor.delegations SET status = 'revoked', revoked_at = now(), revoked_reason = 'stop'
          WHERE tenant = 'org_456' AND id = 'del_100'`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await statusOfDel100()).toBe("active");
  });
});
