// NEW IN STEP 38b: the escalation sweep, DSoR's own command alert.escalate_due (DSOR-UNK-04c in
// specs/dsor/03-execution.md, section 25.3). It hands each of the company's alerts still open after
// the company's escalate_after to the person alerts.json names, once, inside the claim's
// transaction, and answers with the proposals it escalated. Only a system login holding
// alert:escalate may call it, which line ⑤ checks: dsor-scheduler. A deployment's timer would call
// it every minute; this tutorial builds no timer, as for the expiry sweep (step 38b's README,
// decisions D3 and D4).
import { Refusal } from "./envelope.ts";
import { proposalUri } from "./proposals.ts";
import { preview } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { parseUri } from "./uri.ts";

/** Line ⑨: the company the sweep names must be the call's own, as for the expiry sweep. */
async function mayEscalate(input: unknown, look: OwnLook): Promise<void> {
  const { id } = parseUri((input as { company: string }).company);
  if (id !== look.tenant) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no company ${preview(id)} here`, "internal");
  }
}

/** The sweep's work, after line ⑩: every overdue open alert goes to the company's person. */
async function escalateDue(_input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, stores, alerting } = work;
  // Start-up refused a company where a login works and no alerts are named, so this is a bug.
  if (alerting === undefined) throw new Error(`${tenant} has no alerts, and start-up let it run`);
  const { escalate_to, escalate_ms } = alerting;
  const escalated = await stores.proposals.escalateDue(tenant, escalate_ms, escalate_to);
  return {
    tenant_id: tenant,
    escalated: escalated.map(({ proposal, raised_at }) => ({
      proposal: proposalUri(tenant, proposal),
      raised_at,
    })),
    to: escalate_to,
  };
}

/** DSoR's own work for the escalation sweep. */
export function escalationWorkFor(): Record<string, OwnWork> {
  return { "alert.escalate_due": { check: mayEscalate, change: escalateDue } };
}
