// NEW IN STEP 06: what a caller may do.
//
// Step 05 answered *who are you*. This answers *may you do this*, and the answer is no
// unless somebody said yes. That is the whole idea: a permission that was never granted is
// refused, so a forgotten grant makes something stop working instead of quietly letting a
// stranger through.
//
// A permission is a short string: `<resource>:<action>`. `invoice:read`, `invoice:issue`,
// `payment:approve`. Each operation's contract already says which one it needs — it has said
// so since step 03, in `authorization.permission`, and nothing has read it until now.
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
 * changing what a role may do is one edit rather than one per person.
 *
 * `approver` is the interesting one. cfo_100 is the most senior person in the story and the
 * only one who cannot issue an invoice, because a CFO signs payments off and does not do
 * accounts-payable data entry. Permissions are not a ladder.
 *
 * A real deployment reads these from a role source — an identity provider or a directory —
 * which DSOR-IDN-04a requires and which is steps 18 and 19. Here they are in the source,
 * like the people beside them.
 */
export const ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ap_supervisor: Object.freeze(["invoice:read", "invoice:issue"]),
  approver: Object.freeze(["invoice:read", "payment:approve"]),
  ap_worker: Object.freeze(["invoice:read", "invoice:issue"]),
});

/** Nobody's permissions. Frozen, so an unknown role cannot be grown into a known one. */
const NOTHING: readonly string[] = Object.freeze([]);

// The shape of a permission is read out of the specification's own schema rather than
// written again here. `common.schema.json` is the same file the contracts are validated
// against, so the two cannot drift: change the schema and this follows.
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
 * Takes the table as an argument rather than reading the one above, so a test can hand it a
 * rotten one — and so it can run at start-up rather than on the first request.
 *
 * A misspelled permission fails **closed**: `INVOICE:READ` matches nothing, so the role
 * quietly grants less than its author meant and the first sign of trouble is somebody unable
 * to do their job. Checking the table when the program loads turns that silence into a stop.
 * An empty grant list is refused for the same reason: it is nearly always a half-finished
 * edit, and deny-by-default would turn it into an outage nobody could explain.
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

// Start-up, not first request.
//
// This holds **how many** permissions were checked, not `true`. Step 04's WIRING_CHECKED is a
// boolean, and a mutation test here showed why that is not enough: deleting the call and
// leaving `return true` behind kept every test green. A count cannot be faked that way — a
// test compares it against the table, so the number has to have come from walking it.
//
// What is still not provable from inside this process: replacing the call with the literal
// `6` — today's correct answer — passes every test. No test can watch a line at module scope
// run, because by the time a test imports this file it already has. A child process importing
// a deliberately bad table would close it, and costs more machinery than it teaches here. The
// count is not a proof; it raises the price of the mistake from "delete a line" to "delete a
// line and work out the right number and keep it right".
export const PERMISSIONS_CHECKED: number = checkPermissions(ROLES);

/** Everything this principal's role grants. Nothing at all, for a role nobody defined. */
export function permissionsOf(principal: Principal): readonly string[] {
  return ROLES[principal.role] ?? NOTHING;
}

/**
 * May this principal do this?
 *
 * Whole strings only. `invoice:read` does not satisfy a request for `invoice:readall`, and
 * holding `invoice:issue` does not satisfy `invoice:i` — the same lesson findPerson taught in
 * step 05, where a prefix match would have let `cfo_100_evil` log in as `cfo_100`.
 *
 * An empty permission is held by nobody, and there is deliberately no line here saying so.
 * There was one, and deleting it broke no test — because `includes("")` is already false, and
 * `checkPermissions` refuses a table that grants an empty string, so no role can hold one. A
 * guard that provably changes nothing is decoration, and decoration in a security check is
 * worse than nothing: it reads like the protection lives here when it lives in those two other
 * places.
 */
export function holds(principal: Principal, permission: string): boolean {
  return permissionsOf(principal).includes(permission);
}
