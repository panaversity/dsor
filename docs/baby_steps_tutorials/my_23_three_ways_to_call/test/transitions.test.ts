// STEP 22, decision 157: every move of a proposal has its record in the company's audit log,
// written by the same statement as the move: both, or neither.
//
// Until this step a move was written in `dsor.proposal_moves` only, a table without fingerprints.
// For the demo's last cancel the log said ALLOW, and nothing after it, while the history said the
// cancel FAILED. One statement now writes a move and its record, so the database keeps both or
// neither, and each move names its record, so the database refuses a move that names none.
//
// Rule DSOR-AUD-01: every command decision, every proposal transition, and every read covered by
// DSOR-CLS-05 MUST produce a durable audit record that validates against audit-record.schema.json.
// Rule DSOR-EXE-03b: if the control-plane store cannot accept the decision or intent record, DSoR
// MUST NOT execute; the caller receives EVIDENCE_STORE_UNAVAILABLE.
// Rule DSOR-UNK-01b: DSoR MUST NOT report an unknown outcome as success, as failure, or with an
// error code whose retry class allows a new attempt.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  audit,
  theHead,
  theLog,
  validateAuditRecord,
  verifyChain,
  type AuditRecord,
} from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { getInvoice } from "../src/invoice.ts";
import { PIPELINE } from "../src/operations.ts";
import { moveProposal, movesOf, propose, stateOf } from "../src/proposal.ts";
import { theDatabase, useDatabase, type Database } from "../src/store.ts";
import {
  aDatabase,
  asTheOwner,
  BY_A_TEST,
  forgetTheLog,
  resetTheStory,
} from "./support/database.ts";
import { callOperation, makeDoor } from "./support/door.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const ISSUE_1009 = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };
const PAY_2500 = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "2500.00", currency: "USD" },
};

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await forgetTheLog("org_456");
  await resetTheStory();
});

afterEach(() => {
  useDatabase(overPGlite(db));
});

/** org_456's log, each record as its kind and its result. */
const theLogInShort = async (): Promise<string[]> =>
  (await theLog("org_456")).map((r) => `${r.kind} ${r.result}`);

/** The records of moves in org_456's log, as the states they say were entered. */
const recordsOfMoves = async (): Promise<string[]> =>
  (await theLog("org_456")).filter((r) => r.kind === "proposal_transition").map((r) => r.result);

/** A proposal of org_456's, made by the program's own `propose`, as a test needs one. */
const aProposal = (): Promise<string> =>
  propose(
    {
      tenant: "org_456",
      operation: "payment.create@1",
      mode: "execute",
      payload: "{}",
      payloadHash: "sha256:0000",
      requester: '{"mode":"direct","subject":"user_123","actor_chain":[]}',
      idempotencyKey: `a-test-${Math.random()}`,
      actor: "user_123",
      cause: "payment.create@1 invoked",
    },
    BY_A_TEST,
  );

/** Another request's decision, written at the end of the log. */
const anotherRecord = (): Promise<AuditRecord | undefined> =>
  audit({
    kind: "decision",
    subject: "cfo_100",
    tenant: "org_456",
    requestId: "req_another",
    result: "ANOTHER",
  });

/** A statement that writes moves, and names one of these states among its values. */
const aMoveNaming =
  (...states: readonly string[]) =>
  (sql: string, params: readonly unknown[]): boolean =>
    sql.includes("INSERT INTO dsor.proposal_moves") &&
    states.some((state) => params.includes(state));

/** The statement that makes a proposal. */
const theCreation = (sql: string): boolean => sql.includes("INSERT INTO dsor.proposals");

const aLostConnection = (): Error =>
  Object.assign(new Error("the store went away"), { code: "ECONNRESET" });

/**
 * The program's store, with one kind of fault on the statements `matches` picks, the first `times`
 * of them, and a count of how many it met.
 *
 *   - "refused": the server refuses it, with the code and table of `refusal`; nothing ran.
 *   - "never sent": the connection fails before the server has it; nothing ran.
 *   - "reply lost": it ran, and its reply is lost.
 *   - "place taken": another record is written at the end of the log first, so the place the
 *     statement's records were given is taken; then the statement is sent.
 *   - "place taken, then never sent": the same, and then the connection fails before it is sent.
 *
 * With `readBackFails`, once a fault was met, every read of a proposal's state fails too.
 */
function withAFault(
  matches: (sql: string, params: readonly unknown[]) => boolean,
  fault: "refused" | "never sent" | "reply lost" | "place taken" | "place taken, then never sent",
  {
    times = 1,
    refusal = { code: "53100" },
    readBackFails = false,
  }: { times?: number; refusal?: object; readBackFails?: boolean } = {},
): { met: number } {
  const connection = overPGlite(db);
  const counted = { met: 0 };
  let left = times;
  const wrapped: Database = {
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      if (left > 0 && matches(sql, params ?? [])) {
        left -= 1;
        counted.met += 1;

        if (fault === "refused") {
          throw Object.assign(new Error("the server refused it"), refusal);
        }

        if (fault === "never sent") {
          throw aLostConnection();
        }

        if (fault === "place taken" || fault === "place taken, then never sent") {
          // The other record goes straight to the database, as another request's would.
          useDatabase(connection);

          try {
            await anotherRecord();
          } finally {
            useDatabase(wrapped);
          }

          if (fault === "place taken, then never sent") {
            throw aLostConnection();
          }
        }

        if (fault === "reply lost") {
          await connection.query(sql, params, tenant);

          throw aLostConnection();
        }
      }

      if (readBackFails && counted.met > 0 && sql.includes("SELECT m.to_state FROM")) {
        throw aLostConnection();
      }

      return connection.query<T>(sql, params, tenant);
    },
  };

  useDatabase(wrapped);

  return counted;
}

describe("every move has its record, written by the statement that makes the move", () => {
  it("DSOR-AUD-01: a command carried out leaves a record of each of its four moves, around its decision", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind).toBe("result");

    const log = await theLog("org_456");

    expect(log.map((r) => `${r.kind} ${r.result}`)).toStrictEqual([
      "proposal_transition PROPOSED",
      "decision ALLOWED",
      "proposal_transition READY",
      "proposal_transition EXECUTING",
      "proposal_transition COMMITTED",
    ]);
    // Each move names its own record, and no other.
    expect((await movesOf("org_456", "prop_1")).map((m) => m.record)).toStrictEqual(
      [0, 2, 3, 4].map((i) => log[i]?.record_id),
    );
    expect(log.every((r) => validateAuditRecord(r))).toBe(true);
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });

  it("DSOR-AUD-01: a move's record names the request's identity, the proposal, and the move", async () => {
    const answer = await callOperation(AGENT, "payment.create", PAY_2500);

    if (answer.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
    }

    const log = await theLog("org_456");
    const decision = log.find((r) => r.kind === "decision");
    const moves = log.filter((r) => r.kind === "proposal_transition");

    expect(moves).toHaveLength(4);

    // In the request's name, the agent's use of user_123's authority under del_100, word for word
    // as its decision says it: never `dsor`, which holds no authority of its own.
    for (const move of moves) {
      expect(move.identity).toStrictEqual(decision?.identity);
      expect(move).toMatchObject({
        delegation: "del_100",
        operation: "payment.create@1",
        payload_hash: answer.envelope.payload_hash,
        correlation: {
          request_id: answer.envelope.correlation.request_id,
          tenant_id: "org_456",
          principal_id: "accounts-payable-fte",
        },
      });
      // A move is not a decision.
      expect(move.authorization).toBeUndefined();
    }

    expect(moves.find((r) => r.result === "EXECUTING")).toMatchObject({
      resources: ["dsor://org_456/proposal/prop_1"],
      reason: "READY -> EXECUTING by dsor: handed to payment.create",
    });
  });

  it("DSOR-AUD-01: the record of a proposal's creation is the one its first move names", async () => {
    const answer = await callOperation(AGENT, "payment.create", PAY_2500);
    const [first] = await movesOf("org_456", "prop_1");
    const creation = (await theLog("org_456")).find((r) => r.record_id === first?.record);

    expect(creation).toMatchObject({
      kind: "proposal_transition",
      result: "PROPOSED",
      operation: "payment.create@1",
      payload_hash: answer.kind === "result" ? answer.envelope.payload_hash : "a receipt",
      reason: "(new) -> PROPOSED by accounts-payable-fte: payment.create@1 invoked",
    });
    // The database numbers the proposal inside the statement, after the record's hash is made.
    expect(creation?.resources).toBeUndefined();
  });

  it("DSOR-AUD-01: a command refused after its proposal is made has the records of its creation and of DENIED, around its DENY", async () => {
    await callOperation(AGENT, "payment.create", {
      ...PAY_2500,
      amount: { value: "60000.00", currency: "USD" },
    });

    expect(await theLogInShort()).toStrictEqual([
      "proposal_transition PROPOSED",
      "decision LIMIT_EXCEEDED",
      "proposal_transition DENIED",
    ]);
    expect((await theLog("org_456")).at(-1)?.reason).toBe(
      "PROPOSED -> DENIED by dsor: refused: LIMIT_EXCEEDED",
    );
  });
});

describe("no record claims a move that did not happen", () => {
  it("DSOR-AUD-01: a move the map refuses writes no record", async () => {
    // Three refusals: a move that is not on the map, a move out of a finished state, and a state
    // left twice.
    const offTheMap = await aProposal();
    const finished = await aProposal();
    const leftOnce = await aProposal();

    for (const [from, to] of [
      ["PROPOSED", "READY"],
      ["READY", "EXECUTING"],
      ["EXECUTING", "COMMITTED"],
    ] as const) {
      await moveProposal("org_456", finished, from, to, "dsor", "walked", BY_A_TEST);
    }

    await moveProposal("org_456", leftOnce, "PROPOSED", "READY", "dsor", "allowed", BY_A_TEST);

    const before = await theLog("org_456");

    for (const [id, from, to] of [
      [offTheMap, "PROPOSED", "COMMITTED"],
      [finished, "COMMITTED", "FAILED"],
      [leftOnce, "PROPOSED", "DENIED"],
    ] as const) {
      expect(
        await moveProposal("org_456", id, from, to, "dsor", "refused", BY_A_TEST),
      ).toStrictEqual({ kind: "refused" });
    }

    expect(await theLog("org_456")).toStrictEqual(before);
  });

  it("DSOR-AUD-01: a move with no record, or with a record not in the log, is refused, even from SQL the application writes itself", async () => {
    const id = await aProposal();

    // Not through moveProposal: the SQL a careless handler next year would write, with the
    // application's own rights.
    await expect(
      theDatabase("org_456").query(
        `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
         VALUES ('org_456', $1, 'PROPOSED', 'DENIED', 'dsor', 'no record')`,
        [id],
      ),
    ).rejects.toThrow(/null value in column "record"/);
    await expect(
      theDatabase("org_456").query(
        `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
         VALUES ('org_456', $1, 'PROPOSED', 'DENIED', 'dsor', 'a record nobody wrote', 'audit:org_456:999')`,
        [id],
      ),
    ).rejects.toThrow(/foreign key/);
    expect(await stateOf("org_456", id)).toBe("PROPOSED");
  });

  it("DSOR-EXE-03b: when the record of the move to EXECUTING cannot be written, the move is not written either, and the handler does not run", async () => {
    // The server refuses the statement that moves the proposal to READY and EXECUTING: the disk is
    // full, say. Its records are in the same statement, so nothing of it is written.
    withAFault(
      (_sql, params) => params.includes("proposal_transition") && params.includes("EXECUTING"),
      "refused",
    );

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("safe_same_key");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
    expect((await movesOf("org_456", "prop_1")).map((m) => m.to)).toStrictEqual([
      "PROPOSED",
      "DENIED",
    ]);
    expect(await theLogInShort()).toStrictEqual([
      "proposal_transition PROPOSED",
      "decision ALLOWED",
      "proposal_transition DENIED",
    ]);
  });

  it("DSOR-AUD-01: a refusal from the log is never taken for a refusal of the move", async () => {
    // The log refuses with the codes the map uses, for its own reasons: 23514 is a record whose
    // chain is not its company's. Taken for the map's refusal, the door would say the proposal was
    // not PROPOSED, answer INTERNAL_ERROR, and leave it PROPOSED for good.
    withAFault(aMoveNaming("EXECUTING"), "refused", {
      refusal: { code: "23514", table: "audit" },
    });

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(await stateOf("org_456", "prop_1")).toBe("DENIED");
  });

  it("DSOR-EXE-03b: a move the server refused, and a DENIED it refused too, are still nothing done: the key may be sent again", async () => {
    // Decision 153 made "nothing was done" wait for a written DENIED after the door's move was lost,
    // because a lost write can land late. A move the server refused cannot land, ever, so a DENIED
    // that cannot be written either does not make it unknown.
    const request = { idempotencyKey: "issue-1009-refused-twice" };

    withAFault(aMoveNaming("EXECUTING", "DENIED"), "refused", { times: Number.POSITIVE_INFINITY });

    const refused = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(refused.kind === "error" && refused.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(refused.kind === "error" && refused.envelope.retry).toBe("safe_same_key");
    expect(await stateOf("org_456", "prop_1")).toBe("PROPOSED");

    useDatabase(overPGlite(db));

    const sentAgain = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(sentAgain.kind).toBe("result");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("issued");
  });

  it("DSOR-EXE-03b: a move the server refused is nothing done even when the proposal cannot be read back: DENIED, and the key may be sent again", async () => {
    // Found by a review. A move the server refused can never land, so the proposal is still
    // PROPOSED; the door read it back all the same, and a read that failed made a true "nothing was
    // done" into OUTCOME_UNKNOWN, kept the key, and wrote no DENIED.
    const request = { idempotencyKey: "issue-1009-refused-unread" };

    withAFault(aMoveNaming("EXECUTING"), "refused", { readBackFails: true });

    const refused = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(refused.kind === "error" && refused.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(refused.kind === "error" && refused.envelope.retry).toBe("safe_same_key");

    useDatabase(overPGlite(db));

    expect(await stateOf("org_456", "prop_1")).toBe("DENIED");
    expect((await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request)).kind).toBe(
      "result",
    );
  });
});

describe("a place in the log that another record took first", () => {
  it("DSOR-AUD-01: a move whose place in the log is taken writes nothing there, and is written at the next place", async () => {
    withAFault(aMoveNaming("EXECUTING"), "place taken");

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind).toBe("result");
    expect(await stateOf("org_456", "prop_1")).toBe("COMMITTED");

    const log = await theLog("org_456");

    expect(log.map((r) => r.result)).toStrictEqual([
      "PROPOSED",
      "ALLOWED",
      "ANOTHER",
      "READY",
      "EXECUTING",
      "COMMITTED",
    ]);
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });

  it("DSOR-EXE-03b: a place lost every time is given up after ten tries: nothing is written, and the caller is told nothing was done", async () => {
    const counted = withAFault(aMoveNaming("EXECUTING"), "place taken", {
      times: Number.POSITIVE_INFINITY,
    });

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(counted.met).toBe(10);
    expect(answer.kind === "error" && answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("safe_same_key");
    expect(await stateOf("org_456", "prop_1")).toBe("DENIED");
    expect(await recordsOfMoves()).toStrictEqual(["PROPOSED", "DENIED"]);
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
  });
});

describe("a reply that is lost", () => {
  it("DSOR-UNK-01b: a move whose reply is lost is found by its own record, even when the proposal cannot be read back, and the handler runs once", async () => {
    withAFault(aMoveNaming("EXECUTING"), "reply lost", { readBackFails: true });

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind).toBe("result");

    useDatabase(overPGlite(db));

    expect(await stateOf("org_456", "prop_1")).toBe("COMMITTED");
    expect(await recordsOfMoves()).toStrictEqual(["PROPOSED", "READY", "EXECUTING", "COMMITTED"]);
  });

  it("DSOR-UNK-01b: a lost reply whose place another record took is not mistaken for the door's own", async () => {
    withAFault(aMoveNaming("EXECUTING"), "place taken, then never sent");

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind).toBe("result");

    const log = await theLog("org_456");

    expect(log.map((r) => r.result)).toStrictEqual([
      "PROPOSED",
      "ALLOWED",
      "ANOTHER",
      "READY",
      "EXECUTING",
      "COMMITTED",
    ]);
    // The other record is untouched, and still its own request's.
    expect(log[2]?.correlation.request_id).toBe("req_another");
    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });

  it("DSOR-APR-01a: a creation whose reply is lost is found by its record, and the request carries on with that one proposal", async () => {
    withAFault(theCreation, "reply lost");

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind === "result" && answer.envelope.proposal).toBe(
      "dsor://org_456/proposal/prop_1",
    );

    const proposals = await asTheOwner(async () => {
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM dsor.proposals WHERE tenant = 'org_456'",
      );

      return rows.map((r) => r.id);
    });

    expect(proposals).toStrictEqual(["prop_1"]);
    expect(await stateOf("org_456", "prop_1")).toBe("COMMITTED");
  });

  it("DSOR-UNK-01b: a creation nobody can confirm is OUTCOME_UNKNOWN, and its key stays taken", async () => {
    // The connection fails before the server has the statement, and its record is not there yet.
    // It may still land, with its proposal: "nothing was done" would be a guess.
    const request = { idempotencyKey: "issue-1009-creation-unknown" };

    withAFault(theCreation, "never sent");

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("after_reconciliation");

    useDatabase(overPGlite(db));

    // Sent again with its key: the same answer, and nothing is carried out.
    expect(await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request)).toStrictEqual(
      answer,
    );
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
  });

  it("DSOR-UNK-01b: a creation nobody can confirm stays OUTCOME_UNKNOWN when its decision cannot be written either, and no second proposal is made", async () => {
    // Found by a review. §21.11 runs after a refusal, to write it down, and when the log refused that
    // record too, its own refusal won: EVIDENCE_STORE_UNAVAILABLE, safe to send again. The key was
    // released, and a retry made a second proposal beside a first that might still land.
    const request = { idempotencyKey: "issue-1009-unknown-then-unwritten" };
    const connection = overPGlite(db);

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        if (theCreation(sql)) {
          throw aLostConnection();
        }

        if (sql.trimStart().startsWith("INSERT INTO dsor.audit")) {
          throw Object.assign(new Error("the server refused it"), { code: "53100" });
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("after_reconciliation");

    useDatabase(overPGlite(db));

    // Sent again with its key: the same answer, and still no proposal at all.
    expect(await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request)).toStrictEqual(
      answer,
    );

    const proposals = await asTheOwner(async () => {
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM dsor.proposals WHERE tenant = 'org_456'",
      );

      return rows.map((r) => r.id);
    });

    expect(proposals).toStrictEqual([]);
  });
});

describe("after every path the door has", () => {
  it("DSOR-AUD-01: every move has its record, saying the state it entered, and every record of a move has its move", async () => {
    // Carried out; FAILED, its handler refusing; a handler that throws; DENIED; a lost reply; a
    // replay of the first request.
    const once = { idempotencyKey: "issue-1009-once" };

    await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, once);
    await callOperation(SUPERVISOR, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
    });
    await expect(
      makeDoor(PIPELINE, {
        "payment.create": () => {
          throw new Error("the bank hung up half way");
        },
      })(AGENT, "payment.create", PAY_2500),
    ).rejects.toThrow(/half way/);
    await callOperation(AGENT, "payment.create", {
      ...PAY_2500,
      amount: { value: "60000.00", currency: "USD" },
    });
    withAFault(aMoveNaming("EXECUTING"), "reply lost");
    await callOperation(AGENT, "payment.create", PAY_2500);
    useDatabase(overPGlite(db));
    await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, once);

    // As the owner, every move of the company beside the record it names.
    const pairs = await asTheOwner(async () => {
      const { rows } = await db.query<{
        proposal: string;
        to_state: string;
        record: string;
        kind: string;
        result: string;
        resources: readonly string[] | null;
      }>(
        `SELECT m.proposal, m.to_state, m.record, a.kind, a.result, a.resources
           FROM dsor.proposal_moves m JOIN dsor.audit a ON a.record_id = m.record
          WHERE m.tenant = 'org_456'
          ORDER BY m.seq`,
      );

      return rows;
    });
    const log = await theLog("org_456");
    const records = log.filter((r) => r.kind === "proposal_transition");

    // Five proposals: the replay made none.
    expect(new Set(pairs.map((p) => p.proposal)).size).toBe(5);
    // As many records of moves as moves, and no two moves name the same one.
    expect(pairs).toHaveLength(records.length);
    expect(new Set(pairs.map((p) => p.record)).size).toBe(pairs.length);

    for (const pair of pairs) {
      expect(pair.kind).toBe("proposal_transition");
      expect(pair.result).toBe(pair.to_state);
      expect(pair.resources).toStrictEqual(
        pair.to_state === "PROPOSED" ? null : [`dsor://org_456/proposal/${pair.proposal}`],
      );
    }

    expect(verifyChain(log, await theHead("org_456"))).toBe(true);
  });
});
