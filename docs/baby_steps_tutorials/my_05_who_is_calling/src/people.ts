// NEW IN STEP 05: the people this program knows about.
//
// A *principal* is whoever is asking: a person, an agent, or an application. Until now
// nobody was asking — every call was anonymous, and the program answered anyone.
//
// Rule DSOR-IDN-01: DSoR MUST normalize every caller into a principal with a type and
// tenant memberships before any other processing.

import { TENANT } from "./tenant.ts";

/**
 * What kind of thing is asking.
 *
 * The specification names four. Two are used in this step. `application` would be a
 * program of the company's own, and `system` DSoR itself.
 */
export type PrincipalType = "human" | "agent" | "application" | "system";

/** A company this principal belongs to. Roles arrive in step 06, more companies in 10. */
export interface Membership {
  readonly tenantId: string;
}

/** Whoever is asking. */
export interface Principal {
  readonly id: string;
  readonly type: PrincipalType;
  /**
   * Which companies this principal belongs to.
   *
   * DSOR-IDN-01 asks for memberships by name, so they are here from the start even though
   * nothing reads them yet. Step 06 gives each principal a role beside them, and step 10 makes
   * more than one
   * company possible.
   */
  readonly memberships: readonly Membership[];
}

const person = (id: string, type: PrincipalType): Principal =>
  Object.freeze({ id, type, memberships: Object.freeze([Object.freeze({ tenantId: TENANT })]) });

// The cast of the running example, and nobody else. A real deployment reads its people
// from an identity provider, which is step 43.
//
// The agent is an entry of its own, with an identity of its own, and it logs in as itself
// exactly as the two people do. That is the *shape* DSOR-IDN-02a asks for — an agent with
// credentials of its own rather than a borrowed session — but it is not the rule, which is
// about authenticating with them. Nothing here authenticates anything. Step 44.
const people: readonly Principal[] = Object.freeze([
  person("user_123", "human"),
  person("cfo_100", "human"),
  person("accounts-payable-fte", "agent"),
]);

/** Finds one principal by id, or `undefined` when nobody has that name. */
export function findPerson(id: string): Principal | undefined {
  return people.find((p) => p.id === id);
}

/** Everyone this program knows. */
export function everyone(): readonly Principal[] {
  return people;
}
