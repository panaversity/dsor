// What a caller may do comes from its roles, and anything not granted is
// refused. DSOR-AUT-01a and DSOR-AUT-01b in specs/dsor/02-security.md, section 15.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Refusal } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import { actsAsAgent, principalNamed, type Principal } from "./principals.ts";
import type { Contract } from "./registry.ts";
import type { Slip } from "./slips.ts";

/** The role table, as it was read from disk: its file name and its text. */
export type RoleSource = { file: string; text: string };

/** What each role grants: a role's name, and its permissions. */
export type Roles = ReadonlyMap<string, ReadonlySet<string>>;

// A resource, ":", and an action, each lowercase letters, digits, and "_", starting with a
// letter. ".propose" may follow. The pattern is the specification's own. Inside the dsor
// repository, `pnpm guard` checks that it still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/permission/pattern
const PERMISSION = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*(\.propose)?$/;

/** Reads the role table from a file. */
export function readRoles(path: string): RoleSource {
  return { file: basename(path), text: readFileSync(path, "utf8") };
}

/** Checks the role table and every role a principal holds, and names every problem. */
export function checkRoles(
  source: RoleSource,
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
// holds now, in this company (DSOR-DEL-02; step 18's README, decisions 4 and 5). Line ③ has
// checked that a person of this company signed the slip (decision 18). This tutorial's
// tokens carry no scopes, so the token's part narrows nothing (decision 9).
/** What this caller may do in this company: a person's roles, or an agent's slip cut down to its signer. */
export function effectivePermissions(
  caller: Principal,
  roles: Roles,
  tenant: string,
  slip?: Slip,
): ReadonlySet<string> {
  if (!actsAsAgent(caller)) return permissionsOf(caller, roles, tenant);
  // Line ③ refuses an agent with no usable slip, so this is never reached without one. If it
  // were, the agent may do nothing.
  if (slip === undefined) return new Set();
  const signer = principalNamed(slip.delegator);
  if (signer === undefined) return new Set();
  // Read at every call, from the role table DSoR loaded at start-up: if user_123 loses a
  // permission, the agent loses it at its first call after a restart, though the slip still
  // lists it (step 18's README, decision 4).
  const held = permissionsOf(signer, roles, tenant);
  return new Set(slip.permissions.filter((permission) => held.has(permission)));
}

/** Refuses the call unless the caller holds the very permission the contract names. */
export function checkPermission(
  caller: Principal,
  contract: Contract,
  roles: Roles,
  // The active company.
  tenant: string,
  // The slip line ③ found, for an agent.
  slip?: Slip,
): void {
  const name = JSON.stringify(contract.id);
  const needed = (contract["authorization"] as { permission?: unknown } | undefined)?.permission;
  // The schema makes every contract name one at start-up. If one ever did not, nobody could
  // call it: when the answer is missing, the answer is no.
  if (typeof needed !== "string") {
    throw new Refusal("AUTHORIZATION_DENIED", `${name} names no permission, so nobody may call it`);
  }
  // Only the same text grants it. No wildcard, no "issue grants read", and the ".propose"
  // form does not stand in for the full one (step 06's README, decisions 2 and 3).
  if (!effectivePermissions(caller, roles, tenant, slip).has(needed)) {
    throw new Refusal(
      "AUTHORIZATION_DENIED",
      `${name} needs ${needed}, ${whyNot(needed, caller, slip)}`,
    );
  }
}

// Why the permission is missing. For an agent, one code covers "the slip
// does not list it" and "the signer no longer holds it", so the message tells them apart
// (step 18's README, decision 5).
function whyNot(needed: string, caller: Principal, slip: Slip | undefined): string {
  if (!actsAsAgent(caller) || slip === undefined) return "which the caller does not hold";
  if (!slip.permissions.includes(needed)) return `which slip ${slip.id} does not list`;
  return `which ${slip.delegator}, who signed slip ${slip.id}, does not hold now`;
}
