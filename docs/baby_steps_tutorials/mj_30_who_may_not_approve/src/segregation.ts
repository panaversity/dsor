// NEW IN STEP 30: segregation of duties, who may not approve (§16; step 30's README, decisions D1
// to D4). The person who asked for something must not be the person who approves it. An agent acts
// for the person who signed its slip, so that person may not approve the agent's requests either.
import type { Requester } from "./proposals.ts";
import type { Slip, SlipStore } from "./slips.ts";

/**
 * Why this person is in the requesting chain of a proposal, in words, or undefined when they are
 * not (DSOR-SOD-02). The chain comes from DSoR's own records, never from the approval call: the
 * requester that line ⑧ wrote, and the slip it names, read from DSoR's store of slips (decision D1).
 */
export async function inChain(
  requester: Requester,
  person: string,
  slips: Pick<SlipStore, "get">,
  tenant: string,
): Promise<string | undefined> {
  // Not any actor: the agents that acted in the request.
  if (requester.actor_chain.includes(person)) return `${person} acted in the request`;
  // Not the delegator of an acting agent: the person who signed the slip the request names.
  const slipId = requester.delegation;
  if (slipId !== undefined) {
    const found = await slips.get(tenant, slipId);
    const signer = (found?.slip as Slip | undefined)?.delegator;
    if (signer === person) {
      return `${person} signed slip ${slipId}, which the agent that asked works under`;
    }
  }
  // Not the subject: the person the request is for. For an agent's call, step 18 records the
  // slip's signer here too, so a slip that could not be read still leaves its signer out.
  if (requester.subject !== person) return undefined;
  return slipId === undefined
    ? `${person} asked for it`
    : `the request is ${person}'s, through slip ${slipId}`;
}
