// proposal.approve, DSoR's own command for a person's approval of a waiting proposal
// (§26.1; step 29's README, decisions D1 to D14). Line ⑨ looks first, and changes nothing: which
// proposal, whether this person may approve its operation, whether they are in its requesting chain
// (step 30), its state, their roles and their earlier approval, and last the fingerprint. The work after line ⑩ asks the store for one step: the
// approval, and the move to APPROVED when it is the last one the proposal waits for.
import { randomUUID } from "node:crypto";
import { stillOpen, type Approving, type Offer, type Risk } from "./approvals.ts";
import { readBound, type BoundRead } from "./bound.ts";
import { payloadHash } from "./canonical.ts";
import { lineOperationOf, type RunLine } from "./run.ts";
import { Refusal } from "./envelope.ts";
import { approvePermissionOf } from "./permissions.ts";
import { isProposalOf, proposalIdOf, type MoveBy, type Proposal } from "./proposals.ts";
import { preview, type Contract } from "./registry.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { inChain } from "./segregation.ts";

/** The input that line ⑥ checked: the proposal's URI, and the fingerprint the approver saw. */
// And, for a run, its fingerprint and its totals, as the approver saw them.
type ApproveInput = {
  proposal: string;
  payload_hash: string;
  manifest_hash?: string;
  totals?: unknown[];
  vendor_totals?: unknown[];
};

const NAME = JSON.stringify("proposal.approve");

/** The contract of the operation a proposal names, without its version. */
function targetOf(
  contracts: ReadonlyMap<string, Contract>,
  proposal: Proposal,
): Contract | undefined {
  return contracts.get(proposal.operation.split("@")[0] ?? proposal.operation);
}

/**
 * Line ⑨, for an approval: one look, in decision D5's order. Who may approve the operation is
 * asked before the state, so a person who may not approve learns nothing of the proposal but that
 * it is there. The fingerprint is compared last (DSOR-APR-09).
 */
async function mayApprove(input: unknown, look: OwnLook): Promise<void> {
  const { tenant, caller, roles } = look;
  const { proposal: uri, payload_hash } = input as ApproveInput;
  // DSOR-APR-05a: a person's own call, on the login DSoR gave them. Line ⑤ refused every caller that
  // is not a person, by the contract's people_only. This is DSoR's own second look, by the call's
  // identity mode and the caller's type, so an approval never rests on one flag (decision D10).
  if (look.identity !== "direct") {
    const why = `${NAME} is accepted only in direct identity mode, on the approver's own login`;
    throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
  }
  // And a person's: a system login calls in direct mode too. Found by step 29's review, finding
  // L4: with people_only lost, a system login holding the CFO's role approved.
  if (caller.type !== "human") {
    const why = `${NAME} is accepted only from a person, on their own login`;
    throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
  }
  // An address whose id is not a proposal's names no proposal. Line ⑥'s schema lets any id
  // through, so another company's address meets line ②'s refusal first. Found by step 29's
  // review, finding L1: the parse below threw, and the caller heard INTERNAL_ERROR.
  if (!isProposalOf(tenant, uri)) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no proposal ${preview(uri)}`, "internal");
  }
  const id = proposalIdOf(tenant, uri);
  const found = await look.proposals.get(tenant, id);
  if (found === undefined) {
    throw new Refusal("RESOURCE_NOT_FOUND", `no proposal ${preview(id)}`, "internal");
  }
  // DSOR-APR-07: the permission that decides is the target operation's approve_permission.
  const needed = approvePermissionOf(targetOf(look.contracts, found));
  if (needed === undefined) {
    const why = `${found.operation} names no approve_permission, so no one approves it`;
    throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
  }
  if (!look.permissions.has(needed)) {
    const why = `${caller.id} may not approve ${found.operation}: it needs ${needed}`;
    throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
  }
  // DSOR-SOD-02: no one in the requesting chain approves: not the person who asked,
  // not the person who signed the slip of the agent that asked, not an actor. Owner-approval mode is
  // not built, so this always applies. A no here comes before any work (step 30's README, decisions
  // D3 and D9).
  const chain = await inChain(found.requester, caller.id, look.slips, tenant);
  if (chain !== undefined) {
    const why = `${caller.id} may not approve proposal ${id}: ${chain}`;
    throw new Refusal("SOD_VIOLATION", why, "internal");
  }
  // A line of a run is approved only with its run, never alone, so one approval
  //   covers the whole list it was shown (step 41's README, decision D7). Before its state, so a
  //   line that waits is refused for what it is.
  if (found.run !== undefined) {
    const why = `proposal ${id} is a line of run ${proposalIdOf(tenant, found.run)}, and is approved only with its run`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  if (found.state !== "PENDING_APPROVAL" || found.requires === undefined) {
    const why = `proposal ${id} is ${found.state}, and only a PENDING_APPROVAL proposal is approved`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // DSOR-APR-04a: and only while its time has not come, though no sweep has moved it yet. The
  // store's own clock decides, as it does for the sweep. Found by step 29's review, finding L2: a dry
  // run said yes, and the real call's work said no.
  if (await look.proposals.isDue(tenant, id)) {
    const why = `proposal ${id}'s time came at ${found.expires_at}, so it is not approved`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // Decision D3: a role the proposal waits for, in this company.
  const asked = [...new Set(found.requires.map((requirement) => requirement.approval.role))];
  if (!asked.some((role) => roles.includes(role))) {
    const why = `${caller.id} holds none of the roles proposal ${id} waits for: ${asked.join(", ")}`;
    throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
  }
  const given = await look.proposals.approvals(tenant, id);
  if (given.some((approval) => approval.approvers.some((a) => a.principal === caller.id))) {
    throw new Refusal("CONFLICT", `${caller.id} approved proposal ${id} already`, "internal");
  }
  const open = stillOpen(found.requires, given);
  if (!open.some((requirement) => roles.includes(requirement.approval.role))) {
    const why = `what ${caller.id} may approve of proposal ${id} is approved already`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // DSOR-APR-09: last, the fingerprint. The approver approves the request with this fingerprint,
  // and no other.
  // Changed in step 41: the message names it the payload hash, because a run has a second
  //   fingerprint, over its lines, and the approver must know which of the two did not match.
  if (payload_hash !== found.payload_hash) {
    const why = `the payload hash is not the one of proposal ${id}'s request`;
    throw new Refusal("APPROVAL_MISMATCH", why, "internal");
  }
  // And a run's approval binds its fingerprint and its totals too, each compared as
  //   the approver sent it, with the run's own, written when it started to wait. One draft has
  //   none of them, so an approval that carries one is not an approval of it (DSOR-BAT-02a; step
  //   41's README, decision D4).
  const { manifest_hash, totals, vendor_totals } = input as ApproveInput;
  if (found.manifest_hash === undefined) {
    if (manifest_hash !== undefined || totals !== undefined || vendor_totals !== undefined) {
      const why = `proposal ${id} is not a run, so it has no fingerprint of lines and no totals`;
      throw new Refusal("APPROVAL_MISMATCH", why, "internal");
    }
    return;
  }
  if (manifest_hash !== found.manifest_hash) {
    const why = `the fingerprint is not the one of run ${id}'s lines in their order`;
    throw new Refusal("APPROVAL_MISMATCH", why, "internal");
  }
  if (totals === undefined || payloadHash(totals) !== payloadHash(found.totals)) {
    throw new Refusal("APPROVAL_MISMATCH", `the totals are not run ${id}'s`, "internal");
  }
  if (
    vendor_totals === undefined ||
    payloadHash(vendor_totals) !== payloadHash(found.vendor_totals)
  ) {
    const why = `the totals per vendor are not run ${id}'s`;
    throw new Refusal("APPROVAL_MISMATCH", why, "internal");
  }
}

/** The risk level a contract names. Start-up checked every contract against the schema. */
function riskOf(contract: Contract): Risk {
  return (contract["risk"] as { level: Risk }).level;
}

/** The words of a refusal of the store's step, which ran after line ⑨'s look. */
function wordsOf(
  id: string,
  person: string,
  done: Extract<Approving, { refused: string }>,
): string {
  if (done.refused === "moved") {
    return `proposal ${id} moved on to ${done.state ?? "another state"} while it was being approved`;
  }
  if (done.refused === "expired") return `proposal ${id} expired before it was approved`;
  if (done.refused === "twice") return `${person} approved proposal ${id} already`;
  return `what ${person} may approve of proposal ${id} is approved already`;
}

/**
 * The approval's work, after line ⑩, inside the claim's transaction: the approval, in its shape,
 * and the store's one step. It answers with the approval's id, the proposal's state after it, what
 * the proposal still waits for, and when the approval expires (decision D14).
 */
async function approve(input: unknown, work: OwnStores): Promise<unknown> {
  const { tenant, caller, stores, correlation, now, contracts, events } = work;
  const { proposal: uri } = input as ApproveInput;
  const id = proposalIdOf(tenant, uri);
  const found = await stores.proposals.get(tenant, id);
  const target = found === undefined ? undefined : targetOf(contracts, found);
  // Line ⑨ found both a moment ago, and neither goes away.
  if (found === undefined || target === undefined)
    throw new Error("the proposal line ⑨ found is gone");
  // Decision D7: the state that the target's contract binds, as DSoR reads it now: the version of
  // each invoice the proposal names. A critical operation's approval binds it strictly, as
  // approval.schema.json asks.
  // Changed in step 33: each bound record by its own address, as line ⑨ reads it, so the vendor is
  //   bound as a vendor. Since step 32 every record of the state was named as an invoice, VENDOR-44
  //   too (step 33's README, found while building). A record that is not there has no version.
  const read: BoundRead[] = [];
  // A run binds what each of its lines binds, read with the contract of its lines,
  //   in the order of the lines. Found by step 41's review, M3: the run's own contract binds
  //   nothing, so its approval kept no version.
  const ofLines = contracts.get(lineOperationOf(target) ?? "");
  const requests =
    ofLines === undefined
      ? [{ contract: target, payload: found.payload }]
      : (found.payload as { lines: RunLine[] }).lines.map((line) => ({
          contract: ofLines,
          payload: line,
        }));
  // Changed in step 37: with the payments, for a contract that binds one.
  for (const request of requests) {
    await readBound(
      request.contract,
      request.payload,
      stores.invoices,
      tenant,
      (one) => read.push(one),
      stores.payments,
    );
  }
  const versions = Object.fromEntries(
    read.flatMap((one) => (one.version === undefined ? [] : [[one.uri, one.version]])),
  );
  const risk = riskOf(target);
  const roles = caller.memberships.find((m) => m.tenant_id === tenant)?.roles ?? [];
  const offer: Offer = {
    id: `apr_${randomUUID()}`,
    risk,
    bound_state: { mode: risk === "critical" ? "strict_version" : "predicate", versions },
    approver: caller.id,
    roles,
    // This tutorial's logins carry no time of their own, so the time of the call (decision D7).
    at: now,
  };
  // DSOR-APR-01b: the move to APPROVED names the approver, who made it through their own call.
  const by: MoveBy = {
    mover: {
      mode: "direct",
      subject: caller.id,
      actor_chain: [],
      subject_authority: { source: "token", as_of: now },
    },
    cause: `approved by ${caller.id}`,
    correlation,
  };
  const done = await stores.proposals.approve(tenant, id, offer, by);
  if ("refused" in done) throw new Refusal("CONFLICT", wordsOf(id, caller.id, done), "internal");
  // A run approved approves every line that waited for it, in the same step, each
  //   move with its record. A line that waited READY asked for no one, and stays READY for the
  //   release (step 41's README, claim C6).
  if (done.state === "APPROVED" && found.manifest_hash !== undefined) {
    for (const line of await stores.proposals.lines(tenant, uri)) {
      if (line.state !== "PENDING_APPROVAL") continue;
      const withRun = { ...by, cause: `approved with its run ${id} by ${caller.id}` };
      if (
        !(await stores.proposals.move(tenant, line.id, "PENDING_APPROVAL", "APPROVED", withRun))
      ) {
        throw new Error(`the line ${line.id} moved while its run was approved`);
      }
    }
  }
  const answer = {
    tenant_id: tenant,
    id: done.approval.id,
    proposal: uri,
    state: done.state,
    waits_for: done.waits_for,
    expires_at: done.approval.expires_at,
  };
  // The approval that moved the proposal to APPROVED writes its event, in the same
  //   transaction; one that leaves it waiting writes none (step 40's README, claim C3).
  if (done.state === "APPROVED") await events.write("proposal.approved", uri, "Approval", answer);
  return answer;
}

/** DSoR's own work for proposal.approve. */
export function approveWorkFor(): Record<string, OwnWork> {
  return { "proposal.approve": { check: mayApprove, change: approve } };
}
