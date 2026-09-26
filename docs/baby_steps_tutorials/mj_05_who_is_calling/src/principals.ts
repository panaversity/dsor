// NEW IN STEP 05: who is calling. DSoR finds the caller from the login token and its own
// table, never from the arguments. DSOR-IDN-01 in specs/dsor/02-security.md, section 12.

/** The four kinds of caller that §12 lists. */
export type PrincipalType = "human" | "agent" | "application" | "system";

/** A company the principal belongs to, and its roles there. Unused until step 06. */
export type Membership = { tenant_id: string; roles: string[] };

/** Who is calling. */
export type Principal = { id: string; type: PrincipalType; memberships: Membership[] };

// DSoR's own table: each login token it gave, and to whom. Empty until the code exists.
export const logins: ReadonlyMap<string, Principal> = new Map<string, Principal>();
