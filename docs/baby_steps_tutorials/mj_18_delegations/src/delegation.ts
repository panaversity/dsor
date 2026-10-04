// Line ③ of the checklist. An agent runs a command only under a person's delegation, its
// permission slip (DSOR-DEL-01a in specs/dsor/02-security.md, section 13).
// Step 18's red commit: the shape of line ③ with slips, and step 17's behaviour still.
import { Refusal } from "./envelope.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import type { Contract } from "./registry.ts";
import type { Slip, SlipStore } from "./slips.ts";

/** Refuses an agent's command, which no delegation covers yet. A query, or a person's command, passes. */
export async function checkDelegation(
  caller: Principal,
  contract: Contract,
  _slips: SlipStore,
  _tenant: string,
): Promise<Slip | undefined> {
  if (contract["kind"] === "query") return undefined;
  if (!actsAsAgent(caller)) return undefined;
  const name = JSON.stringify(contract.id);
  const why = "is a command, and an agent runs a command only under a person's delegation";
  throw new Refusal("DELEGATION_REQUIRED", `${name} ${why}`);
}
