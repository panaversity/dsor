// The people this program knows about.
//
// A *principal* is whoever is asking: a person, an agent, or an application.
//
// NEW IN STEP 06: each one carries a **role**, which is what decides may-you. What each role
// grants is in permissions.ts, deliberately in a file of its own.
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
   * nothing reads them yet — and step 06 still does not: it put `role` beside them rather than
   * inside them, because there is only one company to belong to. A role is really per-company,
   * so step 10, which makes more than one company possible, is where it has to move.
   */
  readonly memberships: readonly Membership[];
  /**
   * NEW IN STEP 06. The name of this principal's role, which is what they may do.
   *
   * A name, not a list of permissions. The list lives in one place, beside the other roles,
   * so changing what a job may do is one edit instead of one per person. A role nobody
   * defined grants nothing — see permissionsOf.
   *
   * One role each, which is enough for this story. A real system gives people several.
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
// NEW IN STEP 06: the third column. cfo_100 is an `approver`, and that one word is the whole
// reason she cannot issue an invoice.
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
