// STEP 10: more than one company, and which one a request is for.
//
// Step 09 served exactly one company and said so with a constant. This file now holds the companies
// this program knows, and the one decision §21 makes at step 2, "resolve tenant": which company THIS
// request is for. The answer comes from who is logged in — their memberships, and the company their
// login names when they have more than one. It never comes from the address or the arguments, which
// are data, and data can describe things but can never say who you are or where you belong.
//
// Rule DSOR-IDN-03a: each request MUST resolve to exactly one active tenant in which the subject
// holds a membership.

import { refusal, type ErrorEnvelope } from "./envelopes.ts";
import type { Principal } from "./people.ts";

/**
 * The companies this program serves. Two, from this step on.
 *
 * "Active" in DSOR-IDN-03a means a tenant that exists and is not suspended. Suspension is a later
 * step; here a tenant is active when it is on this list.
 */
export const TENANTS: readonly string[] = Object.freeze(["org_456", "org_789"]);

/** Is this one of the companies this program serves? */
export function isKnownTenant(tenantId: string): boolean {
  return TENANTS.includes(tenantId);
}

/**
 * What a login said about which company it means.
 *
 * Three shapes and not two, on purpose. "Unnamed" and "malformed" must stay apart: a caller with one
 * membership who sends `{ tenant: 42 }` has made a wrong claim, not no claim, and must not quietly
 * land in their one company as if they had said nothing.
 */
export type TenantClaim =
  | { readonly kind: "unnamed" }
  | { readonly kind: "named"; readonly tenant: string }
  | { readonly kind: "malformed" };

/**
 * Which company this request is for, or a refusal.
 *
 * Every refusal is `TENANT_MISMATCH` with retry `never`: the same request cannot start working by
 * being sent again. And every refusal says the same words whether the company named exists or not —
 * being refused must never tell a caller which companies are real.
 */
export function tenantFor(
  principal: Principal,
  claim: TenantClaim,
  requestId: string,
): { readonly tenant: string } | { readonly refused: ErrorEnvelope } {
  const mine = principal.memberships.map((m) => m.tenantId);
  const no = (message: string): { readonly refused: ErrorEnvelope } => ({
    refused: refusal("TENANT_MISMATCH", message, requestId, principal.id),
  });

  if (claim.kind === "malformed") {
    return no("the company named in the login is not a company id");
  }

  // "Active" (DSOR-IDN-03a): a membership of a company this program does not serve resolves to
  // nothing, with the same words as any other refusal. people.ts refuses such a membership at load,
  // and a review pointed out that a hand-built principal never passes through people.ts — so the
  // rule is held here, where the request is, and not only where the cast is written.
  const active = (
    tenant: string,
  ): { readonly tenant: string } | { readonly refused: ErrorEnvelope } =>
    isKnownTenant(tenant) ? { tenant } : no(`${tenant} is not a company you belong to`);

  if (claim.kind === "named") {
    // Membership first; the existence of the company is never what the answer turns on, so a
    // company you are not a member of gets the same words whether it exists or not.
    return mine.includes(claim.tenant)
      ? active(claim.tenant)
      : no(`${claim.tenant} is not a company you belong to`);
  }

  if (mine.length === 1) {
    return active(mine[0]!);
  }

  return mine.length === 0
    ? no("you belong to no company")
    : no("you belong to more than one company; say which one this request is for");
}
