// The sweep, DSoR's own command proposal.expire_due (step 25c's README, decisions
// L3, D1, D4, D8, and D9). It moves each of the company's READY proposals whose expires_at has come
// to EXPIRED, with a record that names the sweep's caller, and gives each one's booking back to the
// day (DSOR-DEL-06d in specs/dsor/02-security.md, section 13.4). All of it happens inside the claim's
// transaction, so every due proposal expires, or none does. Only a system login holding the
// permission proposal:expire may call it, which line ⑤ checks: dsor-scheduler. A deployment's timer
// would call it each night. This step builds no timer (step 25c's README, decision D14).
import { Refusal } from "./envelope.ts";
import type { Mover } from "./log.ts";
import { preview } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { parseUri } from "./uri.ts";

/**
 * Line ⑨: the company the sweep names must be the call's own. The check of the URIs refused
 * another company's URI before line ⑥; a URI of this company that names another company's id
 * is "no company", as a freeze's target is (step 25b's README, decision D2). Line ⑤ checked
 * proposal:expire, which is the rest of the rule (step 25c's README, decision D11).
 */
async function maySweep(input: unknown, look: OwnLook): Promise<void> {
  const { id } = parseUri((input as { company: string }).company);
  if (id !== look.tenant) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no company ${preview(id)} here`, "internal");
  }
}

/**
 * The sweep's work, after line ⑩: each due READY proposal moves to EXPIRED, with its record, and
 * its booking goes back to the day. It answers with the company, and how many proposals it expired.
 */
async function expireDue(_input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, caller, stores, correlation, now } = work;
  // The record names the caller that made the move through its own call, as a tear-up's records
  // name the person (step 25's README, decision D15; step 25c's README, decision D4).
  const mover: Mover = {
    mode: "direct",
    subject: caller.id,
    actor_chain: [],
    subject_authority: { source: "token", as_of: now },
  };
  const by = { mover, cause: "waited past its lifetime", correlation };
  let expired = 0;
  for (const id of await stores.proposals.due(tenant)) {
    // A move that finds the proposal moved on already, by a tear-up a moment before, changes
    // nothing, so its booking is not given back twice, and it is not counted.
    if (await stores.proposals.move(tenant, id, "READY", "EXPIRED", by)) {
      await stores.reservations.release(tenant, id);
      expired += 1;
    }
  }
  // A count, as the tear-up's answer counts what it cancelled. Each expired proposal's own record
  // names it (step 25c's README, decision D9).
  return { tenant_id: tenant, expired };
}

/** DSoR's own work for the sweep. */
export function expiryWorkFor(): Record<string, OwnWork> {
  return { "proposal.expire_due": { check: maySweep, change: expireDue } };
}
