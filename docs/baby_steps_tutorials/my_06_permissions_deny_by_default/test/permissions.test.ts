// NEW IN STEP 06: what a role grants, and what it does not.
//
// This tests the permission table on its own. It knows nothing about operations — you hand it
// a person and a permission string, and it answers yes or no. The smallest thing that can be
// tested by itself is the easiest thing to trust.

import { describe, expect, it } from "vitest";
import { holds, permissionsOf, ROLES } from "../src/permissions.ts";
import { everyone, findPerson, type Principal } from "../src/people.ts";

/** A principal this program does not know, so a role can be tried without adding a person. */
function madeUp(role: string): Principal {
  return Object.freeze({
    id: "someone",
    type: "human" as const,
    role,
    memberships: Object.freeze([Object.freeze({ tenantId: "org_456" })]),
  });
}

/** The principal, or a failure. Keeps every test below one line shorter. */
function person(id: string): Principal {
  const found = findPerson(id);

  if (found === undefined) {
    throw new Error(`${id} is not someone this program knows`);
  }

  return found;
}

describe("permissions", () => {
  it("DSOR-AUT-01b: a principal holds what their role grants, and nothing else", () => {
    expect([...permissionsOf(person("user_123"))].sort()).toEqual([
      "invoice:issue",
      "invoice:read",
    ]);
    expect([...permissionsOf(person("cfo_100"))].sort()).toEqual([
      "invoice:read",
      "payment:approve",
    ]);
    expect([...permissionsOf(person("accounts-payable-fte"))].sort()).toEqual([
      "invoice:issue",
      "invoice:read",
    ]);
  });

  // The one the step is named after. A role nobody granted anything holds nothing — it is not
  // an error to be reported and worked around, and it is certainly not a reason to let someone
  // through. If we never said yes, the answer is no.
  it("DSOR-AUT-01b: a role nobody granted anything holds nothing", () => {
    for (const role of ["", "admin", "ap_supervisorr", "AP_SUPERVISOR", "root"]) {
      expect(permissionsOf(madeUp(role)), JSON.stringify(role)).toEqual([]);

      // Not even reading, which is the one that feels harmless.
      expect(holds(madeUp(role), "invoice:read"), JSON.stringify(role)).toBe(false);
    }
  });

  // Step 05's bug in a new file. There, matching a name by prefix let `cfo_100_evil` log in as
  // `cfo_100`. Here, matching a permission by prefix means asking for `invoice:i` succeeds
  // because `invoice:issue` starts with it — and asking for `""` succeeds, because every
  // string starts with nothing. A prefix is not a match.
  it("DSOR-AUT-01b: a permission is matched whole, never by prefix", () => {
    const supervisor = person("user_123");

    expect(holds(supervisor, "invoice:read")).toBe(true);
    expect(holds(supervisor, "invoice:issue")).toBe(true);

    for (const asked of [
      "invoice:i",
      "invoice:issu",
      "invoice:rea",
      "invoice:readall",
      "invoice:issue.propose",
      "voice:read",
      "invoice:read ",
      " invoice:read",
      "",
    ]) {
      expect(holds(supervisor, asked), JSON.stringify(asked)).toBe(false);
    }
  });

  // Every person's role is one the table knows. Without this, a typo in people.ts would take
  // every permission away from somebody and no test would notice — deny-by-default means the
  // mistake is silent.
  it("DSOR-AUT-01b: everybody in the story has a role the table defines", () => {
    for (const who of everyone()) {
      expect(Object.keys(ROLES), who.id).toContain(who.role);
      expect(permissionsOf(who).length, who.id).toBeGreaterThan(0);
    }
  });

  // `readonly` is erased before Node runs — step 01's lesson. A caller who could push onto a
  // role's list would grant themselves anything.
  it("the table of roles cannot be edited after it is handed out", () => {
    expect(Object.isFrozen(ROLES)).toBe(true);

    for (const [role, granted] of Object.entries(ROLES)) {
      expect(Object.isFrozen(granted), role).toBe(true);
      expect(() => (granted as string[]).push("payment:execute")).toThrow(TypeError);
    }

    expect(() => {
      (ROLES as Record<string, readonly string[]>)["root"] = ["payment:execute"];
    }).toThrow(TypeError);

    // And the list a caller is handed cannot be grown into a bigger one.
    const held = permissionsOf(person("cfo_100"));

    expect(() => (held as string[]).push("invoice:issue")).toThrow(TypeError);
    expect(holds(person("cfo_100"), "invoice:issue")).toBe(false);
  });
});
