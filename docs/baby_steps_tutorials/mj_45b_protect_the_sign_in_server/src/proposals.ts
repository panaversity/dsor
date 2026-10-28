// Proposals. Every command call that passes line ⑦ becomes a proposal: one
// record of the attempt, whose state moves only along the picture in §26.2 (DSOR-APR-01a in
// specs/dsor/03-execution.md, section 26.2), never out of a final state (DSOR-APR-01c), with one
// record of each move in the log (DSOR-APR-01b; step 22's README, decisions 1 to 4). The log is
// the place because DSOR-AUD-01 makes each move an audit record. That rule also asks each record
// to pass audit-record.schema.json, which this tutorial's records do not yet.
// The program keeps proposals in dsor.proposals (postgres.ts); the unit tests keep them in memory
// (memoryProposals below).
import { randomUUID } from "node:crypto";
import { approvalOf, stillOpen, type Approval, type Approving, type Offer } from "./approvals.ts";
import { millisecondsOf } from "./authority.ts";
import type { Alert } from "./alerts.ts";
import type { Correlation, Refusal, Requirement } from "./envelope.ts";
import { transitionOf, type Authority, type Mover, type ProposalTransition } from "./log.ts";
import type { Principal } from "./principals.ts";
import type { Money } from "./money.ts";
import type { RunTotals, VendorTotal } from "./run.ts";

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
  // And a READY proposal may end without running: CANCELLED when its slip is torn
  // up, and EXPIRED when its company's lifetime has passed. §26.2 does not draw these two moves
  // yet. The learner proposed them (open question 90; step 25c's README, claim C1).
  // And INVALIDATED, when the check again at its release says no: a rule switched
  //   on since asks for an approval, or another check fails. §26.2 does not draw this move; DSOR-
  //   APR-03c asks for it (step 31's README, decision D6).
  READY: Object.freeze(["EXECUTING", "CANCELLED", "EXPIRED", "INVALIDATED"] as State[]),
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
  // And the address of the record its operation is exclusive over, when its
  //   contract names one. It is the store's own key, not a field of proposal.schema.json, so a
  //   proposal never shows it: two proposals in flight for one operation over one record cannot
  //   both be kept (DSOR-EXC-01; step 32's README, decision D7).
  exclusive_over?: string;
  // For a line of a run, the run's address, and for a run, the fingerprint of its
  //   lines in their order: proposal.schema.json's manifest_hash (DSOR-BAT-01b, DSOR-BAT-02a; step
  //   41's README, decisions D4 and D5). Written once, with the proposal.
  run?: string;
  manifest_hash?: string;
  // And the address of the waiting proposal this one replaces, from the call's
  //   envelope: proposal.schema.json's supersedes. Written once, with the proposal, beside its
  //   payload, never inside it (DSOR-APR-12; step 41b's README, decisions D4 and D9).
  supersedes?: string;
};

/** One move, as a proposal's history shows it: proposal.schema.json's transitions. */
export type Transition = { from?: State; to: State; at: string; actor: string; cause: string };

/** A proposal as DSoR keeps it, in the shape of the specification's proposal.schema.json. */
export type Proposal = ProposalDraft & {
  uri: string;
  tenant: string;
  state: State;
  // What it waits for, once line ⑩ stopped it at PENDING_APPROVAL: the schema's
  // own requires (step 29's README, decision D4).
  requires?: Requirement[];
  // And the ids of its approvals, once it has one: the schema's own approvals
  // (decision D8).
  approvals?: string[];
  // For a run, its totals per currency, proposal.schema.json's totals, and per
  //   vendor, which the schema has no field for, so the name is this tutorial's. Written once, when
  //   the run leaves PROPOSED (DSOR-BAT-02a; step 41's README, decision D4).
  totals?: Money[];
  vendor_totals?: VendorTotal[];
  created_at: string;
  // When a READY proposal stops waiting: created_at plus its company's lifetime,
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
  // And its expiry: the store's clock plus the company's lifetime, a duration
  // such as P7D (step 25c's README, decision D6).
  create: (
    tenant: string,
    id: string,
    draft: ProposalDraft,
    by: MoveBy,
    lifetime: string,
  ) => Promise<void>;
  // Moves a proposal that is still in `from` to `to`, with the move's record, both or neither.
  // And the move to PENDING_APPROVAL names what the proposal waits for, which
  // is written then, and never again (step 29's README, decision D4).
  move: (
    tenant: string,
    id: string,
    from: State,
    to: State,
    by: MoveBy,
    requires?: Requirement[],
    // And a run's totals, written once, on its move out of PROPOSED to wait.
    totals?: RunTotals,
  ) => Promise<boolean>;
  // One proposal, with its history, or none.
  get: (tenant: string, id: string) => Promise<Proposal | undefined>;
  // Every proposal made under one slip that still waits: for an approval, in PENDING_APPROVAL or
  // APPROVED, and, since step 25c, for its release, in READY. A tear-up cancels these (DSOR-DEL-04c
  // as the learner proposed it; step 25c's README, claim C2).
  waiting: (tenant: string, delegation: string) => Promise<Waiting[]>;
  // This company's READY proposals whose expires_at has come, by the store's clock, in the order
  // of their ids. The sweep expires these (step 25c's README, claim C4). And its
  // PENDING_APPROVAL ones, each with its state, which the sweep's move starts from (step 27's
  // README, decision D11). And its APPROVED ones (step 29's README, decision D11).
  due: (tenant: string) => Promise<Due[]>;
  // One approval and, when it is the last one the proposal waits for, the move to
  // APPROVED, with its record: one step, while no other approval, tear-up, or sweep of the company
  // runs. It approves only a PENDING_APPROVAL proposal whose time has not come (step 29's README,
  // decisions D8, D9, and D11).
  approve: (tenant: string, id: string, offer: Offer, by: MoveBy) => Promise<Approving>;
  // And every approval of one proposal, in the order they were given.
  approvals: (tenant: string, id: string) => Promise<Approval[]>;
  // And whether one proposal's time has come, by the store's own clock, which the sweep and the
  // approval's step read too. Line ⑨'s look asks it, so a dry run hears what the real call hears.
  // Found by step 29's review, finding L2.
  isDue: (tenant: string, id: string) => Promise<boolean>;
  // And every proposal of the company in flight whose request names this record,
  //   by its address, in the order of their ids. Line ⑨ counts them as spent, and refuses a second
  //   attempt of the same operation (DSOR-EXC-01, DSOR-EXC-02; step 32's README, decisions D7 and
  //   D9).
  inFlightOver: (tenant: string, uri: string) => Promise<InFlight[]>;
  // And the lines of one run, each with its state and its invoice, in the order of
  //   their ids: an approval and a release move them with their run (step 41's README, claim C6).
  lines: (tenant: string, run: string) => Promise<RunLineState[]>;
  // And the lock of one operation over one record, held alone until the claim
  //   ends, so two attempts over one invoice look one after the other (step 32's README, D7).
  holdOver: (tenant: string, operation: string, uri: string) => Promise<void>;
  // And the company's ending lock, which a tear-up, the sweep, an approval, and now
  //   a replacement take before they move a waiting proposal or give its booking back. A release
  //   takes none: its move to EXECUTING, and a replacement's move to CANCELLED, each check the state
  //   they read, so of the two, one moves it and the other hears CONFLICT. Held alone until the claim
  //   ends (step 25c's README, decision D13; step 41b's review, M2).
  holdEnding: (tenant: string) => Promise<void>;
  // And the address of the proposal that replaced this one, or none. A refused
  //   replacement ended DENIED, and replaced nothing, so it is never the answer (step 41b's README,
  //   decision D8).
  replacedBy: (tenant: string, uri: string) => Promise<string | undefined>;
  // And the company's alerts, in the order they were raised. The move to
  //   OUTCOME_UNKNOWN raises one and the move out of it closes it, both with the move's record, so
  //   every path raises it and no settlement leaves it open (DSOR-UNK-04b; step 38b's README,
  //   decisions D1, D5, and D6).
  alerts: (tenant: string) => Promise<Alert[]>;
  // And the escalation of each of the company's open alerts raised at least `afterMs` before the
  //   store's clock, to this person, once each: the alerts it escalated, in the order of their
  //   proposals' ids (DSOR-UNK-04c; step 38b's README, decisions D3 and D4).
  escalateDue: (tenant: string, afterMs: number, to: string) => Promise<Alert[]>;
  // And a page of the company's unsettled alerts in these states, in the order
  //   of their proposals' ids, after this id, at most this many: what alert.list reads, so a
  //   call never reads the company's whole history (found by step 38c's review).
  unsettled: (
    tenant: string,
    states: readonly ("open" | "escalated")[],
    after: string | undefined,
    count: number,
  ) => Promise<Alert[]>;
};

// The five states of §25.1's "in flight": the proposal may still run, or it runs.
/** The states of a proposal in flight (§25.1). */
export const IN_FLIGHT: readonly State[] = Object.freeze([
  "READY",
  "PENDING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "OUTCOME_UNKNOWN",
] as State[]);

/** One line of a run: its proposal's id, its state, and the invoice it drafts. */
export type RunLineState = { id: string; state: State; invoice: string };

/** A proposal in flight over a record: its id, its operation with its version, and its state. */
export type InFlight = { id: string; operation: string; state: State };

// A proposal whose time has come, and the state it waited in (step 27's README,
// decision D11).
// And an APPROVED one, which waits for step 31's proposal.execute. Its approval
// expires with it (DSOR-APR-04a; step 29's README, decision D11).
/** A proposal the sweep expires: its id, and the state it waited in. */
export type Due = { id: string; state: "PENDING_APPROVAL" | "READY" | "APPROVED" };

// The three states the learner's DSOR-DEL-04c names, each of which the picture now
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

/** The check both stores make of what a move writes of what the proposal waits for: on the move to PENDING_APPROVAL, and only then. */
export function checkRequires(from: State, to: State, requires: Requirement[] | undefined): void {
  const starts = from === "PROPOSED" && to === "PENDING_APPROVAL";
  if (starts && (requires === undefined || requires.length === 0)) {
    throw new Error("a proposal that waits for an approval names what it waits for");
  }
  if (!starts && requires !== undefined) {
    throw new Error("what a proposal waits for is written once, when it starts to wait");
  }
}

/**
 * The check both stores make of a run's totals: written once, on a run's move out of
 * PROPOSED to wait, PENDING_APPROVAL or READY, and never on anything else (step 41's README, C5).
 */
export function checkTotals(
  from: State,
  to: State,
  isRun: boolean,
  totals: RunTotals | undefined,
): void {
  const waits = from === "PROPOSED" && (to === "PENDING_APPROVAL" || to === "READY");
  if (isRun && waits && totals === undefined) {
    throw new Error("a run that waits keeps its totals");
  }
  if ((!isRun || !waits) && totals !== undefined) {
    throw new Error("a run's totals are written once, when it starts to wait");
  }
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
  // And none that is due.
  due: async () => [],
  // And approves none.
  approve: async (): Promise<never> => {
    throw new Error("this call approves no proposal");
  },
  approvals: async () => [],
  isDue: async () => false,
  // And none in flight, and no lock.
  inFlightOver: async () => [],
  // And no run's lines.
  lines: async () => [],
  holdOver: async () => {},
  holdEnding: async () => {},
  replacedBy: async () => undefined,
  // And no alert, and escalates none.
  alerts: async () => [],
  escalateDue: async (): Promise<never> => {
    throw new Error("this call makes no proposal");
  },
  unsettled: async () => [],
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
  // And the undo of what one call did to one proposal, which memory's claims call
  //   after an accident, as the database's rollback undoes it: the records that call wrote are
  //   dropped, and the proposal goes back to the state of its last record left. A proposal that
  //   call made, with no record left, is gone. A proposal left EXECUTING would now hold its invoice
  //   for ever. Found by step 32's review, finding M1: the first undo deleted an approved proposal,
  //   its whole history, when its release had an accident (step 32's README, decision D14).
  undo: (uri: string, requestId: string) => Promise<"kept" | "restored" | "gone">;
};

// One proposal in memory, without its history, which the records hold.
type Row = ProposalDraft & {
  tenant: string;
  id: string;
  state: State;
  created_at: string;
  // And its expiry.
  expires_at: string;
  // And what it waits for, once it waits.
  requires?: Requirement[];
  // And a run's totals, once it waits.
  totals?: Money[];
  vendor_totals?: VendorTotal[];
};

/** Proposals in memory, for the unit tests. Like the database, a move and its record are made together. */
// By this clock, which a test can move on, as memoryReservations takes one.
export function memoryProposals(now: () => number = Date.now): MemoryProposals {
  const rows = new Map<string, Row>();
  const records: KeptTransition[] = [];
  // Every approval, in the order they were given.
  const given: Approval[] = [];
  const approvalsOf = (tenant: string, uri: string): Approval[] =>
    given.filter((approval) => approval.tenant === tenant && approval.proposal === uri);
  const keyOf = (tenant: string, id: string): string => JSON.stringify([tenant, id]);
  // Who each escalated alert went to, and when, by company and proposal.
  const escalations = new Map<string, { to: string; at: string }>();
  // The company's alerts now, read from the moves' records, so an undone move undoes its alert
  //   too, as the database's rollback does. Only the escalation is kept apart.
  const alertsNow = (tenant: string): Alert[] => {
    const found: Alert[] = [];
    for (const row of rows.values()) {
      if (row.tenant !== tenant) continue;
      const { transitions } = shown(row);
      const raised = transitions.find((t) => t.to === "OUTCOME_UNKNOWN");
      if (raised === undefined) continue;
      const closed = transitions.find((t) => t.from === "OUTCOME_UNKNOWN");
      const escalated = escalations.get(keyOf(tenant, row.id));
      const state = closed !== undefined ? "closed" : escalated ? "escalated" : "open";
      found.push({
        tenant_id: row.tenant,
        proposal: row.id,
        state,
        raised_at: raised.at,
        ...(escalated === undefined
          ? {}
          : { escalated_to: escalated.to, escalated_at: escalated.at }),
        ...(closed === undefined
          ? {}
          : { outcome: closed.to as "COMMITTED" | "FAILED", closed_at: closed.at }),
      });
    }
    return found.sort(
      (a, b) => a.raised_at.localeCompare(b.raised_at) || a.proposal.localeCompare(b.proposal),
    );
  };
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
    const { tenant, id: _id, exclusive_over: _exclusive, ...draft } = structuredClone(row);
    const transitions = records
      .filter((kept) => kept.tenant === tenant && kept.resources[0] === uri)
      .map(transitionFrom);
    // And the ids of its approvals, once it has one.
    const ids = approvalsOf(tenant, uri).map((approval) => approval.id);
    return { uri, tenant, ...draft, ...(ids.length > 0 ? { approvals: ids } : {}), transitions };
  };
  const store: MemoryProposals = Object.freeze({
    create: async (
      tenant: string,
      id: string,
      draft: ProposalDraft,
      by: MoveBy,
      lifetime: string,
    ): Promise<void> => {
      if (by.cause.trim() === "") throw new Error("a move needs a cause");
      // The database's CHECK keeps an expiry after created_at and within 30
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
        // Its expiry, by the same clock.
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
      requires?: Requirement[],
      totals?: RunTotals,
    ): Promise<boolean> => {
      checkMove(from, to, by);
      checkRequires(from, to, requires);
      const row = rows.get(keyOf(tenant, id));
      // Only while it is still in `from`, as the database's UPDATE … WHERE state checks.
      if (row === undefined || row.state !== from) return false;
      checkTotals(from, to, row.manifest_hash !== undefined, totals);
      // The database's key proposals_one_attempt, in memory: no second proposal in
      //   flight for one operation over one record (DSOR-EXC-01; step 32's README, decision D7).
      if (row.exclusive_over !== undefined && IN_FLIGHT.includes(to)) {
        const name = row.operation.split("@")[0];
        for (const other of rows.values()) {
          if (other === row || other.tenant !== tenant || !IN_FLIGHT.includes(other.state))
            continue;
          if (
            other.exclusive_over === row.exclusive_over &&
            other.operation.split("@")[0] === name
          ) {
            throw new Error(
              `two proposals of ${name} would be in flight over ${row.exclusive_over}`,
            );
          }
        }
      }
      row.state = to;
      // A copy, so a caller that changes its list afterwards cannot change the proposal.
      if (requires !== undefined) row.requires = structuredClone(requires);
      if (totals !== undefined) {
        row.totals = structuredClone(totals.totals);
        row.vendor_totals = structuredClone(totals.vendor_totals);
      }
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
        // READY too.
        if (row.state === "PENDING_APPROVAL" || row.state === "APPROVED" || row.state === "READY") {
          found.push({ id: row.id, state: row.state });
        }
      }
      // In the order of their ids, as the database's ORDER BY gives them. Found by
      // step 25c's review: memory gave them in the order they were made.
      return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    // Outside a claim, as in a dry run, no lock is held. Memory's claims hold the
    //   lock themselves, until the claim ends (src/claims.ts).
    holdOver: async (): Promise<void> => {},
    // And no ending lock either, outside a claim.
    holdEnding: async (): Promise<void> => {},
    // As the database's SELECT does it: this company, a proposal that names it in
    //   supersedes and was not refused.
    replacedBy: async (tenant: string, uri: string): Promise<string | undefined> => {
      for (const row of rows.values()) {
        if (row.tenant !== tenant || row.supersedes !== uri || row.state === "DENIED") continue;
        return proposalUri(row.tenant, row.id);
      }
      return undefined;
    },
    // As the database's SELECT does it: this company, a state in flight, and the
    //   record's address among the request's, in the order of their ids.
    inFlightOver: async (tenant: string, uri: string): Promise<InFlight[]> => {
      const found: InFlight[] = [];
      for (const row of rows.values()) {
        if (row.tenant !== tenant || !IN_FLIGHT.includes(row.state)) continue;
        if (row.resources.includes(uri)) {
          found.push({ id: row.id, operation: row.operation, state: row.state });
        }
      }
      return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    // As the database's SELECT does it: this company, the run's lines, in the order of their ids.
    lines: async (tenant: string, run: string): Promise<RunLineState[]> => {
      const found: RunLineState[] = [];
      for (const row of rows.values()) {
        if (row.tenant !== tenant || row.run !== run) continue;
        const { invoice } = row.payload as { invoice: string };
        found.push({ id: row.id, state: row.state, invoice });
      }
      return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    // As the database's SELECT does it: this company, READY or, since step 27, PENDING_APPROVAL,
    // and its time come. Or APPROVED.
    due: async (tenant: string): Promise<Due[]> => {
      const at = now();
      const found: Due[] = [];
      for (const row of rows.values()) {
        if (row.tenant !== tenant || Date.parse(row.expires_at) > at) continue;
        if (row.state === "READY" || row.state === "PENDING_APPROVAL" || row.state === "APPROVED") {
          found.push({ id: row.id, state: row.state });
        }
      }
      return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    // The approval and the move, with no await between them, so no other call
    // runs in between, as the database's ending lock keeps them apart (step 29's README, decision
    // D9).
    approve: async (tenant: string, id: string, offer: Offer, by: MoveBy): Promise<Approving> => {
      checkMove("PENDING_APPROVAL", "APPROVED", by);
      const row = rows.get(keyOf(tenant, id));
      if (row === undefined) return { refused: "moved" };
      if (row.state !== "PENDING_APPROVAL") return { refused: "moved", state: row.state };
      // The move to PENDING_APPROVAL wrote it, and nothing clears it (step 29's README, decision D4).
      if (row.requires === undefined) throw new Error("a waiting proposal names what it waits for");
      // Its time has come, by the store's clock, though no sweep has moved it yet.
      if (Date.parse(row.expires_at) <= now()) return { refused: "expired" };
      const uri = proposalUri(tenant, id);
      const before = approvalsOf(tenant, uri);
      const { operation, resources, payload_hash, expires_at, requires } = row;
      const bindable = { uri, tenant, operation, resources, payload_hash, expires_at, requires };
      const made = approvalOf(bindable, before, offer);
      if (typeof made === "string") return { refused: made };
      given.push(made);
      const waits_for = stillOpen(requires, [...before, made]);
      if (waits_for.length > 0) {
        return { approval: structuredClone(made), state: "PENDING_APPROVAL", waits_for };
      }
      row.state = "APPROVED";
      record(
        transitionOf(
          tenant,
          uri,
          operation,
          "PENDING_APPROVAL",
          "APPROVED",
          by.mover,
          by.cause,
          by.correlation,
        ),
      );
      return { approval: structuredClone(made), state: "APPROVED", waits_for };
    },
    approvals: async (tenant: string, id: string): Promise<Approval[]> =>
      structuredClone(approvalsOf(tenant, proposalUri(tenant, id))),
    // By the store's clock, as due reads it.
    isDue: async (tenant: string, id: string): Promise<boolean> => {
      const row = rows.get(keyOf(tenant, id));
      return row !== undefined && Date.parse(row.expires_at) <= now();
    },
    // The alerts, read from the moves' records, so an undone move undoes its
    //   alert too, as the database's rollback does. Only the escalation is kept apart.
    alerts: async (tenant: string): Promise<Alert[]> => alertsNow(tenant),
    // By the store's clock, as due reads it. Only an open alert, once each: read and changed with
    //   no wait between, so of three sweeps at once, one escalates it (found by step 38b's review,
    //   M4: each read first, then each escalated it).
    escalateDue: async (tenant: string, afterMs: number, to: string): Promise<Alert[]> => {
      const at = new Date(now()).toISOString();
      const escalated: Alert[] = [];
      for (const alert of alertsNow(tenant)) {
        if (alert.state !== "open" || Date.parse(alert.raised_at) + afterMs > now()) continue;
        escalations.set(keyOf(tenant, alert.proposal), { to, at });
        escalated.push({ ...alert, state: "escalated", escalated_to: to, escalated_at: at });
      }
      // In the order of their proposals' ids, as the database's answer is sorted.
      return escalated.sort((a, b) => a.proposal.localeCompare(b.proposal));
    },
    // < compares text by its character codes, as the database's C.UTF-8 does,
    //   and as invoice.list's memory does.
    unsettled: async (tenant, states, after, count): Promise<Alert[]> =>
      alertsNow(tenant)
        .filter((alert) => (states as readonly string[]).includes(alert.state))
        .filter((alert) => after === undefined || alert.proposal > after)
        .sort((a, b) => (a.proposal < b.proposal ? -1 : a.proposal > b.proposal ? 1 : 0))
        .slice(0, count),
    transitions: async (): Promise<KeptTransition[]> => structuredClone(records),
    all: async (): Promise<Proposal[]> => [...rows.values()].map(shown),
    undo: async (uri: string, requestId: string): Promise<"kept" | "restored" | "gone"> => {
      const mine = (made: KeptTransition): boolean =>
        made.resources[0] === uri && made.correlation.request_id === requestId;
      const undone = records.filter(mine);
      if (undone.length === 0) return "kept";
      records.splice(0, records.length, ...records.filter((made) => !mine(made)));
      const entry = [...rows.entries()].find(([, row]) => proposalUri(row.tenant, row.id) === uri);
      if (entry === undefined) return "gone";
      const [key, row] = entry;
      const left = records.filter((made) => made.resources[0] === uri);
      if (left.length === 0) {
        rows.delete(key);
        return "gone";
      }
      row.state = left.at(-1)!.result as State;
      // What it waits for was written by the move to PENDING_APPROVAL: undone with it.
      if (undone.some((made) => made.result === "PENDING_APPROVAL")) delete row.requires;
      return "restored";
    },
  });
  return store;
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
  // A person's comes from her company's lookup, which line ② asked, as of its
  // answer. A system login's still comes from DSoR's own table (step 45's README, C2 and D6).
  return {
    identity_mode: "direct",
    subject: caller.id,
    subject_type: caller.type,
    actor_chain: [],
    active_tenant: tenant,
    subject_authority: caller.authority ?? { source: "token", as_of: now },
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
  // And the company's READY lifetime, from ready-lifetimes.json, which sets the
  // proposal's expiry (step 25c's README, decisions L2 and D2).
  lifetime: string;
};

// What a proposal that waits for an approval answers: what it requires, and when it
// expires, its own expires_at (step 27's README, decision D10).
/** A proposal waiting at PENDING_APPROVAL: the approvals it requires, and when it expires. */
export type Pending = { requires: Requirement[]; expires_at: string };

// What opening a proposal gave: its URI, and the refusal that ended it DENIED,
// when lines ⑨ and ⑩ refused it (step 24's README, decision 6). Since step 27, or what it waits for.
// What lines ⑨ and ⑩ decided of a request that may go on: what it waits for, when a
//   control asks for an approval, and, for a run, its totals (step 41's README, claim C5).
/** What lines ⑨ and ⑩ let through: the approvals asked for, if any, and a run's totals. */
export type Decided = { requires?: Requirement[]; totals?: RunTotals };

/** What line ⑧ opened: the proposal's URI, and the refusal that ended it DENIED, or what it waits for. */
export type Opened = { proposal: string; refused?: Refusal; pending?: Pending };

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
  // And the approvals a control asks for, which stop the proposal at
  // PENDING_APPROVAL (step 27's README, decision D10).
  // And, for a run, its totals, which it keeps once it waits.
  decide: (proposal: string) => Promise<Refusal | Decided | undefined>,
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
  const decided = await decide(proposalUri(tenant, id));
  if (decided !== undefined && "code" in decided) {
    await moveOrFail(store, tenant, id, "PROPOSED", "DENIED", {
      mover: dsor,
      cause: `the checks refused it: ${decided.code}`,
      correlation,
    });
    return { proposal: proposalUri(tenant, id), refused: decided };
  }
  // A control asks for an approval, so the proposal waits for it, in every mode, and
  // the work does not run. Nothing approves until step 29 (step 27's README, decision D10).
  const totals = decided?.totals;
  if (decided?.requires !== undefined) {
    const controls = decided.requires.map((r) => r.control).join(", ");
    // And the proposal keeps what it waits for (step 29's README, decision D4).
    const by = { mover: dsor, cause: `the control ${controls} asks for an approval`, correlation };
    const moved = await store.move(
      tenant,
      id,
      "PROPOSED",
      "PENDING_APPROVAL",
      by,
      decided.requires,
      totals,
    );
    if (!moved) {
      throw new Error(`the proposal ${id} was no longer PROPOSED`);
    }
    const waiting = await store.get(tenant, id);
    if (waiting === undefined) throw new Error("a waiting proposal is gone from its store");
    const pending = { requires: decided.requires, expires_at: waiting.expires_at };
    return { proposal: proposalUri(tenant, id), pending };
  }
  const ready = { mover: dsor, cause: "no control asks for an approval", correlation };
  if (!(await store.move(tenant, id, "PROPOSED", "READY", ready, undefined, totals))) {
    throw new Error(`the proposal ${id} was no longer PROPOSED`);
  }
  // A proposal made in propose_only mode waits here. Nothing moves it on until
  // proposal.execute, which step 31 builds (§26.2, READY; step 23's README, decision 1).
  // And so does a replacement, in either mode (step 41b's README, decision D12).
  if (draft.mode === "propose_only" || draft.supersedes !== undefined) {
    return { proposal: proposalUri(tenant, id) };
  }
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
  // A work that cannot say whether its side effect happened ends OUTCOME_UNKNOWN,
  //   never FAILED, and stays in flight (DSOR-UNK-01a, DSOR-UNK-01b; step 35's README, decision D5).
  const unknown = !ended && outcome.refused.code === "OUTCOME_UNKNOWN";
  const to: State = ended ? "COMMITTED" : unknown ? "OUTCOME_UNKNOWN" : "FAILED";
  await moveOrFail(store, tenant, id, "EXECUTING", to, {
    mover: dsorMover(draft.requester),
    cause: ended
      ? "the work ended"
      : unknown
        ? `the outcome is unknown: ${(outcome.refused as { message?: string }).message ?? ""}`
        : `the code refused: ${outcome.refused.code}`,
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
