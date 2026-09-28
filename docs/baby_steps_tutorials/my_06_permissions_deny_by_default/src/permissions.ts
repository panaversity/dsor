// NEW IN STEP 06: what a caller may do.
//
// Step 05 answered *who are you*. This answers *may you do this*, and the answer is no unless
// somebody said yes. That is the whole idea, and it is the opposite of how most programs grow:
// a permission nobody granted is refused, so a grant somebody forgot makes a thing stop
// working loudly instead of quietly letting a stranger through.
//
// A permission is a short string in two parts, `<resource>:<action>`: `invoice:read`,
// `invoice:issue`, `payment:approve`.
//
// This file knows nothing about operations, envelopes or callers. You hand it a person and a
// permission and it answers yes or no. Keeping it that small is why it can be trusted.
//
// Rule DSOR-AUT-01a: DSoR MUST support role-based access control using the
// `<resource>:<action>` permission format.
// Rule DSOR-AUT-01b: DSoR MUST deny any operation for which no permission is granted.

import type { Principal } from "./people.ts";

/**
 * What each role may do.
 *
 * Permissions hang off a **role**, not off a person. That is what the "role-based" in
 * DSOR-AUT-01a means, and it is how it works in a company: a new joiner is given a role, and
 * changing what a job may do is one edit here rather than one per person.
 *
 * `approver` is the one to look at twice. cfo_100 is the most senior person in this story and
 * the only one who cannot issue an invoice, because a CFO signs payments off and does not do
 * accounts-payable data entry. **Permissions are not a ladder.** Design them by rank and the
 * most powerful account in the company becomes the one most worth stealing.
 *
 * A real deployment reads these from a role source — a directory or an identity provider —
 * which DSOR-IDN-04a requires and which is steps 18 and 19. Here they sit in the source, like
 * the people beside them.
 */
export const ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ap_supervisor: Object.freeze(["invoice:read", "invoice:issue"]),
  approver: Object.freeze(["invoice:read", "payment:approve"]),
  ap_worker: Object.freeze(["invoice:read", "invoice:issue"]),
});

/**
 * Nobody's permissions.
 *
 * Frozen and shared, so a role nobody defined cannot be grown into one that exists. An
 * unfrozen empty array handed out here would be an invitation.
 */
const NOTHING: readonly string[] = Object.freeze([]);

/**
 * Everything this principal's role grants.
 *
 * A role nobody defined grants **nothing**. That single `?? NOTHING` is deny-by-default, and
 * it is worth knowing what the two tempting alternatives would cost:
 *
 * - Throwing on an unknown role puts a caller in control of whether the program runs, and it
 *   is the wrong shape anyway: a missing grant is not a crash, it is a no. Loudness belongs in
 *   the table, checked once at start-up.
 * - Falling back to some small default — "read-only seems safe" — is a permission nobody
 *   granted. The one thing certain about an unknown role is that nobody decided what it may
 *   do.
 */
export function permissionsOf(principal: Principal): readonly string[] {
  return ROLES[principal.role] ?? NOTHING;
}

/**
 * May this principal do this?
 *
 * Whole strings only, which is the trap in this file. `includes` is right; anything looser is
 * a hole. With `some((g) => g.startsWith(permission))` a caller asking for `invoice:i`
 * succeeds because `invoice:issue` starts with it, and a caller asking for `""` succeeds
 * because every string starts with nothing.
 *
 * That is the same bug step 05 had in `findPerson`, where a prefix match let `cfo_100_evil`
 * log in as `cfo_100`. Twice now, in two files, in code written a day apart. **A prefix is not
 * a match** — and the reason it keeps happening is that the loose version reads as more
 * forgiving, which feels like a virtue right up to the moment it is a bypass.
 */
export function holds(principal: Principal, permission: string): boolean {
  return permissionsOf(principal).includes(permission);
}
