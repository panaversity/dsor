// NEW IN STEP 20: the claims of idempotency keys. A command carries a key that its caller chose,
// and DSoR claims the key before the command's work runs, in the same transaction. A second
// request with the same key and the same request gets the recorded answer, and a different
// request is refused (DSOR-IDM-01b to DSOR-IDM-01d in specs/dsor/03-execution.md, section 22;
// step 20's README, decisions 4, 6, 7, and 9). The program keeps its claims in the table
// dsor.idempotency (postgres.ts); the unit tests keep them in memory (memoryClaims below).
import { RETRY, Refusal, type ErrorCode } from "./envelope.ts";
import type { InvoiceStore } from "./invoice.ts";
import { isLabel } from "./labels.ts";
import type { PaymentStore } from "./payment.ts";
import type { Contract } from "./registry.ts";

/**
 * The scope of one claim: the company, the caller, the operation, and the key. One key text in
 * another scope is another claim (DSOR-IDM-01b).
 */
export type ClaimScope = { tenant: string; principal: string; operation: string; key: string };

/** The stores a command's code works on. On the database, they work inside the claim's transaction. */
export type WorkStores = { invoices: InvoiceStore; payments: PaymentStore };

/** How the first call's work ended: with its code's value, or with the refusal its code gave. */
export type Outcome = { value: unknown } | { refused: Refusal };

/** What a claim gives back: the outcome, and, for a replay, the request id of the first call. */
export type Claimed = Outcome & { replay_of?: string };

/** Where DSoR keeps its claims. */
export type ClaimStore = {
  /**
   * Claims the key and runs the work, or gives back the outcome recorded for the same request,
   * or refuses a different request with IDEMPOTENCY_CONFLICT.
   */
  run: (
    scope: ClaimScope,
    payloadHash: string,
    requestId: string,
    work: (stores: WorkStores) => Promise<unknown>,
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
type MemoryClaim = { payloadHash: string; requestId: string; outcome: Promise<Outcome> };

/** Claims in memory, for the unit tests, with these stores for the work. */
export function memoryClaims(invoices: InvoiceStore, payments: PaymentStore): ClaimStore {
  // Each claim by its scope, written as one text.
  const claims = new Map<string, MemoryClaim>();
  const run = async (
    scope: ClaimScope,
    payloadHash: string,
    requestId: string,
    work: (stores: WorkStores) => Promise<unknown>,
  ): Promise<Claimed> => {
    const id = JSON.stringify([scope.tenant, scope.principal, scope.operation, scope.key]);
    const held = claims.get(id);
    if (held === undefined) {
      // The key is free, so this call claims it, with its fingerprint. The work starts after
      // the claim is set, a moment later, so no second call can find the key free meanwhile.
      // The value is kept as a copy, as the database keeps it as text: a payment changed later
      // does not change what was answered. Memory has no transaction, so nothing undoes a
      // write the code made before it refused. The database undoes it.
      const outcome = Promise.resolve()
        .then(() => work({ invoices, payments }))
        .then(
          (value): Outcome => ({ value: copyOf(value) }),
          (thrown: unknown): Outcome => {
            if (isOutcome(thrown)) return { refused: thrown };
            throw thrown;
          },
        );
      claims.set(id, { payloadHash, requestId, outcome });
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
    if (ended === undefined) return run(scope, payloadHash, requestId, work);
    // The fingerprint is compared only now, after the wait: a claim that failed was never a
    // claim (DSOR-IDM-01c, DSOR-IDM-01d).
    if (held.payloadHash !== payloadHash) throw usedForAnother(scope.operation);
    return { ...fresh(ended), replay_of: held.requestId };
  };
  return Object.freeze({ run });
}

// The outcome, with a copy of its value, so no caller can change what the claim keeps.
function fresh(outcome: Outcome): Outcome {
  return "value" in outcome ? { value: copyOf(outcome.value) } : outcome;
}

// A copy through JSON text, as the database keeps the value.
function copyOf(value: unknown): unknown {
  return JSON.parse(keptText(value)) as unknown;
}
