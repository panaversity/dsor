// STEP 23: three ways to call a command (decision 138).
//
// Rule DSOR-OPR-05: every command MUST support the execute, propose_only, and validate_only
// invocation modes.
// Rule DSOR-OPR-06: a validate_only invocation MUST NOT create a proposal, take a reservation, place
// a hold, or cause a side effect.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { getInvoice } from "../src/invoice.ts";
import { callOperation } from "../src/operations.ts";
import { paymentsOf } from "../src/payment.ts";
import { movesOf, proposalsOf, stateOf } from "../src/proposal.ts";
import { contractsFromDisk, exampleRequestOf, loadRegistry } from "../src/registry.ts";
import { overPGlite } from "../src/database.ts";
import { useDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const ISSUE_1009 = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  await forgetTheLog("org_456");
});

/** INV-1009's status now. */
const statusOf1009 = async (): Promise<string | undefined> =>
  (await getInvoice("org_456", "INV-1009")).value?.status;

describe("how a command is called travels beside its arguments", () => {
  it("DSOR-OPR-05: execute is what a request with no mode gets, and saying it changes nothing", async () => {
    const unsaid = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-unsaid",
    });

    expect(unsaid.kind === "result" && unsaid.envelope.outcome).toBe("COMMITTED");

    await resetTheStory();

    const said = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-said",
      mode: "execute",
    });

    expect(said.kind === "result" && said.envelope.outcome).toBe("COMMITTED");
  });

  for (const mode of ["EXECUTE", "dry_run", 1, null, ""]) {
    it(`DSOR-OPR-05: a mode that is not one of the three, ${JSON.stringify(mode)}, is refused and recorded, and nothing runs`, async () => {
      const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
        idempotencyKey: `issue-mode-${String(mode)}`,
        mode,
      });

      expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
      expect(answer.kind === "error" && answer.envelope.message).toMatch(
        /execute, propose_only or validate_only/,
      );
      expect(await statusOf1009()).toBe("draft");
      expect((await theLog("org_456")).at(-1)?.result).toBe("VALIDATION_FAILED");
    });
  }

  it("DSOR-OPR-05: a query has one way to be called, and another mode is refused", async () => {
    const answer = await callOperation(
      SUPERVISOR,
      "invoice.get",
      { invoice: "dsor://org_456/invoice/INV-1008" },
      { mode: "validate_only" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(/a query/);
  });

  it("DSOR-IDM-01d: the same key in another mode is another request, and is refused", async () => {
    const first = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-one-key",
      mode: "propose_only",
    });

    expect(first.kind).toBe("result");

    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-one-key",
      mode: "execute",
    });

    expect(again.kind === "error" && again.envelope.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  // Decision 154: and a claim released because nothing ran is taken back only in the mode it was
  // made in. The test above reaches the check a claim with an answer gets. This one reaches the
  // UPDATE that takes back a released claim, whose `mode = $6` no test reached: without it, a
  // prepared request whose move failed, sent again to execute, issued the invoice under a claim that
  // still said propose_only.
  for (const [first, then] of [
    ["propose_only", "execute"],
    ["execute", "propose_only"],
  ] as const) {
    it(`DSOR-IDM-01d: a key released by ${first} is not taken back by ${then}`, async () => {
      const key = `released-by-${first}`;
      const connection = overPGlite(db);

      // The move to READY cannot be written, so nothing runs and the claim is released.
      useDatabase({
        async query<T>(sql: string, params?: unknown[], tenant?: string) {
          if (sql.includes("INSERT INTO dsor.proposal_moves") && params?.includes("READY")) {
            throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
          }

          return connection.query<T>(sql, params, tenant);
        },
      });

      try {
        const released = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
          idempotencyKey: key,
          mode: first,
        });

        expect(released.kind === "error" && released.envelope.retry).toBe("safe_same_key");
      } finally {
        useDatabase(connection);
      }

      const other = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
        idempotencyKey: key,
        mode: then,
      });

      expect(other.kind === "error" && other.envelope.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(await statusOf1009()).toBe("draft");
      expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);

      // And the claim was released, so the request it belongs to may still take it back. Without
      // this, a claim that had kept its answer would give the same conflict, and this test would
      // pass without ever reaching the UPDATE.
      const own = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
        idempotencyKey: key,
        mode: first,
      });

      expect(own.kind === "result" && own.envelope.outcome).toBe(
        first === "execute" ? "COMMITTED" : "READY",
      );
    });
  }
});

// STEP 23, piece 2: a dry run. The decision stage runs and is recorded; nothing else happens.

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };

/** org_456's proposals and claims, as the owner counts them. */
const leftBehind = async (): Promise<{ proposals: number; claims: number }> =>
  asTheOwner(async () => {
    const { rows } = await db.query<{ proposals: number; claims: number }>(
      `SELECT (SELECT count(*)::int FROM dsor.proposals WHERE tenant = 'org_456') AS proposals,
              (SELECT count(*)::int FROM dsor.idempotency_keys WHERE tenant = 'org_456') AS claims`,
    );

    return rows[0] ?? { proposals: -1, claims: -1 };
  });

describe("validate_only is a dry run", () => {
  beforeEach(async () => {
    await asTheOwner(() =>
      db.exec("DELETE FROM dsor.idempotency_keys WHERE tenant IN ('org_456', 'org_789')"),
    );
  });

  it("DSOR-OPR-06: an allowed command is VALIDATED, ALLOW, and nothing happens: no change, no proposal, no claim", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-dry",
      mode: "validate_only",
    });

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${JSON.stringify(answer)}`);
    }

    expect(answer.envelope.outcome).toBe("VALIDATED");
    expect(answer.envelope.decision).toBe("ALLOW");
    expect(await statusOf1009()).toBe("draft");
    expect(await leftBehind()).toStrictEqual({ proposals: 0, claims: 0 });
  });

  it("DSOR-OPR-06: a dry run needs no key, because nothing is claimed", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      mode: "validate_only",
    });

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("VALIDATED");
  });

  it("DSOR-OPR-06: a dry run is recorded as VALIDATED, so the log never shows it as something allowed to run", async () => {
    await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, { mode: "validate_only" });

    const last = (await theLog("org_456")).at(-1);

    expect(last?.authorization).toBe("ALLOW");
    expect(last?.result).toBe("VALIDATED");
  });

  it("DSOR-OPR-06: a dry run leaves its decision and no record of any move", async () => {
    // STEP 22, decision 157: a move is written with its record, and a dry run makes no proposal to
    // move, so the log holds its decision and nothing else.
    await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, { mode: "validate_only" });

    expect((await theLog("org_456")).map((r) => `${r.kind} ${r.result}`)).toStrictEqual([
      "decision VALIDATED",
    ]);
  });

  it("DSOR-OPR-06: a dry run of a payment makes no payment, and takes no payment number", async () => {
    const before = await paymentsOf("org_456");
    const answer = await callOperation(
      AGENT,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1009", amount: { value: "2500.00", currency: "USD" } },
      { mode: "validate_only" },
    );

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("VALIDATED");
    expect(await paymentsOf("org_456")).toStrictEqual(before);

    // The next payment made for real is still PAY-902: the dry run took no number.
    const made = await callOperation(
      AGENT,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1009", amount: { value: "2500.00", currency: "USD" } },
      { idempotencyKey: "pay-for-real" },
    );

    expect(made.kind === "result" && made.envelope.data?.["id"]).toBe("PAY-902");
  });

  it("DSOR-EXE-05b: a dry run says whether the command could be undone, before anything is done", async () => {
    // Decision 154: §24 says the agent needs that answer before it acts, not after, and a dry run is
    // where it asks. A VALIDATED answer said everything else, and not this.
    const answer = await callOperation(
      AGENT,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1009", amount: { value: "2500.00", currency: "USD" } },
      { mode: "validate_only" },
    );

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("VALIDATED");
    expect(answer.kind === "result" && answer.envelope.semantics).toBe("compensatable");
  });

  it("DSOR-OPR-05: a dry run the rules refuse gets the same refusal execute would, and leaves nothing", async () => {
    const answer = await callOperation(
      AGENT,
      "payment.create",
      {
        invoice: "dsor://org_456/invoice/INV-1009",
        amount: { value: "60000.00", currency: "USD" },
      },
      { mode: "validate_only" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("LIMIT_EXCEEDED");
    expect(await leftBehind()).toStrictEqual({ proposals: 0, claims: 0 });
    expect((await theLog("org_456")).at(-1)?.result).toBe("LIMIT_EXCEEDED");
  });
});

// STEP 23, piece 3: prepared, not done. The proposal waits at READY for proposal.execute,
// which is step 31's.

describe("propose_only prepares a command and stops at READY", () => {
  it("DSOR-OPR-05: an allowed command is READY: a proposal, its fingerprint, and nothing done", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-prepared",
      mode: "propose_only",
    });

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${JSON.stringify(answer)}`);
    }

    expect(answer.envelope.outcome).toBe("READY");
    expect(answer.envelope.proposal).toMatch(/^dsor:\/\/org_456\/proposal\/prop_\d+$/);
    expect(answer.envelope.payload_hash).toMatch(/^sha256:/);
    expect(answer.envelope.semantics).toBe("atomic");
    expect(answer.envelope.data).toBeUndefined();
    expect(await statusOf1009()).toBe("draft");

    const id = String(answer.envelope.proposal).split("/").at(-1) ?? "";
    const moves = await movesOf("org_456", id);

    expect(moves.map((m) => m.to)).toStrictEqual(["PROPOSED", "READY"]);
    expect(moves[1]?.cause).toMatch(/waiting to be released/);
    expect(await stateOf("org_456", id)).toBe("READY");

    const { rows } = await asTheOwner(() =>
      db.query<{ mode: string }>("SELECT mode FROM dsor.proposals WHERE id = $1", [id]),
    );

    expect(rows[0]?.mode).toBe("propose_only");
  });

  it("DSOR-AUD-01: a prepared command leaves the records of PROPOSED and READY, and none after them", async () => {
    // STEP 22, decision 157: each of its two moves has its record, around its decision. Nothing
    // moves it past READY, so no record says anything more happened.
    await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-prepared-on-record",
      mode: "propose_only",
    });

    const log = await theLog("org_456");

    expect(log.map((r) => `${r.kind} ${r.result}`)).toStrictEqual([
      "proposal_transition PROPOSED",
      "decision ALLOWED",
      "proposal_transition READY",
    ]);
    expect(log.at(-1)?.reason).toMatch(
      /^PROPOSED -> READY by dsor: allowed: .*waiting to be released$/,
    );
  });

  it("DSOR-OPR-05: a prepared payment is not made", async () => {
    const before = await paymentsOf("org_456");
    const answer = await callOperation(
      AGENT,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1009", amount: { value: "2500.00", currency: "USD" } },
      { idempotencyKey: "pay-prepared", mode: "propose_only" },
    );

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("READY");
    expect(await paymentsOf("org_456")).toStrictEqual(before);
  });

  it("DSOR-IDM-01c: sent again with its key, a prepared command is the same READY answer and one proposal", async () => {
    const request = { idempotencyKey: "issue-prepared-twice", mode: "propose_only" };
    const first = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(again).toStrictEqual(first);
    expect((await proposalsOf("org_456")).filter((p) => p.state === "READY")).toHaveLength(1);
  });

  it("DSOR-EXE-03b: a move to READY that cannot be written is refused, DENIED, and the key may be sent again", async () => {
    const request = { idempotencyKey: "issue-prepared-store-down", mode: "propose_only" };
    const connection = overPGlite(db);

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        if (sql.includes("INSERT INTO dsor.proposal_moves") && params?.includes("READY")) {
          throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    try {
      const refused = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

      expect(refused.kind === "error" && refused.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
    } finally {
      useDatabase(connection);
    }

    const sentAgain = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(sentAgain.kind === "result" && sentAgain.envelope.outcome).toBe("READY");
  });

  it("DSOR-EXE-03b: a move to READY the server refused is nothing done even when the proposal cannot be read back: DENIED, and the key may be sent again", async () => {
    // STEP 22, decision 157, found by a review: a refused move can never land, so there is nothing
    // to read back. Read back all the same, a read that failed made this OUTCOME_UNKNOWN, kept the
    // key, and wrote no DENIED.
    const request = { idempotencyKey: "issue-prepared-refused-unread", mode: "propose_only" };
    const connection = overPGlite(db);
    let refused = false;

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        if (
          !refused &&
          sql.includes("INSERT INTO dsor.proposal_moves") &&
          params?.includes("READY")
        ) {
          refused = true;

          throw Object.assign(new Error("the server refused it"), { code: "53100" });
        }

        if (refused && sql.includes("SELECT m.to_state FROM dsor.proposal_moves")) {
          throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    } finally {
      useDatabase(connection);
    }

    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("safe_same_key");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);

    const sentAgain = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(sentAgain.kind === "result" && sentAgain.envelope.outcome).toBe("READY");
  });

  it("DSOR-APR-01a: a prepared command the rules refuse is DENIED, as one executed would be", async () => {
    const answer = await callOperation(
      AGENT,
      "payment.create",
      {
        invoice: "dsor://org_456/invoice/INV-1009",
        amount: { value: "60000.00", currency: "USD" },
      },
      { idempotencyKey: "pay-too-much-prepared", mode: "propose_only" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("LIMIT_EXCEEDED");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
  });
});

// STEP 23, decision 139: what the review measured.

/**
 * The store, for one write of moves naming `state`: the write happens and its reply is lost; with
 * `readsFail`, reading a proposal's state back fails too, and STEP 22, decision 157, so does every
 * look for a record by its id: the door would otherwise find the move's own record, and know.
 */
function aLostReply(state: string, readsFail: boolean): () => void {
  const connection = overPGlite(db);
  let lost = false;

  useDatabase({
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      if (!lost && sql.includes("INSERT INTO dsor.proposal_moves") && params?.includes(state)) {
        lost = true;
        await connection.query(sql, params, tenant);

        throw Object.assign(new Error("the reply was lost"), { code: "ECONNRESET" });
      }

      if (
        readsFail &&
        lost &&
        (sql.includes("SELECT m.to_state FROM dsor.proposal_moves") ||
          sql.includes("SELECT record_hash FROM dsor.audit WHERE record_id"))
      ) {
        throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
      }

      return connection.query<T>(sql, params, tenant);
    },
  });

  return () => useDatabase(connection);
}

/**
 * Decision 153: the store, for the first write of moves naming `state`: its reply is lost and the
 * write is held, as a COMMIT still on its way. It lands just before the next write naming DENIED,
 * after the door has read PROPOSED back. With `deniedFails`, every write naming DENIED fails
 * instead, and the held one lands when `land` is called.
 */
function aWriteThatLandsLate(
  state: string,
  { deniedFails = false } = {},
): { readonly land: () => Promise<void>; readonly putBack: () => void } {
  const connection = overPGlite(db);
  let held: { sql: string; params: unknown[] | undefined; tenant: string | undefined } | undefined;
  let landed = false;
  const land = async (): Promise<void> => {
    if (held !== undefined && !landed) {
      landed = true;
      await connection.query(held.sql, held.params, held.tenant);
    }
  };

  useDatabase({
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      const aMove = sql.includes("INSERT INTO dsor.proposal_moves");

      if (aMove && held === undefined && params?.includes(state)) {
        held = { sql, params, tenant };

        throw Object.assign(new Error("the reply was lost"), { code: "ECONNRESET" });
      }

      if (aMove && params?.includes("DENIED")) {
        if (deniedFails) {
          throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
        }

        await land();
      }

      return connection.query<T>(sql, params, tenant);
    },
  });

  return { land, putBack: () => useDatabase(connection) };
}

describe("a lost reply, read back", () => {
  it("DSOR-OPR-05: a move to READY whose reply is lost is read back, and the command is prepared", async () => {
    const putBack = aLostReply("READY", false);

    try {
      const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
        idempotencyKey: "prepared-reply-lost",
        mode: "propose_only",
      });

      expect(answer.kind === "result" && answer.envelope.outcome).toBe("READY");
    } finally {
      putBack();
    }

    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["READY"]);
  });

  it("DSOR-IDM-01c: a move to READY whose reply is lost and cannot be read back is OUTCOME_UNKNOWN, and its key stays taken", async () => {
    // Decision 139: told "safe to send again", the retry made a second READY proposal.
    const request = { idempotencyKey: "prepared-unknown", mode: "propose_only" };
    const putBack = aLostReply("READY", true);
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    } finally {
      putBack();
    }

    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");

    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(again).toStrictEqual(answer);
    expect(await proposalsOf("org_456")).toHaveLength(1);
  });

  it("DSOR-IDM-01c: a move to READY whose reply is lost and that lands after the read-back is OUTCOME_UNKNOWN, and its key stays taken", async () => {
    // Decision 153: read back as PROPOSED, the request was told nothing was done; the lost write
    // then landed, the move to DENIED was refused, the claim was released all the same, and the
    // retry prepared a second READY proposal: two to release in step 31, a review measured.
    const request = { idempotencyKey: "prepared-lands-late", mode: "propose_only" };
    const late = aWriteThatLandsLate("READY");
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    } finally {
      late.putBack();
    }

    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("after_reconciliation");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["READY"]);

    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(again).toStrictEqual(answer);
    expect(await proposalsOf("org_456")).toHaveLength(1);
  });

  it("DSOR-IDM-01c: a move to READY whose reply is lost, then a DENIED that cannot be written, is OUTCOME_UNKNOWN, and its key stays taken", async () => {
    // Decision 153: a DENIED that was not written proves nothing either. The lost write lands after
    // the request was answered.
    const request = { idempotencyKey: "prepared-denied-down", mode: "propose_only" };
    const late = aWriteThatLandsLate("READY", { deniedFails: true });
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
      await late.land();
    } finally {
      late.putBack();
    }

    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");

    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(again).toStrictEqual(answer);
    expect(await proposalsOf("org_456")).toHaveLength(1);
  });
});

describe("the mode is read once, and only the request's own", () => {
  it("DSOR-OPR-05: a mode on the request's prototype is refused, never taken as execute", async () => {
    // Decision 139: the caller asked for a dry run, and got the invoice issued.
    const request = Object.assign(Object.create({ mode: "validate_only" }) as object, {
      idempotencyKey: "inherited-mode",
    });
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(await statusOf1009()).toBe("draft");
  });

  it("DSOR-OPR-05: a mode whose getter throws is refused, never taken as execute", async () => {
    const request = {
      idempotencyKey: "throwing-mode",
      get mode(): string {
        throw new Error("no mode for you");
      },
    };
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(await statusOf1009()).toBe("draft");
  });

  it("DSOR-OPR-05: a mode read once: a getter that says validate_only, then execute, is a dry run", async () => {
    let reads = 0;
    const request = {
      idempotencyKey: "changing-mode",
      get mode(): string {
        reads += 1;

        return reads === 1 ? "validate_only" : "execute";
      },
    };
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("VALIDATED");
    expect(await statusOf1009()).toBe("draft");
  });
});

describe("what a dry run does not check yet", () => {
  it("DSOR-OPR-06: a dry run is decided without the handlers' preconditions, until step 32", async () => {
    // Decision 139, written down: the version and whether the invoice exists are checked inside the
    // handlers, which a dry run never reaches. Pinned so that step 32's stage changes it on purpose.
    const answer = await callOperation(
      SUPERVISOR,
      "invoice.issue",
      { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 99 },
      { mode: "validate_only" },
    );

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("VALIDATED");
  });
});

// Decision 154: DSOR-OPR-05 is about every command, and the tests above call two of them. These walk
// the registry and call each command with its contract's own example request, so a command added
// later is called all three ways too, and a contract that turned a mode off would fail here.

const COMMANDS = [...loadRegistry(contractsFromDisk()).values()].filter(
  (contract) => contract.kind === "command",
);

/**
 * org_456's invoices, payments, slips, reservations, day totals and brakes, as the owner reads
 * them. With the claims and the proposals, which the test checks itself, and the log, which records
 * every call, that is every table a command writes. Decision 154: step 23's copy read only the
 * first three, so a dry run of control.suspend that pulled a brake on every agent passed here.
 */
const theRows = async (): Promise<unknown[]> =>
  asTheOwner(async () => {
    const { rows } = await db.query(
      `SELECT 'invoice' AS kind, id, status, version FROM public.invoices WHERE tenant_id = 'org_456'
       UNION ALL
       SELECT 'payment', id, status, version FROM public.payments WHERE tenant_id = 'org_456'
       UNION ALL
       SELECT 'slip', id, status, NULL FROM dsor.delegations WHERE tenant = 'org_456'
       UNION ALL
       SELECT 'reservation', proposal, state, NULL FROM dsor.reservations WHERE tenant = 'org_456'
       UNION ALL
       SELECT 'day total', delegation || ' ' || day::text, used_value::text, NULL
         FROM dsor.day_totals WHERE tenant = 'org_456'
       UNION ALL
       SELECT 'brake', id || ': ' || COALESCE(agent, 'every agent'),
              CASE WHEN lifted_at IS NULL THEN 'on' ELSE 'lifted' END, NULL
         FROM dsor.agent_controls WHERE tenant = 'org_456'
       ORDER BY 1, 2`,
    );

    return rows;
  });

describe("every command can be called all three ways", () => {
  for (const contract of COMMANDS) {
    it(`DSOR-OPR-05: ${contract.id} is VALIDATED as a dry run and READY when prepared, and neither carries it out`, async () => {
      const example = exampleRequestOf(contract) ?? {};
      const before = await theRows();
      const { claims } = await leftBehind();

      const dry = await callOperation(SUPERVISOR, contract.id, example, { mode: "validate_only" });

      expect(dry.kind === "result" && dry.envelope.outcome, `${contract.id}, a dry run`).toBe(
        "VALIDATED",
      );
      expect(dry.kind === "result" && dry.envelope.semantics).toBe(contract.execution?.semantics);
      // A dry run leaves nothing behind: no proposal, no claim, and no change to the rows the
      // snapshot reads (DSOR-OPR-06). Asked here, and not only after the prepared call, so that a
      // change the dry run made fails as the dry run's.
      expect(await leftBehind()).toStrictEqual({ proposals: 0, claims });
      expect(await theRows(), `${contract.id}, after the dry run`).toStrictEqual(before);

      const prepared = await callOperation(SUPERVISOR, contract.id, example, {
        idempotencyKey: `every-command-prepared-${contract.id}`,
        mode: "propose_only",
      });

      expect(
        prepared.kind === "result" && prepared.envelope.outcome,
        `${contract.id}, prepared`,
      ).toBe("READY");
      expect(prepared.kind === "result" && prepared.envelope.semantics).toBe(
        contract.execution?.semantics,
      );

      // Its proposal waits at READY and never went to EXECUTING, the move the door makes just before
      // a handler runs. And nothing the snapshot reads has changed: user_123 has no slip, so not
      // even a reservation is held. The agent's prepared payment would hold one.
      const [only] = await proposalsOf("org_456");

      expect(only?.state).toBe("READY");
      expect((await movesOf("org_456", only?.id ?? "")).map((m) => m.to)).toStrictEqual([
        "PROPOSED",
        "READY",
      ]);
      expect(await theRows(), `${contract.id}, after it was prepared`).toStrictEqual(before);

      // Executed, it is done. So the example is one the rules allow, and VALIDATED and READY above
      // are the right answers, not refusals that happened to change nothing.
      const done = await callOperation(SUPERVISOR, contract.id, example, {
        idempotencyKey: `every-command-executed-${contract.id}`,
      });

      expect(done.kind === "result" && done.envelope.outcome, `${contract.id}, executed`).toBe(
        "COMMITTED",
      );
    });
  }
});
