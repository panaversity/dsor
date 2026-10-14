// The people this program knows about.
//
// A *principal* is whoever is asking: a person, an agent, or an application.
//
// STEP 06: each one carries a **role**, which is what decides may-you. What each role
// grants is in permissions.ts, deliberately in a file of its own.
//
// Rule DSOR-IDN-01: DSoR MUST normalize every caller into a principal with a type and
// tenant memberships before any other processing.

import type { Classification } from "./classification.ts";
import { isKnownTenant } from "./tenant.ts";

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
   * DSOR-IDN-01 asks for memberships by name, so they were here from the start. Step 06 put `role`
   * beside them rather than inside them, because there was one company to belong to. A role is
   * really per company, and STEP 10 — the step that made more than one company possible —
   * it stayed where it was, on purpose: nobody in the cast holds different roles in different
   * companies. The agent is an `ap_worker` for both of its employers. The day someone is a
   * supervisor in one company and an approver in the other, the role moves inside the membership,
   * and `holds` learns to ask inside the request's company.
   */
  readonly memberships: readonly Membership[];
  /**
   * STEP 06. The name of this principal's role, which is what they may do.
   *
   * A name, not a list of permissions. The list lives in one place, beside the other roles,
   * so changing what a job may do is one edit instead of one per person. A role nobody
   * defined grants nothing — see permissionsOf.
   *
   * One role each, which is enough for this story. A real system gives people several.
   */
  readonly role: string;
  /**
   * NEW IN STEP 14: how far up this principal may read. An agent's answers cross the model
   * boundary, so every field above its clearance is left out before the answer leaves. The two
   * people carry none: a human is not filtered (decision 105), the role decides what a human may
   * do. An agent with none reads public fields only — see `clearanceOf`.
   */
  readonly clearance?: Classification;
}

// STEP 10: the companies come last, one or more. A membership of a company this program
// does not serve is a mistake in this file, and it fails here, when the file loads, not later
// inside a request.
const person = (id: string, type: PrincipalType, role: string, ...tenants: string[]): Principal => {
  for (const tenantId of tenants) {
    if (!isKnownTenant(tenantId)) {
      throw new TypeError(
        `${id} is listed as a member of ${tenantId}, which this program does not serve`,
      );
    }
  }

  return Object.freeze({
    id,
    type,
    role,
    memberships: Object.freeze(tenants.map((tenantId) => Object.freeze({ tenantId }))),
  });
};

// The cast of the running example, and nobody else. A real deployment reads its people
// from an identity provider, which is step 43.
//
// The agent is an entry of its own, with an identity of its own, and it logs in as itself
// exactly as the two people do. That is the *shape* DSOR-IDN-02a asks for — an agent with
// credentials of its own rather than a borrowed session — but it is not the rule, which is
// about authenticating with them. Nothing here authenticates anything. Step 44.
// STEP 06: the third column. cfo_100 is an `approver`, and that one word is the whole
// reason she cannot issue an invoice.
// STEP 10: a second company, org_789, and one principal who works for both. The agent is an
// outsourced accounts-payable service, so every request it makes has to say which company it is
// working for — which is what gives DSOR-IDN-03a's "exactly one" something to bite on. The two
// people belong to org_456 only.
const people: readonly Principal[] = Object.freeze([
  person("user_123", "human", "ap_supervisor", "org_456"),
  person("cfo_100", "human", "approver", "org_456"),
  // NEW IN STEP 14: cleared for `internal`. The amount of an invoice is confidential, so the agent
  // sees the invoice and not the amount, which is the map's "done when".
  Object.freeze({
    ...person("accounts-payable-fte", "agent", "ap_worker", "org_456", "org_789"),
    clearance: "internal" as const,
  }),
]);

/** Finds one principal by id, or `undefined` when nobody has that name. */
export function findPerson(id: string): Principal | undefined {
  return people.find((p) => p.id === id);
}

/** Everyone this program knows. */
export function everyone(): readonly Principal[] {
  return people;
}
