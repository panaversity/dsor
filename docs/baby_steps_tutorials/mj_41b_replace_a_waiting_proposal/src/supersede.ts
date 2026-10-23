// NEW IN STEP 41b: a new proposal that replaces a waiting one (DSOR-APR-12 in
//   specs/dsor/03-execution.md, section 26.1; step 41b's README). The new command names the old
//   proposal in its envelope's supersedes. Inside the new command's claim, DSoR checks who may
//   replace it and whether it still waits (this file's mayReplace), then cancels it, with its lines
//   and its booking, and only then checks the new command from the start.
import { Refusal } from "./envelope.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import { isProposalOf, proposalIdOf, type Proposal, type State } from "./proposals.ts";
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
