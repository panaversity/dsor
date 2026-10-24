// A new proposal that replaces a waiting one (DSOR-APR-12 in
//   specs/dsor/03-execution.md, section 26.1; step 41b's README). The new command names the old
//   proposal in its envelope's supersedes. Inside the new command's claim, DSoR checks who may
//   replace it and whether it still waits (this file's mayReplace), then cancels it, with its lines
//   and its booking, and only then checks the new command from the start.
import type { WorkStores } from "./claims.ts";
import type { ReservationStore } from "./limits.ts";
import { Refusal, type Correlation } from "./envelope.ts";
import type { Mover } from "./log.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import {
  isProposalOf,
  proposalIdOf,
  type Proposal,
  type ProposalStore,
  type State,
} from "./proposals.ts";
import { preview } from "./registry.ts";
import type { Slip } from "./slips.ts";

/** Who asks for the replacement: the caller, and the slip line ③ found for an agent. */
export type Replacer = { caller: Principal; slip: Slip | undefined };

// The three states of D3: the proposal still waits, and nothing has left DSoR for it. From
//   EXECUTING on, the bank may hold the instruction, and the picture of §26.2 draws no move to
//   CANCELLED from there (step 41b's README, decision D3).
const REPLACEABLE: readonly State[] = Object.freeze(["READY", "PENDING_APPROVAL", "APPROVED"]);

/**
 * Line ⑨'s look at the proposal a call replaces, in the order of a release's gate: is it there, who
 * may replace it, what it is, then its state. Who comes before what, so a caller who may not replace
 * it learns nothing of it but that it is there (step 31's README, decision D2). It answers the
 * proposal it found, and refuses as `proposal.approve` and `proposal.execute` refuse
 * (step 41b's README, claim C3).
 */
export function mayReplace(
  found: Proposal | undefined,
  uri: string,
  tenant: string,
  who: Replacer,
  // Whether an operation is the company's code: a draft, a run, a send. DSoR's own work is not.
  companyCode: (operation: string) => boolean,
): Proposal {
  // Line ① checked the address's form, and the check after line ⑥ its company, so this is a bug.
  if (!isProposalOf(tenant, uri)) throw new Error("supersedes names no proposal of the company");
  const id = proposalIdOf(tenant, uri);
  if (found === undefined) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no proposal ${preview(id)}`, "internal");
  }
  const { caller, slip } = who;
  const no = (why: string): never => {
    const words = `${caller.id} may not replace proposal ${id}: ${why}`;
    throw new Refusal("AUTHORIZATION_DENIED", words, "internal");
  };
  const asked = found.requester;
  if (actsAsAgent(caller)) {
    // The agent that asked, and only under the slip it asked under, as a release binds it
    //   (DSOR-APR-11; decision D10). The words name neither the slip nor the person that asked.
    const asker = asked.actor_chain[0];
    if (asker !== caller.id || slip === undefined || asked.delegation !== slip.id) {
      no(`it was not asked for under ${caller.id}'s own slip`);
    }
  } else if (asked.identity_mode !== "direct" || asked.subject !== caller.id) {
    // A person, for their own direct request only: not for an agent's, though it acts for them
    //   (decision D5).
    no(`${caller.id} did not ask for it`);
  }
  // A line is replaced only with its run, as it is approved and released only with it (step 41's
  //   README, decision D7).
  if (found.run !== undefined) {
    const why = `proposal ${id} is a line of run ${proposalIdOf(tenant, found.run)}, and is replaced only with its run`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  if (!companyCode(found.operation.split("@")[0] ?? found.operation)) {
    const why = `proposal ${id} is DSoR's own work, which is not replaced`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  if (!REPLACEABLE.includes(found.state)) {
    const why = `proposal ${id} is ${found.state}, and only a READY, PENDING_APPROVAL, or APPROVED proposal is replaced`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  return found;
}

/** Who cancels the old proposal, and in which call: the caller, through their own call. */
export type CancelBy = { mover: Mover; correlation: Correlation };

/**
 * The old proposal and every line of it that still waits move to CANCELLED, the run first, each
 * move recorded with the new proposal as its cause. Then its booking goes back to the day. A move
 * that finds the old proposal moved on already is a CONFLICT: another call moved it a moment ago
 * (step 41b's README, decisions D6 to D8, and claim C4).
 */
export async function cancelReplaced(
  stores: Pick<WorkStores, "proposals" | "reservations">,
  tenant: string,
  old: Proposal,
  made: string,
  by: CancelBy,
): Promise<void> {
  const id = proposalIdOf(tenant, old.uri);
  const move = { ...by, cause: `replaced by proposal ${made}` };
  if (!(await stores.proposals.move(tenant, id, old.state, "CANCELLED", move))) {
    const why = `proposal ${id} moved on while it was being replaced`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // The run first, then its lines: the database moves a line to CANCELLED only with its run
  //   (decision D11).
  const withRun = { ...by, cause: `its run was replaced by proposal ${made}` };
  for (const line of await stores.proposals.lines(tenant, old.uri)) {
    if (!REPLACEABLE.includes(line.state)) continue;
    if (!(await stores.proposals.move(tenant, line.id, line.state, "CANCELLED", withRun))) {
      throw new Error(`the line ${line.id} moved while its run was replaced`);
    }
  }
  // The old booking goes back before the new command books, so the new one may use its room
  //   (decision D7). A run's booking is the run's; its lines hold none.
  await stores.reservations.release(tenant, id);
}

/**
 * For a dry run of a replacement: the stores a dry run reads, as they would be once the old
 * proposal were cancelled. Its proposal and its lines are left out of what is in flight over a
 * bill, and its booking counts as given back. Nothing is changed: a dry run writes nothing
 * (DSOR-OPR-05, DSOR-OPR-06; step 41b's README, claim C9).
 */
export async function asIfReplaced(
  proposals: ProposalStore,
  reservations: ReservationStore,
  tenant: string,
  old: Proposal,
): Promise<{ proposals: ProposalStore; reservations: ReservationStore }> {
  const id = proposalIdOf(tenant, old.uri);
  const gone = new Set([id, ...(await proposals.lines(tenant, old.uri)).map((line) => line.id)]);
  return {
    proposals: {
      ...proposals,
      inFlightOver: async (company, uri) =>
        (await proposals.inFlightOver(company, uri)).filter((other) => !gone.has(other.id)),
    },
    reservations: {
      ...reservations,
      fits: (company, delegation, amount, limit) =>
        reservations.fits(company, delegation, amount, limit, id),
    },
  };
}
