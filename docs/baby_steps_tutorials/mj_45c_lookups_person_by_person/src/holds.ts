// Holds, the "do not touch" signs DSoR keeps while a payment's outcome is unknown
// (DSOR-UNK-03b in specs/dsor/03-execution.md, section 25.2). Before a payment is sent, DSoR holds
// every record its contract's in_flight.hold_on_unknown names, with the note of step 36. A hold
// counts while its proposal is EXECUTING or OUTCOME_UNKNOWN; any other command that binds a held
// record hears RESOURCE_HELD. The program keeps holds in dsor.holds (postgres.ts); the unit tests
// keep them in memory (step 37's README, decisions D1, D6, and D7).
import { Refusal } from "./envelope.ts";
import type { ProposalStore, State } from "./proposals.ts";
import { preview, type Contract } from "./registry.ts";
import { parseUri } from "./uri.ts";

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
    place: async (tenant, proposalId, resources) => {
      const placed_at = new Date().toISOString();
      for (const resource of new Set(resources)) {
        const kept = rows.some(
          (row) =>
            row.tenant_id === tenant && row.resource === resource && row.proposal_id === proposalId,
        );
        if (!kept) rows.push({ tenant_id: tenant, resource, proposal_id: proposalId, placed_at });
      }
    },
    on: async (tenant, resources) =>
      structuredClone(
        rows.filter((row) => row.tenant_id === tenant && resources.includes(row.resource)),
      ),
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

// A hold counts while nobody knows how its payment ended: while it is being sent, and once its
//   outcome is unknown. A payment that is COMMITTED or FAILED frees what it held (step 37's README,
//   decisions D6 and D7).
//   In the order a look reports them: an unknown outcome before a send still running.
const HOLDING: readonly State[] = ["OUTCOME_UNKNOWN", "EXECUTING"];

// The binds line ⑨ gives an address to (src/bound.ts).
const ADDRESSED = [/^input\.[a-z][a-z0-9_]*$/, /^state\.[a-z][a-z0-9_]*\.invoice_id$/];

/** The aliases a contract's in_flight.hold_on_unknown names, as written. */
export function holdsOf(contract: Contract): string[] {
  const inFlight = contract["in_flight"] as { hold_on_unknown?: unknown } | undefined;
  const listed = inFlight?.hold_on_unknown;
  return Array.isArray(listed) ? listed.map(String) : [];
}

/** A record held for a proposal still EXECUTING or OUTCOME_UNKNOWN, and that proposal's state. */
export type Held = { resource: string; state: State };

/**
 * Line ⑨'s look at the holds: the first of these records, in the order given, that a hold of
 * another proposal holds now, OUTCOME_UNKNOWN before EXECUTING. The order given is the bind's, so
 * the record named is the first the request names. Found by step 37's review, L2: the store's
 * order named an invoice the caller never named.
 */
export async function heldBy(
  holds: HoldStore,
  proposals: ProposalStore,
  tenant: string,
  resources: readonly string[],
  own?: string,
): Promise<Held | undefined> {
  if (resources.length === 0) return undefined;
  const found: Held[] = [];
  for (const hold of await holds.on(tenant, resources)) {
    if (hold.proposal_id === own) continue;
    const holder = await proposals.get(tenant, hold.proposal_id);
    if (holder === undefined || !HOLDING.includes(holder.state)) continue;
    found.push({ resource: hold.resource, state: holder.state });
  }
  const first = (state: State): Held | undefined =>
    resources
      .map((resource) => found.find((one) => one.resource === resource && one.state === state))
      .find((one) => one !== undefined);
  // Found by break B4 after the review: a second filter here once made HOLDING dead code. HOLDING
  //   alone decides which states hold, and in which order they are reported.
  return HOLDING.map(first).find((one) => one !== undefined);
}

/**
 * The refusal of a command that binds a held record. It names the record, which the caller named,
 * and why it is held, never whose payment holds it: the proposal may be another person's.
 */
export function heldRefusal(resource: string): Refusal {
  const { entity, id } = parseUri(resource);
  const why = `${entity} ${preview(id)} is held while a payment's outcome is unknown; try again once it is reconciled`;
  return new Refusal("RESOURCE_HELD", why, "internal");
}

/**
 * Every contract whose in_flight.hold_on_unknown names an alias it does not bind: DSoR could not
 * know which record to hold (step 37's README, claim C5).
 */
export function holdProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const bind = contract["bind"];
    const binds = typeof bind === "object" && bind !== null ? Object.entries(bind) : [];
    for (const alias of holdsOf(contract)) {
      const path = binds.find(([name]) => name === alias)?.[1];
      if (path === undefined) {
        problems.push(
          `${contract.id}: in_flight.hold_on_unknown names ${JSON.stringify(alias)}, which the contract does not bind (DSOR-UNK-03b)`,
        );
        continue;
      }
      // Line ⑨ gives an address to what the input names and to the invoice of a payment, never
      //   to a vendor link, so a hold there would hold nothing. Found by step 37's review, F2.
      if (!ADDRESSED.some((form) => form.test(String(path)))) {
        problems.push(
          `${contract.id}: in_flight.hold_on_unknown names ${JSON.stringify(alias)}, which line ⑨ gives no address a hold can match: only input.<field>, or state.<alias>.invoice_id, can be held (DSOR-UNK-03b)`,
        );
      }
    }
  }
  return problems;
}
