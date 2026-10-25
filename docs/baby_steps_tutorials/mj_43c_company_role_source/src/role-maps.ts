// NEW IN STEP 43c: each company's role map. A company on its own directory says, in role-maps.json,
//   which of its directory's groups gives which of DSoR's roles. A group is named by its id, the
//   uuid its directory gave it, never by its name: a name is text an administrator may type twice.
//   What a role may do stays in roles.json. Start-up checks every map before any caller
//   (DSOR-IDN-04a, DSOR-IDN-04b; step 43c's README, claim C1, decisions L3, L4, and D8).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RoleSettings } from "./authority.ts";
import { keysWrittenTwice } from "./json.ts";
import type { Roles } from "./permissions.ts";
import { SYSTEM_ROLES } from "./people-commands.ts";
import { isTenantId } from "./uri.ts";

/** One line of a map: the group's name, which DSoR never decides by, and the role it gives. */
export type MapLine = { name: string; role: string };

/** Each company's map, by company: the role each group gives, by the group's id. */
export type RoleMaps = ReadonlyMap<string, ReadonlyMap<string, MapLine>>;

/** The maps file, as it was read from disk: its name and its text. */
export type RoleMapsSource = { file: string; text: string };

const SHIPPED = fileURLToPath(new URL("../role-maps.json", import.meta.url));

/** Reads the maps file: this step's own, unless another is named. */
export function readRoleMaps(path: string = SHIPPED): RoleMapsSource {
  return { file: "role-maps.json", text: readFileSync(path, "utf8") };
}

// A uuid as authentik writes a group's pk: lowercase, with its dashes. Any other text is a name.
// not copied: RFC 9562's form of a uuid, in lowercase only, so one group has one spelling.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELDS: ReadonlySet<string> = new Set(["group", "name", "role"]);

/** Checks each map of a company on scim, and names every problem. A map of any other company is not read. */
export function checkRoleMaps(
  source: RoleMapsSource,
  settings: RoleSettings,
  roles: Roles,
): { maps: RoleMaps; problems: string[] } {
  const { file, text } = source;
  const maps = new Map<string, Map<string, MapLine>>();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { maps, problems: [`${file}: not valid JSON`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { maps, problems: [`${file}: must be an object that gives each company its map`] };
  }
  const problems = keysWrittenTwice(text).map(
    (key) => `${file}: ${JSON.stringify(key)} is written twice in one object`,
  );
  for (const [tenant, lines] of Object.entries(data)) {
    if (!isTenantId(tenant)) {
      problems.push(`${file}: ${JSON.stringify(tenant)} is not a company id like org_456`);
      continue;
    }
    // A company on DSoR's own table takes its roles from the table: its map, if any, is not read,
    //   so one company never has two truths (the learner's L10).
    if (settings.get(tenant)?.kind !== "scim") continue;
    if (!Array.isArray(lines)) {
      const why = "must be a list of lines, each a group, its name, and a role";
      problems.push(`${file}: ${tenant}'s map ${why}`);
      continue;
    }
    const map = new Map<string, MapLine>();
    lines.forEach((entry: unknown, index) => {
      const where = `${file}: ${tenant}'s line ${index + 1}`;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        problems.push(`${where} must be an object with group, name, and role`);
        return;
      }
      const unknown = Object.keys(entry).filter((key) => !FIELDS.has(key));
      if (unknown.length > 0) {
        problems.push(`${where} has a field it does not know: ${JSON.stringify(unknown[0])}`);
        return;
      }
      const { group, name, role } = entry as Record<string, unknown>;
      if (typeof group !== "string" || !UUID.test(group)) {
        const why = "which is no id: a group is named by its uuid, never its name";
        problems.push(`${where} names the group ${JSON.stringify(group)}, ${why}`);
        return;
      }
      if (map.has(group)) {
        problems.push(`${where} names the group ${group} again: one group, one role`);
        return;
      }
      if (typeof name !== "string" || name.length < 1 || name.length > 200) {
        problems.push(`${where} must name the group, 1 to 200 letters`);
        return;
      }
      if (typeof role !== "string" || !roles.has(role)) {
        problems.push(
          `${where} gives the role ${JSON.stringify(role)}, which roles.json does not have`,
        );
        return;
      }
      // A role only DSoR's system logins hold is never a person's, from a map or from a grant
      //   (step 43b's review, finding 8).
      if (SYSTEM_ROLES.has(role)) {
        problems.push(`${where} gives ${role}, a role of DSoR's system logins, never a person's`);
        return;
      }
      map.set(group, { name, role });
    });
    maps.set(tenant, map);
  }
  // Every company on scim needs a map. With none, its people would hold no role at all, and nobody
  //   would know why.
  for (const [tenant, setting] of settings) {
    if (setting.kind === "scim" && !Object.hasOwn(data, tenant)) {
      problems.push(`${file}: ${tenant}'s role source is scim, and it has no map`);
    }
  }
  return { maps, problems };
}
