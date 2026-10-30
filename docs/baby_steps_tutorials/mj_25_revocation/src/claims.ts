// The claims of idempotency keys. A command carries a key that its caller chose,
// and DSoR claims the key before the command's work runs, in the same transaction. A second
// request with the same key and the same request gets the recorded answer, and a different
// request is refused (DSOR-IDM-01b to DSOR-IDM-01d in specs/dsor/03-execution.md, section 22;
// step 20's README, decisions 4, 6, 7, and 9). The program keeps its claims in the table
// dsor.idempotency (postgres.ts); the unit tests keep them in memory (memoryClaims below).
import { RETRY, Refusal, type ErrorCode } from "./envelope.ts";
import type { InvoiceStore } from "./invoice.ts";
import { isLabel } from "./labels.ts";
import type { PaymentStore } from "./payment.ts";
import { memoryReservations, type ReservationStore } from "./limits.ts";
import {
  memoryProposals,
  type Opened,
  type ProposalMode,
  type ProposalStore,
} from "./proposals.ts";
import type { Contract } from "./registry.ts";
import { NO_SLIPS, type SlipStore } from "./slips.ts";

/**
 * The scope of one claim: the company, the caller, the operation, and the key. One key text in
 * another scope is another claim (DSOR-IDM-01b).
 */
export type ClaimScope = { tenant: string; principal: string; operation: string; key: string };

/** The stores a command's code works on. On the database, they work inside the claim's transaction. */
// And the proposals, which line ⑧ writes inside the same transaction (step 22's
// README, decision 9).
// And the reservations, which line ⑩ makes inside the same transaction (step 24's README,
// decision 4).
// NEW IN STEP 25: and the slips, which DSoR's own work tears up inside the same transaction, with
// the proposals it cancels (step 25's README, decision D2).
export type WorkStores = {
  invoices: InvoiceStore;
  payments: PaymentStore;
  proposals: ProposalStore;
  reservations: ReservationStore;
  slips: SlipStore;
};

/** How the code's work ended: with its value, or with the refusal it gave. */
export type Ended = { value: unknown } | { refused: Refusal };

/** How the first call ended: its work's end, or a proposal that waits. */
// A proposal that waits, in propose_only mode, where no code runs (step 23's
// README, decision 12).
export type Outcome = Ended | { ready: true };

// And the URI of the call's proposal, which the claim keeps beside the outcome, so
// a replay names the proposal the first call made (DSOR-IDM-04; step 22's README, decision 5).
/** What a claim gives back: the outcome, its proposal, and, for a replay, the request id of the first call. */
// And whether lines ⑨ and ⑩ denied the first call, so a replay's record says what
// the first call's said (step 24's README, decision 17).
export type Claimed = Outcome & { proposal?: string; replay_of?: string; denied?: true };

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
  return RETRY[thrown.code] !== "safe_same_key";
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
type Kept = Outcome & { proposal?: string; denied?: true };
type MemoryClaim = {
  payloadHash: string;
  mode: ProposalMode;
  requestId: string;
  outcome: Promise<Kept>;
};

/** Claims in memory, for the unit tests, with these stores for the work. */
// And these proposals, a store of their own unless the test gives one, and these reservations.
// NEW IN STEP 25: and these slips: the same store that line ③ reads, so a tear-up is seen by the
// next call.
export function memoryClaims(
  invoices: InvoiceStore,
  payments: PaymentStore,
  proposals: ProposalStore = memoryProposals(),
  reservations: ReservationStore = memoryReservations(),
  slips: SlipStore = NO_SLIPS,
): ClaimStore {
  // Each claim by its scope, written as one text.
  const claims = new Map<string, MemoryClaim>();
  const run = async (
    scope: ClaimScope,
    payloadHash: string,
    mode: ProposalMode,
    requestId: string,
    work: (stores: WorkStores) => Promise<unknown>,
    steps?: ProposalSteps,
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
      const stores: WorkStores = { invoices, payments, proposals, reservations, slips };
      const outcome = Promise.resolve().then(async (): Promise<Kept> => {
        const opened = steps === undefined ? undefined : await steps.open(stores);
        const proposal = opened?.proposal;
        // A proposal that lines ⑨ and ⑩ refused ended DENIED. Its refusal is the
        // outcome, and no work runs.
        if (opened?.refused !== undefined) {
          return { refused: opened.refused, proposal, denied: true };
        }
        // In propose_only mode the proposal waits READY, and the work never runs.
        if (mode === "propose_only") {
          if (proposal === undefined) throw new Error("a propose_only claim made no proposal");
          return { ready: true, proposal };
        }
        let ended: Ended;
        try {
          ended = { value: copyOf(await work(stores)) };
        } catch (thrown) {
          if (!isOutcome(thrown)) throw thrown;
          ended = { refused: thrown };
        }
        if (steps === undefined || proposal === undefined) return ended;
        await steps.close(stores, proposal, ended);
        return { ...ended, proposal };
      });
      claims.set(id, { payloadHash, mode, requestId, outcome });
      try {
        return fresh(await outcome);
      } catch (error) {
        // An accident keeps no claim, as the database rolls the claim back with the work.
        claims.delete(id);
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
    if (ended === undefined) return run(scope, payloadHash, mode, requestId, work, steps);
    // The fingerprint is compared only now, after the wait: a claim that failed was never a
    // claim (DSOR-IDM-01c, DSOR-IDM-01d).
    if (held.payloadHash !== payloadHash) throw usedForAnother(scope.operation);
    // And then the mode.
    if (held.mode !== mode) throw usedInAnotherMode(scope.operation, held.mode);
    return { ...fresh(ended), replay_of: held.requestId };
  };
  return Object.freeze({ run, reservations });
}

// The outcome, with a copy of its value, so no caller can change what the claim keeps.
// And its proposal, when it has one.
function fresh(outcome: Kept): Kept {
  const proposal = outcome.proposal === undefined ? {} : { proposal: outcome.proposal };
  // A proposal that waits has no value to copy.
  if ("ready" in outcome) return { ready: true, ...proposal };
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
