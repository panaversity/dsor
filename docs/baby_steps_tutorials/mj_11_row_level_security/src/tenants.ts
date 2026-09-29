// NEW IN STEP 10: the company a call works in, its active tenant. DSOR-IDN-03a in
// specs/dsor/02-security.md, section 12, and DSOR-SRC-02b in section 11.
import { Refusal } from "./envelope.ts";
import type { Principal } from "./principals.ts";
import type { RequestEnvelope } from "./request.ts";
import { isTenantId, parseUri } from "./uri.ts";

/**
 * Line ② of the checklist: the company the envelope names, once DSoR has checked in its
 * own table that the caller is a member of it. Anything else is refused. The caller reads
 * the envelope's tenant once and passes it in, so the value checked is the value kept.
 */
export function activeTenant(named: RequestEnvelope["tenant"], caller: Principal): string {
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

// The places where the arguments may name a company: the same places step 05 checks for a
// principal. tenantId and activeTenantId are §12's own spellings (step 10's README,
// decision 4). Another spelling is refused only by line ⑥. That is the decision's downside.
const TENANT_FIELDS = ["tenant", "tenant_id", "tenantId", "activeTenantId"];

/** Refuses the call when its arguments name any company but the active one (DSOR-SRC-02b). */
export function checkNamedTenants(input: unknown, tenant: string): void {
  // The input comes from outside the program, so it has no types yet.
  const top = input as { [field: string]: unknown } | null | undefined;
  const correlationInInput = top?.["correlation"] as { [field: string]: unknown } | undefined;
  for (const field of TENANT_FIELDS) {
    refuseUnlessActive(top?.[field], field, tenant);
    refuseUnlessActive(correlationInInput?.[field], `correlation.${field}`, tenant);
  }
}

// Anything there but the active company's own id is refused: another company, one that
// does not exist, or a list or an object that holds one. DSoR never looks the company up,
// so the refusal cannot tell the caller which companies exist.
function refuseUnlessActive(named: unknown, place: string, tenant: string): void {
  if (named !== undefined && named !== tenant) {
    const message = `the arguments name a tenant other than the active one, in ${place}`;
    throw new Refusal("TENANT_MISMATCH", message);
  }
}

/**
 * Refuses the call when the checked input holds a URI outside the active company. Every
 * text is looked at, keys too, however deep, not only the fields a schema calls URIs, so a
 * new operation cannot forget the check (step 10's README, decision 4).
 */
export function checkUrisInTenant(checked: unknown, tenant: string): void {
  // A list of values still to look at, instead of a function that calls itself: an input
  // nested thousands deep cannot run the program out of stack.
  const todo: unknown[] = [checked];
  while (todo.length > 0) {
    const value = todo.pop();
    if (typeof value === "string") refuseUnlessInTenant(value, tenant);
    // line ⑥ checked a JSON copy, so an object here is a plain object or a list.
    else if (typeof value === "object" && value !== null) {
      for (const [key, inner] of Object.entries(value)) todo.push(key, inner);
    }
  }
}

// One answer for every URI outside the company: another company's, one whose company is a
// name such as acme, one that is not canonical. Whether its invoice exists is never looked
// up, so the answer cannot tell (DSOR-ERR-01b).
function refuseUnlessInTenant(text: string, tenant: string): void {
  // DSOR:// in capitals is still meant as a URI.
  if (text.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return;
  let named: string | undefined;
  try {
    named = parseUri(text).tenant_id;
  } catch {
    named = undefined;
  }
  if (named !== tenant) {
    throw new Refusal("TENANT_MISMATCH", "the arguments name a resource outside the active tenant");
  }
}

const SCHEME = "dsor://";
