// Proposal.execute, the release of a waiting proposal (§26.1, §26.4; step 31's
// README, decisions D2, D7, D12, and D13). Line ⑧ loads the proposal the input names, instead of
// making one. Line ⑨ first asks who may release it, and whether it waits to be released. Then the
// stored request is checked again on live data, and runs.
import type { RoleSource } from "./authority.ts";
import { checkBrake, holdBrake, type BrakeStore } from "./brakes.ts";
import { checkDelegation, holdSlip } from "./delegation.ts";
import type { Approval } from "./approvals.ts";
import { Refusal, type ErrorCode, type Requirement } from "./envelope.ts";
import { checkPermission, covers, type Roles } from "./permissions.ts";
import { actsAsAgent, principalNamed, type Principal } from "./principals.ts";
import { NO_PEOPLE, type PeopleStore } from "./people.ts";
import type { Proposal } from "./proposals.ts";
import { preview, type Contract } from "./registry.ts";
import { staleRefusal } from "./concurrency.ts";
import type { Invoice } from "./invoice.ts";
import { inChain } from "./segregation.ts";
import type { Slip, SlipStore } from "./slips.ts";

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
  // And the proposal that replaced it, if one did.
  replacedBy: () => Promise<string | undefined> = async () => undefined,
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
    // The words name neither the slip nor the person that asked: a caller who may not release
    //   learns nothing of the proposal but that it is there. Found by step 31's review, finding L1.
    if (asker !== caller.id || slip === undefined || under !== slip.id) {
      no(`it was not asked for under ${caller.id}'s own slip`);
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
  // A proposal that was replaced names the one that replaced it (step 41b's
  //   README, decision D8).
  const replaced = found.state === "CANCELLED" ? await replacedBy() : undefined;
  if (replaced !== undefined) {
    const why = `proposal ${id} was replaced by proposal ${replaced}, so it is not released`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  if (found.state !== "APPROVED" && found.state !== "READY") {
    const why = `proposal ${id} is ${found.state}, and only an APPROVED or a READY proposal is released`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  // And only while its time has not come, though no sweep has moved it yet: its approval
  // expires with it (DSOR-APR-04a).
  if (await isDue()) throw timeCame(found);
}

/** The refusal of a proposal whose time has come, though no sweep has moved it yet. */
export function timeCame(found: Proposal): Refusal {
  const id = found.uri.slice(found.uri.lastIndexOf("/") + 1);
  const why = `proposal ${id}'s time came at ${found.expires_at}, so it is not released`;
  return new Refusal("CONFLICT", why, "internal");
}

/** The roles the person or agent that asked holds now, and, for an agent, the slip it works under now. */
// And where DSoR learned what the asker holds now, and as of when, so a release's
//   bundle names the request it decided as it was checked (step 33's README, decision D15).
export type AskerNow = {
  roles: readonly string[];
  slip: Slip | undefined;
  authority: { source: "token" | "role_source"; as_of: string };
};

/**
 * Lines ③ to ⑤ again, for the person or agent that asked for the stored request, not for the
 * caller who releases it (DSOR-APR-03a; step 31's README, decision D1). For an agent: it still
 * works under the slip it asked under, its signer still holds what the directory says now, no brake
 * stops it, and the slip still holds, under the slip's lock, as at a draft. Then, for both, the
 * permission the request needs, in the mode it was made in: an agent that prepared in propose_only
 * mode needs only the .propose form, and its release needed the full one, which line ⑨'s gate
 * checked of the caller (decision D2).
 */
export async function askerNow(
  found: Proposal,
  target: Contract,
  roles: Roles,
  roleSource: RoleSource,
  stores: { slips: SlipStore; brakes: BrakeStore },
  tenant: string,
  // Inside the release's claim, under the brake's and the slip's locks, as at a draft. A dry run
  //   takes no lock: it reads the brake, and line ③'s look has read the slip.
  inClaim = true,
  // Since step 43b: and the table of people, where a person who asked for herself holds her roles
  //   now (step 43b's README, claim C1).
  people: PeopleStore = NO_PEOPLE,
): Promise<AskerNow> {
  const { requester } = found;
  const asker = requester.actor_chain[0];
  if (requester.delegation !== undefined && asker !== undefined) {
    const agent = principalNamed(asker);
    if (agent === undefined) {
      throw new Refusal(
        "AUTHORIZATION_DENIED",
        `${asker}, which asked, has no login now`,
        "internal",
      );
    }
    const slip = await checkDelegation(agent, target, stores.slips, tenant);
    if (slip?.id !== requester.delegation) {
      const why = `${asker} works under another slip now, and asked under ${requester.delegation}`;
      throw new Refusal("DELEGATION_REQUIRED", why, "internal");
    }
    // The signer's authority, from the directory, asked now. A directory that cannot answer is
    //   not a "no": its refusal leaves the proposal waiting (decision D15). A signer it reports as
    //   gone is a "no", and the slip is suspended at the agent's next call (line ③).
    const authority = await roleSource.authorityOf(tenant, slip, JSON.stringify(target.id));
    if (inClaim) {
      await holdBrake(agent, target, stores.brakes, tenant);
      await holdSlip(agent, target, slip.id, stores.slips, tenant);
    } else {
      await checkBrake(agent, target, stores.brakes, tenant);
    }
    checkPermission(agent, target, roles, tenant, slip, authority.roles, found.mode);
    return {
      roles: authority.roles,
      slip,
      authority: { source: authority.source, as_of: authority.as_of },
    };
  }
  // A person who asked for herself: what she holds in DSoR's own table now.
  // Changed in step 43b: the table of people, never src/principals.ts. A person who is no active
  //   member of the company now holds nothing here.
  const story = principalNamed(requester.subject);
  const member = await people.memberOf(tenant, requester.subject);
  if (member?.status !== "active" || (story !== undefined && story.type !== "human")) {
    const why = `${requester.subject}, who asked, has no login now`;
    throw new Refusal("AUTHORIZATION_DENIED", why, "internal");
  }
  const person: Principal = {
    id: requester.subject,
    type: "human",
    memberships: [{ tenant_id: tenant, roles: member.roles }],
  };
  checkPermission(person, target, roles, tenant, undefined, undefined, found.mode);
  return {
    roles: person.memberships.find((m) => m.tenant_id === tenant)?.roles ?? [],
    slip: undefined,
    authority: { source: "token", as_of: new Date().toISOString() },
  };
}

// A refusal that says only "not now": the check could not be made, so it says nothing about the
// request. It leaves the proposal waiting, and the claim is undone, so the same key may try again
// (step 31's README, decision D15).
const NOT_NOW: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "INTERNAL_ERROR",
  "CONNECTOR_UNAVAILABLE",
  "TRANSACTION_FAILED",
  "EVIDENCE_STORE_UNAVAILABLE",
  "DEPENDENCY_TIMEOUT",
  "RATE_LIMITED",
  "FRESHNESS_UNSATISFIABLE",
  // And a record held for an unknown payment: the release waits, as its proposal
  //   does (step 37's README, decision D4).
  "RESOURCE_HELD",
]);

/** True when a refusal of the check again says no to the request, which invalidates it. */
export function invalidates(refusal: Refusal): boolean {
  return !NOT_NOW.has(refusal.code);
}

/**
 * What the caller hears of why: the code, and the words when they may hear them, as an approval's
 * caller hears its refusal's (step 31's README, decision D8).
 */
export function causeOf(refusal: Refusal): string {
  const shown = refusal.label === "public" || refusal.label === "internal";
  return shown ? `${refusal.code}: ${refusal.message}` : refusal.code;
}

/**
 * The approvals the stored request has, against what the rules ask for now (DSOR-APR-03b,
 * DSOR-APR-03c; step 31's README, decision D3). First, no approver may be in the requesting chain,
 * read from DSoR's records now, as step 30's approval checks (DSOR-SOD-02). Then each approval the
 * rules ask for now: a rule that was not asked about when the request was decided is new, and
 * invalidates. A rule that was, in this version or another, counts the people whose approval met
 * its role, and needs its quorum of them now.
 */
// And it answers what it counted, for the decision's bundle: each approval that met
//   a rule, in the order they were given, and the ids that met each rule (step 33's README, D7).
export async function checkApprovals(
  found: Proposal,
  // What the rules ask for now: line ⑩'s answer for the stored request, or none.
  requires: readonly Requirement[],
  given: readonly Approval[],
  slips: Pick<SlipStore, "get">,
  tenant: string,
  // Since step 43b: and the table of people, which says whether each approver still holds the
  //   role their approval met (the review of step 43b, finding 2).
  people: Pick<PeopleStore, "memberOf"> = NO_PEOPLE,
): Promise<Counted> {
  for (const approval of given) {
    for (const { principal } of approval.approvers) {
      const why = await inChain(found.requester, principal, slips, tenant);
      if (why !== undefined) {
        throw new Refusal("SOD_VIOLATION", `${principal} may not approve it: ${why}`, "internal");
      }
    }
  }
  // Only an approval that is active and binds this very request counts: one for another
  //   fingerprint approved another request (DSOR-APR-09). Its expiry is its proposal's, which the
  //   release reads again just before the work (found by step 31's review, finding M2).
  const binding = given.filter(
    (a) => a.status === "active" && a.payload_hash === found.payload_hash,
  );
  // Changed in step 43b: an approval counts for a rule only while each of its approvers is still an
  //   active person of the company holding that rule's role, now. A CFO removed, or no longer CFO,
  //   after approving no longer approves (DSOR-APR-03b; the review of step 43b, finding 2). Rule by
  //   rule, not all or nothing: an approval still counts where its role is still held (the code
  //   review of step 43b, finding 6). Each approver's roles are read once (finding 10).
  const held = new Map<string, readonly string[]>();
  for (const principal of new Set(binding.flatMap((a) => a.approvers.map((p) => p.principal)))) {
    const now = await people.memberOf(tenant, principal);
    held.set(principal, now?.status === "active" ? now.roles : []);
  }
  const stillHolds = (a: Approval, role: string): boolean =>
    a.approvers.every((p) => (held.get(p.principal) ?? []).includes(role));
  const counted = binding;
  for (const now of requires) {
    const { control, control_version: version } = now;
    const { role, quorum } = now.approval;
    if (!(found.requires ?? []).some((then) => then.control === control)) {
      const why = `${control} version ${version} asks for an approval that was not asked for when the request was made`;
      throw new Refusal("APPROVAL_REQUIRED", why, "internal");
    }
    // One person counts once (DSOR-SOD-04c), and only for the role their approval met.
    const people = new Set(
      counted
        .filter(
          (a) =>
            a.satisfies.some(
              (line) => line.control === control && line.requirement.role === role,
            ) && stillHolds(a, role),
        )
        .flatMap((a) => a.approvers.map((approver) => approver.principal)),
    );
    if (people.size < quorum) {
      const wanted = quorum === 1 ? "an approval" : `${quorum} approvals`;
      const why = `${control} version ${version} asks for ${wanted} by ${role}, and ${people.size} counts`;
      throw new Refusal("APPROVAL_REQUIRED", why, "internal");
    }
  }
  // What counted, once every rule has its quorum: the same test as the count above, so the bundle
  //   names no approval that the count did not take.
  const metBy = (a: Approval, r: Requirement): boolean =>
    a.satisfies.some(
      (line) => line.control === r.control && line.requirement.role === r.approval.role,
    ) && stillHolds(a, r.approval.role);
  // A Map, never a plain object: a rule's id is the company's text, and a rule named constructor
  //   found Object's own constructor in a plain one. Found by step 33's review, findings 1 and 2.
  const satisfied = new Map<string, string[]>();
  for (const now of requires) {
    const ids = counted.filter((a) => metBy(a, now)).map((a) => a.id);
    satisfied.set(now.control, [...new Set([...(satisfied.get(now.control) ?? []), ...ids])]);
  }
  const approvals = counted.filter((a) => requires.some((now) => metBy(a, now)));
  return { approvals: structuredClone(approvals), satisfied };
}

/** What a release counted: each approval that met a rule, in the order given, and the ids that met each rule. */
export type Counted = { approvals: Approval[]; satisfied: ReadonlyMap<string, string[]> };

/**
 * The version an optimistic stored request was decided on, its expected_version, when it names
 * one, as the field the check again reads (step 31's README, decision D5).
 */
export function decidedOnOf(target: Contract, payload: unknown): { decidedOn?: number } {
  const strategy = (target["concurrency"] as { strategy?: unknown } | undefined)?.strategy;
  const version = (payload as { expected_version?: unknown } | null)?.expected_version;
  return strategy === "optimistic" && typeof version === "number" ? { decidedOn: version } : {};
}

// Only an invoice is bound in this tutorial, and only payment.create binds one: the record its
// expected_version names. A contract that bound two records would leave this check unsure which,
// so it checks only one, and the code's own check stays, as the store's does (DSOR-CON-01b).
/** Refuses with STALE_STATE when the one record line ⑨ read has moved on from the version decided on. */
export function checkDecidedOn(state: Record<string, Invoice>, decided: number): void {
  const records = Object.values(state);
  if (records.length !== 1) return;
  const invoice = records[0]!;
  if (invoice.version !== decided) {
    throw staleRefusal(`invoice ${preview(invoice.id)}`, invoice.version, decided);
  }
}
