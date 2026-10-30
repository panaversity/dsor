// NEW IN STEP 06: what a caller may do comes from its roles, and anything not granted is
// refused. DSOR-AUT-01a and DSOR-AUT-01b in specs/dsor/02-security.md, section 15.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Refusal } from "./envelope.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Principal } from "./principals.ts";
import type { Contract } from "./registry.ts";

/** The role table, as it was read from disk: its file name and its text. */
export type RoleSource = { file: string; text: string };

/** What each role grants: a role's name, and its permissions. */
export type Roles = ReadonlyMap<string, ReadonlySet<string>>;

// A resource, ":", and an action, each lowercase letters, digits, and "_", starting with a
// letter. ".propose" may follow. The pattern is the specification's own. Inside the dsor
// repository, `pnpm guard` checks that it still matches:
// copied from packages/spec/schemas/common.schema.json#/$defs/permission/pattern
const PERMISSION = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*(\.propose)?$/;

// The one company this step knows. Step 10 picks the company of each call.
const COMPANY = "org_456";

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
  for (const { id, memberships } of principals) {
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

/** The permissions a caller holds: what its roles in org_456 grant, and nothing else. */
export function permissionsOf(caller: Principal, roles: Roles): ReadonlySet<string> {
  const held = new Set<string>();
  for (const { tenant_id, roles: names } of caller.memberships) {
    // Roles count only in the company of the call (step 06's README, decision 1).
    if (tenant_id !== COMPANY) continue;
    // A role missing from the table grants nothing. Start-up refuses such a table anyway.
    for (const name of names) for (const permission of roles.get(name) ?? []) held.add(permission);
  }
  return held;
}

/** Refuses the call unless the caller holds the very permission the contract names. */
export function checkPermission(caller: Principal, contract: Contract, roles: Roles): void {
  const name = JSON.stringify(contract.id);
  const needed = (contract["authorization"] as { permission?: unknown } | undefined)?.permission;
  // The schema makes every contract name one at start-up. If one ever did not, nobody could
  // call it: when the answer is missing, the answer is no.
  if (typeof needed !== "string") {
    throw new Refusal("AUTHORIZATION_DENIED", `${name} names no permission, so nobody may call it`);
  }
  // Only the same text grants it. No wildcard, no "issue grants read", and the ".propose"
  // form does not stand in for the full one (step 06's README, decisions 2 and 3).
  if (!permissionsOf(caller, roles).has(needed)) {
    throw new Refusal(
      "AUTHORIZATION_DENIED",
      `${name} needs ${needed}, which the caller does not hold`,
    );
  }
}
