// The people this program knows about.
//
// A *principal* is whoever is asking: a person, an agent, or an application.
//
// NEW IN STEP 06: each one carries a **role**, and the role is what decides may-you. What
// each role grants is in permissions.ts.
//
// Rule DSOR-IDN-01: DSoR MUST normalize every caller into a principal with a type and
// tenant memberships before any other processing.

import { TENANT } from "./invoice.ts";

/**
 * What kind of thing is asking.
 *
 * The specification names four. Two are used in this step. `application` would be a
 * program of the company's own, and `system` DSoR itself.
 */
export type PrincipalType = "human" | "agent" | "application" | "system";

/** A company this principal belongs to. More than one company arrives in step 10. */
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
   * nothing reads them yet. Step 06 hangs roles off them and step 10 makes more than one
   * company possible.
   */
  readonly memberships: readonly Membership[];
  /**
   * NEW IN STEP 06. Which role this principal has, which is what they may do.
   *
   * One role each, which is enough for the story and is where a real system would have
   * several. A role nobody defined grants nothing — see permissionsOf.
   */
  readonly role: string;
}

const person = (id: string, type: PrincipalType, role: string): Principal =>
  Object.freeze({
    id,
    type,
    role,
    memberships: Object.freeze([Object.freeze({ tenantId: TENANT })]),
  });

// The cast of the running example, and nobody else. A real deployment reads its people
// from an identity provider, which is step 43.
//
// The agent is an entry of its own, with an identity of its own, and it logs in as itself
// exactly as the two people do. That is the *shape* DSOR-IDN-02a asks for — an agent with
// credentials of its own rather than a borrowed session — but it is not the rule, which is
// about authenticating with them. Nothing here authenticates anything. Step 44.
// NEW IN STEP 06: the third column. cfo_100 is an `approver` and cannot issue an invoice,
// which is the one thing this step sets out to show.
const people: readonly Principal[] = Object.freeze([
  person("user_123", "human", "ap_supervisor"),
  person("cfo_100", "human", "approver"),
  person("accounts-payable-fte", "agent", "ap_worker"),
]);

/** Finds one principal by id, or `undefined` when nobody has that name. */
export function findPerson(id: string): Principal | undefined {
  return people.find((p) => p.id === id);
}

/** Everyone this program knows. */
export function everyone(): readonly Principal[] {
  return people;
}
