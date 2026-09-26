// NEW IN STEP 06: what a caller may do comes from its roles, and anything not granted is
// refused. DSOR-AUT-01a and DSOR-AUT-01b in specs/dsor/02-security.md, section 15.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Principal } from "./principals.ts";

/** The role table, as it was read from disk: its file name and its text. */
export type RoleSource = { file: string; text: string };

/** What each role grants: a role's name, and its permissions. */
export type Roles = ReadonlyMap<string, ReadonlySet<string>>;

/** Reads the role table from a file. */
export function readRoles(path: string): RoleSource {
  return { file: basename(path), text: readFileSync(path, "utf8") };
}

/** Checks the role table and every role a principal holds. Nothing is checked yet. */
export function checkRoles(
  _source: RoleSource,
  _principals: Iterable<Principal>,
): { roles: Roles; problems: string[] } {
  return { roles: new Map(), problems: [] };
}

/** The permissions a caller holds. None, until the code exists. */
export function permissionsOf(_caller: Principal, _roles: Roles): ReadonlySet<string> {
  return new Set();
}
