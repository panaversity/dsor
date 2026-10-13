// NEW IN STEP 29: an approval, the record of one person's yes to one waiting proposal, in the
// shape of the specification's approval.schema.json (DSOR-APR-02a; step 29's README, decisions D7
// and D8). And the count of approvals against what a proposal waits for: a proposal is APPROVED
// only when each requirement has its quorum of approvers (DSOR-AUT-02c; decisions D3 and D9).
// Both stores of proposals count with these functions, while no other approval of the company runs.
import type { Requirement } from "./envelope.ts";

/** One requirement an approval satisfies, as approval.schema.json writes it. */
export type Satisfied = {
  control: string;
  version: number;
  requirement: { role: string; quorum: number };
};

/** One approver, as approval.schema.json writes it: who, on what basis, and when they logged in. */
export type Approver = { principal: string; basis: string; authn: { at: string } };

/** The risk levels of common.schema.json. */
export type Risk = "low" | "medium" | "high" | "critical";

/** An approval as DSoR keeps it, in the shape of approval.schema.json. */
export type Approval = {
  id: string;
  proposal: string;
  operation: string;
  tenant: string;
  resources: string[];
  payload_hash: string;
  risk: Risk;
  bound_state: { mode: "predicate" | "strict_version"; versions: Record<string, number> };
  satisfies: Satisfied[];
  approvers: Approver[];
  sod_mode: "standard";
  status: "active";
  expires_at: string;
};

/**
 * What an approver offers: the approval's id, the target's risk, the state DSoR read for it, and
 * who they are, with their roles in the company. The rest the store takes from the proposal, and
 * decides what the approval satisfies, while no other approval of the company runs (decision D9).
 */
export type Offer = Pick<Approval, "id" | "risk" | "bound_state"> & {
  approver: string;
  roles: readonly string[];
  at: string;
};

/** The waiting proposal an approval binds, as the store read it. */
export type Bindable = {
  uri: string;
  tenant: string;
  operation: string;
  resources: string[];
  payload_hash: string;
  expires_at: string;
  requires: Requirement[];
};

/** What one offer did: the approval kept, the proposal's state, and what it still waits for. */
export type Approving =
  | { approval: Approval; state: "PENDING_APPROVAL" | "APPROVED"; waits_for: Requirement[] }
  // Or why the store kept none: the proposal no longer waits, or its time has come, or this person
  // approved it already, or nothing it still waits for asks for a role this person holds.
  | { refused: "moved" | "expired" | "twice" | "nothing_open"; state?: string };

// apr_ and a random UUID: this tutorial's own form of an approval's id, which the database's CHECK
// keeps too (step 29's README, decision D7).
const APPROVAL_ID = /^apr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether an approval's line names this requirement: the same rule, the same version. */
function names(line: Satisfied, requirement: Requirement): boolean {
  return line.control === requirement.control && line.version === requirement.control_version;
}

/** What a proposal still waits for: each requirement with fewer approvers than its quorum. */
export function stillOpen(
  requires: readonly Requirement[],
  given: readonly Approval[],
): Requirement[] {
  return requires.filter((requirement) => {
    const approvers = given.filter((approval) =>
      approval.satisfies.some((line) => names(line, requirement)),
    );
    return approvers.length < requirement.approval.quorum;
  });
}

/**
 * The approval an offer makes: each requirement still open whose role the approver holds. One
 * person counts once for one proposal, so a second offer of theirs makes none (decision D3).
 */
export function approvalOf(
  proposal: Bindable,
  given: readonly Approval[],
  offer: Offer,
): Approval | "twice" | "nothing_open" {
  if (!APPROVAL_ID.test(offer.id)) {
    throw new Error(`${JSON.stringify(offer.id)} is not an approval's id: apr_ and a random UUID`);
  }
  if (given.some((approval) => approval.approvers.some((a) => a.principal === offer.approver))) {
    return "twice";
  }
  const open = stillOpen(proposal.requires, given);
  const met = open.filter((requirement) => offer.roles.includes(requirement.approval.role));
  if (met.length === 0) return "nothing_open";
  // The basis names each role the approval counts for, once, in the order of what it satisfies.
  const basis = [...new Set(met.map((r) => `role:${r.approval.role}`))].join(", ");
  return {
    id: offer.id,
    proposal: proposal.uri,
    operation: proposal.operation,
    tenant: proposal.tenant,
    resources: [...proposal.resources],
    payload_hash: proposal.payload_hash,
    risk: offer.risk,
    bound_state: structuredClone(offer.bound_state),
    satisfies: met.map((r) => ({
      control: r.control,
      version: r.control_version,
      requirement: { ...r.approval },
    })),
    approvers: [{ principal: offer.approver, basis, authn: { at: offer.at } }],
    sod_mode: "standard",
    status: "active",
    // DSOR-APR-04a: it expires with its proposal, which step 25c caps at 30 days, §44's longest
    // life at L2 (decision D11).
    expires_at: proposal.expires_at,
  };
}
