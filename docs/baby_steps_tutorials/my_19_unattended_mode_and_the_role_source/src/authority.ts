// STEP 18: what a person holds right now, asked at every decision (decision 127).
//
// An agent's power under a slip is never more than its signer's, at the moment of the decision. So
// DSoR asks where a person's permissions come from every time, and copies them nowhere: not into the
// slip, not into a cache. Ask at 09:00 and at 09:01, and a permission taken away in between is gone.
//
// Today the answer comes from this program's own list of people and roles, the same place
// `permissionsOf` reads. It is a source that a test can replace, the way a test hands the program
// its database: the done-when of this step is a test that takes a permission away from user_123
// between two requests. Step 19 replaces it with a company directory, which can be down.

import { findPerson } from "./people.ts";
import { permissionsOf } from "./permissions.ts";

/**
 * What a person holds in one company now, or `undefined` for somebody the source does not know
 * there. Per company, because a person holds nothing in a company they do not belong to: user_123
 * could otherwise sign a slip in org_789 and lend the agent power user_123 has only in org_456.
 */
export type RoleSource = (person: string, tenant: string) => readonly string[] | undefined;

/** The source this program ships with: its own people and their roles. */
export const rolesOfThisProgram: RoleSource = (person, tenant) => {
  const found = findPerson(person);

  return found === undefined || !found.memberships.some((m) => m.tenantId === tenant)
    ? undefined
    : permissionsOf(found);
};

let source: RoleSource = rolesOfThisProgram;

/** Use another source, or `undefined` for this program's own again. */
export function useRoleSource(next: RoleSource | undefined): void {
  source = next ?? rolesOfThisProgram;
}

/** What one person holds in one company at this moment, from whichever source is in use. */
export function holdsNow(person: string, tenant: string): readonly string[] | undefined {
  return source(person, tenant);
}
