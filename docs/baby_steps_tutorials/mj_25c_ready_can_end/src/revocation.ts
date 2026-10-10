// DSoR's own work, and the tear-up of a permission slip. Most commands run the
// company's code, which works on the company's tables (operations.ts). A few commands change
// DSoR's own store instead, such as the tear-up of a slip. Their work has two parts. The check is
// DSoR's own look at line ⑨, before any work, so its refusal is a "no", as line ⑩'s is. The change
// gets DSoR's own stores after line ⑩, inside the claim's transaction, and the company's code
// never does (step 25's README, decisions D1, D2, and D7).
// The tear-up: the slip's delegator, or a tenant administrator, tears it up. Every proposal made
// under the slip that waits for an approval moves to CANCELLED, and its reservation is released,
// in the same transaction (DSOR-DEL-04a, DSOR-DEL-04c, and DSOR-DEL-06d in
// specs/dsor/02-security.md, section 13).
import { brakeWorkFor, type BrakeStore } from "./brakes.ts";
import { expiryWorkFor } from "./expiry.ts";
import type { WorkStores } from "./claims.ts";
import { Refusal, type Correlation } from "./envelope.ts";
import type { Mover } from "./log.ts";
import type { Principal } from "./principals.ts";
import { preview, type Contract } from "./registry.ts";
import type { Slip, SlipStore } from "./slips.ts";
import { parseUri } from "./uri.ts";

/** What DSoR's own check reads at line ⑨: the company, the caller and the caller's roles there, and the slips, read only. */
export type OwnLook = {
  tenant: string;
  caller: Principal;
  roles: readonly string[];
  slips: Pick<SlipStore, "get">;
  // And the brakes, read only, for the brake's own commands (step 25b's README,
  // decision D1).
  brakes: Pick<BrakeStore, "get">;
};

/** What DSoR's own change gets after line ⑩: the company, the caller, DSoR's stores, and the call. */
export type OwnStores = {
  tenant: string;
  caller: Principal;
  stores: WorkStores;
  correlation: Correlation;
  // The time of the call, which a record of a person's change names.
  now: string;
};

/** DSoR's own work for a command that changes DSoR's own store, never the company's. */
export type OwnWork = {
  // Line ⑨: DSoR's own look, before any work. It changes nothing, so a dry run runs it too.
  check: (input: unknown, look: OwnLook) => Promise<void>;
  // The work, after line ⑩, inside the claim's transaction.
  change: (input: unknown, work: OwnStores) => Promise<unknown>;
};

/** DSoR's own work, by the name of its operation. */
export function ownWorkFor(): Record<string, OwnWork> {
  // And the brake's two commands (step 25b's README, decision D1).
  // NEW IN STEP 25c: and the sweep, which expires READY proposals (step 25c's README, decision L3).
  return {
    "delegation.revoke": { check: mayTearUp, change: tearUp },
    ...brakeWorkFor(),
    ...expiryWorkFor(),
  };
}

/** What line ⑨ gives DSoR's own check: the caller's roles in this company only, and stores that can only read. */
export function lookFor(
  tenant: string,
  caller: Principal,
  slips: SlipStore,
  // And the brakes, read only too.
  brakes: BrakeStore,
): OwnLook {
  // The roles of this company only: a tenant administrator of org_789 is no tenant
  // administrator in org_456.
  const roles = caller.memberships.find((m) => m.tenant_id === tenant)?.roles ?? [];
  return {
    tenant,
    caller,
    roles,
    slips: { get: (company, id) => slips.get(company, id) },
    brakes: { get: (company, agent) => brakes.get(company, agent) },
  };
}

/** Every problem with DSoR's own work: work with no contract, a name with both kinds of code, and own work for a query. */
export function ownProblems(
  own: Record<string, OwnWork>,
  // Every id a contract file named, broken files too, so a broken contract is not also "none".
  named: ReadonlySet<string>,
  contracts: ReadonlyMap<string, Contract>,
  code: ReadonlyMap<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (const name of Object.keys(own)) {
    const kind = contracts.get(name)?.["kind"];
    if (!named.has(name)) problems.push(`${name} has DSoR's own work but no contract`);
    else if (code.has(name)) problems.push(`${name} has both company code and DSoR's own work`);
    else if (kind !== undefined && kind !== "command") {
      problems.push(`${name}: DSoR's own work changes DSoR's store, so it is a command`);
    }
  }
  return problems;
}

// The tutorial's own role for a tenant administrator. The specification names a tenant
// administrator in DSOR-DEL-04a, and defines no role for one (step 25's README, decision L2).
const TENANT_ADMIN = "tenant_admin";

/** The slip's id, from the input that line ⑥ checked. */
function slipIdOf(input: unknown): string {
  // Line ⑥ checked the input, and the check of the URIs that it names this company. The slip is
  // named in a field of its own: line ③ reads "delegation" as the authority the call claims
  // (DSOR-SRC-02b; step 25's README, decision D11).
  return parseUri((input as { slip: string }).slip).id;
}

/**
 * Line ⑨, for the tear-up: one look at the slip. Who first, then the slip's state. It changes
 * nothing, so a dry run hears the real call's answer.
 */
async function mayTearUp(input: unknown, look: OwnLook): Promise<void> {
  const { tenant, caller, roles, slips } = look;
  const id = slipIdOf(input);
  const found = await slips.get(tenant, id);
  const slip = found?.slip as Slip | undefined;
  // A person who may not tear up a slip hears one answer, for a slip that is not theirs and for a
  // slip that is not there, so the refusal says nothing of which slips exist (DSOR-ERR-01b). A
  // tenant administrator may tear up any slip of the company, so that person learns nothing new from
  // "no slip" (step 25's README, decision D3).
  const admin = roles.includes(TENANT_ADMIN);
  if (!admin && slip?.delegator !== caller.id) {
    const who = `${caller.id} may not tear up slip ${preview(id)}`;
    const why = `${who}: only its signer or a tenant administrator may`;
    const name = JSON.stringify("delegation.revoke");
    throw new Refusal("AUTHORIZATION_DENIED", `${name}: ${why}`, "internal");
  }
  if (found === undefined || slip === undefined) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no slip ${preview(id)}`, "internal");
  }
  if (slip.status === "revoked") {
    throw new Refusal("CONFLICT", `slip ${slip.id} is torn up already`, "internal");
  }
  if (slip.status === "expired" || found.past) {
    const why = `slip ${slip.id} is past its date, so there is nothing to tear up`;
    throw new Refusal("CONFLICT", why, "internal");
  }
}

/**
 * The tear-up's work, after line ⑩: one change that checks the slip again, with its record. Then
 * its waiting work is cancelled. It answers with the slip, and how many proposals it cancelled.
 */
async function tearUp(input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, caller, stores, correlation, now } = work;
  const id = slipIdOf(input);
  const { reason } = input as { reason: string };
  // The change and its record, in one step, which checks the slip again: still active or
  // suspended, and not past its date. Line ⑨ looked a moment before, and another call may have
  // changed the slip since (step 25's README, decisions D5 and D6).
  const why = { person: caller.id, as_of: now, words: reason, correlation };
  if (!(await stores.slips.revoke(tenant, id, why))) {
    throw new Refusal("CONFLICT", `slip ${id} changed while it was being torn up`, "internal");
  }
  // DSOR-DEL-04c: the slip's work that still waits moves to CANCELLED, each move with its record.
  // The person who tore up the slip made the move, through their own call, so the record names them
  // (DSOR-APR-01b; step 25's README, decision D15). NEW IN STEP 25c: a READY proposal is cancelled
  // too, as the learner proposed. Step 25 left it READY, because the picture drew no move from READY
  // to CANCELLED (step 25's README, decision L4; step 25c's README, claim C2).
  // DSOR-DEL-06d: and each cancelled proposal's reservation goes back to the day.
  const mover: Mover = {
    mode: "direct",
    subject: caller.id,
    actor_chain: [],
    subject_authority: { source: "token", as_of: now },
  };
  const by = { mover, cause: `slip ${id} was torn up`, correlation };
  let cancelled = 0;
  for (const waiting of await stores.proposals.waiting(tenant, id)) {
    // A move that finds the proposal moved on already changes nothing, so its reservation stays
    // and it is not counted. Approvals arrive in step 29, which must keep a tear-up and an
    // approval of one proposal apart.
    if (await stores.proposals.move(tenant, waiting.id, waiting.state, "CANCELLED", by)) {
      await stores.reservations.release(tenant, waiting.id);
      cancelled += 1;
    }
  }
  // The slip as DSoR keeps it now, a row of its company, so the decision record names its URI.
  // The answer counts the cancelled proposals, and each one's own record names it: a list could
  // outgrow the answer's size limit after the tear-up has committed (step 25's README, decision
  // D13). Found by step 25's review.
  return { tenant_id: tenant, id, status: "revoked", cancelled };
}
