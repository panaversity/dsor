// The claims of idempotency keys. A command carries a key that its caller chose,
// and DSoR claims the key before the command's work runs, in the same transaction. A second
// request with the same key and the same request gets the recorded answer, and a different
// request is refused (DSOR-IDM-01b to DSOR-IDM-01d in specs/dsor/03-execution.md, section 22;
// step 20's README, decisions 4, 6, 7, and 9). The program keeps its claims in the table
// dsor.idempotency (postgres.ts); the unit tests keep them in memory (memoryClaims below).
import { memoryOutbox, type OutboxWriter } from "./outbox.ts";
import { memoryHolds, type HoldStore } from "./holds.ts";
import { memoryIntents, unknownFromNote, type IntentStore } from "./intents.ts";
import { NO_BRAKES, type BrakeStore } from "./brakes.ts";
import { RETRY, Refusal, type ErrorCode } from "./envelope.ts";
import type { InvoiceStore } from "./invoice.ts";
import { isLabel } from "./labels.ts";
import type { PaymentStore } from "./payment.ts";
import { memoryReservations, type MemoryReservations, type ReservationStore } from "./limits.ts";
import { randomUUID } from "node:crypto";
import {
  dsorMover,
  memoryProposals,
  proposalIdOf,
  proposalUri,
  type Opened,
  type Pending,
  type ProposalMode,
  type ProposalStore,
  type MemoryProposals,
} from "./proposals.ts";
import type { Contract } from "./registry.ts";
import { NO_RATES, type RateStore } from "./rates.ts";
import { NO_CONTROLS, type ControlStore } from "./rulebook.ts";
import { NO_SLIPS, type SlipStore } from "./slips.ts";

/**
 * The scope of one claim: the company, the caller, the operation, and the key. One key text in
 * another scope is another claim (DSOR-IDM-01b).
 */
export type ClaimScope = { tenant: string; principal: string; operation: string; key: string };

// The claim's own database transaction, as a log of the same database writes a
//   record into it. Memory has none (step 36b's README, decision D1).
/** The claim's own transaction, which only a log of the same database can use. */
export type ClaimTransaction = object;

/** The stores a command's code works on. On the database, they work inside the claim's transaction. */
// And the proposals, which line ⑧ writes inside the same transaction (step 22's
// README, decision 9).
// And the reservations, which line ⑩ makes inside the same transaction (step 24's README,
// decision 4).
// And the slips, which DSoR's own work tears up inside the same transaction, with
// the proposals it cancels (step 25's README, decision D2).
export type WorkStores = {
  invoices: InvoiceStore;
  payments: PaymentStore;
  proposals: ProposalStore;
  reservations: ReservationStore;
  slips: SlipStore;
  // And the brakes, so the check after line ⑧ takes the brake's lock inside the
  // claim's transaction, and DSoR's own work pulls and lifts there (step 25b's README, decisions
  // L8 and D1).
  brakes: BrakeStore;
  // And the company's sheets of rates, so line ⑩ converts inside the claim's
  // transaction, and rate.load writes a sheet there (step 26's README, decisions L1 and L2).
  rates: RateStore;
  // And the company's rules, so DSoR's own work changes a rule inside the claim's
  // transaction, with its record (step 28's README, decisions D14 and D15).
  controls: ControlStore;
  // The intent records, and the checkpoint that commits what the claim has done so
  //   far, the note with it, before a bank is called. On the database the work goes on in a new
  //   transaction; in memory nothing needs committing (step 36's README, decision D2).
  intents: IntentStore;
  checkpoint: () => Promise<void>;
  // And the holds, placed with the note and read at line ⑨ (step 37's README,
  //   decisions D1 and D6).
  holds: HoldStore;
  // And the outbox, where DSoR writes the event of a change in the change's own
  //   transaction (DSOR-EVT-01a; step 40's README, decision D1).
  outbox: OutboxWriter;
  // And the claim's transaction itself, so the record commits with the work.
  transaction?: ClaimTransaction;
  // NEW IN STEP 41b: and a part of the work that a refusal undoes alone, while the claim keeps the
  //   refusal: on the database a savepoint, in memory an undo of the moves and bookings made inside
  //   it. A replacement cancels the old proposal inside one, so a refused new command leaves the old
  //   one waiting (step 41b's README, decisions D6 and D7).
  undoable: <T>(body: () => Promise<T>) => Promise<T>;
};

/** How the code's work ended: with its value, or with the refusal it gave. */
export type Ended = { value: unknown } | { refused: Refusal };

/** How the first call ended: its work's end, or a proposal that waits. */
// A proposal that waits, in propose_only mode, where no code runs (step 23's
// README, decision 12). Or, since step 27, one that waits for an approval, in any mode, where no
// code runs either (step 27's README, decision D10).
export type Outcome = Ended | { ready: true } | { pending: Pending };

// And the URI of the call's proposal, which the claim keeps beside the outcome, so
// a replay names the proposal the first call made (DSOR-IDM-04; step 22's README, decision 5).
/** What a claim gives back: the outcome, its proposal, and, for a replay, the request id of the first call. */
// And whether lines ⑨ and ⑩ denied the first call, so a replay's record says what
// the first call's said (step 24's README, decision 17).
// And whether the seal ran and committed with the claim: the record of a first
//   call is kept already (decision D1).
export type Claimed = Outcome & {
  proposal?: string;
  replay_of?: string;
  denied?: true;
  sealed?: true;
};

// Line ⑧ and the proposal's last move, which the claim runs around the code. The
// proposal is opened before the code's savepoint, and moved after it, so a refusal that undoes the
// code's writes keeps the proposal, and ends it FAILED (step 22's README, decision 9).
/** Line ⑧'s part of a claim: open the proposal before the code runs, and close it once the code ends. */
// Opening runs lines ⑨ and ⑩ too, and may end the proposal DENIED. Then the claim
// keeps that refusal, and runs no work (step 24's README, decision 6).
export type ProposalSteps = {
  open: (stores: WorkStores) => Promise<Opened>;
  close: (stores: WorkStores, proposal: string, outcome: Ended) => Promise<void>;
};

/** Where DSoR keeps its claims. */
// And the reservations the claims make, which a dry run reads at line ⑩ to see
// whether its amount would fit (step 24's README, decision 8).
export type ClaimStore = {
  reservations: ReservationStore;
  // And the sheets of rates, for a dry run's line ⑩, which converts as a real call
  // does, outside any claim (step 26's README, claim C3).
  rates: RateStore;
  // And the proposals, for a dry run's line ⑨, which an approval's look reads
  // outside any claim (step 29's README, decision D5).
  proposals: ProposalStore;
  // And the intent records, which a test, and the sweep at start-up, read.
  intents: IntentStore;
  // And the holds, which a dry run's line ⑨ looks at, outside any claim.
  holds: HoldStore;
  /**
   * Claims the key and runs the work, or gives back the outcome recorded for the same request,
   * or refuses a different request with IDEMPOTENCY_CONFLICT.
   */
  run: (
    scope: ClaimScope,
    payloadHash: string,
    // The mode of the call, which the claim keeps beside the fingerprint. In
    // propose_only mode, the claim opens the proposal and runs no work (step 23's README,
    // decisions 4 and 12).
    mode: ProposalMode,
    requestId: string,
    work: (stores: WorkStores) => Promise<unknown>,
    // Line ⑧, for a command's call. Without it, the claim makes no proposal.
    steps?: ProposalSteps,
    // Line ⑪ for the first call, run inside the claim after its outcome is kept
    //   and before it commits. If it throws, nothing of the claim is kept (decisions D1 to D3).
    seal?: (stores: WorkStores, claimed: Claimed) => Promise<void>,
    // NEW IN STEP 41b: and the proposal the call replaces, which the claim keeps beside the
    //   fingerprint and the mode, and compares as it compares them (step 41b's README, D9).
    supersedes?: string,
  ) => Promise<Claimed>;
};

/**
 * The scope of a call's claim, after line ⑦'s two checks: a command must carry a key, and a
 * query must carry none (DSOR-IDM-01a; step 20's README, decision 3).
 */
export function claimScope(
  contract: Contract,
  key: string | undefined,
  tenant: string,
  principal: string,
): ClaimScope {
  const name = JSON.stringify(contract.id);
  // The refusals of line ⑦ name only the operation, which the caller sent. So they are public,
  // and masking never hides them (step 20's README, decision 7).
  // A query changes nothing, so a key on it would promise a protection that is not there.
  if (contract["kind"] === "query") {
    const why = `${name} is a query, which takes no idempotency_key`;
    throw new Refusal("VALIDATION_FAILED", why, "public");
  }
  if (key === undefined) {
    const why = `${name} needs an idempotency_key in the request envelope`;
    throw new Refusal("VALIDATION_FAILED", why, "public");
  }
  // The operation's id, without its version, so a retry that meets a new version of the
  // contract still finds its claim (step 20's README, decision 4).
  return { tenant, principal, operation: contract.id, key };
}

/** The refusal of a key sent again with a different request (DSOR-IDM-01d). */
export function usedForAnother(operation: string): Refusal {
  const message = `the idempotency_key was used for a different request to ${JSON.stringify(operation)}`;
  return new Refusal("IDEMPOTENCY_CONFLICT", message, "public");
}

// A key keeps the mode of its first call. Sent again in another mode, the same
// request is refused too, so a key prepared in propose_only mode never executes, and a call in
// propose_only mode never hears an earlier COMMITTED (step 23's README, decision 4). Public, as the
// other refusals of line ⑦: it names only what this caller sent before.
/** The refusal of a key sent again in another mode. */
export function usedInAnotherMode(operation: string, first: ProposalMode): Refusal {
  const used = `the idempotency_key was used for ${JSON.stringify(operation)} in ${first} mode`;
  return new Refusal("IDEMPOTENCY_CONFLICT", `${used}, and a key keeps its mode`, "public");
}

// NEW IN STEP 41b: a key keeps what its first call replaced, or that it replaced nothing. Sent
//   again with another supersedes, the same input is another request: it would cancel another
//   proposal, or none. So it is refused, as another mode is (step 41b's README, decision D9).
/** The refusal of a key sent again with another supersedes, or with one where it had none. */
export function usedToReplaceAnother(operation: string): Refusal {
  const used = `the idempotency_key was used for ${JSON.stringify(operation)} with another supersedes`;
  return new Refusal("IDEMPOTENCY_CONFLICT", `${used}, and a key keeps what it replaces`, "public");
}

/**
 * Whether the work's throw is an outcome to keep with the claim. A refusal from the code is a
 * decision about the request, and §22 replays it like any other result. Anything else is an
 * accident, such as a bug or a lost connection, and the claim goes with the work. So does an
 * INTERNAL_ERROR refusal, which DSoR throws for its own faults, and a refusal whose retry class
 * is safe_same_key, which tells the caller that a retry with the same key runs again (step 20's
 * README, decision 9).
 */
export function isOutcome(thrown: unknown): thrown is Refusal {
  if (!(thrown instanceof Refusal) || thrown.code === "INTERNAL_ERROR") return false;
  // RESOURCE_HELD says "not now", nothing about the request: a record it binds is
  //   held for a payment nobody knows the end of. So the claim keeps nothing, no proposal stays
  //   DENIED, a waiting proposal keeps waiting, and the same key runs once the payment is settled,
  //   as its retry class says (step 37's README, decisions D3 and D4).
  if (thrown.code === "RESOURCE_HELD") return false;
  // A refusal that came after the note is kept, whatever its retry class.
  if (AFTER_NOTE.has(thrown)) return true;
  return RETRY[thrown.code] !== "safe_same_key";
}

// The refusals that came after the note was committed. The claim and the
//   proposal were committed with the note, so no rollback can take them back: the claim keeps
//   this refusal, and the proposal ends FAILED. A bank that said it sent nothing is one. The
//   same key gives that answer back; a new key pays (step 36's README, decision D5).
const AFTER_NOTE = new WeakSet<Refusal>();

/** Marks a refusal that came after the note, so the claim keeps it. */
export function keptAfterNote(refusal: Refusal): Refusal {
  AFTER_NOTE.add(refusal);
  return refusal;
}

/** A recorded refusal, as JSON keeps it: its code, its message, and the label of the message. */
export type KeptRefusal = { code: string; message: string; label: string };

/** A refusal as JSON can keep it. */
export function keptOf(refusal: Refusal): KeptRefusal {
  return { code: refusal.code, message: refusal.message, label: refusal.label };
}

/** A kept refusal as a refusal again. A record that is not one is a bug. */
export function refusalOf(kept: unknown): Refusal {
  const { code, message, label } = (kept ?? {}) as Partial<KeptRefusal>;
  if (
    typeof code !== "string" ||
    !(code in RETRY) ||
    typeof message !== "string" ||
    !isLabel(label)
  ) {
    throw new Error("a claim holds a refusal that is not one");
  }
  return new Refusal(code as ErrorCode, message, label);
}

/** A value as JSON text, the way a claim keeps it. A value that JSON cannot keep is a bug. */
export function keptText(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("the command's answer cannot be kept as JSON");
  return text;
}

/**
 * Every command whose contract does not require a key, and every query whose contract does.
 * The contract's flag is a promise to callers, and DSOR-IDM-01a makes every command keep it.
 */
export function keyProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const required = (contract["idempotency"] as { required?: unknown } | undefined)?.required;
    if (contract["kind"] === "command" && required !== true) {
      problems.push(`${contract.id}: a command must require an idempotency key (DSOR-IDM-01a)`);
    }
    if (contract["kind"] === "query" && required === true) {
      problems.push(
        `${contract.id}: a query takes no idempotency key (step 20's README, decision 3)`,
      );
    }
  }
  return problems;
}

// One claim in memory: the fingerprint, the first call's request id, and its outcome, which is
// a promise until the work ends. The promise fails only when the work had an accident.
// The outcome holds the proposal's URI too.
// And the mode of the first call.
type Kept = Outcome & { proposal?: string; denied?: true; sealed?: true };
type MemoryClaim = {
  payloadHash: string;
  mode: ProposalMode;
  // NEW IN STEP 41b: and what the first call replaced, if anything.
  supersedes: string | undefined;
  requestId: string;
  outcome: Promise<Kept>;
};

/** Claims in memory, for the unit tests, with these stores for the work. */
// And these proposals, a store of their own unless the test gives one, and these reservations.
// And these slips: the same store that line ③ reads, so a tear-up is seen by the
// next call.
export function memoryClaims(
  invoices: InvoiceStore,
  payments: PaymentStore,
  proposals: ProposalStore = memoryProposals(),
  reservations: ReservationStore = memoryReservations(),
  slips: SlipStore = NO_SLIPS,
  // And the brakes that line ④ reads, so the claim's work pulls and lifts them.
  brakes: BrakeStore = NO_BRAKES,
  // And these sheets of rates. None, unless the test gives them: then every amount
  // in another currency than its limit is refused (DSOR-MON-04; step 26's README, claim C2).
  rates: RateStore = NO_RATES,
  // And the rules that line ⑩ reads, so the claim's work changes them. None,
  // unless the test gives them (step 28's README, decision D5).
  controls: ControlStore = NO_CONTROLS,
  // And these intent records, in memory unless the test gives others.
  intents: IntentStore = memoryIntents(),
  // And these holds, in memory unless the test gives others.
  holds: HoldStore = memoryHolds(),
  // And this outbox, in memory unless the test gives one it reads.
  outbox: OutboxWriter = memoryOutbox(),
): ClaimStore {
  // Each claim by its scope, written as one text.
  const claims = new Map<string, MemoryClaim>();
  // The lock of one operation over one record, which line ⑨ takes inside a claim
  //   and the claim holds until it ends, as the database's advisory lock is held until its
  //   transaction ends. Memory's calls interleave at each await, so seven drafts at once looked
  //   together without it. Found while building (step 32's README, decision D7).
  const locks = new Map<string, Promise<void>>();
  // The end of one claim's open note after an accident past the checkpoint, as
  //   the database's claim does it: the proposal, still EXECUTING, moves to OUTCOME_UNKNOWN, which
  //   raises its alert, and the note ends outcome_unknown (found by step 38b's review, H1).
  const endOwnNote = async (tenant: string, uri: string): Promise<void> => {
    const id = proposalIdOf(tenant, uri);
    const note = await intents.get(tenant, id);
    if (note === undefined || note.outcome !== undefined) return;
    const kept = await proposals.get(tenant, id);
    if (kept?.state === "EXECUTING") {
      const by = {
        mover: dsorMover(kept.requester),
        cause: `the outcome is unknown: ${unknownFromNote().message}`,
        correlation: { request_id: `req_${randomUUID()}` },
      };
      await proposals.move(tenant, id, "EXECUTING", "OUTCOME_UNKNOWN", by);
    }
    await intents.end(tenant, id, "outcome_unknown");
  };
  const run = async (
    scope: ClaimScope,
    payloadHash: string,
    mode: ProposalMode,
    requestId: string,
    work: (stores: WorkStores) => Promise<unknown>,
    steps?: ProposalSteps,
    seal?: (stores: WorkStores, claimed: Claimed) => Promise<void>,
    supersedes?: string,
  ): Promise<Claimed> => {
    const id = JSON.stringify([scope.tenant, scope.principal, scope.operation, scope.key]);
    const held = claims.get(id);
    if (held === undefined) {
      // The key is free, so this call claims it, with its fingerprint. The work starts after
      // the claim is set, a moment later, so no second call can find the key free meanwhile.
      // The value is kept as a copy, as the database keeps it as text: a payment changed later
      // does not change what was answered. Memory has no transaction, so nothing undoes a
      // write the code made before it refused. The database undoes it.
      // Line ⑧ opens the proposal first, and its last move follows the code. A
      // refusal closes it FAILED. An accident closes nothing: memory cannot undo the proposal, and
      // it stays EXECUTING, where the database rolls it back with the claim.
      // After an accident, memory undoes what this call did to its proposal, as the
      //   database's rollback does: a proposal left EXECUTING is in flight, and would hold its
      //   invoice against the retry. A proposal this call made goes, with the reservation it made.
      //   A proposal it loaded, for a release, goes back to the state it was in (step 32's README,
      //   decision D14; step 32's review, finding M1). Stores of another kind are left as they are.
      let made: string | undefined;
      // And every other proposal it made, such as a run's lines, which an accident
      //   undoes too (step 41's README, claim C3).
      const others: string[] = [];
      // The locks this claim holds, each given back when the claim ends.
      const held: (() => void)[] = [];
      // And their keys, so a lock it holds is not waited for twice.
      const heldKeys = new Set<string>();
      // Whether the checkpoint passed, so the claim and its note count as kept.
      let noted = false;
      const holdOver = async (tenant: string, operation: string, uri: string): Promise<void> => {
        const key = JSON.stringify([tenant, operation, uri]);
        // A lock this claim holds already is held, as the database's advisory lock
        //   is taken again by its own transaction. A run takes its lines' locks first, then each
        //   line's check takes its own again (step 41's review, M2).
        if (heldKeys.has(key)) return;
        heldKeys.add(key);
        const before = locks.get(key) ?? Promise.resolve();
        let free = (): void => {};
        const mine = new Promise<void>((resolve) => (free = resolve));
        locks.set(
          key,
          before.then(() => mine),
        );
        await before;
        held.push(free);
      };
      // NEW IN STEP 41b: what this call made, and the bookings it gave back, which an accident
      //   undoes as the database's rollback does: a replaced proposal's booking is held again.
      const createdHere = new Set<string>();
      const releasedHere: string[] = [];
      // And, while an undoable part runs, what it moved, gave back, and booked, which a refusal
      //   inside it undoes, as the database's ROLLBACK TO SAVEPOINT does (step 41b's README, D6).
      let inside: { moved: Set<string>; released: string[]; reserved: string[] } | undefined;
      const undoInside = async (
        tenant: string,
        done: { moved: Set<string>; released: string[]; reserved: string[] },
      ): Promise<void> => {
        if (!("undo" in proposals) || !("restore" in reservations)) {
          throw new Error("memory can undo a part of a claim only in its own stores");
        }
        for (const uri of done.moved) {
          // A proposal this call made goes only with the whole claim: its first record stays.
          if (createdHere.has(uri))
            throw new Error(`an undoable part moved its own proposal ${uri}`);
          await (proposals as MemoryProposals).undo(uri, requestId);
        }
        for (const id of done.released)
          await (reservations as MemoryReservations).restore(tenant, id);
        for (const id of done.reserved)
          await (reservations as MemoryReservations).forget(tenant, id);
      };
      const stores: WorkStores = {
        invoices,
        payments,
        // And a create that remembers the proposal this claim made, so a refusal
        //   inside line ⑧, such as RESOURCE_HELD, which keeps nothing, undoes it as the database's
        //   rollback does. Found while building: memory left it PROPOSED.
        proposals: {
          ...proposals,
          holdOver,
          // NEW IN STEP 41b: the company's ending lock, one of this claim's locks.
          holdEnding: (tenant) => holdOver(tenant, "dsor.ending", tenant),
          create: async (tenant, id, draft, by, lifetime) => {
            await proposals.create(tenant, id, draft, by, lifetime);
            if (made === undefined) made = proposalUri(tenant, id);
            else others.push(proposalUri(tenant, id));
            createdHere.add(proposalUri(tenant, id));
          },
          // And every other proposal it moves, such as the lines a release starts, which an
          //   accident puts back as they were, as the database's rollback does. Found by step 41's
          //   review, L1: a run's lines stayed EXECUTING after an accident at its release.
          move: async (tenant, id, from, to, by, requires, totals) => {
            const moved = await proposals.move(tenant, id, from, to, by, requires, totals);
            const uri = proposalUri(tenant, id);
            if (moved && uri !== made && !others.includes(uri)) others.push(uri);
            if (moved) inside?.moved.add(uri);
            return moved;
          },
        },
        // NEW IN STEP 41b: and the bookings it makes and gives back, noted for an undo.
        reservations: {
          ...reservations,
          reserve: async (tenant, proposal, delegation, amount, limit) => {
            const had = await reservations.get(tenant, proposal);
            const fits = await reservations.reserve(tenant, proposal, delegation, amount, limit);
            if (fits && had === undefined) inside?.reserved.push(proposal);
            return fits;
          },
          release: async (tenant, proposal) => {
            const had = await reservations.get(tenant, proposal);
            await reservations.release(tenant, proposal);
            if (had?.state !== "held") return;
            releasedHere.push(proposal);
            inside?.released.push(proposal);
          },
        },
        slips,
        brakes,
        rates,
        controls,
        intents,
        holds,
        outbox,
        // Memory has no transaction to commit, and keeps the note as it is written. From here
        //   on the claim is kept, as the database's is once its checkpoint commits.
        checkpoint: async () => {
          noted = true;
          // And the claim's locks go, as the database's COMMIT lets go of its
          //   advisory locks: from here a second attempt over the record finds this one in flight,
          //   and hears CONFLICT, rather than waiting for the bank. Found by step 37's review, F1.
          held.splice(0).forEach((free) => free());
        },
        undoable: async <T>(part: () => Promise<T>): Promise<T> => {
          if (inside !== undefined) throw new Error("an undoable part inside another");
          const done = {
            moved: new Set<string>(),
            released: [] as string[],
            reserved: [] as string[],
          };
          inside = done;
          try {
            return await part();
          } catch (thrown) {
            if (isOutcome(thrown)) await undoInside(scope.tenant, done);
            throw thrown;
          } finally {
            inside = undefined;
          }
        },
      };
      // Set when an accident after the checkpoint made the outcome unknown: nobody seals that one.
      let broke = false;
      // Set when the work's own outcome was sealed before its last move.
      let sealedFirst = false;
      const body = async (): Promise<Kept> => {
        const opened = steps === undefined ? undefined : await steps.open(stores);
        const proposal = opened?.proposal;
        made = proposal;
        // A proposal that lines ⑨ and ⑩ refused ended DENIED. Its refusal is the
        // outcome, and no work runs.
        if (opened?.refused !== undefined) {
          return { refused: opened.refused, proposal, denied: true };
        }
        // A proposal that a control stopped waits for its approval, in every mode,
        // and the work never runs.
        if (opened?.pending !== undefined) {
          return { pending: structuredClone(opened.pending), proposal };
        }
        // In propose_only mode the proposal waits READY, and the work never runs.
        if (mode === "propose_only") {
          if (proposal === undefined) throw new Error("a propose_only claim made no proposal");
          return { ready: true, proposal };
        }
        let ended: Ended;
        try {
          try {
            ended = { value: copyOf(await work(stores)) };
          } catch (thrown) {
            if (!isOutcome(thrown)) throw thrown;
            ended = { refused: thrown };
          }
          if (steps === undefined || proposal === undefined) return ended;
          // Memory seals before the proposal's last move, so a seal that fails
          //   after the checkpoint leaves the proposal EXECUTING and its note open, as the
          //   database's rollback does. Found by step 36b's review, F3.
          if (seal !== undefined) {
            await seal(stores, { ...ended, proposal });
            sealedFirst = true;
          }
          await steps.close(stores, proposal, ended);
          return { ...ended, proposal };
        } catch (thrown) {
          // An accident after the checkpoint undoes nothing: the note, the claim,
          //   and the proposal at EXECUTING stay, as on the database, and the answer is
          //   OUTCOME_UNKNOWN. Found by step 36's review, H1.
          if (!noted || proposal === undefined) throw thrown;
          broke = true;
          await endOwnNote(scope.tenant, proposal);
          return { refused: unknownFromNote(), proposal };
        }
      };
      // The outcome, then its record, before any replay can read the outcome: a
      //   replay waits for this promise. A record that cannot be kept is an accident, so the claim
      //   and the proposal go, as the database rolls them back with the record. After the
      //   checkpoint it is OUTCOME_UNKNOWN instead, as there. Memory has no transaction: what the
      //   code wrote to its stores stays (step 36b's README, decisions D1 and D3).
      const outcome = Promise.resolve().then(async (): Promise<Kept> => {
        const kept = await body();
        if (seal === undefined || broke) return kept;
        if (sealedFirst) return { ...kept, sealed: true };
        try {
          await seal(stores, fresh(kept));
        } catch (thrown) {
          if (!noted || made === undefined) throw thrown;
          await endOwnNote(scope.tenant, made);
          return { refused: unknownFromNote(), proposal: made };
        }
        return { ...kept, sealed: true };
      });
      claims.set(id, { payloadHash, mode, supersedes, requestId, outcome });
      // The claim's locks are given back once its work has ended, either way.
      void outcome.then(
        () => held.forEach((free) => free()),
        () => held.forEach((free) => free()),
      );
      try {
        const kept = await outcome;
        // Only the first call hears that its record is kept; a replay's is written afterwards.
        return kept.sealed === true ? { ...fresh(kept), sealed: true } : fresh(kept);
      } catch (error) {
        // An accident keeps no claim, as the database rolls the claim back with the work.
        claims.delete(id);
        // NEW IN STEP 41b: and every booking it gave back is held again, such as a replaced
        //   proposal's.
        if ("restore" in reservations) {
          for (const given of releasedHere) {
            await (reservations as MemoryReservations).restore(scope.tenant, given);
          }
        }
        for (const uri of made === undefined ? others : [made, ...others]) {
          if (!("undo" in proposals)) break;
          const undone = await (proposals as MemoryProposals).undo(uri, requestId);
          if (undone === "gone" && "forget" in reservations) {
            const proposal = uri.split("/").at(-1) ?? "";
            await (reservations as MemoryReservations).forget(scope.tenant, proposal);
          }
        }
        throw error;
      }
    }
    // The key is claimed. This call waits for that work to end, as a second INSERT waits on the
    // database's primary key. If the work had an accident, its claim is gone, and this call
    // starts again.
    const ended = await held.outcome.then(
      (outcome) => outcome,
      () => undefined,
    );
    if (ended === undefined) {
      return run(scope, payloadHash, mode, requestId, work, steps, seal, supersedes);
    }
    // The fingerprint is compared only now, after the wait: a claim that failed was never a
    // claim (DSOR-IDM-01c, DSOR-IDM-01d).
    if (held.payloadHash !== payloadHash) throw usedForAnother(scope.operation);
    // And then the mode.
    if (held.mode !== mode) throw usedInAnotherMode(scope.operation, held.mode);
    // NEW IN STEP 41b: and then what it replaces.
    if (held.supersedes !== supersedes) throw usedToReplaceAnother(scope.operation);
    return { ...fresh(ended), replay_of: held.requestId };
  };
  return Object.freeze({ run, reservations, rates, proposals, intents, holds });
}

// The outcome, with a copy of its value, so no caller can change what the claim keeps.
// And its proposal, when it has one.
function fresh(outcome: Kept): Kept {
  const proposal = outcome.proposal === undefined ? {} : { proposal: outcome.proposal };
  // A proposal that waits has no value to copy.
  if ("ready" in outcome) return { ready: true, ...proposal };
  // And one that waits for an approval, a copy of what it waits for.
  if ("pending" in outcome) return { pending: structuredClone(outcome.pending), ...proposal };
  // And a denied refusal stays denied.
  const denied = outcome.denied === true ? { denied: true as const } : {};
  return "value" in outcome
    ? { value: copyOf(outcome.value), ...proposal }
    : { refused: outcome.refused, ...proposal, ...denied };
}

// A copy through JSON text, as the database keeps the value.
function copyOf(value: unknown): unknown {
  return JSON.parse(keptText(value)) as unknown;
}
