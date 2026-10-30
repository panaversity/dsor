// NEW IN STEP 36: the intent record, the note DSoR writes before it calls a bank: "I am about to do
// this" (DSOR-EXE-03a in specs/dsor/03-execution.md, section 21). It names the proposal, the
// operation and its version, the payload hash, the claim's key, the connector, and who asked. It is
// committed before the bank is asked, so a crash afterwards leaves it behind, and a note with no
// outcome is OUTCOME_UNKNOWN (DSOR-EXE-04b). The program keeps notes in dsor.intents
// (postgres.ts); the unit tests keep them in memory (step 36's README, decisions D1 to D3).

import { Refusal } from "./envelope.ts";

/** One note, as it is written before the side effect. */
export type Intent = {
  proposal_id: string;
  tenant_id: string;
  // The operation and its version, as the record names it: payment.execute@1.
  operation: string;
  payload_hash: string;
  // The claim the note belongs to: its principal, its operation, and its idempotency key. The
  //   claim's operation is the call's own: proposal.execute for a release, whose note names the
  //   operation it runs.
  principal: string;
  claim_operation: string;
  idempotency_key: string;
  connector: string;
  // Who asked, under whose authority, as line ③ found it: the requester DSoR stored.
  security_context: Record<string, unknown>;
};

/** How a note ends: the work was done, it was not, or nobody knows. */
export type IntentOutcome = "committed" | "failed" | "outcome_unknown";

/** A note as it is kept: with its time, and its outcome once it has ended. */
export type KeptIntent = Intent & {
  written_at: string;
  outcome?: IntentOutcome;
  ended_at?: string;
};

/** Where DSoR keeps its notes, one company at a time. */
export type IntentStore = {
  /** Writes one note. A second note for one proposal is refused. */
  write: (tenant: string, intent: Intent) => Promise<void>;
  /** Ends one note with its outcome, once. */
  end: (tenant: string, proposalId: string, outcome: IntentOutcome) => Promise<void>;
  /** One note, by its proposal. */
  get: (tenant: string, proposalId: string) => Promise<KeptIntent | undefined>;
  /** The note of one claim, by its principal, operation, and key, if the claim wrote one. */
  forClaim: (
    tenant: string,
    principal: string,
    operation: string,
    idempotencyKey: string,
  ) => Promise<KeptIntent | undefined>;
  /** Every note of one company that has no outcome yet. */
  open: (tenant: string) => Promise<KeptIntent[]>;
};

/** Notes in memory, for the unit tests, and every one of them. */
export type MemoryIntents = IntentStore & { all: () => KeptIntent[] };

/** Notes held in memory, for the unit tests. */
export function memoryIntents(): MemoryIntents {
  const rows: KeptIntent[] = [];
  const find = (tenant: string, id: string) =>
    rows.find((row) => row.tenant_id === tenant && row.proposal_id === id);
  return {
    write: async (tenant, intent) => {
      if (intent.tenant_id !== tenant) throw new Error("a note names another company");
      if (find(tenant, intent.proposal_id) !== undefined) {
        throw new Error(`proposal ${intent.proposal_id} has a note already`);
      }
      rows.push({ ...structuredClone(intent), written_at: new Date().toISOString() });
    },
    end: async (tenant, proposalId, outcome) => {
      const found = find(tenant, proposalId);
      if (found === undefined) throw new Error(`proposal ${proposalId} has no note`);
      if (found.outcome !== undefined) throw new Error("an intent record ends once");
      found.outcome = outcome;
      found.ended_at = new Date().toISOString();
    },
    get: async (tenant, proposalId) => {
      const found = find(tenant, proposalId);
      return found === undefined ? undefined : structuredClone(found);
    },
    forClaim: async (tenant, principal, operation, idempotencyKey) => {
      const found = rows.find(
        (row) =>
          row.tenant_id === tenant &&
          row.principal === principal &&
          row.claim_operation === operation &&
          row.idempotency_key === idempotencyKey,
      );
      return found === undefined ? undefined : structuredClone(found);
    },
    open: async (tenant) =>
      structuredClone(rows.filter((row) => row.tenant_id === tenant && row.outcome === undefined)),
    all: () => structuredClone(rows),
  };
}

/** No store of notes: a write throws, so a command that would call a bank never does. */
export const NO_INTENTS: IntentStore = Object.freeze({
  write: async (): Promise<never> => {
    throw new Error("this registry was built without a store of intent records");
  },
  end: async (): Promise<never> => {
    throw new Error("this registry was built without a store of intent records");
  },
  get: async () => undefined,
  forClaim: async () => undefined,
  open: async () => [],
});

/**
 * The answer for a note with no outcome: nobody knows whether the bank sent the payment. The
 * proposal stays in flight, and only a reconciliation may say more (DSOR-EXE-04b, DSOR-UNK-01b).
 */
export function unknownFromNote(): Refusal {
  const why =
    "DSoR wrote down that it would pay, and has no outcome for it, so the payment may or may not have been sent";
  return new Refusal("OUTCOME_UNKNOWN", why, "internal");
}
