// NEW IN STEP 22: the proposal, a record with a state you can look up (decision 136).
//
// Every command that gets past the idempotency claim becomes one. Its payload is written once and
// never changed; where it is now is its history of moves, each with who made it and why, and its
// state is its last move. The rules of §26.2 live in the database (migrations/020_proposals.sql):
// this file asks for a move, and the database says whether it may happen.
//
// Rule DSOR-APR-01a: proposals MUST follow this state machine.
// Rule DSOR-APR-01b: every proposal transition MUST be recorded with its actor and its cause.
// Rule DSOR-APR-01c: a proposal MUST NOT leave a terminal state.
// Rule DSOR-IDM-04: a proposal MUST be executed at most once; the proposal id is the idempotency key
// of its execution.

import { theDatabase } from "./store.ts";

/** The states of §26.2, as `proposalState` in the schemas lists them. */
export type ProposalState =
  | "PROPOSED"
  | "DENIED"
  | "READY"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
  | "REVOKED"
  | "INVALIDATED"
  | "EXECUTING"
  | "COMMITTED"
  | "FAILED"
  | "OUTCOME_UNKNOWN"
  | "COMPENSATING"
  | "COMPENSATED"
  | "COMPENSATION_FAILED";

/** What a new proposal is made of. None of it changes afterwards. */
export interface NewProposal {
  readonly tenant: string;
  readonly operation: string;
  readonly mode: "execute" | "propose_only";
  /** The arguments, as the text the payload hash was computed from. */
  readonly payload: string;
  readonly payloadHash: string;
  /** Who asked, as the decision record says it. */
  readonly requester: string;
  readonly idempotencyKey: string;
  /** Who logged in to ask, the first move's actor. */
  readonly actor: string;
  /** Why it exists, the first move's cause. */
  readonly cause: string;
}

/** One move in a proposal's history. */
export interface Move {
  readonly from: ProposalState | null;
  readonly to: ProposalState;
  readonly at: string;
  readonly actor: string;
  readonly cause: string;
}

/**
 * Write a proposal and its first move, into PROPOSED, in one statement, and say its id.
 *
 * One statement, so a proposal never exists without the move that says where it is.
 */
export async function propose(proposal: NewProposal): Promise<string> {
  const { rows } = await theDatabase(proposal.tenant).query<{ id: string }>(
    `WITH made AS (
       INSERT INTO dsor.proposals (tenant, operation, mode, payload, payload_hash, requester, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING tenant, id
     )
     INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
     SELECT tenant, id, NULL, 'PROPOSED', $8, $9 FROM made
     RETURNING proposal AS id`,
    [
      proposal.tenant,
      proposal.operation,
      proposal.mode,
      proposal.payload,
      proposal.payloadHash,
      proposal.requester,
      proposal.idempotencyKey,
      proposal.actor,
      proposal.cause,
    ],
  );
  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error("the database wrote no proposal and said nothing about why");
  }

  return id;
}

/** What happened when a move was asked for. */
export type MoveOutcome =
  | { readonly kind: "moved" }
  /** The proposal is not in that state, or the map has no such move: nothing was written. */
  | { readonly kind: "refused" };

// PostgreSQL's codes for the constraints a refused move breaks: a move out of a state the proposal
// is not in, or not on the map, has nothing to point at (23503); a state already entered or left
// (23505); a move back into PROPOSED, or one with no actor or no cause (23514).
const REFUSED_MOVE = new Set(["23503", "23505", "23514"]);

/**
 * Move a proposal from one state to another, if it is in that state and the map has the move.
 *
 * One INSERT, and the database decides. Two requests that both try to move a proposal out of READY
 * both reach it, and exactly one is written: a state is left at most once.
 */
export async function moveProposal(
  tenant: string,
  id: string,
  from: ProposalState,
  to: ProposalState,
  actor: string,
  cause: string,
): Promise<MoveOutcome> {
  try {
    await theDatabase(tenant).query(
      `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant, id, from, to, actor, cause],
    );
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;

    if (typeof code === "string" && REFUSED_MOVE.has(code)) {
      return Object.freeze({ kind: "refused" });
    }

    throw error;
  }

  return Object.freeze({ kind: "moved" });
}

/**
 * NEW IN STEP 22, decision 137: several moves, one after the other, in one INSERT: all of them are
 * written, or none.
 *
 * The door moves a proposal to READY and to EXECUTING together. Written one at a time, a failure
 * between the two left a proposal READY for good, with nothing ever to carry it out, a review
 * measured. One statement leaves it where it was, or at the end of the path.
 */
export async function moveProposalThrough(
  tenant: string,
  id: string,
  path: ReadonlyArray<readonly [from: ProposalState, to: ProposalState, cause: string]>,
  actor: string,
): Promise<MoveOutcome> {
  const params: unknown[] = [tenant, id, actor];
  const rows = path.map(([from, to, cause]) => {
    params.push(from, to, cause);

    const at = params.length;

    return `($1, $2, $${at - 2}, $${at - 1}, $3, $${at})`;
  });

  try {
    await theDatabase(tenant).query(
      `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause)
       VALUES ${rows.join(", ")}`,
      params,
    );
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;

    if (typeof code === "string" && REFUSED_MOVE.has(code)) {
      return Object.freeze({ kind: "refused" });
    }

    throw error;
  }

  return Object.freeze({ kind: "moved" });
}

/** A proposal's moves, oldest first. Empty when there is no such proposal in that company. */
export async function movesOf(tenant: string, id: string): Promise<readonly Move[]> {
  const { rows } = await theDatabase(tenant).query<{
    from_state: ProposalState | null;
    to_state: ProposalState;
    at: Date | string;
    actor: string;
    cause: string;
  }>(
    `SELECT from_state, to_state, at, actor, cause FROM dsor.proposal_moves
      WHERE tenant = $1 AND proposal = $2
      ORDER BY seq`,
    [tenant, id],
  );

  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        from: row.from_state,
        to: row.to_state,
        at: new Date(row.at).toISOString(),
        actor: row.actor,
        cause: row.cause,
      }),
    ),
  );
}

/**
 * Where a proposal is now: the state it entered and has not left. Undefined when there is no such
 * proposal in that company.
 */
export async function stateOf(tenant: string, id: string): Promise<ProposalState | undefined> {
  const { rows } = await theDatabase(tenant).query<{ to_state: ProposalState }>(
    `SELECT m.to_state FROM dsor.proposal_moves m
      WHERE m.tenant = $1 AND m.proposal = $2
        AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves n
                         WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                           AND n.from_state = m.to_state)`,
    [tenant, id],
  );

  return rows[0]?.to_state;
}

/** One proposal, as a list of them shows it. */
export interface ProposalSummary {
  readonly id: string;
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly state: ProposalState;
}

/** A company's proposals, oldest first, each with where it is now. */
export async function proposalsOf(tenant: string): Promise<readonly ProposalSummary[]> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    operation: string;
    idempotency_key: string;
    state: ProposalState;
  }>(
    `SELECT p.id, p.operation, p.idempotency_key, m.to_state AS state
       FROM dsor.proposals p
       JOIN dsor.proposal_moves m ON m.tenant = p.tenant AND m.proposal = p.id
      WHERE p.tenant = $1
        AND NOT EXISTS (SELECT 1 FROM dsor.proposal_moves n
                         WHERE n.tenant = m.tenant AND n.proposal = m.proposal
                           AND n.from_state = m.to_state)
      -- In the order they were numbered: prop_9 before prop_10.
      ORDER BY length(p.id), p.id`,
    [tenant],
  );

  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: row.id,
        operation: row.operation,
        idempotencyKey: row.idempotency_key,
        state: row.state,
      }),
    ),
  );
}
