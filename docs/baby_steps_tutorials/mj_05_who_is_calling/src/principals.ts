// NEW IN STEP 05: who is calling. DSoR finds the caller from the login token and its own
// table, never from the arguments. DSOR-IDN-01 in specs/dsor/02-security.md, section 12,
// and DSOR-SRC-02a in section 11.
import { Refusal } from "./envelope.ts";
import type { RequestEnvelope } from "./request.ts";

/** The four kinds of caller that §12 lists. */
export type PrincipalType = "human" | "agent" | "application" | "system";

/** A company the principal belongs to, and its roles there. Unused until step 06. */
export type Membership = { tenant_id: string; roles: string[] };

/** Who is calling. */
export type Principal = { id: string; type: PrincipalType; memberships: Membership[] };

// Every principal in this step belongs to one company, org_456. Tenants arrive in step 10.
function principal(id: string, type: PrincipalType, roles: string[]): Principal {
  return { id, type, memberships: [{ tenant_id: "org_456", roles }] };
}

// DSoR's own table: each login token it gave, and to whom (README, decision 3). A token
// names nobody until it is looked up here (decision 2). §12 writes tenantId. This
// tutorial spells every field the way the schemas do.
export const logins: ReadonlyMap<string, Principal> = new Map([
  ["tok_7f3a", principal("accounts-payable-fte", "agent", [])],
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

/** The ids that name the caller in an answer's correlation (README, decision 9). */
export function callerIds(caller: Principal): { agent_id: string } | { principal_id: string } {
  // The specification's examples put an agent in agent_id. Anyone else goes in principal_id.
  return caller.type === "agent" ? { agent_id: caller.id } : { principal_id: caller.id };
}
