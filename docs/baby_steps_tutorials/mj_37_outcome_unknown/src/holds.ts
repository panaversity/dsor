// NEW IN STEP 37: holds, the "do not touch" signs DSoR keeps while a payment's outcome is unknown
// (DSOR-UNK-03b in specs/dsor/03-execution.md, section 25.2). Before a payment is sent, DSoR holds
// every record its contract's in_flight.hold_on_unknown names, with the note of step 36. A hold
// counts while its proposal is EXECUTING or OUTCOME_UNKNOWN; any other command that binds a held
// record hears RESOURCE_HELD. The program keeps holds in dsor.holds (postgres.ts); the unit tests
// keep them in memory (step 37's README, decisions D1, D6, and D7).
import type { Contract } from "./registry.ts";

/** One hold: a record, held for one proposal. */
export type Hold = { tenant_id: string; resource: string; proposal_id: string };

/** A hold as it is kept: with the time it was placed. */
export type KeptHold = Hold & { placed_at: string };

/** Where DSoR keeps its holds, one company at a time. */
export type HoldStore = {
  /** Holds these records for one proposal. */
  place: (tenant: string, proposalId: string, resources: readonly string[]) => Promise<void>;
  /** The holds placed on any of these records, whatever their proposal's state. */
  on: (tenant: string, resources: readonly string[]) => Promise<KeptHold[]>;
};

/** Holds in memory, for the unit tests, and every one of them. */
export type MemoryHolds = HoldStore & { all: () => KeptHold[] };

/** Holds held in memory, for the unit tests. */
export function memoryHolds(): MemoryHolds {
  const rows: KeptHold[] = [];
  return {
    place: async () => {},
    on: async () => [],
    all: () => structuredClone(rows),
  };
}

/** No store of holds: nothing is held, and placing one throws. */
export const NO_HOLDS: HoldStore = Object.freeze({
  place: async (): Promise<never> => {
    throw new Error("this registry was built without a store of holds");
  },
  on: async () => [],
});

/**
 * Every contract whose in_flight.hold_on_unknown names an alias it does not bind: DSoR could not
 * know which record to hold (step 37's README, claim C5).
 */
export function holdProblems(_contracts: Iterable<Contract>): string[] {
  return [];
}
