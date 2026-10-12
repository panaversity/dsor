// STEP 22: the proposal, and the rules of §26.2 kept by the database (decision 136).
//
// Rule DSOR-APR-01a: proposals MUST follow this state machine.
// Rule DSOR-APR-01b: every proposal transition MUST be recorded with its actor and its cause.
// Rule DSOR-APR-01c: a proposal MUST NOT leave a terminal state.
// Rule DSOR-IDM-04: a proposal MUST be executed at most once; the proposal id is the idempotency key
// of its execution.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { payloadHash, refusal, success } from "../src/envelopes.ts";
import { getInvoice } from "../src/invoice.ts";
import { MAX_PAYLOAD_BYTES, PIPELINE } from "../src/operations.ts";
import type { Context } from "../src/pipeline.ts";
import {
  moveProposal,
  moveProposalThrough,
  movesOf,
  propose,
  type ProposalState,
  stateOf,
} from "../src/proposal.ts";
import { theDatabase, useDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { callOperation, makeDoor } from "./support/door.ts";

// §26.2's diagram, written out by hand from the specification, without the moves into and out of
// compensation. The migration holds the map; this is the second reading that checks it.
const DIAGRAM: readonly string[] = [
  "APPROVED -> CANCELLED",
  "APPROVED -> EXECUTING",
  "APPROVED -> EXPIRED",
  "APPROVED -> INVALIDATED",
  "APPROVED -> REVOKED",
  "EXECUTING -> COMMITTED",
  "EXECUTING -> FAILED",
  "EXECUTING -> OUTCOME_UNKNOWN",
  "OUTCOME_UNKNOWN -> COMMITTED",
  "OUTCOME_UNKNOWN -> FAILED",
  "PENDING_APPROVAL -> APPROVED",
  "PENDING_APPROVAL -> CANCELLED",
  "PENDING_APPROVAL -> EXPIRED",
  "PENDING_APPROVAL -> REJECTED",
  "PROPOSED -> DENIED",
  "PROPOSED -> PENDING_APPROVAL",
  "PROPOSED -> READY",
  "READY -> EXECUTING",
];

const EVERY_STATE: readonly ProposalState[] = [
  "PROPOSED",
  "DENIED",
  "READY",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "REVOKED",
  "INVALIDATED",
  "EXECUTING",
  "COMMITTED",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "COMPENSATING",
  "COMPENSATED",
  "COMPENSATION_FAILED",
];

/** A proposal of org_456's, the agent asking for a payment, as a test needs one. */
const aProposal = (): Promise<string> =>
  propose({
    tenant: "org_456",
    operation: "payment.create@1",
    mode: "execute",
    payload:
      '{"invoice":"dsor://org_456/invoice/INV-1009","amount":{"value":"2500.00","currency":"USD"}}',
    payloadHash: "sha256:0000",
    requester: '{"mode":"unattended","subject":"user_123","actor_chain":["accounts-payable-fte"]}',
    idempotencyKey: "pay-1009",
    actor: "accounts-payable-fte",
    cause: "payment.create@1 invoked",
  });

/** Walk a proposal along a path of states, each move by `dsor`. */
async function walk(id: string, path: readonly ProposalState[]): Promise<void> {
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1] as ProposalState;
    const to = path[i] as ProposalState;
    // STEP 25: through the path, which is the only way into EXECUTING (decision 143).
    const outcome = await moveProposalThrough(
      "org_456",
      id,
      [[from, to, `test walks to ${to}`]],
      "dsor",
      null,
    );

    if (outcome.kind !== "moved") {
      throw new Error(`the walk could not move from ${from} to ${to}`);
    }
  }
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

describe("the map is §26.2's", () => {
  it("DSOR-APR-01a: the database's map of moves is the specification's diagram, without its compensation line", async () => {
    // Decision 153: §26.2's last line moves COMMITTED and FAILED on to COMPENSATING, for commands
    // that can be undone. This tutorial never builds compensation, and the README says so.
    const { rows } = await asTheOwner(() =>
      db.query<{ move: string }>(
        "SELECT from_state || ' -> ' || to_state AS move FROM dsor.proposal_map ORDER BY 1",
      ),
    );

    expect(rows.map((r) => r.move)).toStrictEqual(DIAGRAM);
  });
});

describe("a proposal and its moves", () => {
  it("DSOR-APR-01a: a proposal starts PROPOSED, and its state is its last move", async () => {
    const id = await aProposal();

    expect(id).toMatch(/^prop_\d+$/);
    expect(await stateOf("org_456", id)).toBe("PROPOSED");

    await walk(id, ["PROPOSED", "READY", "EXECUTING", "COMMITTED"]);

    expect(await stateOf("org_456", id)).toBe("COMMITTED");
  });

  it("DSOR-APR-01b: every move is recorded with its actor, its cause and its time", async () => {
    const id = await aProposal();

    await walk(id, ["PROPOSED", "READY"]);

    const moves = await movesOf("org_456", id);

    expect(moves.map((m) => [m.from, m.to, m.actor, m.cause])).toStrictEqual([
      [null, "PROPOSED", "accounts-payable-fte", "payment.create@1 invoked"],
      ["PROPOSED", "READY", "dsor", "test walks to READY"],
    ]);
    expect(moves.every((m) => !Number.isNaN(Date.parse(m.at)))).toBe(true);
  });

  it("DSOR-APR-01b: a move with no actor or no cause is refused by the database", async () => {
    const id = await aProposal();

    for (const [actor, cause] of [
      ["", "a cause"],
      ["dsor", ""],
    ] as const) {
      await expect(
        theDatabase("org_456").query(
          `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
           VALUES ('org_456', $1, 'PROPOSED', 'READY', $2, $3)`,
          [id, actor, cause],
        ),
      ).rejects.toThrow(/check constraint/);
    }

    expect(await stateOf("org_456", id)).toBe("PROPOSED");
  });

  it("DSOR-APR-01a: a move that is not on the map is refused, and nothing is written", async () => {
    const id = await aProposal();

    expect(
      await moveProposal("org_456", id, "PROPOSED", "COMMITTED", "dsor", "skip ahead"),
    ).toStrictEqual({
      kind: "refused",
    });
    expect(await movesOf("org_456", id)).toHaveLength(1);
    expect(await stateOf("org_456", id)).toBe("PROPOSED");
  });

  it("DSOR-APR-01a: a move out of a state the proposal is not in is refused", async () => {
    const id = await aProposal();

    expect(
      await moveProposalThrough("org_456", id, [["READY", "EXECUTING", "jump"]], "dsor", null),
    ).toStrictEqual({
      kind: "refused",
    });
    expect(await stateOf("org_456", id)).toBe("PROPOSED");
  });

  it("DSOR-APR-01a: a second first move, into PROPOSED again, is refused", async () => {
    const id = await aProposal();

    await expect(
      theDatabase("org_456").query(
        `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
         VALUES ('org_456', $1, NULL, 'PROPOSED', 'dsor', 'again')`,
        [id],
      ),
    ).rejects.toThrow();
  });
});

describe("a finished proposal refuses to move to any other state", () => {
  // Every finished state this step's commands reach, by the path they reach it.
  const FINISHED: ReadonlyArray<readonly ProposalState[]> = [
    ["PROPOSED", "DENIED"],
    ["PROPOSED", "READY", "EXECUTING", "COMMITTED"],
    ["PROPOSED", "READY", "EXECUTING", "FAILED"],
    ["PROPOSED", "READY", "EXECUTING", "OUTCOME_UNKNOWN", "COMMITTED"],
  ];

  for (const path of FINISHED) {
    const finished = path.at(-1) as ProposalState;

    it(`DSOR-APR-01c: ${finished}, by ${path.join(" -> ")}, moves to none of the ${EVERY_STATE.length} states`, async () => {
      const id = await aProposal();

      await walk(id, path);

      for (const to of EVERY_STATE) {
        expect(
          await moveProposal("org_456", id, finished, to, "dsor", "try to leave"),
        ).toStrictEqual({
          kind: "refused",
        });
      }

      expect(await stateOf("org_456", id)).toBe(finished);
      expect(await movesOf("org_456", id)).toHaveLength(path.length);
    });
  }

  // Decision 153: PostgreSQL does not check a foreign key when one of its columns is NULL, so neither
  // key above checks a move with no "from". Only the CHECK that the first move is into PROPOSED
  // refuses one. Without it, a review measured a DENIED proposal given a second line of history that
  // went on to EXECUTING, and a COMMITTED one that went on to FAILED.
  for (const path of FINISHED) {
    const finished = path.at(-1) as ProposalState;

    it(`DSOR-APR-01c: ${finished}, by ${path.join(" -> ")}, takes no move with no "from" into any of the ${EVERY_STATE.length} states`, async () => {
      const id = await aProposal();

      await walk(id, path);

      for (const to of EVERY_STATE) {
        // Not through moveProposal: the SQL a careless handler would write, with the application's
        // own rights. A move into PROPOSED is the one the CHECK allows, and "entered once" refuses it.
        await expect(
          theDatabase("org_456").query(
            `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
             VALUES ('org_456', $1, NULL, $2, 'dsor', 'a second first move')`,
            [id, to],
          ),
        ).rejects.toThrow(to === "PROPOSED" ? /duplicate key/ : /check constraint/);
      }

      // The count, not only the state: two lines of history would still answer the first state.
      expect(await movesOf("org_456", id)).toHaveLength(path.length);
      expect(await stateOf("org_456", id)).toBe(finished);
    });
  }

  it("DSOR-APR-01c: the application writing the SQL itself cannot move a COMMITTED proposal either", async () => {
    const id = await aProposal();

    await walk(id, ["PROPOSED", "READY", "EXECUTING", "COMMITTED"]);

    // Not through moveProposal: a careless handler next year, with the application's own rights.
    await expect(
      theDatabase("org_456").query(
        `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
         VALUES ('org_456', $1, 'COMMITTED', 'FAILED', 'dsor', 'call it a failure')`,
        [id],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      theDatabase("org_456").query(
        "UPDATE dsor.proposal_moves SET to_state = 'READY' WHERE proposal = $1 AND to_state = 'COMMITTED'",
        [id],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      theDatabase("org_456").query(
        "DELETE FROM dsor.proposal_moves WHERE proposal = $1 AND to_state = 'COMMITTED'",
        [id],
      ),
    ).rejects.toThrow(/permission denied/);

    expect(await stateOf("org_456", id)).toBe("COMMITTED");
  });
});

describe("a proposal runs at most once", () => {
  it("DSOR-IDM-04: two moves out of READY, sent together: one is written, the other refused", async () => {
    const id = await aProposal();

    await walk(id, ["PROPOSED", "READY"]);

    const outcomes = await Promise.all([
      moveProposalThrough("org_456", id, [["READY", "EXECUTING", "the first"]], "dsor", null),
      moveProposalThrough("org_456", id, [["READY", "EXECUTING", "the second"]], "dsor", null),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toStrictEqual(["moved", "refused"]);
    expect((await movesOf("org_456", id)).filter((m) => m.to === "EXECUTING")).toHaveLength(1);
  });
});

describe("a state is left once, whatever the move", () => {
  it("DSOR-APR-01a: approved and rejected at once: one is written, and the other refused", async () => {
    // Two different moves out of one state. "Entered once" cannot catch this, because the two go
    // to different states; "left once" does. Today no command waits for approval; step 26's will.
    const id = await aProposal();

    await walk(id, ["PROPOSED", "PENDING_APPROVAL"]);

    const outcomes = await Promise.all([
      moveProposal("org_456", id, "PENDING_APPROVAL", "APPROVED", "cfo_100", "approved"),
      moveProposal("org_456", id, "PENDING_APPROVAL", "REJECTED", "cfo_100", "rejected"),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toStrictEqual(["moved", "refused"]);
    expect(await movesOf("org_456", id)).toHaveLength(3);
  });
});

describe("the application adds, and changes nothing", () => {
  it("DSOR-APR-01c: it may not change or delete a proposal or a move, nor touch the map", async () => {
    const { rows } = await db.query<{ right: string }>(
      `SELECT t || ' ' || r AS right
         FROM unnest(ARRAY['dsor.proposals', 'dsor.proposal_moves', 'dsor.proposal_map']) AS t,
              unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'SELECT']) AS r
        WHERE has_table_privilege(current_user, t, r)
           OR (r IN ('INSERT', 'UPDATE', 'SELECT') AND has_any_column_privilege(current_user, t, r))
        ORDER BY 1`,
    );

    expect(rows.map((r) => r.right)).toStrictEqual([
      "dsor.proposal_moves INSERT",
      "dsor.proposal_moves SELECT",
      "dsor.proposals INSERT",
      "dsor.proposals SELECT",
    ]);
  });

  // Decision 153: what this proves is that propose stores the text it is given, unchanged. Nothing is
  // hashed here; the door's test below ties the stored text to its hash.
  it("propose keeps the payload's text byte for byte", async () => {
    const id = await aProposal();
    const { rows } = await theDatabase("org_456").query<{ payload: string }>(
      "SELECT payload FROM dsor.proposals WHERE tenant = 'org_456' AND id = $1",
      [id],
    );

    expect(rows[0]?.payload).toBe(
      '{"invoice":"dsor://org_456/invoice/INV-1009","amount":{"value":"2500.00","currency":"USD"}}',
    );
  });

  it("DSOR-TEN-01a: another company sees neither the proposal nor its moves", async () => {
    const id = await aProposal();

    expect(await stateOf("org_789", id)).toBeUndefined();
    expect(await movesOf("org_789", id)).toStrictEqual([]);
    expect(
      await moveProposal("org_789", id, "PROPOSED", "READY", "dsor", "from outside"),
    ).toStrictEqual({
      kind: "refused",
    });
    expect(await stateOf("org_456", id)).toBe("PROPOSED");
  });
});

// STEP 22, piece 2: the door makes the proposal at §21.8 and moves it as the request goes.

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const CFO = { loggedInAs: "cfo_100" };
const ISSUE_1009 = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };

/** org_456's proposals, as the owner sees them. */
const proposalsOf456 = async (): Promise<
  ReadonlyArray<{ id: string; payload: string; payload_hash: string; requester: string }>
> =>
  asTheOwner(async () => {
    const { rows } = await db.query<{
      id: string;
      payload: string;
      payload_hash: string;
      requester: string;
    }>(
      "SELECT id, payload, payload_hash, requester FROM dsor.proposals WHERE tenant = 'org_456' ORDER BY created_at",
    );

    return rows;
  });

/** The moves of one proposal, as [from, to, actor, cause]. */
const historyOf = async (id: string): Promise<unknown[][]> =>
  (await movesOf("org_456", id)).map((m) => [m.from, m.to, m.actor, m.cause]);

/**
 * The program's store, failing every write of moves that names one of the states, until it is put
 * back, or only the first `times` of them. With `replyLost`, the write happens and only its reply
 * is lost (decision 137).
 */
function failingMovesInto(
  states: readonly ProposalState[],
  { replyLost = false, times = Number.POSITIVE_INFINITY } = {},
): void {
  const connection = overPGlite(db);
  let left = times;

  useDatabase({
    async query<T>(sql: string, params?: unknown[], tenant?: string) {
      if (
        left > 0 &&
        sql.includes("INSERT INTO dsor.proposal_moves") &&
        states.some((state) => params?.includes(state))
      ) {
        left -= 1;

        if (replyLost) {
          await connection.query(sql, params, tenant);
        }

        throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
      }

      return connection.query<T>(sql, params, tenant);
    },
  });
}

/**
 * Decision 153: the program's store, for the first write of moves that names `state`: its reply
 * is lost and the write is held, as a COMMIT still on its way. It lands just before the next write
 * that names DENIED, after the door has read PROPOSED back, which is when a real server can let it
 * be seen. With `deniedFails`, every write that names DENIED fails instead, and the held one lands
 * when `land` is called.
 */
function aWriteThatLandsLate(
  state: ProposalState,
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

describe("the door makes a proposal for every command and moves it", () => {
  afterEach(() => {
    useDatabase(overPGlite(db));
  });

  it("DSOR-APR-01a: a command carried out moves PROPOSED, READY, EXECUTING, COMMITTED, and its receipt names it", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    if (answer.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
    }

    expect(answer.envelope.proposal).toBe("dsor://org_456/proposal/prop_1");

    const history = await historyOf("prop_1");

    expect(history).toHaveLength(4);
    expect(history[0]).toStrictEqual([null, "PROPOSED", "user_123", "invoice.issue@1 invoked"]);
    expect(history[1]?.slice(0, 3)).toStrictEqual(["PROPOSED", "READY", "dsor"]);
    expect(history[1]?.[3]).toMatch(/^allowed: the decision is recorded as /);
    expect(history.slice(2)).toStrictEqual([
      ["READY", "EXECUTING", "dsor", "handed to invoice.issue"],
      ["EXECUTING", "COMMITTED", "dsor", "the handler answered COMMITTED"],
    ]);
  });

  it("a receipt names the door's own proposal, whatever the handler wrote", async () => {
    // Decision 153: every handler passes on the address the door hands it, so nothing tested the door
    // writing it over, and a door that let the handler's word through passed every test. A careless
    // handler here names a proposal of its own company's that this request never made.
    const door = makeDoor(PIPELINE, {
      "invoice.issue": (_args, _contract, askedBy, tenant, hash, requestId) => ({
        kind: "result",
        askedBy,
        envelope: success({
          data: {},
          semantics: "atomic",
          payloadHash: hash,
          tenant,
          proposal: `dsor://${tenant}/proposal/prop_999`,
          principalId: askedBy,
          requestId,
        }),
      }),
    });
    const answer = await door(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind === "result" && answer.envelope.proposal).toBe(
      "dsor://org_456/proposal/prop_1",
    );
  });

  it("DSOR-APR-01a: the proposal keeps the payload the receipt's hash describes, and who asked", async () => {
    const answer = await callOperation(AGENT, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      amount: { value: "2500.00", currency: "USD" },
    });

    if (answer.kind !== "result") {
      throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
    }

    const [kept] = await proposalsOf456();

    expect(kept?.payload_hash).toBe(answer.envelope.payload_hash);
    // Decision 153: and the text kept is the very text that was hashed. Parsing it back cannot tell:
    // a door that kept the same arguments written another way passed every test, a review measured.
    expect(payloadHash(kept?.payload ?? "")).toBe(kept?.payload_hash);
    expect(JSON.parse(kept?.payload ?? "null")).toStrictEqual({
      invoice: "dsor://org_456/invoice/INV-1009",
      amount: { value: "2500.00", currency: "USD" },
    });
    expect(JSON.parse(kept?.requester ?? "null")).toStrictEqual({
      mode: "unattended",
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      delegation: "del_100",
    });
    expect((await historyOf("prop_1"))[0]?.[2]).toBe("accounts-payable-fte");
  });

  it("DSOR-APR-01a: a command a later stage refuses is DENIED, with the code that refused it", async () => {
    const answer = await callOperation(AGENT, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      amount: { value: "60000.00", currency: "USD" },
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("LIMIT_EXCEEDED");
    expect(await historyOf("prop_1")).toStrictEqual([
      [null, "PROPOSED", "accounts-payable-fte", "payment.create@1 invoked"],
      ["PROPOSED", "DENIED", "dsor", "refused: LIMIT_EXCEEDED"],
    ]);
  });

  it("DSOR-APR-01a: a command its handler refuses is FAILED, with the handler's code", async () => {
    // INV-1008 is already issued, at version 1: the handler answers CONFLICT.
    const answer = await callOperation(SUPERVISOR, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("CONFLICT");
    expect(await stateOf("org_456", "prop_1")).toBe("FAILED");
    expect((await historyOf("prop_1")).at(-1)).toStrictEqual([
      "EXECUTING",
      "FAILED",
      "dsor",
      "the handler answered CONFLICT",
    ]);
  });

  it("DSOR-UNK-01a: a handler that throws leaves its proposal OUTCOME_UNKNOWN, never FAILED", async () => {
    // Decision 153: the proposal's state is DSOR-UNK-01a's subject. What the caller is told is
    // UNK-01b's, and here the throw reaches the caller as a throw, which decision 126 left to step 37.
    const door = makeDoor(PIPELINE, {
      "invoice.issue": () => {
        throw new Error("the connector hung up half way");
      },
    });

    await expect(door(SUPERVISOR, "invoice.issue", ISSUE_1009)).rejects.toThrow(/half way/);
    expect(await historyOf("prop_1")).toContainEqual([
      "EXECUTING",
      "OUTCOME_UNKNOWN",
      "dsor",
      "the handler threw, so nobody knows whether it ran",
    ]);
  });

  it("DSOR-UNK-01b: a handler that answers OUTCOME_UNKNOWN leaves its proposal OUTCOME_UNKNOWN, and the caller is told so", async () => {
    let called = 0;
    const door = makeDoor(PIPELINE, {
      "invoice.issue": (_args, _contract, askedBy, _tenant, _hash, requestId) => {
        called += 1;

        return {
          kind: "error",
          askedBy,
          envelope: refusal("OUTCOME_UNKNOWN", "the bank did not say", requestId, askedBy),
        };
      },
    });
    const request = { idempotencyKey: "issue-1009-the-bank-did-not-say" };
    const answer = await door(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(await stateOf("org_456", "prop_1")).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("after_reconciliation");
    // Sent again with its key: the same answer, and the handler is not called again.
    expect(await door(SUPERVISOR, "invoice.issue", ISSUE_1009, request)).toStrictEqual(answer);
    expect(called).toBe(1);
  });

  it("DSOR-APR-01a: a request refused before §21.8, and a query, make no proposal", async () => {
    // cfo_100 may not issue an invoice: refused at §21.5, before there is anything to propose.
    await callOperation(CFO, "invoice.issue", ISSUE_1009);
    await callOperation(SUPERVISOR, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" });

    expect(await proposalsOf456()).toStrictEqual([]);
  });

  it("DSOR-IDM-04: the same request sent again with its key is the same proposal, not a second one", async () => {
    const request = { idempotencyKey: "issue-1009-once" };
    const first = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(first.kind === "result" && first.envelope.proposal).toBe(
      "dsor://org_456/proposal/prop_1",
    );
    expect(again).toStrictEqual(first);
    expect((await proposalsOf456()).map((p) => p.id)).toStrictEqual(["prop_1"]);
  });

  it("DSOR-EXE-03b: a move to READY that cannot be written means nothing runs, and the key may be sent again", async () => {
    const request = { idempotencyKey: "issue-1009-store-down" };

    failingMovesInto(["READY"]);

    const refused = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(refused.kind === "error" && refused.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(refused.kind === "error" && refused.envelope.retry).toBe("safe_same_key");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
    expect(await stateOf("org_456", "prop_1")).toBe("DENIED");

    useDatabase(overPGlite(db));

    // The claim was released, because nothing ran: the same key now carries the request out.
    const sentAgain = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(sentAgain.kind === "result" && sentAgain.envelope.proposal).toBe(
      "dsor://org_456/proposal/prop_2",
    );
    expect(await stateOf("org_456", "prop_2")).toBe("COMMITTED");
  });

  it("DSOR-EXE-03b: a proposal that cannot be written means nothing runs, and the key may be sent again", async () => {
    // Decision 153: decision 136 promises EVIDENCE_STORE_UNAVAILABLE here, and nothing tested it.
    // Without the refusal at §21.8 the request reached §21.11 with no proposal and was refused
    // INTERNAL_ERROR, retry never, kept on its claim: the key was used up for good for a request
    // that never ran, and the log called a store outage a bug, a review measured.
    const request = { idempotencyKey: "issue-1009-proposal-store-down" };
    const connection = overPGlite(db);

    useDatabase({
      async query<T>(sql: string, params?: unknown[], tenant?: string) {
        // The proposal's own statement. A move's says "dsor.proposal_moves", which this does not match.
        if (sql.includes("INSERT INTO dsor.proposals")) {
          throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
        }

        return connection.query<T>(sql, params, tenant);
      },
    });

    const refused = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(refused.kind === "error" && refused.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect(refused.kind === "error" && refused.envelope.retry).toBe("safe_same_key");
    expect((await theLog("org_456")).at(-1)).toMatchObject({
      authorization: "DENY",
      result: "EVIDENCE_STORE_UNAVAILABLE",
    });
    expect(await proposalsOf456()).toStrictEqual([]);
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");

    useDatabase(connection);

    // The claim was released. Not prop_1 by name: on a real server a refused INSERT can use up a
    // number, so the test asks for one proposal, carried out.
    const sentAgain = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    const made = await proposalsOf456();

    expect(sentAgain.kind).toBe("result");
    expect(made).toHaveLength(1);
    expect(await stateOf("org_456", made[0]?.id ?? "")).toBe("COMMITTED");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("issued");
  });

  it("a command whose arguments are over the ceiling is refused at §21.6, with no claim and no proposal", async () => {
    // Decision 153: a proposal keeps its arguments whole, for good, in a table nobody may delete
    // from. With no ceiling, this payment, refused for its amount, still kept a 5,000,000-character
    // note, a review measured. Euro signs, because a size counted in characters lets this through:
    // each is one character and three bytes.
    const request = { idempotencyKey: "pay-1009-with-a-long-note" };
    const answer = await callOperation(
      AGENT,
      "payment.create",
      {
        invoice: "dsor://org_456/invoice/INV-1009",
        amount: { value: "60000.00", currency: "USD" },
        note: "€".repeat(Math.ceil(MAX_PAYLOAD_BYTES / 3)),
      },
      request,
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(await proposalsOf456()).toStrictEqual([]);

    // Recorded as the DENY it is, and the record holds none of the note.
    const record = (await theLog("org_456")).at(-1);

    expect(record).toMatchObject({ authorization: "DENY", result: "VALIDATION_FAILED" });
    expect(JSON.stringify(record).length).toBeLessThan(2000);

    const claims = await asTheOwner(async () => {
      const { rows } = await db.query<{ claims: number }>(
        "SELECT count(*)::int AS claims FROM dsor.idempotency_keys WHERE tenant = 'org_456' AND key = $1",
        [request.idempotencyKey],
      );

      return rows[0]?.claims;
    });

    expect(claims).toBe(0);
  });

  it("a command whose arguments are exactly at the ceiling still becomes a proposal", async () => {
    const payment = {
      invoice: "dsor://org_456/invoice/INV-1009",
      amount: { value: "2500.00", currency: "USD" },
      note: "",
    };
    const atTheCeiling = {
      ...payment,
      note: "x".repeat(MAX_PAYLOAD_BYTES - JSON.stringify(payment).length),
    };

    expect(Buffer.byteLength(JSON.stringify(atTheCeiling), "utf8")).toBe(MAX_PAYLOAD_BYTES);

    const answer = await callOperation(AGENT, "payment.create", atTheCeiling);

    expect(answer.kind === "result" && answer.envelope.proposal).toBe(
      "dsor://org_456/proposal/prop_1",
    );
    expect(await stateOf("org_456", "prop_1")).toBe("COMMITTED");
  });

  it("DSOR-APR-01a: a move to EXECUTING whose reply is lost is read back, found to be the door's own, and carried out", async () => {
    // Decision 137: written one at a time, a lost reply here left a proposal EXECUTING whose handler
    // never ran, and the retry made a second proposal.
    failingMovesInto(["EXECUTING"], { replyLost: true, times: 1 });

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind).toBe("result");
    expect(await stateOf("org_456", "prop_1")).toBe("COMMITTED");
    expect((await proposalsOf456()).map((p) => p.id)).toStrictEqual(["prop_1"]);
  });

  it("DSOR-APR-01a: a move to EXECUTING that cannot be written leaves the proposal DENIED, never READY, and the key may be sent again", async () => {
    // Decision 153: the door writes READY and EXECUTING in one statement (decision 137), and only the
    // helper was tested. A door that went back to two moves passed every test, and left this
    // proposal READY for good beside the retry's, a review measured.
    const request = { idempotencyKey: "issue-1009-executing-down" };

    failingMovesInto(["EXECUTING"]);

    const refused = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(refused.kind === "error" && refused.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
    expect(await stateOf("org_456", "prop_1")).toBe("DENIED");

    useDatabase(overPGlite(db));

    const sentAgain = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(sentAgain.kind === "result" && sentAgain.envelope.proposal).toBe(
      "dsor://org_456/proposal/prop_2",
    );
    expect(await stateOf("org_456", "prop_1")).toBe("DENIED");
  });

  it("DSOR-IDM-01c: a move to EXECUTING whose reply is lost and that lands after the read-back is OUTCOME_UNKNOWN, and its key stays taken", async () => {
    // Decision 153: read back as PROPOSED, the request was told nothing was done; the lost write
    // then landed, the move to DENIED was refused, the claim was released all the same, and the
    // retry made a second proposal beside a first left EXECUTING whose handler never ran, a review
    // measured.
    const request = { idempotencyKey: "issue-1009-lands-late" };
    const late = aWriteThatLandsLate("EXECUTING");
    let answer;

    try {
      answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);
    } finally {
      late.putBack();
    }

    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("after_reconciliation");
    // The lost move is there now, and the handler never ran.
    expect(await stateOf("org_456", "prop_1")).toBe("EXECUTING");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");

    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(again).toStrictEqual(answer);
    expect((await proposalsOf456()).map((p) => p.id)).toStrictEqual(["prop_1"]);
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
  });

  it("DSOR-IDM-01c: a move to EXECUTING whose reply is lost, then a DENIED that cannot be written, is OUTCOME_UNKNOWN, and its key stays taken", async () => {
    // Decision 153: a DENIED that was not written proves nothing either. The lost write lands after
    // the request was answered.
    const request = { idempotencyKey: "issue-1009-denied-down" };
    const late = aWriteThatLandsLate("EXECUTING", { deniedFails: true });
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
    expect((await proposalsOf456()).map((p) => p.id)).toStrictEqual(["prop_1"]);
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
  });

  it("DSOR-APR-01a: moveProposalThrough writes READY and EXECUTING together, or neither", async () => {
    // Decision 137: a review failed the move to EXECUTING alone and measured a proposal READY for
    // good. A move off the map in the second place leaves the first unwritten too.
    const id = await aProposal();

    expect(
      await moveProposalThrough(
        "org_456",
        id,
        [
          ["PROPOSED", "READY", "allowed"],
          ["READY", "COMMITTED", "skipping EXECUTING"],
        ],
        "dsor",
        null,
      ),
    ).toStrictEqual({ kind: "refused" });
    expect(await stateOf("org_456", id)).toBe("PROPOSED");

    expect(
      await moveProposalThrough(
        "org_456",
        id,
        [
          ["PROPOSED", "READY", "allowed"],
          ["READY", "EXECUTING", "handed over"],
        ],
        "dsor",
        null,
      ),
    ).toStrictEqual({ kind: "moved" });
    expect(await stateOf("org_456", id)).toBe("EXECUTING");
  });

  it("DSOR-UNK-01b: a handler that answers a failure which does not say nothing was done leaves its proposal OUTCOME_UNKNOWN, and the caller is told so, never to try again", async () => {
    // Decision 137: a careless handler that made the payment and then answered TRANSACTION_FAILED
    // left its proposal FAILED, finished, a review measured. Decision 153: and its caller was still
    // told TRANSACTION_FAILED, retry safe_same_key, an invitation to make the payment again.
    let called = 0;
    const door = makeDoor(PIPELINE, {
      "invoice.issue": (_args, _contract, askedBy, _tenant, _hash, requestId) => {
        called += 1;

        return {
          kind: "error",
          askedBy,
          envelope: refusal("TRANSACTION_FAILED", "the bank hung up", requestId, askedBy),
        };
      },
    });
    const request = { idempotencyKey: "issue-1009-the-bank-hung-up" };
    const answer = await door(SUPERVISOR, "invoice.issue", ISSUE_1009, request);

    expect(await stateOf("org_456", "prop_1")).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.code).toBe("OUTCOME_UNKNOWN");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("after_reconciliation");
    expect(await door(SUPERVISOR, "invoice.issue", ISSUE_1009, request)).toStrictEqual(answer);
    expect(called).toBe(1);
  });

  it("DSOR-IDM-04: a door that finds its proposal already finished does not run the handler", async () => {
    // Decision 137: the branch nothing tested. Here a stage makes the proposal and finishes it, as a
    // second request for the same proposal would find it; the handler must never be called.
    let called = 0;
    const list = PIPELINE.map((stage) =>
      stage.name === "create the proposal"
        ? Object.freeze({
            ...stage,
            run: async (context: Context) => {
              const done = await stage.run(context);

              if (done.kind === "carry_on" && done.context.proposal !== undefined) {
                await walk(done.context.proposal, ["PROPOSED", "READY", "EXECUTING", "COMMITTED"]);
              }

              return done;
            },
          })
        : stage,
    );
    const door = makeDoor(list, {
      "invoice.issue": () => {
        called += 1;

        throw new Error("the handler ran");
      },
    });
    const answer = await door(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind === "error" && answer.envelope.code).toBe("INTERNAL_ERROR");
    expect(called).toBe(0);
    expect(await stateOf("org_456", "prop_1")).toBe("COMMITTED");
  });

  it("a last move that cannot be written leaves the proposal EXECUTING, and the caller is still told", async () => {
    // Decision 153: not titled DSOR-EXE-04b, which asks that such a proposal be treated as
    // OUTCOME_UNKNOWN. Nothing here does that yet; it arrives with intent records, in step 36.
    failingMovesInto(["COMMITTED"]);

    const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009);

    expect(answer.kind).toBe("result");
    expect(await stateOf("org_456", "prop_1")).toBe("EXECUTING");
  });
});
