// Proposals. Every command call that passes line ⑦ becomes a proposal: one
// record of the attempt, whose state moves only along the picture in §26.2 (DSOR-APR-01a in
// specs/dsor/03-execution.md, section 26.2), never out of a final state (DSOR-APR-01c), with one
// record of each move in the log (DSOR-APR-01b; step 22's README, decisions 1 to 4). The log is
// the place because DSOR-AUD-01 makes each move an audit record. That rule also asks each record
// to pass audit-record.schema.json, which this tutorial's records do not yet.
// The program keeps proposals in dsor.proposals (postgres.ts); the unit tests keep them in memory
// (memoryProposals below).
import { randomUUID } from "node:crypto";
import { millisecondsOf } from "./authority.ts";
import type { Correlation, Refusal } from "./envelope.ts";
import { transitionOf, type Authority, type Mover, type ProposalTransition } from "./log.ts";
import type { Principal } from "./principals.ts";

/** One of the 17 states of §26.2. */
export type State =
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

// The moves the picture of §26.2 draws, out of each state. The whole picture is here, though this
// step reaches only some of it (decision 8). The picture's last line starts with COMMITTED or
// FAILED to COMPENSATING. Both are final here, so that first move is not drawn: undoing a payment
// is a new proposal for payment.cancel (decision 1). A state with no move out is final.
const DRAWN: Readonly<Record<State, readonly State[]>> = Object.freeze({
  PROPOSED: Object.freeze(["DENIED", "READY", "PENDING_APPROVAL"] as State[]),
  DENIED: Object.freeze([] as State[]),
  // NEW IN STEP 25c: and a READY proposal may end without running: CANCELLED when its slip is torn
  // up, and EXPIRED when its company's lifetime has passed. §26.2 does not draw these two moves
  // yet. The learner proposed them (open question 90; step 25c's README, claim C1).
  READY: Object.freeze(["EXECUTING", "CANCELLED", "EXPIRED"] as State[]),
  PENDING_APPROVAL: Object.freeze(["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"] as State[]),
  APPROVED: Object.freeze([
    "EXECUTING",
    "EXPIRED",
    "REVOKED",
    "INVALIDATED",
    "CANCELLED",
  ] as State[]),
  REJECTED: Object.freeze([] as State[]),
  EXPIRED: Object.freeze([] as State[]),
  CANCELLED: Object.freeze([] as State[]),
  REVOKED: Object.freeze([] as State[]),
  INVALIDATED: Object.freeze([] as State[]),
  EXECUTING: Object.freeze(["COMMITTED", "FAILED", "OUTCOME_UNKNOWN"] as State[]),
  COMMITTED: Object.freeze([] as State[]),
  FAILED: Object.freeze([] as State[]),
  OUTCOME_UNKNOWN: Object.freeze(["COMMITTED", "FAILED"] as State[]),
  COMPENSATING: Object.freeze(["COMPENSATED", "COMPENSATION_FAILED"] as State[]),
  COMPENSATED: Object.freeze([] as State[]),
  COMPENSATION_FAILED: Object.freeze([] as State[]),
});

/** Every state of §26.2. */
export const STATES: readonly State[] = Object.freeze(Object.keys(DRAWN) as State[]);

/** True when the picture draws a move from one state to the other (DSOR-APR-01a). */
export function canMove(from: State, to: State): boolean {
  // Object.hasOwn, so a word every object knows, such as "constructor", is no state.
  return Object.hasOwn(DRAWN, from) && Object.hasOwn(DRAWN, to) && DRAWN[from].includes(to);
}

/** True for a final state: one the picture draws no move out of (DSOR-APR-01c). */
export function isFinal(state: State): boolean {
  return Object.hasOwn(DRAWN, state) && DRAWN[state].length === 0;
}

/** Who asked, as the specification's security context names it (decision 11). */
export type Requester = {
  identity_mode: "direct" | "unattended";
  subject: string;
  subject_type: string;
  actor_chain: string[];
  active_tenant: string;
  delegation?: string;
  subject_authority: { source: "token" | "role_source"; as_of: string };
};

// The two modes that make a proposal, as proposal.schema.json lists them. A dry
// run, validate_only, makes none (DSOR-OPR-06).
/** The mode a proposal was made in. */
export type ProposalMode = "execute" | "propose_only";

/** What line ⑧ writes once, and never changes: the request, the URIs it names, and who asked. */
// And the mode the call was made in.
export type ProposalDraft = {
  operation: string;
  mode: ProposalMode;
  payload: unknown;
  payload_hash: string;
  resources: string[];
  requester: Requester;
  idempotency_key: string;
};

/** One move, as a proposal's history shows it: proposal.schema.json's transitions. */
export type Transition = { from?: State; to: State; at: string; actor: string; cause: string };

/** A proposal as DSoR keeps it, in the shape of the specification's proposal.schema.json. */
export type Proposal = ProposalDraft & {
  uri: string;
  tenant: string;
  state: State;
  created_at: string;
  // NEW IN STEP 25c: when a READY proposal stops waiting: created_at plus its company's lifetime,
  // by the store's clock (step 25c's README, decisions L2 and D6).
  expires_at: string;
  transitions: Transition[];
};

/** Who makes one move, why, and in which call. */
export type MoveBy = { mover: Mover; cause: string; correlation: Correlation };

// Two parts of DSoR may move a proposal, so the store moves it only while it is still in the
// state the mover read: the check and the write are one statement (decision 6; step 21's README,
// decision 6). A move that found the proposal moved already answers false, and changes nothing.
/** Where DSoR keeps its proposals. */
export type ProposalStore = {
  // Adds a proposal in PROPOSED, with the record of that first move, both or neither.
  // NEW IN STEP 25c: and its expiry: the store's clock plus the company's lifetime, a duration
  // such as P7D (step 25c's README, decision D6).
  create: (
    tenant: string,
    id: string,
    draft: ProposalDraft,
    by: MoveBy,
    lifetime: string,
  ) => Promise<void>;
  // Moves a proposal that is still in `from` to `to`, with the move's record, both or neither.
  move: (tenant: string, id: string, from: State, to: State, by: MoveBy) => Promise<boolean>;
  // One proposal, with its history, or none.
  get: (tenant: string, id: string) => Promise<Proposal | undefined>;
  // Every proposal made under one slip that still waits: for an approval, in PENDING_APPROVAL or
  // APPROVED, and, NEW IN STEP 25c, for its release, in READY. A tear-up cancels these (DSOR-DEL-04c
  // as the learner proposed it; step 25c's README, claim C2).
  waiting: (tenant: string, delegation: string) => Promise<Waiting[]>;
  // NEW IN STEP 25c: the ids of this company's READY proposals whose expires_at has come, by the
  // store's clock, in the order of their ids. The sweep expires these (step 25c's README, claim
  // C4).
  due: (tenant: string) => Promise<string[]>;
};

// NEW IN STEP 25c: the three states the learner's DSOR-DEL-04c names, each of which the picture now
// lets move to CANCELLED. Step 25 left a READY proposal waiting, because the picture drew no move
// from READY to CANCELLED (step 25's README, decision L4; step 25c's README, claim C2).
/** A proposal that still waits, for an approval or for its release: its id, and its state. */
export type Waiting = { id: string; state: "PENDING_APPROVAL" | "APPROVED" | "READY" };

/** The canonical URI of one proposal of one company (DSOR-OPR-02a). */
export function proposalUri(tenant: string, id: string): string {
  return `dsor://${tenant}/proposal/${id}`;
}

// not copied: prop_ and a random UUID is this tutorial's form of a proposal's id (step 22's README,
// decision 10). The schema's resourceUri allows any id after the entity.
const PROPOSAL_ID = /^prop_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True when the value is the URI of a proposal of this company. */
export function isProposalOf(tenant: string, value: unknown): value is string {
  const prefix = proposalUri(tenant, "");
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    PROPOSAL_ID.test(value.slice(prefix.length))
  );
}

/** The checks both stores make before a move: the picture draws it, and someone made it for a reason. */
export function checkMove(from: State, to: State, by: MoveBy): void {
  // DSoR's own guard. The database has a second one, its trigger (decision 3).
  if (!canMove(from, to)) {
    throw new Error(`no move from ${from} to ${to} in the picture of section 26.2`);
  }
  // A record must name its actor and its cause (DSOR-APR-01b), so a move without one is a bug.
  if (by.cause.trim() === "") throw new Error("a move needs a cause");
  if (by.mover.subject.trim() === "") throw new Error("a move needs an actor");
}

/** The actor's name in a proposal's history: the agent that acted, or the person, or DSoR. */
export function actorOf(mover: Mover): string {
  return mover.actor_chain.at(-1) ?? mover.subject;
}

/** One move, as a history shows it, from its record. */
export function transitionFrom(
  record: Pick<ProposalTransition, "result" | "reason" | "identity" | "extensions"> & {
    at: string;
  },
): Transition {
  // This tutorial's own namespace, by name, never the first one there (DSOR-SCH-02). Found by
  // the review.
  const from = record.extensions?.["org.panaversity.steps"]?.from as State | undefined;
  return {
    ...(from === undefined ? {} : { from }),
    to: record.result as State,
    at: record.at,
    actor: actorOf(record.identity),
    cause: record.reason,
  };
}

// A store for a call that makes no proposal, such as a query. Any write is a bug.
/** A store that holds no proposal and makes none. */
export const NO_PROPOSALS: ProposalStore = Object.freeze({
  create: async (): Promise<never> => {
    throw new Error("this call makes no proposal");
  },
  move: async (): Promise<never> => {
    throw new Error("this call makes no proposal");
  },
  get: async () => undefined,
  // And none that waits.
  waiting: async () => [],
  // NEW IN STEP 25c: and none that is due.
  due: async () => [],
});

/** A record kept in memory: the record, its id, its place in the log, and its time. */
export type KeptTransition = ProposalTransition & {
  record_id: string;
  sequence: number;
  at: string;
};

/** Proposals in memory, with every record of their moves and every proposal, for the tests. */
export type MemoryProposals = ProposalStore & {
  transitions: () => Promise<KeptTransition[]>;
  all: () => Promise<Proposal[]>;
};

// One proposal in memory, without its history, which the records hold.
type Row = ProposalDraft & {
  tenant: string;
  id: string;
  state: State;
  created_at: string;
  // NEW IN STEP 25c: and its expiry.
  expires_at: string;
};

/** Proposals in memory, for the unit tests. Like the database, a move and its record are made together. */
// NEW IN STEP 25c: by this clock, which a test can move on, as memoryReservations takes one.
export function memoryProposals(now: () => number = Date.now): MemoryProposals {
  const rows = new Map<string, Row>();
  const records: KeptTransition[] = [];
  const keyOf = (tenant: string, id: string): string => JSON.stringify([tenant, id]);
  const record = (made: ProposalTransition): void => {
    records.push({
      ...made,
      record_id: `aud_${randomUUID()}`,
      sequence: records.length + 1,
      at: new Date(now()).toISOString(),
    });
  };
  const shown = (row: Row): Proposal => {
    const uri = proposalUri(row.tenant, row.id);
    const { tenant, id: _id, ...draft } = structuredClone(row);
    const transitions = records
      .filter((kept) => kept.tenant === tenant && kept.resources[0] === uri)
      .map(transitionFrom);
    return { uri, tenant, ...draft, transitions };
  };
  return Object.freeze({
    create: async (
      tenant: string,
      id: string,
      draft: ProposalDraft,
      by: MoveBy,
      lifetime: string,
    ): Promise<void> => {
      if (by.cause.trim() === "") throw new Error("a move needs a cause");
      // NEW IN STEP 25c: the database's CHECK keeps an expiry after created_at and within 30
      // days of it, so memory refuses the same lifetimes (step 25c's README, decision D6).
      const life = millisecondsOf(lifetime);
      if (life <= 0 || life > 30 * 24 * 60 * 60 * 1000) {
        throw new Error(
          `a lifetime of ${JSON.stringify(lifetime)} is not more than zero and at most 30 days`,
        );
      }
      if (by.mover.subject.trim() === "") throw new Error("a move needs an actor");
      // The database's primary key refuses a second proposal with one id, so memory does too.
      if (rows.has(keyOf(tenant, id))) throw new Error(`a second proposal with the id ${id}`);
      // A copy, so a caller that changes its draft afterwards cannot change the proposal.
      const made = now();
      const row: Row = {
        tenant,
        id,
        state: "PROPOSED",
        created_at: new Date(made).toISOString(),
        // NEW IN STEP 25c: its expiry, by the same clock.
        expires_at: new Date(made + life).toISOString(),
        ...structuredClone(draft),
      };
      rows.set(keyOf(tenant, id), row);
      const uri = proposalUri(tenant, id);
      record(
        transitionOf(
          tenant,
          uri,
          draft.operation,
          undefined,
          "PROPOSED",
          by.mover,
          by.cause,
          by.correlation,
        ),
      );
    },
    move: async (
      tenant: string,
      id: string,
      from: State,
      to: State,
      by: MoveBy,
    ): Promise<boolean> => {
      checkMove(from, to, by);
      const row = rows.get(keyOf(tenant, id));
      // Only while it is still in `from`, as the database's UPDATE … WHERE state checks.
      if (row === undefined || row.state !== from) return false;
      row.state = to;
      const uri = proposalUri(tenant, id);
      record(
        transitionOf(tenant, uri, row.operation, from, to, by.mover, by.cause, by.correlation),
      );
      return true;
    },
    get: async (tenant: string, id: string): Promise<Proposal | undefined> => {
      const row = rows.get(keyOf(tenant, id));
      return row === undefined ? undefined : shown(row);
    },
    // As the database's SELECT does it: this company, this slip, these two states.
    waiting: async (tenant: string, delegation: string): Promise<Waiting[]> => {
      const found: Waiting[] = [];
      for (const row of rows.values()) {
        if (row.tenant !== tenant || row.requester.delegation !== delegation) continue;
        // NEW IN STEP 25c: READY too.
        if (row.state === "PENDING_APPROVAL" || row.state === "APPROVED" || row.state === "READY") {
          found.push({ id: row.id, state: row.state });
        }
      }
      // NEW IN STEP 25c: in the order of their ids, as the database's ORDER BY gives them. Found by
      // step 25c's review: memory gave them in the order they were made.
      return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    // NEW IN STEP 25c: as the database's SELECT does it: this company, READY, and its time come.
    due: async (tenant: string): Promise<string[]> => {
      const at = now();
      return [...rows.values()]
        .filter((row) => row.tenant === tenant && row.state === "READY")
        .filter((row) => Date.parse(row.expires_at) <= at)
        .map((row) => row.id)
        .sort();
    },
    transitions: async (): Promise<KeptTransition[]> => structuredClone(records),
    all: async (): Promise<Proposal[]> => [...rows.values()].map(shown),
  });
}

/** Who asked, from line ①'s caller and line ③'s slip, at this time (decision 11). */
export function requesterOf(
  caller: Principal,
  under: Authority | undefined,
  tenant: string,
  now: string,
): Requester {
  // An agent asks under a slip, so the person who signed it is the subject, and the agent acts.
  if (under !== undefined) {
    return {
      identity_mode: "unattended",
      subject: under.subject,
      subject_type: "human",
      actor_chain: [under.actor],
      active_tenant: tenant,
      delegation: under.delegation,
      subject_authority: { source: under.source, as_of: under.as_of },
    };
  }
  // A person asks for herself, with the login DSoR gave her: what she holds comes from DSoR's own
  // table, which the token names, at the time of the call.
  return {
    identity_mode: "direct",
    subject: caller.id,
    subject_type: caller.type,
    actor_chain: [],
    active_tenant: tenant,
    subject_authority: { source: "token", as_of: now },
  };
}

/** The caller, as the mover of a proposal's first move. */
export function callerMover(requester: Requester): Mover {
  return {
    mode: requester.identity_mode,
    subject: requester.subject,
    actor_chain: [...requester.actor_chain],
    subject_authority: { ...requester.subject_authority },
  };
}

/** DSoR itself, as the mover of the moves it makes, on the authority the call carried. */
export function dsorMover(requester: Requester): Mover {
  return {
    mode: "direct",
    subject: "dsor",
    actor_chain: [],
    subject_authority: { ...requester.subject_authority },
  };
}

/** Every URI the request names, each once, in the order it first appears. */
export function urisIn(payload: unknown): string[] {
  const found: string[] = [];
  // A list of values still to look at, as tenants.ts walks an input: no stack to run out of.
  const todo: unknown[] = [payload];
  while (todo.length > 0) {
    const value = todo.shift();
    if (typeof value === "string") {
      if (value.startsWith("dsor://") && !found.includes(value)) found.push(value);
    } else if (typeof value === "object" && value !== null) {
      todo.push(...Object.values(value));
    }
  }
  return found;
}

// Line ⑧ and the proposal's last move, which the claim runs around the code (decision 9).
/** What line ⑧ needs to know to open a proposal. */
export type Opening = {
  tenant: string;
  draft: ProposalDraft;
  correlation: Correlation;
  // NEW IN STEP 25c: and the company's READY lifetime, from ready-lifetimes.json, which sets the
  // proposal's expiry (step 25c's README, decisions L2 and D2).
  lifetime: string;
};

// What opening a proposal gave: its URI, and the refusal that ended it DENIED,
// when lines ⑨ and ⑩ refused it (step 24's README, decision 6).
/** What line ⑧ opened: the proposal's URI, and the refusal that ended it DENIED, if one did. */
export type Opened = { proposal: string; refused?: Refusal };

/**
 * Line ⑧: makes the proposal, PROPOSED. Then `decide` runs lines ⑨ and ⑩. When it answers with a
 * refusal, the proposal moves to DENIED, and the refusal comes back. Otherwise the proposal moves
 * to READY, and in execute mode on to EXECUTING, where the work starts. In propose_only mode it
 * waits at READY for proposal.execute.
 */
// READY and EXECUTING come after lines ⑨ and ⑩ now, where §21 puts them. Step 22
// made both moves at line ⑧, before any check could deny the call (step 22's README, decision 12;
// step 24's README, decision 6).
export async function openProposal(
  store: ProposalStore,
  opening: Opening,
  decide: (proposal: string) => Promise<Refusal | undefined>,
): Promise<Opened> {
  const { tenant, draft, correlation } = opening;
  const id = `prop_${randomUUID()}`;
  const dsor = dsorMover(draft.requester);
  const operation = draft.operation.split("@")[0] ?? draft.operation;
  await store.create(
    tenant,
    id,
    draft,
    { mover: callerMover(draft.requester), cause: `${operation} called`, correlation },
    opening.lifetime,
  );
  const refused = await decide(proposalUri(tenant, id));
  if (refused !== undefined) {
    await moveOrFail(store, tenant, id, "PROPOSED", "DENIED", {
      mover: dsor,
      cause: `the checks refused it: ${refused.code}`,
      correlation,
    });
    return { proposal: proposalUri(tenant, id), refused };
  }
  await moveOrFail(store, tenant, id, "PROPOSED", "READY", {
    mover: dsor,
    cause: "no control asks for an approval: controls are not built yet",
    correlation,
  });
  // A proposal made in propose_only mode waits here. Nothing moves it on until
  // proposal.execute, which step 31 builds (§26.2, READY; step 23's README, decision 1).
  if (draft.mode === "propose_only") return { proposal: proposalUri(tenant, id) };
  await moveOrFail(store, tenant, id, "READY", "EXECUTING", {
    mover: dsor,
    cause: "execute mode: the work starts",
    correlation,
  });
  return { proposal: proposalUri(tenant, id) };
}

// A reservation is keyed by the proposal's id (DSOR-DEL-06b).
/** The id of one of this company's proposals, from its URI. Any other text is a bug. */
export function proposalIdOf(tenant: string, uri: string): string {
  if (!isProposalOf(tenant, uri)) throw new Error("a call's proposal is not one of its company's");
  return uri.slice(proposalUri(tenant, "").length);
}

/** The proposal's last move: COMMITTED when the code answered, FAILED when it refused (decision 2). */
export async function closeProposal(
  store: ProposalStore,
  opening: Opening,
  uri: string,
  outcome: { value: unknown } | { refused: { code: string } },
): Promise<void> {
  const { tenant, draft, correlation } = opening;
  // The claim's own proposal, of this company, or a bug. Found by the review: the id was cut out
  // of the URI by its length, without a look at the URI.
  if (!isProposalOf(tenant, uri)) throw new Error("a claim's proposal is not one of its company's");
  const id = uri.slice(proposalUri(tenant, "").length);
  const ended = "value" in outcome;
  await moveOrFail(store, tenant, id, "EXECUTING", ended ? "COMMITTED" : "FAILED", {
    mover: dsorMover(draft.requester),
    cause: ended ? "the work ended" : `the code refused: ${outcome.refused.code}`,
    correlation,
  });
}

// Nothing but this call moves its own proposal inside its claim, so a move that finds the
// proposal moved already is a fault in DSoR, and the call fails with INTERNAL_ERROR.
async function moveOrFail(
  store: ProposalStore,
  tenant: string,
  id: string,
  from: State,
  to: State,
  by: MoveBy,
): Promise<void> {
  if (!(await store.move(tenant, id, from, to, by))) {
    throw new Error(`the proposal ${id} was no longer ${from}`);
  }
}
