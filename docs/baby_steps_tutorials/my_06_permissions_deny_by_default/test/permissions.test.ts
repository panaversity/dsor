// NEW IN STEP 06: what a role grants, and what it does not.
//
// This tests the permission table on its own. It knows nothing about operations — you hand it
// a person and a permission string, and it answers yes or no. The smallest thing that can be
// tested by itself is the easiest thing to trust.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkPermissions,
  holds,
  permissionPattern,
  permissionsOf,
  PERMISSIONS_CHECKED,
  ROLES,
} from "../src/permissions.ts";
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
  // NEW IN PIECE 3. The shape of a permission is read out of common.schema.json rather than
  // written again in the code, so the two cannot drift apart. `.propose` is the tell: only the
  // specification's own pattern allows that suffix, so a pattern accepting it is the real one
  // and not somebody's guess at it.
  it("DSOR-AUT-01a: the shape of a permission comes from the specification's own schema", () => {
    const pattern = permissionPattern();

    expect(pattern.test("invoice:read")).toBe(true);
    expect(pattern.test("payment:execute.propose")).toBe(true);

    const schema = JSON.parse(
      readFileSync(new URL("../src/schemas/common.schema.json", import.meta.url), "utf8"),
    ) as { $defs: { permission: { pattern: string } } };

    expect(pattern.source).toBe(schema.$defs.permission.pattern);
  });

  it("DSOR-AUT-01a: every permission in the table has the <resource>:<action> shape", () => {
    const pattern = permissionPattern();

    for (const [role, granted] of Object.entries(ROLES)) {
      for (const permission of granted) {
        expect(pattern.test(permission), `${role} grants ${JSON.stringify(permission)}`).toBe(true);
      }
    }
  });

  // The silent failure this piece exists for. `INVOICE:READ` matches nothing, so the role grants
  // less than its author meant and nobody finds out until somebody cannot do their job. The
  // direction is safe; the silence is not. Checking the table at start-up turns it into a stop.
  it("DSOR-AUT-01a: a role that grants a malformed permission stops the program", () => {
    const wrong = [
      ["shouting", "INVOICE:READ"],
      ["no action", "invoice"],
      ["empty action", "invoice:"],
      ["a sentence", "may read invoices"],
      ["nothing at all", ""],
      ["two colons", "invoice:read:extra"],
      ["a dash", "invoice-read"],
    ] as const;

    for (const [why, permission] of wrong) {
      expect(() => checkPermissions({ a_role: [permission] }), why).toThrow(/a_role/);
    }
  });

  it("DSOR-AUT-01a: a role that grants nothing at all stops the program", () => {
    // Not the same as a role nobody has. An empty list is nearly always a half-finished edit,
    // and deny-by-default would turn it into an outage nobody could explain.
    expect(() => checkPermissions({ a_role: [] })).toThrow(/a_role/);
  });

  // Not `toBe(true)`. A boolean beside a check can be left behind when the check is deleted —
  // which is exactly what happened in an earlier version of this step, with every test green. A
  // count has to come from walking the table, so deleting the call cannot leave a right answer.
  it("DSOR-AUT-01a: the table was checked when the program loaded, all of it", () => {
    const every = Object.values(ROLES).reduce((n, granted) => n + granted.length, 0);

    expect(every).toBeGreaterThan(0);
    expect(PERMISSIONS_CHECKED).toBe(every);
  });

  it("DSOR-AUT-01a: the checker reports how many permissions it looked at", () => {
    expect(checkPermissions({ a: ["invoice:read"], b: ["invoice:read", "invoice:issue"] })).toBe(3);
  });

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
