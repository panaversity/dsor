// NEW IN STEP 17: line ③ of the checklist. An agent runs a command only under a person's
// delegation, its permission slip (DSOR-DEL-01a in specs/dsor/02-security.md, section 13).
// Delegations arrive in step 18, so today line ③ refuses every command an agent calls
// (step 17's README, decision 5).
import { Refusal } from "./envelope.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import type { Contract } from "./registry.ts";

/** Refuses an agent's command, which no delegation covers yet. A query, or a person's command, passes. */
export function checkDelegation(caller: Principal, contract: Contract): void {
  // A query changes nothing, so DSOR-DEL-01a asks no delegation for it. Anything else needs
  // one: when the answer is missing, the answer is no.
  if (contract["kind"] === "query") return;
  // One rule decides who is an agent: step 14's, which masking and the answer's agent_id use
  // too. So a type DSoR does not know is refused, and a person, an application, or the
  // system runs a command in its own name (step 17's README, decision 5).
  if (!actsAsAgent(caller)) return;
  // DSoR holds no delegation for anyone until step 18, so no agent's command is covered.
  const name = JSON.stringify(contract.id);
  const why = "is a command, and an agent runs a command only under a person's delegation";
  throw new Refusal("DELEGATION_REQUIRED", `${name} ${why}`);
}
