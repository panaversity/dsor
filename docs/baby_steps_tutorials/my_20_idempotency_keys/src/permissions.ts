// STEP 06: what a caller may do.
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

import { readFileSync } from "node:fs";
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
 * which DSOR-IDN-04a requires. Here they sit in the source, like the people beside them.
 *
 * STEP 18: and the program asks for a slip's signer's permissions through a role source,
 * `authority.ts`. STEP 19: that source is the company's directory, and the fake one in
 * `directory.ts` builds its answers from this list. A person who is logged in is still judged by
 * this list directly, standing in for what a real login would carry (decision 130).
 */
// STEP 17: the supervisor and the agent may make a draft payment and take one back. The
// CFO approves payments, in a later step, and makes none (decision 125).
export const ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ap_supervisor: Object.freeze([
    "invoice:read",
    "invoice:issue",
    "payment:create",
    "payment:cancel",
  ]),
  approver: Object.freeze(["invoice:read", "payment:approve"]),
  // STEP 18: the agent's own role reads. Every command it sends runs under a permission
  // slip a person signed, and its power there is computed from the slip (decision 127).
  ap_worker: Object.freeze(["invoice:read"]),
});

/**
 * Nobody's permissions.
 *
 * Frozen and shared, so a role nobody defined cannot be grown into one that exists. An
 * unfrozen empty array handed out here would be an invitation.
 */
const NOTHING: readonly string[] = Object.freeze([]);

// STEP 06. The shape of a permission, read out of the specification's own schema
// instead of written again here. `common.schema.json` is the same file the contracts are
// validated against, so the two cannot drift: change the schema and this follows. Writing
// `/^[a-z]+:[a-z]+$/` by hand would have been shorter and wrong — it refuses
// `payment:execute.propose`, which the specification allows.
const pattern = new RegExp(
  (
    JSON.parse(readFileSync(new URL("./schemas/common.schema.json", import.meta.url), "utf8")) as {
      $defs: { permission: { pattern: string } };
    }
  ).$defs.permission.pattern,
);

/** The shape every permission must have, from `common.schema.json`. */
export function permissionPattern(): RegExp {
  return pattern;
}

/**
 * Refuses a role table that is not well formed, and returns how many permissions it checked.
 *
 * This exists because of a failure that is **safe and silent**, which is the worst combination
 * to debug. Write `INVOICE:READ` in a role and it matches nothing, so the role grants less than
 * its author meant. Nobody is let in who should not be — the direction is right — but nobody
 * finds out either, until a person cannot do their job and the reason is a capital letter in a
 * file they have never opened. Checking the table when the program starts turns that silence
 * into a stop.
 *
 * An empty grant list is refused for the same reason: it is almost always a half-finished edit,
 * and deny-by-default would turn it into an outage nobody could explain.
 *
 * It takes the table as an argument rather than reading the one above, so a test can hand it a
 * rotten one — and so it can run at start-up instead of on the first request.
 */
export function checkPermissions(roles: Readonly<Record<string, readonly string[]>>): number {
  let checked = 0;

  for (const [role, granted] of Object.entries(roles)) {
    if (granted.length === 0) {
      throw new TypeError(`${role} grants nothing: a role with no permissions is never useful`);
    }

    for (const permission of granted) {
      if (!pattern.test(permission)) {
        throw new TypeError(
          `${role} grants ${JSON.stringify(permission)}, which is not <resource>:<action>`,
        );
      }

      checked += 1;
    }
  }

  return checked;
}

// Start-up, not first request. A bad table stops the program before any caller gets a turn.
//
// This holds **how many** permissions were checked, not `true`. An earlier version of this step
// used a boolean, and a mutation test found the hole at once: delete the call, leave `return
// true` behind, and every test stayed green. The flag said the check had run; all it proved was
// that somebody had written `true`. A count has to come from walking the table.
//
// What is still not provable from inside this process: replacing the call with the literal `6`
// — today's correct answer — would also pass. No test can watch a line at module scope run,
// because by the time a test imports this file it already has. A child process importing a
// deliberately bad table would close that, and costs more machinery than it teaches here. The
// count is not a proof; it moves the mistake from "delete a line" to "delete a line, work out
// the right number, and keep it right as the table changes".
export const PERMISSIONS_CHECKED: number = checkPermissions(ROLES);

/**
 * Everything this principal's role grants.
 *
 * A role nobody defined grants **nothing**. That is deny-by-default, and it is worth knowing
 * what the two tempting alternatives would cost:
 *
 * - Throwing on an unknown role puts a caller in control of whether the program runs, and it
 *   is the wrong shape anyway: a missing grant is not a crash, it is a no. Loudness belongs in
 *   the table, checked once at start-up.
 * - Falling back to some small default — "read-only seems safe" — is a permission nobody
 *   granted. The one thing certain about an unknown role is that nobody decided what it may
 *   do.
 */
export function permissionsOf(principal: Principal): readonly string[] {
  // `Object.hasOwn` first, and it is not belt-and-braces. A plain `ROLES[role] ?? NOTHING`
  // walks the **prototype chain**, so a role named `toString` or `constructor` finds a function
  // on Object.prototype, `?? NOTHING` never fires, and `holds` then calls `.includes` on a
  // function and throws a raw TypeError at the caller instead of answering no. Worse, anything
  // written to Object.prototype becomes a role that grants whatever it likes — one that
  // checkPermissions never validated and that `Object.keys(ROLES)` never shows.
  //
  // login.ts:58 already guards against exactly this, with exactly this call, because "a name the
  // object merely inherits is a name nobody in this program chose". That lesson was applied to
  // identity in step 05 and missed here until a hostile review found it. Same bug, same file
  // tree, one day apart.
  if (!Object.hasOwn(ROLES, principal.role)) {
    return NOTHING;
  }

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
