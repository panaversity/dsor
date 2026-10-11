// NEW IN STEP 22: the proposal, and the rules of §26.2 kept by the database (decision 136).
//
// Rule DSOR-APR-01a: proposals MUST follow this state machine.
// Rule DSOR-APR-01b: every proposal transition MUST be recorded with its actor and its cause.
// Rule DSOR-APR-01c: a proposal MUST NOT leave a terminal state.
// Rule DSOR-IDM-04: a proposal MUST be executed at most once; the proposal id is the idempotency key
// of its execution.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { moveProposal, movesOf, propose, type ProposalState, stateOf } from "../src/proposal.ts";
import { theDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

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
    const outcome = await moveProposal("org_456", id, from, to, "dsor", `test walks to ${to}`);

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
  it("DSOR-APR-01a: the database's map of moves is the specification's diagram", async () => {
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

    expect(await moveProposal("org_456", id, "READY", "EXECUTING", "dsor", "jump")).toStrictEqual({
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
      moveProposal("org_456", id, "READY", "EXECUTING", "dsor", "the first"),
      moveProposal("org_456", id, "READY", "EXECUTING", "dsor", "the second"),
    ]);

    expect(outcomes.map((o) => o.kind).sort()).toStrictEqual(["moved", "refused"]);
    expect((await movesOf("org_456", id)).filter((m) => m.to === "EXECUTING")).toHaveLength(1);
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

  it("DSOR-APR-01a: the payload is kept as the text it was hashed from, word for word", async () => {
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
