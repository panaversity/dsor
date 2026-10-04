// Line ③ of the checklist. An agent calls only under a person's permission slip, which
// DSoR finds in its own store (DSOR-DEL-01a, DSOR-DEL-07, and DSOR-DEL-08 in
// specs/dsor/02-security.md, section 13).
import { Refusal } from "./envelope.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import type { Contract } from "./registry.ts";
import { slipProblems, type Slip, type SlipStore } from "./slips.ts";

/**
 * Finds the usable slip an agent calls under, or refuses the call. A person, an
 * application, or the system calls in its own name, and needs none.
 */
// NEW IN STEP 18: every call from an agent needs a slip, a read too, because the agent calls
// as itself with no person present: `unattended` (DSOR-DEL-07; step 18's README, decisions 1
// and 2). Step 17 refused every agent's command here, because no slip existed yet.
export async function checkDelegation(
  caller: Principal,
  contract: Contract,
  slips: SlipStore,
  // The active company, which line ② checked.
  tenant: string,
): Promise<Slip | undefined> {
  // One rule decides who is an agent: step 14's, which masking and the answer's agent_id
  // use too (step 17's README, decision 5).
  if (!actsAsAgent(caller)) return undefined;
  const name = JSON.stringify(contract.id);
  // The slip comes from DSoR's store, never from the request, and its delegator is the
  // person the agent works for (DSOR-DEL-08). One slip per agent and company, so DSoR never
  // chooses between two (step 18's README, decision 7).
  const found = await slips.find(tenant, caller.id);
  if (found === undefined) {
    const why = `${caller.id} holds no person's slip in ${tenant}`;
    throw new Refusal("DELEGATION_REQUIRED", `${name} needs a slip: ${why}`);
  }
  // A slip that breaks the specification's schema is a fault in DSoR's own store, not the
  // agent's, so the call fails as any bug does (step 18's README, decision 13). The message
  // names no field: what is wrong is for the people who keep the store.
  if (slipProblems(found.slip).length > 0) {
    throw new Refusal("INTERNAL_ERROR", "the slip DSoR holds for this agent is not a valid slip");
  }
  const slip = found.slip as Slip;
  // The store was asked for this agent in this company. A slip of anyone else, or of
  // another company, is a fault in the store, and is never used. The same rule as step
  // 10's check of the code's answer: DSoR does not trust its own parts to keep a company.
  if (slip.tenant !== tenant || slip.delegate !== caller.id) {
    throw new Refusal("INTERNAL_ERROR", "the store answered with a slip of someone else");
  }
  // A torn-up slip, and a slip past its date by the store's clock, have codes of their own
  // in §28 (step 18's README, decisions 5 and 12).
  if (slip.status === "revoked") {
    throw new Refusal("DELEGATION_REVOKED", `${name}: slip ${slip.id} was torn up`);
  }
  if (slip.status === "expired" || found.past) {
    throw new Refusal("DELEGATION_EXPIRED", `${name}: slip ${slip.id} is past its date`);
  }
  if (slip.status !== "active") {
    const why = `slip ${slip.id} is ${slip.status}, not active`;
    throw new Refusal("DELEGATION_REQUIRED", `${name}: ${why}`);
  }
  // The agent calls as itself, so the slip must allow that mode (DSOR-DEL-07).
  if (!slip.modes.includes("unattended")) {
    const why = `slip ${slip.id} does not allow unattended calls`;
    throw new Refusal("DELEGATION_REQUIRED", `${name}: ${why}`);
  }
  // A sub-slip may grant nothing its parent lacks (DSOR-DEL-05b), and nothing here checks
  // that yet, so it is not used (step 18's README, decision 13).
  if (slip.parent !== undefined) {
    const why = `slip ${slip.id} is a sub-slip of ${slip.parent}, which DSoR cannot check yet`;
    throw new Refusal("DELEGATION_REQUIRED", `${name}: ${why}`);
  }
  // A constraint that nothing checks would be a promise nobody keeps (step 18's README,
  // decision 6).
  const constraints = Object.keys(slip.constraints);
  if (constraints.length > 0) {
    const why = `slip ${slip.id} carries ${constraints.join(", ")}, which DSoR cannot check yet`;
    throw new Refusal("DELEGATION_REQUIRED", `${name}: ${why}`);
  }
  return slip;
}
