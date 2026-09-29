// NEW IN STEP 10: the company a call works in, its active tenant. DSOR-IDN-03a in
// specs/dsor/02-security.md, section 12, and DSOR-SRC-02b in section 11.
import { Refusal } from "./envelope.ts";
import type { Principal } from "./principals.ts";
import type { RequestEnvelope } from "./request.ts";
import { isTenantId } from "./uri.ts";

/**
 * Line ② of the checklist: the company the envelope names, once DSoR has checked in its
 * own table that the caller is a member of it. Anything else is refused.
 */
export function activeTenant(request: RequestEnvelope, caller: Principal): string {
  // The envelope comes from outside the program, so it may even be null.
  const named = request?.tenant;
  // Always required, even for a caller with one company: DSoR never guesses it (step 10's
  // README, decision 1). A malformed id tells nothing about who exists.
  if (!isTenantId(named)) {
    const message = "a tenant must be an id like org_456, named in the request envelope";
    throw new Refusal("VALIDATION_FAILED", message);
  }
  // DSoR looks only at the caller's own memberships. It never asks whether the company
  // exists, so "no such company" and "not a member" cannot be told apart (DSOR-ERR-01b).
  if (!caller.memberships.some((membership) => membership.tenant_id === named)) {
    throw new Refusal("AUTHORIZATION_DENIED", "the caller may not work in the tenant it named");
  }
  return named;
}

/** Refuses the call when the checked input holds a URI outside the active company. */
export function checkUrisInTenant(_checked: unknown, _tenant: string): void {
  throw new Error("not written yet: step 10's green commits");
}
