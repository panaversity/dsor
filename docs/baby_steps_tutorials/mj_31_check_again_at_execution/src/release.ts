// NEW IN STEP 31: proposal.execute, the release of a waiting proposal (§26.1, §26.4; step 31's
// README, decisions D2, D7, D12, and D13). Line ⑧ loads the proposal the input names, instead of
// making one. Line ⑨ first asks who may release it, and whether it waits to be released. Then the
// stored request is checked again on live data, and runs.
import { Refusal } from "./envelope.ts";
import { covers } from "./permissions.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import type { Proposal } from "./proposals.ts";
import type { Contract } from "./registry.ts";
import type { Slip } from "./slips.ts";

// The release's own extension: its caller is decided at line ⑨, once the proposal is loaded,
// not at line ⑤, which runs before DSoR knows which proposal is released. The specification's
// table says who: "the requester, or a human holding the target permission" (step 31's README,
// decision D12). A field of this tutorial's own, under its own name (DSOR-SCH-02).
/** True when the contract is a release, whose caller line ⑨ decides, not line ⑤. */
export function releases(contract: Contract): boolean {
  const extensions = contract["extensions"] as Record<string, unknown> | undefined;
  const ours = extensions?.["org.panaversity.steps"] as { release?: unknown } | undefined;
  return ours?.release === true;
}

// Only proposal.execute may skip line ⑤'s check, and it must say so: a flag that let any
// command skip it would let every caller in (step 31's README, decision D12).
/** A problem for each contract that misuses the release's extension. */
export function releaseProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const id = contract.id;
    if (releases(contract) && id !== "proposal.execute") {
      problems.push(
        `${id}: only proposal.execute is a release, so its "release" extension is refused`,
      );
    }
    if (!releases(contract) && id === "proposal.execute") {
      problems.push(
        `${id}: a release, whose caller line ⑨ decides, must say so with the "release" extension`,
      );
    }
  }
  return problems;
}

/** Who asks for the release: the caller, the slip line ③ found for an agent, and what it may do in this company now. */
export type Releaser = {
  caller: Principal;
  slip: Slip | undefined;
  held: ReadonlySet<string>;
};

/** The contract of the operation a proposal holds, without its version. */
export function targetOf(
  contracts: ReadonlyMap<string, Contract>,
  proposal: Proposal,
): Contract | undefined {
  return contracts.get(proposal.operation.split("@")[0] ?? proposal.operation);
}

// The messages name the proposal, its slip, and its state, which the caller may know: internal, as
// an approval's are (step 29's README, decision D5).
/**
 * Line ⑨'s gate for a release: who may release this proposal (D2), then whether it waits to be
 * released (D7). Who comes first, so a caller who may not release learns nothing of the
 * proposal but that it is there, as for an approval (step 29's README, decision D5).
 */
export async function mayRelease(
  found: Proposal,
  target: Contract,
  who: Releaser,
  // Whether the proposal's time has come, by the store's own clock.
  isDue: () => Promise<boolean>,
): Promise<void> {
  const { caller, slip, held } = who;
  const id = found.uri.slice(found.uri.lastIndexOf("/") + 1);
  // The permission of the operation the proposal holds, payment:create for a payment.
  const needed = (target["authorization"] as { permission: string }).permission;
  const no = (why: string) => {
    throw new Refusal(
      "AUTHORIZATION_DENIED",
      `${caller.id} may not release proposal ${id}: ${why}`,
      "internal",
    );
  };
  if (actsAsAgent(caller)) {
    // The agent that asked, and only under the slip it asked under (DSOR-APR-11).
    const asker = found.requester.actor_chain[0];
    const under = found.requester.delegation;
    if (asker !== caller.id || slip === undefined || under !== slip.id) {
      const asked = under === undefined ? "by a person" : `under slip ${under}`;
      no(`it was asked for ${asked}, not under ${caller.id}'s own`);
    }
    // And with the full permission: an agent that may only prepare may not release what it
    // prepared, which is why propose_only exists (D2).
    if (!covers(held, needed)) {
      no(`its slip allows ${needed}.propose only, and a release needs ${needed}`);
    }
  } else if (caller.type === "human") {
    // A person who holds the operation's own permission, in this company.
    if (!covers(held, needed)) no(`it needs ${needed}`);
  } else {
    no("only the agent that asked, or a person, releases");
  }
  // D7: only an APPROVED or a READY proposal is released.
  if (found.state === "PENDING_APPROVAL") {
    throw new Refusal(
      "APPROVAL_REQUIRED",
      `proposal ${id} still waits for an approval`,
      "internal",
    );
  }
  if (found.state !== "APPROVED" && found.state !== "READY") {
    const why = `proposal ${id} is ${found.state}, and only an APPROVED or a READY proposal is released`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // And only while its time has not come, though no sweep has moved it yet: its approval
  // expires with it (DSOR-APR-04a).
  if (await isDue()) {
    const why = `proposal ${id}'s time came at ${found.expires_at}, so it is not released`;
    throw new Refusal("CONFLICT", why, "internal");
  }
}
