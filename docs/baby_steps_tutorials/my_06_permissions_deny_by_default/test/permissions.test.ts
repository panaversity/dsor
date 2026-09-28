// NEW IN STEP 06: what a role grants, and what it does not.
//
// These test the permission table on its own, away from any operation. The step's headline
// — cfo_100 can read and cannot issue — is in test/deny-by-default.test.ts.

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
import { findPerson, type Principal } from "../src/people.ts";

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
  // The pattern is read out of common.schema.json rather than copied into the code, so the
  // two cannot drift apart. `.propose` is the tell: only the specification's own pattern
  // allows that suffix, so a pattern that accepts it is the real one and not a guess.
  it("DSOR-AUT-01a: the shape of a permission comes from the specification's own schema", () => {
    const pattern = permissionPattern();

    expect(pattern.test("invoice:read")).toBe(true);
    expect(pattern.test("payment:execute.propose")).toBe(true);

    // Same as the file says, character for character.
    const schema = JSON.parse(
      readFileSync(new URL("../src/schemas/common.schema.json", import.meta.url), "utf8"),
    ) as { $defs: { permission: { pattern: string } } };

    expect(pattern.source).toBe(schema.$defs.permission.pattern);
  });

  it("DSOR-AUT-01a: every permission in the table has the <resource>:<action> shape", () => {
    const pattern = permissionPattern();

    for (const [role, granted] of Object.entries(ROLES)) {
      expect(granted.length, role).toBeGreaterThan(0);

      for (const permission of granted) {
        expect(pattern.test(permission), `${role} grants ${JSON.stringify(permission)}`).toBe(true);
      }
    }
  });

  // A typo in a grant fails *closed*: `INVOICE:READ` never matches anything, so the role
  // silently grants less than its author meant. Silent is the problem. The table is checked
  // when the program loads, so a typo stops it instead of quietly taking a permission away.
  it("DSOR-AUT-01a: a role that grants a malformed permission stops the program", () => {
    const wrong = [
      ["shouting", "INVOICE:READ"],
      ["no action", "invoice"],
      ["empty action", "invoice:"],
      ["a sentence", "may read invoices"],
      ["nothing at all", ""],
      ["two colons", "invoice:read:extra"],
    ] as const;

    for (const [why, permission] of wrong) {
      expect(() => checkPermissions({ a_role: [permission] }), why).toThrow(/a_role/);
    }
  });

  it("DSOR-AUT-01a: a role that grants nothing at all stops the program", () => {
    // Not the same thing as a role nobody has. An empty grant list is almost always a
    // half-finished edit, and deny-by-default would turn it into a silent outage.
    expect(() => checkPermissions({ a_role: [] })).toThrow(/a_role/);
  });

  // Not `toBe(true)`. A boolean flag beside the check can be left behind when the check is
  // deleted — that is exactly what a mutation test found here. A count has to come from
  // walking the table, so it cannot survive the call being removed.
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

  // The whole of deny by default, in one line: if we never said yes, the answer is no. An
  // unknown role is not an error to be reported and worked around — it simply grants nothing.
  it("DSOR-AUT-01b: a role nobody granted anything holds nothing", () => {
    for (const role of ["", "admin", "ap_supervisorr", "AP_SUPERVISOR", "root"]) {
      expect(permissionsOf(madeUp(role)), JSON.stringify(role)).toEqual([]);
      expect(holds(madeUp(role), "invoice:read"), JSON.stringify(role)).toBe(false);
    }
  });

  // The same lesson as findPerson in step 05, in a different place: a prefix is not a match.
  // `invoice:read` must not satisfy `invoice:readall`, and holding `invoice:issue` must not
  // satisfy a request for `invoice:i`.
  it("DSOR-AUT-01b: a permission is matched whole, never by prefix", () => {
    const supervisor = person("user_123");

    expect(holds(supervisor, "invoice:read")).toBe(true);
    expect(holds(supervisor, "invoice:issue")).toBe(true);

    for (const asked of [
      "invoice:i",
      "invoice:rea",
      "invoice:readall",
      "invoice:issue.propose",
      "invoice:issu",
      "voice:read",
      "invoice:read ",
      " invoice:read",
    ]) {
      expect(holds(supervisor, asked), JSON.stringify(asked)).toBe(false);
    }
  });

  it("DSOR-AUT-01b: an empty permission is held by nobody", () => {
    for (const id of ["user_123", "cfo_100", "accounts-payable-fte"]) {
      expect(holds(person(id), "")).toBe(false);
    }
  });

  // `readonly` is erased before Node runs, so the table needs freezing as well as declaring —
  // step 01's lesson. A caller who could push onto a role's list would grant themselves
  // anything.
  it("the table of roles cannot be edited after it is handed out", () => {
    expect(Object.isFrozen(ROLES)).toBe(true);

    for (const [role, granted] of Object.entries(ROLES)) {
      expect(Object.isFrozen(granted), role).toBe(true);
      expect(() => (granted as string[]).push("payment:execute")).toThrow(TypeError);
    }

    expect(() => {
      (ROLES as Record<string, readonly string[]>)["root"] = ["payment:execute"];
    }).toThrow(TypeError);

    // And the list a caller is handed cannot be edited into a bigger one either.
    const held = permissionsOf(person("cfo_100"));

    expect(() => (held as string[]).push("invoice:issue")).toThrow(TypeError);
    expect(holds(person("cfo_100"), "invoice:issue")).toBe(false);
  });
});
