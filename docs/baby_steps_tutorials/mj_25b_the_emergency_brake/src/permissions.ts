// What a caller may do comes from its roles, and anything not granted is
// refused. DSOR-AUT-01a and DSOR-AUT-01b in specs/dsor/02-security.md, section 15.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Refusal } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import { actsAsAgent, type Principal } from "./principals.ts";
import type { Contract } from "./registry.ts";
import type { Mode } from "./request.ts";
import type { Slip } from "./slips.ts";

// Called RoleSource until now. From this step, the role source is the company's
// directory, as in §12.1 (step 19's README, the small fixes).
/** The role table, as it was read from disk: its file name and its text. */
export type RoleTableSource = { file: string; text: string };

/** What each role grants: a role's name, and its permissions. */
export type Roles = ReadonlyMap<string, ReadonlySet<string>>;

// A resource, ":", and an action, each lowercase letters, digits, and "_", starting with a
// letter. ".propose" may follow. The pattern is the specification's own. Inside the dsor
// repository, `pnpm guard` checks that it still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/permission/pattern
const PERMISSION = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*(\.propose)?$/;

// The .propose form of a permission, such as payment:create.propose. Its holder may
// call the command in propose_only mode only, and the full permission covers it: whoever may
// create a payment may also prepare one (§7.3; step 23's README, decision 5).
const PROPOSE = ".propose";

/** True when these permissions allow this one: the same text, or, for a .propose form, the full permission it belongs to. */
export function covers(held: Iterable<string>, wanted: string): boolean {
  const list = [...held];
  if (list.includes(wanted)) return true;
  return wanted.endsWith(PROPOSE) && list.includes(wanted.slice(0, -PROPOSE.length));
}

/** Reads the role table from a file. */
export function readRoles(path: string): RoleTableSource {
  return { file: basename(path), text: readFileSync(path, "utf8") };
}

/** Checks the role table and every role a principal holds, and names every problem. */
export function checkRoles(
  source: RoleTableSource,
  principals: Iterable<Principal>,
): { roles: Roles; problems: string[] } {
  const { file, text } = source;
  const roles = new Map<string, ReadonlySet<string>>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { roles, problems: [`${file}: not valid JSON`] };
  }
  // A list and null are objects in JavaScript too. Neither one names a role.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    const problem = `${file}: must be an object that gives each role a list of permissions`;
    return { roles, problems: [problem] };
  }

  // JSON.parse keeps the last of two lines for one role, and says nothing, so a second
  // ap_agent line could widen the agent without a word. Found by step 06's review.
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [role, grants] of Object.entries(data)) {
    // A text is not a list, even though JavaScript can loop over its letters.
    if (!Array.isArray(grants)) {
      problems.push(`${file}: the role ${JSON.stringify(role)} must grant a list of permissions`);
      continue;
    }
    for (const permission of grants) {
      // The type comes first: a pattern test turns ["invoice:read"] into "invoice:read".
      if (typeof permission !== "string" || !PERMISSION.test(permission)) {
        const what = `grants ${JSON.stringify(permission)}, which is not <resource>:<action>`;
        problems.push(`${file}: the role ${JSON.stringify(role)} ${what}`);
      }
    }
    roles.set(role, new Set<string>(grants));
  }

  // A role that no line of the table names is a typo. It stops start-up, before any caller
  // arrives (step 06's README, decision 4). A role named with a problem is not named twice.
  const named = new Set(Object.keys(data));
  for (const principal of principals) {
    const { id, memberships } = principal;
    // An agent holds no role of its own. What it may do comes only from a
    // person's slip, so line ⑤ never weighs a role against a slip (step 18's README,
    // decisions 2 and 11).
    if (actsAsAgent(principal)) {
      for (const { tenant_id, roles: held } of memberships) {
        for (const role of held) {
          const why = "an agent's power comes only from a person's slip";
          const holds = `holds the role ${JSON.stringify(role)} in ${tenant_id}`;
          problems.push(`${id} is an agent, and ${holds}: ${why}`);
        }
      }
      continue;
    }
    for (const role of memberships.flatMap((membership) => membership.roles)) {
      if (!named.has(role)) {
        problems.push(
          `${file}: ${id} holds the role ${JSON.stringify(role)}, which the table does not have`,
        );
      }
    }
  }
  return { roles, problems };
}

// The company is the call's active tenant, which line ② checked. Step 06's
// constant COMPANY is gone (step 10's README, decision 3).
/** The permissions a caller holds: what its roles in this company grant, and nothing else. */
export function permissionsOf(
  caller: Principal,
  roles: Roles,
  tenant: string,
): ReadonlySet<string> {
  const held = new Set<string>();
  for (const { tenant_id, roles: names } of caller.memberships) {
    // Roles count only in the company of the call, so authority one company gave is never
    // used in another (DSOR-IDN-03a, step 06's README, decision 1).
    if (tenant_id !== tenant) continue;
    // A role missing from the table grants nothing. Start-up refuses such a table anyway.
    for (const name of names) for (const permission of roles.get(name) ?? []) held.add(permission);
  }
  return held;
}

// A person may do what its roles in this company grant, as since step 06.
// An agent holds no role. It may use only what its slip lists and the person who signed it
// holds now, in this company (DSOR-DEL-02; step 18's README, decisions 4 and 5). This
// tutorial's tokens carry no scopes, so the token's part narrows nothing (decision 9).
/** What this caller may do in this company: a person's roles, or an agent's slip cut down to its signer. */
export function effectivePermissions(
  caller: Principal,
  roles: Roles,
  tenant: string,
  slip?: Slip,
  // The signer's roles now, which line ③ got from her company's directory
  // (step 19's README, decision 2).
  signerRoles?: readonly string[],
): ReadonlySet<string> {
  if (!actsAsAgent(caller)) return permissionsOf(caller, roles, tenant);
  // Line ③ refuses an agent with no usable slip, or whose signer it could not look up, so
  // this is never reached without both. If it were, the agent may do nothing.
  if (slip === undefined || signerRoles === undefined) return new Set();
  // What her roles grant, by the role table. A role the table does not have
  // grants nothing (DSOR-AUT-01b; step 19's README, the small fixes). If user_123 moves to
  // ap_clerk in the directory, the agent loses payment:create at its next call, though the
  // slip still lists it, with no restart.
  const held = new Set<string>();
  for (const name of signerRoles)
    for (const permission of roles.get(name) ?? []) held.add(permission);
  // Each permission the slip lists, when the signer covers it, or else its .propose
  // form, when the signer holds that. So payment:create on the slip, and payment:create.propose
  // held, leave the agent payment:create.propose: it may prepare, and never create (step 23's
  // README, decision 5).
  const allowed = new Set<string>();
  for (const permission of slip.permissions) {
    if (covers(held, permission)) allowed.add(permission);
    else if (!permission.endsWith(PROPOSE) && held.has(`${permission}${PROPOSE}`)) {
      allowed.add(`${permission}${PROPOSE}`);
    }
  }
  return allowed;
}

/** Refuses the call unless the caller holds the very permission the contract names, or, in propose_only mode, its .propose form. */
export function checkPermission(
  caller: Principal,
  contract: Contract,
  roles: Roles,
  // The active company.
  tenant: string,
  // The slip line ③ found, for an agent.
  slip?: Slip,
  // And the roles its signer holds now, which line ③ found.
  signerRoles?: readonly string[],
  // And the mode of the call (step 23's README, decision 5).
  mode: Mode = "execute",
): void {
  const name = JSON.stringify(contract.id);
  const needed = (contract["authorization"] as { permission?: unknown } | undefined)?.permission;
  // The schema makes every contract name one at start-up. If one ever did not, nobody could
  // call it: when the answer is missing, the answer is no.
  if (typeof needed !== "string") {
    throw new Refusal("AUTHORIZATION_DENIED", `${name} names no permission, so nobody may call it`);
  }
  // A contract may say that only a person may call it, as the tear-up of a slip
  // does. A caller that is not a person is refused here, whatever its slip lists and its signer
  // holds: an agent never tears up a slip, its own or another's, and neither does an application
  // (DSOR-DEL-04a; step 25's README, decision D4). Found by step 25's review: an application
  // passed, because it does not act as an agent.
  if (peopleOnly(contract) && caller.type !== "human") {
    const why = `${name} is for people only, and ${caller.id} is not a person`;
    throw new Refusal("AUTHORIZATION_DENIED", why);
  }
  // Only the same text grants it. No wildcard, no "issue grants read", and the ".propose"
  // form does not stand in for the full one (step 06's README, decisions 2 and 3).
  const held = effectivePermissions(caller, roles, tenant, slip, signerRoles);
  // But in propose_only mode the .propose form is enough, and the full permission
  // covers it. Not in a dry run: §7.3 lets a holder of the .propose form call "in propose_only
  // mode only" (step 23's README, decision 5).
  const proposing = mode === "propose_only";
  const wanted = proposing ? `${needed}${PROPOSE}` : needed;
  if (!covers(held, wanted)) {
    const asked = proposing
      ? `${name} in propose_only mode needs ${needed} or ${wanted}`
      : `${name} needs ${needed}`;
    // A caller that holds only the .propose form is told what it allows.
    const only = `${needed}${PROPOSE}`;
    const hint = !proposing && covers(held, only) ? `; ${only} allows propose_only mode only` : "";
    throw new Refusal("AUTHORIZATION_DENIED", `${asked}, ${whyNot(wanted, caller, slip)}${hint}`);
  }
}

// A field of this tutorial's own, under its own name (DSOR-SCH-02). The
// specification has no field that keeps an operation for people (step 25's README, decision D4).
/** True when the contract says that only a person may call its operation. */
export function peopleOnly(contract: Contract): boolean {
  const extensions = contract["extensions"] as Record<string, unknown> | undefined;
  const ours = extensions?.["org.panaversity.steps"] as { people_only?: unknown } | undefined;
  return ours?.people_only === true;
}

// A contract names the permission its operation needs, never its .propose form. In
// execute mode, a contract that named payment:create.propose would let a holder of that form run
// the operation (step 23's README, decision 14).
/** Every contract whose permission is a .propose form. */
export function proposeProblems(contracts: Iterable<Contract>): string[] {
  const problems: string[] = [];
  for (const contract of contracts) {
    const authorization = contract["authorization"] as { permission?: unknown } | undefined;
    const permission = authorization?.permission;
    if (typeof permission === "string" && permission.endsWith(PROPOSE)) {
      const rule = "a contract names the permission its operation needs, never its .propose form";
      problems.push(`${contract.id}: ${rule} (step 23's README, decision 14)`);
    }
  }
  return problems;
}

// Why the permission is missing. For an agent, one code covers "the slip
// does not list it" and "the signer no longer holds it", so the message tells them apart
// (step 18's README, decision 5).
function whyNot(needed: string, caller: Principal, slip: Slip | undefined): string {
  if (!actsAsAgent(caller) || slip === undefined) return "which the caller does not hold";
  // A slip that lists payment:create covers payment:create.propose too.
  if (!covers(slip.permissions, needed)) return `which slip ${slip.id} does not list`;
  return `which ${slip.delegator}, who signed slip ${slip.id}, does not hold now`;
}
