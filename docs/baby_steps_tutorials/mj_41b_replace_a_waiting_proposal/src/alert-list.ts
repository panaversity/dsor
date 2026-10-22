// alert.list, DSoR's first query over its own store (DSOR-UNK-04b and DSOR-UNK-04c
// in specs/dsor/03-execution.md, section 25.3). It shows a person of the company's receivers role
// every unsettled alert, and the company's named person the ones escalated to them; anyone else is
// refused. Each alert names its payment and invoice, read from its proposal. The list pages as
// invoice.list does, and its reads are labelled current, from DSoR's own store, as every query's
// are (DSOR-QRY-01, DSOR-FRS-01a; step 38c's README, decisions D1 to D7).
import type { Alert, Alerting } from "./alerts.ts";
import { Refusal } from "./envelope.ts";
import { checkedLabel, type Reads } from "./freshness.ts";
import { pageOf, pageSize } from "./pages.ts";
import type { Principal } from "./principals.ts";
import type { Proposal, ProposalStore } from "./proposals.ts";
import type { Contract } from "./registry.ts";

/** DSoR's own store, read only and bound to one company, for a query of DSoR's own. */
export type OwnReadLook = {
  tenant: string;
  caller: Principal;
  // The caller's roles in this company only.
  roles: readonly string[];
  // The company's alerts.json line, which start-up checked.
  alerting: Alerting | undefined;
  // A page of the company's unsettled alerts in these states, after this id, at most this many.
  unsettled: (
    states: readonly ("open" | "escalated")[],
    after: string | undefined,
    count: number,
  ) => Promise<Alert[]>;
  proposal: (id: string) => Promise<Proposal | undefined>;
};

/**
 * DSoR's own read, for a query over DSoR's own store. It changes nothing. Its check runs before
 * the work, so a refusal is recorded as a denial (found by step 38c's review, H2).
 */
export type OwnRead = {
  check: (input: unknown, look: OwnReadLook) => Promise<void>;
  read: (input: unknown, look: OwnReadLook) => Promise<unknown>;
};

// The connector a read of DSoR's own store names in its label. DSoR's store is not a company
//   connector, so this is the tutorial's own name (step 38c's README, decision D6).
const OWN_STORE = "dsor";

/**
 * The look, bound to one company: every read is that company's, whatever the code passes, and
 * notes its label, current, in the call's reads, which the code never holds. Once line ⑨ has
 * ended, it reads nothing more, as a Company does (step 15's README, decision 5).
 */
export function ownReadOf(
  proposals: Pick<ProposalStore, "unsettled" | "get">,
  tenant: string,
  caller: Principal,
  alerting: Alerting | undefined,
  reads: Reads,
): OwnReadLook {
  const open = (): void => {
    if (reads.closed) throw new Error("this call has ended, so DSoR's store reads nothing more");
  };
  // Read now, never kept, so current; observed when the read starts (DSOR-FRS-01b).
  const note = (observed_at: string): void => {
    reads.labels.push(checkedLabel({ mode: "current", observed_at, connector: OWN_STORE }));
  };
  const roles = caller.memberships.find((m) => m.tenant_id === tenant)?.roles ?? [];
  return Object.freeze({
    tenant,
    caller,
    roles,
    alerting,
    unsettled: async (states, after, count) => {
      open();
      const observed_at = new Date().toISOString();
      const found = await proposals.unsettled(tenant, states, after, count);
      open();
      note(observed_at);
      return found;
    },
    proposal: async (id: string) => {
      open();
      const observed_at = new Date().toISOString();
      const found = await proposals.get(tenant, id);
      open();
      note(observed_at);
      return found;
    },
  });
}

/** One alert as the list shows it: a row of its company, named by its proposal's id. */
type Listed = Record<string, unknown> & { id: string };

/**
 * The states of the alerts this caller sees, or a refusal: whom alerts.json names (decision D1).
 * The receivers role sees every unsettled alert, open and escalated (decision D3); the named
 * person every escalated one, whoever it went to, so a change of person orphans none (the
 * learner's choice after step 38c's review, M2; decision D8).
 */
function statesFor(look: OwnReadLook): readonly ("open" | "escalated")[] {
  const { alerting, caller, roles, tenant } = look;
  // Start-up refused a company where a login works and no alerts are named, so this is a bug.
  if (alerting === undefined) throw new Error(`${tenant} has no alerts, and start-up let it run`);
  if (roles.includes(alerting.receivers)) return ["open", "escalated"];
  if (caller.id === alerting.escalate_to) return ["escalated"];
  const why = `alerts.json names neither ${caller.id} nor a role it holds as one who sees ${tenant}'s alerts`;
  throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
}

/** Line ⑨'s check, before the work: the caller is one alerts.json names. */
async function mayList(_input: unknown, look: OwnReadLook): Promise<void> {
  statesFor(look);
}

/** The read: a page of the alerts meant for the caller, in the order of their proposals' ids. */
async function listAlerts(input: unknown, look: OwnReadLook): Promise<unknown> {
  // Line ⑥ has checked the input against AlertListRequest.
  const { limit, cursor } = input as { limit?: number; cursor?: string };
  // One row more than the page holds, to know whether another page follows. The cursor is a
  //   place in this company's list, never a lookup (step 13's README, decision 4).
  const seen = await look.unsettled(statesFor(look), cursor, pageSize(limit) + 1);
  const rows: Listed[] = [];
  for (const alert of seen) {
    const proposal = await look.proposal(alert.proposal);
    if (proposal === undefined) throw new Error(`alert ${alert.proposal} has no proposal`);
    // The payment and the invoice the proposal sends, as line ⑥ checked them (decision D4). Only
    //   a payment's send goes unknown today; any other shape is a bug, never a row without them.
    const { payment, invoice } = proposal.payload as { payment?: unknown; invoice?: unknown };
    if (typeof payment !== "string" || typeof invoice !== "string") {
      throw new Error(`alert ${alert.proposal}'s proposal names no payment and invoice`);
    }
    rows.push({
      // The alert's own company and its proposal's own address, as the store keeps them, so the
      //   answer's company check reads them from the alert (found by step 38c's review, M1).
      tenant_id: alert.tenant_id,
      id: alert.proposal,
      proposal: proposal.uri,
      state: alert.state,
      raised_at: alert.raised_at,
      ...(alert.escalated_to === undefined
        ? {}
        : { escalated_to: alert.escalated_to, escalated_at: alert.escalated_at }),
      payment,
      invoice,
    });
  }
  return pageOf(rows, limit);
}

/** DSoR's own reads: alert.list. */
export function ownReadsFor(): Record<string, OwnRead> {
  return { "alert.list": { check: mayList, read: listAlerts } };
}

/** Every problem with DSoR's own reads: a read with no contract, with company code, or a command. */
export function ownReadProblems(
  reads: Record<string, OwnRead>,
  named: ReadonlySet<string>,
  contracts: ReadonlyMap<string, Contract>,
  code: ReadonlyMap<string, unknown>,
  own: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (const name of Object.keys(reads)) {
    const kind = contracts.get(name)?.["kind"];
    if (!named.has(name)) problems.push(`${name} has DSoR's own read but no contract`);
    else if (code.has(name) || Object.hasOwn(own, name)) {
      problems.push(`${name} has DSoR's own read and other code`);
    } else if (kind !== undefined && kind !== "query") {
      problems.push(`${name}: DSoR's own read changes nothing, so it is a query`);
    }
  }
  return problems;
}
