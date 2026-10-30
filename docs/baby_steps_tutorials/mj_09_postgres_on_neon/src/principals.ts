// Who is calling. DSoR finds the caller from the login token and its own
// table, never from the arguments. DSOR-IDN-01 in specs/dsor/02-security.md, section 12,
// and DSOR-SRC-02a and DSOR-SRC-02b in section 11.
import { Refusal } from "./envelope.ts";
import type { RequestEnvelope } from "./request.ts";

/** The four kinds of caller that §12 lists. */
export type PrincipalType = "human" | "agent" | "application" | "system";

// The roles say what the principal may do there (step 06's README, decision 1).
/** A company the principal belongs to, and its roles there. */
export type Membership = { tenant_id: string; roles: string[] };

/** Who is calling. */
export type Principal = { id: string; type: PrincipalType; memberships: Membership[] };

// Every principal in this step belongs to one company, org_456. Tenants arrive in step 10.
function principal(id: string, type: PrincipalType, roles: string[]): Principal {
  return { id, type, memberships: [{ tenant_id: "org_456", roles }] };
}

// DSoR's own table: each login token it gave, and to whom (step 05's README, decision 3).
// A token names nobody until it is looked up here (step 05's decision 2). §12 writes tenantId.
// This tutorial spells every field the way the schemas do.
export const logins: ReadonlyMap<string, Principal> = new Map([
  // The agent holds a stand-in role of its own, ap_agent. It may read, and
  // nothing more. Step 18 should replace it with a person's permission slip (step 06's
  // README, decision 5).
  ["tok_7f3a", principal("accounts-payable-fte", "agent", ["ap_agent"])],
  ["tok_2c91", principal("user_123", "human", ["ap_supervisor"])],
  ["tok_d4e8", principal("cfo_100", "human", ["CFO"])],
]);

/** Finds who is calling, from the login token and DSoR's own table, or refuses the call. */
export function whoIsCalling(request: RequestEnvelope): Principal {
  // The envelope comes from outside the program, so it may even be null.
  const token = request?.token;
  // Only text is looked up. A Map never turns its key into text, so ["tok_7f3a"] finds
  // nobody, and neither does "toString".
  const caller = typeof token === "string" ? logins.get(token) : undefined;
  // One message for every case, so a refusal never tells a caller which tokens exist.
  if (caller === undefined) {
    const message = "log in first: the call has no login token that DSoR gave";
    throw new Refusal("AUTHENTICATION_REQUIRED", message);
  }
  return caller;
}

/** The ids that name the caller in an answer's correlation (step 05's README, decision 9). */
export function callerIds(caller: Principal): { agent_id: string } | { principal_id: string } {
  // The specification's examples put an agent in agent_id. Anyone else goes in principal_id.
  return caller.type === "agent" ? { agent_id: caller.id } : { principal_id: caller.id };
}

// The places where the arguments may name a principal (step 05's README, decision 4). A new
// spelling, such as as_user, is not caught. That is the decision's price.
const AT_THE_TOP = [
  "principal",
  "principal_id",
  "subject",
  "actor",
  "actor_chain",
  "agent_id",
  "user",
];
const IN_CORRELATION = ["principal_id", "agent_id"];

/** Refuses the call when its arguments name anyone but the caller (DSOR-SRC-02b). */
export function checkNamedPrincipals(input: unknown, caller: Principal): void {
  // The input comes from outside the program, so it has no types yet.
  const top = input as { [field: string]: unknown } | null | undefined;
  const correlationInInput = top?.["correlation"] as { [field: string]: unknown } | undefined;
  for (const field of AT_THE_TOP) refuseUnlessCaller(top?.[field], field, caller);
  for (const field of IN_CORRELATION) {
    refuseUnlessCaller(correlationInInput?.[field], `correlation.${field}`, caller);
  }
}

// Anything there but the caller's own id is refused: another name, a name nobody has, or
// a list or an object that holds one. DSoR never looks the name up, so the refusal cannot
// tell the caller who exists.
function refuseUnlessCaller(named: unknown, place: string, caller: Principal): void {
  if (named !== undefined && named !== caller.id) {
    const message = `the arguments name someone other than the caller, in ${place}`;
    throw new Refusal("AUTHORIZATION_DENIED", message);
  }
}
