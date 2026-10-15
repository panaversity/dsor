// STEP 22: the proposal, a record with a state you can look up (decision 136).
//
// Every command that gets past the idempotency claim becomes one. Its payload is written once and
// never changed; where it is now is its history of moves, each with who made it and why, and its
// state is its last move. The rules of §26.2 live in the database (migrations/020_proposals.sql):
// this file asks for a move, and the database says whether it may happen.
//
// STEP 22, decision 157: and every move is in the company's audit log too. One statement
// writes the move and its record, so the database keeps both or neither: the log never says a move
// happened that did not, and no move happens that the log does not say. Each move names its record,
// and the database refuses a move that names none.
//
// Rule DSOR-APR-01a: proposals MUST follow this state machine.
// Rule DSOR-APR-01b: every proposal transition MUST be recorded with its actor and its cause.
// Rule DSOR-APR-01c: a proposal MUST NOT leave a terminal state.
// Rule DSOR-IDM-04: a proposal MUST be executed at most once; the proposal id is the idempotency key
// of its execution.
// Rule DSOR-AUD-01: every command decision, every proposal transition, and every read covered by
// DSOR-CLS-05 MUST produce a durable audit record that validates against audit-record.schema.json.

// STEP 22, decision 157: the log's routine for writing records beside a change.
import {
  type AuditRecord,
  type DecisionToRecord,
  OutcomeUnknown,
  recordInsertIf,
  recordTogether,
} from "./audit.ts";
import { noBrakeOn } from "./controls.ts";
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
  /** STEP 22, decision 157: the move's record in the company's audit log. */
  readonly record: string;
}

/**
 * STEP 22, decision 157: the request that moves a proposal, as the record of the move names
 * it: who logged in, the request's id, and, for an agent, the slip it asked under and whose
 * authority that is (step 19). The same words as that request's decision record.
 */
export interface Asked {
  readonly subject: string;
  readonly requestId: string;
  readonly underSlip?: DecisionToRecord["underSlip"];
}

/**
 * STEP 22, decision 157: and the proposal's own operation and payload hash, which every
 * record of its moves carries, so all of a proposal's records say what it is.
 */
export interface ForTheRecord extends Asked {
  readonly operation: string;
  readonly payloadHash: string;
}

/**
 * STEP 22, decision 157: the record of one move, as the audit log keeps it. Its result is
 * the state the proposal entered. It is in the name of the request that made the move, never of
 * `dsor`, which holds no authority of its own; who moved it, from where, and why are its reason,
 * the move's own actor and cause, so they are inside the record's hash too. The address names the
 * proposal; the first move's record has none, because the proposal has no number yet when the
 * record's hash is made.
 *
 * STEP 25, decision 157: exported, because a revocation moves the proposals waiting under the
 * slip, and each of those moves has its record too (delegation.ts).
 */
export function transition(
  by: ForTheRecord,
  tenant: string,
  proposal: string | undefined,
  from: ProposalState | null,
  to: ProposalState,
  actor: string,
  cause: string,
): DecisionToRecord {
  return {
    kind: "proposal_transition",
    subject: by.subject,
    tenant,
    requestId: by.requestId,
    result: to,
    operation: by.operation,
    payloadHash: by.payloadHash,
    reason: `${from ?? "(new)"} -> ${to} by ${actor}: ${cause}`,
    ...(proposal === undefined ? {} : { resources: [`dsor://${tenant}/proposal/${proposal}`] }),
    ...(by.underSlip === undefined ? {} : { underSlip: by.underSlip }),
  };
}

/**
 * STEP 22, decision 157: each record's INSERT, as a part of the statement's WITH, `r0`,
 * `r1` and so on. A part of a WITH that writes runs whether or not the statement reads it.
 *
 * STEP 25, decision 157: and only if the moves were written. A brake on the agent stops its
 * moves inside the statement, which then writes no move and does not fail; a record written all the
 * same would say a move happened that did not. So each record asks whether `moved` wrote a row.
 */
function theRecordsIn(records: readonly AuditRecord[], params: unknown[]): string {
  return records
    .map(
      (written, i) =>
        `r${i} AS (${recordInsertIf("EXISTS (SELECT 1 FROM moved)", written, params)})`,
    )
    .join(",\n");
}

/**
 * Write a proposal and its first move, into PROPOSED, in one statement, and say its id.
 *
 * One statement, so a proposal never exists without the move that says where it is.
 *
 * STEP 22, decision 157: and the same statement writes the move's record in the log. The
 * record cannot name the proposal: PostgreSQL numbers it inside the statement, after the record's
 * hash is made, and the program may not choose the number (start-up refuses one that may). So the
 * first move names the record instead.
 */
export async function propose(proposal: NewProposal, asked: Asked): Promise<string> {
  const { tenant } = proposal;
  const { records, rows } = await recordTogether<{ id: string }>(
    tenant,
    [
      transition(
        { ...asked, operation: proposal.operation, payloadHash: proposal.payloadHash },
        tenant,
        undefined,
        null,
        "PROPOSED",
        proposal.actor,
        proposal.cause,
      ),
    ],
    (written) => {
      const params: unknown[] = [
        tenant,
        proposal.operation,
        proposal.mode,
        proposal.payload,
        proposal.payloadHash,
        proposal.requester,
        proposal.idempotencyKey,
        proposal.actor,
        proposal.cause,
        written[0]?.record_id,
      ];

      return {
        sql: `WITH made AS (
                INSERT INTO dsor.proposals (tenant, operation, mode, payload, payload_hash, requester, idempotency_key)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING tenant, id
              ),
              moved AS (
                INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
                SELECT tenant, id, NULL, 'PROPOSED', $8, $9, $10 FROM made
                RETURNING proposal
              ),
              ${theRecordsIn(written, params)}
              SELECT proposal AS id FROM moved`,
        params,
      };
    },
  );

  // STEP 22, decision 157: the reply was lost, and the record was found written, so the
  // statement committed and the proposal is there. Its first move names the record: that is its id.
  // A read that fails here leaves a proposal that exists with nobody able to say which: unknown.
  if (rows === undefined) {
    let found: string | undefined;
    let why: unknown;

    try {
      const { rows: named } = await theDatabase(tenant).query<{ id: string }>(
        "SELECT proposal AS id FROM dsor.proposal_moves WHERE tenant = $1 AND record = $2",
        [tenant, records[0]?.record_id],
      );

      found = named[0]?.id;
    } catch (cannotLook) {
      why = cannotLook;
    }

    if (found === undefined) {
      throw new OutcomeUnknown(
        `the proposal whose first record is ${records[0]?.record_id} was written, and could not be read back`,
        why,
      );
    }

    return found;
  }

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
  | { readonly kind: "refused" }
  /**
   * STEP 25: a brake was on the agent the moves were for, so nothing was written
   * (DSOR-OPS-01c, decision 142).
   */
  | { readonly kind: "stopped" };

// PostgreSQL's codes for the constraints a refused move breaks: a move out of a state the proposal
// is not in, or not on the map, has nothing to point at (23503); a state already entered or left
// (23505); a move back into PROPOSED, or one with no actor or no cause (23514).
const REFUSED_MOVE = new Set(["23503", "23505", "23514"]);

/**
 * STEP 22, decision 157: did the map refuse this move? One of the codes above, and from the
 * moves' own table. The move's statement writes the log too, and the log refuses with the same
 * codes for its own reasons: a record whose chain is not its company's is 23514 on `audit`. Taken
 * for the map's refusal, that is "the proposal is not PROPOSED", and the door answers INTERNAL_ERROR
 * and leaves the proposal PROPOSED for good, when the truth is that the store failed.
 */
function refusedByTheMap(error: unknown): boolean {
  const { code, table } = (error ?? {}) as { code?: unknown; table?: unknown };

  return typeof code === "string" && REFUSED_MOVE.has(code) && table === "proposal_moves";
}

/**
 * Move a proposal from one state to another, if it is in that state and the map has the move.
 *
 * One INSERT, and the database decides. Two requests that both try to move a proposal out of the
 * same state both reach it, and exactly one is written: a state is left at most once. A move into
 * EXECUTING is the exception, refused here before the database is asked (below). Decision 156: so
 * the race out of READY, whose only move is into EXECUTING, is moveProposalThrough's now.
 *
 * STEP 22, decision 157: the INSERT is one of a statement that also writes the move's record;
 * see `moveProposalThrough`, which this is with one move, for a person: the brake stops agents.
 */
export async function moveProposal(
  tenant: string,
  id: string,
  from: ProposalState,
  to: ProposalState,
  actor: string,
  cause: string,
  by: ForTheRecord,
): Promise<MoveOutcome> {
  // STEP 25, decision 143: nothing enters EXECUTING one move at a time. That way in asks the
  // brake, and only moveProposalThrough, told the agent, asks it; a caller that came this way would
  // run a stopped agent's command, as a review measured. STEP 25, decision 157: before the
  // log is asked for its end, so a refused move costs nothing there.
  if (to === "EXECUTING") {
    return Object.freeze({ kind: "refused" });
  }

  return moveProposalThrough(tenant, id, [[from, to, cause]], actor, null, by);
}

/**
 * STEP 22, decision 137: several moves, one after the other, in one INSERT: all of them are
 * written, or none.
 *
 * The door moves a proposal to READY and to EXECUTING together. Written one at a time, a failure
 * between the two left a proposal READY for good, with nothing ever to carry it out, a review
 * measured. One statement leaves it where it was, or at the end of the path.
 *
 * STEP 22, decision 157: and the statement writes each move's record in the log beside it,
 * each move naming its own. Refused by the map, it writes none of them. A place in the log that
 * another record took first is tried again at the next one, by `recordTogether`.
 */
export async function moveProposalThrough(
  tenant: string,
  id: string,
  path: ReadonlyArray<readonly [from: ProposalState, to: ProposalState, cause: string]>,
  actor: string,
  // STEP 25: the agent on whose behalf the moves are made, or null for a person. Required, so
  // no caller can forget it: for an agent, none is written if a brake is on it, in the same statement,
  // so a brake pulled a moment ago is seen (DSOR-OPS-01c, decisions 142 and 143). A brake stops
  // agents, never people, so a person's moves ask nothing.
  agent: string | null,
  by: ForTheRecord,
): Promise<MoveOutcome> {
  let moved: number | undefined;

  try {
    const { rows } = await recordTogether<{ moved: number }>(
      tenant,
      path.map(([from, to, cause]) => transition(by, tenant, id, from, to, actor, cause)),
      (records) => {
        const params: unknown[] = [tenant, id, actor];
        const values = path.map(([from, to, cause], i) => {
          // The record the move names. Absent only if `recordTogether` sealed fewer records than
          // there are moves, and then NULL is what the database refuses.
          params.push(from, to, cause, records[i]?.record_id);

          const at = params.length;

          return `($1, $2, $${at - 3}, $${at - 2}, $3, $${at - 1}, $${at})`;
        });
        let moves = `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
                     VALUES ${values.join(", ")}
                     RETURNING proposal`;

        if (agent !== null) {
          params.push(agent);
          moves = `INSERT INTO dsor.proposal_moves (tenant, proposal, from_state, to_state, actor, cause, record)
                   SELECT v.tenant, v.proposal, v.from_state, v.to_state, v.actor, v.cause, v.record
                     FROM (VALUES ${values.join(", ")})
                       AS v (tenant, proposal, from_state, to_state, actor, cause, record)
                    WHERE ${noBrakeOn("$1", `$${params.length}`)}
                   RETURNING proposal`;
        }

        return {
          sql: `WITH moved AS (${moves}),
                ${theRecordsIn(records, params)}
                SELECT count(*)::int AS moved FROM moved`,
          params,
        };
      },
    );

    // STEP 25, decision 157: no rows when the reply was lost and the first record was found:
    // a record is written only beside its moves, so the moves were written.
    moved = rows === undefined ? path.length : rows[0]?.moved;
  } catch (error) {
    if (refusedByTheMap(error)) {
      return Object.freeze({ kind: "refused" });
    }

    throw error;
  }

  // A brake on the agent: no move was written, and so no record either.
  if (moved === 0) {
    return Object.freeze({ kind: "stopped" });
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
    record: string;
  }>(
    `SELECT from_state, to_state, at, actor, cause, record FROM dsor.proposal_moves
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
        record: row.record,
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

/**
 * STEP 22, decision 157: which proposal each record of a move is about, by the move that
 * names it. Every record of a move names its proposal but one: the record of its creation, made
 * before the proposal had a number. Its move names it, and that is how it is found.
 */
export async function proposalsByRecord(tenant: string): Promise<ReadonlyMap<string, string>> {
  const { rows } = await theDatabase(tenant).query<{ record: string; proposal: string }>(
    "SELECT record, proposal FROM dsor.proposal_moves WHERE tenant = $1",
    [tenant],
  );

  return new Map(rows.map((row) => [row.record, row.proposal]));
}

/** One proposal, as a list of them shows it. */
export interface ProposalSummary {
  readonly id: string;
  readonly operation: string;
  /** STEP 22, decision 157: what every record of its moves says it is about. */
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly state: ProposalState;
}

/** A company's proposals, oldest first, each with where it is now. */
export async function proposalsOf(tenant: string): Promise<readonly ProposalSummary[]> {
  const { rows } = await theDatabase(tenant).query<{
    id: string;
    operation: string;
    payload_hash: string;
    idempotency_key: string;
    state: ProposalState;
  }>(
    `SELECT p.id, p.operation, p.payload_hash, p.idempotency_key, m.to_state AS state
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
        payloadHash: row.payload_hash,
        idempotencyKey: row.idempotency_key,
        state: row.state,
      }),
    ),
  );
}
