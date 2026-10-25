// Step 43c: a company on its own directory names its role source `scim` in role-sources.json, and
// its role map in role-maps.json: which group, by its id, gives which of DSoR's roles. Start-up
// checks both before any caller (DSOR-IDN-04a, DSOR-IDN-05; step 43c's README, claim C1, decisions
// L3 and L4).
import { describe, expect, it } from "vitest";
import { checkRoleSettings, readRoleSettings, SCIM_ROLE_SOURCES } from "../src/authority.ts";
import { logins } from "../src/principals.ts";
import { checkRoleMaps, readRoleMaps, type RoleMapsSource } from "../src/role-maps.ts";
import { checkRoles } from "../src/permissions.ts";
import { buildRegistry } from "../src/registry.ts";
import { handlers, refusal, shipped, shippedRoles } from "./helpers.ts";

const roles = checkRoles(shippedRoles, logins.values()).roles;
const scim = checkRoleSettings(readRoleSettings(SCIM_ROLE_SOURCES), logins.values()).settings;

// The ids of org_456's groups in the authentik of the real check, 2026-10-26.
const FINANCE = "65f59cd5-727e-4dfd-bbca-bd79023adb29";
const SUPERVISORS = "4c4650fa-861e-4480-acd5-6ab376c04683";
const ADMINS = "f029a971-5869-4063-9241-499171bb694a";

const mapsFile = (data: unknown): RoleMapsSource => ({
  file: "role-maps.json",
  text: typeof data === "string" ? data : JSON.stringify(data),
});
const line = (over: Record<string, unknown> = {}) => ({
  group: FINANCE,
  name: "Finance-Approvers",
  role: "CFO",
  ...over,
});

describe("Step 43c, C1: a company on its directory has a role source scim and a role map", () => {
  it("DSOR-IDN-05: role-sources.scim.json puts org_456 on scim for two hours, and org_789 stays on DSoR's table", () => {
    expect([...scim]).toStrictEqual([
      ["org_456", { kind: "scim", max_staleness: "PT2H", ms: 7_200_000 }],
      ["org_789", { kind: "dsor_assignments", max_staleness: "PT1H", ms: 3_600_000 }],
    ]);
  });

  it("DSOR-IDN-04a: the shipped role-maps.json gives org_456 three groups, by their ids", () => {
    const { maps, problems } = checkRoleMaps(readRoleMaps(), scim, roles);
    expect(problems).toStrictEqual([]);
    expect([...(maps.get("org_456") ?? new Map())]).toStrictEqual([
      [FINANCE, { name: "Finance-Approvers", role: "CFO" }],
      [SUPERVISORS, { name: "AP-Supervisors", role: "ap_supervisor" }],
      [ADMINS, { name: "Tenant-Admins", role: "tenant_admin" }],
    ]);
    expect(maps.has("org_789")).toBe(false);
  });

  it("DSOR-IDN-04a: many groups may give one role", () => {
    const other = "0b6f1d1e-3c3a-4a52-9a43-111111111111";
    const { maps, problems } = checkRoleMaps(
      mapsFile({ org_456: [line(), line({ group: other, name: "Treasury" })] }),
      scim,
      roles,
    );
    expect(problems).toStrictEqual([]);
    expect(maps.get("org_456")?.get(other)).toStrictEqual({ name: "Treasury", role: "CFO" });
  });

  it("DSOR-IDN-05: a map for a company on DSoR's own table is not read: that company's roles are its table's", () => {
    const { maps, problems } = checkRoleMaps(
      mapsFile({ org_456: [line()], org_789: [line()] }),
      scim,
      roles,
    );
    expect(problems).toStrictEqual([]);
    expect(maps.has("org_789")).toBe(false);
  });

  it.each([
    ["text that is not JSON", "{ org_456: ", "role-maps.json: not valid JSON"],
    ["a list", "[]", "role-maps.json: must be an object that gives each company its map"],
    ["null", "null", "role-maps.json: must be an object that gives each company its map"],
    [
      "a company id that is not one",
      { org_456: [line()], acme: [line()] },
      'role-maps.json: "acme" is not a company id like org_456',
    ],
    [
      "a map that is not a list",
      { org_456: line() },
      "role-maps.json: org_456's map must be a list of lines, each a group, its name, and a role",
    ],
    [
      "a line that is not an object",
      { org_456: ["CFO"] },
      "role-maps.json: org_456's line 1 must be an object with group, name, and role",
    ],
    [
      "a line with a field it does not know",
      { org_456: [line({ when: "always" })] },
      'role-maps.json: org_456\'s line 1 has a field it does not know: "when"',
    ],
    [
      "a group by its name",
      { org_456: [line({ group: "Finance-Approvers" })] },
      'role-maps.json: org_456\'s line 1 names the group "Finance-Approvers", which is no id: a group is named by its uuid, never its name',
    ],
    [
      "a group in capitals",
      { org_456: [line({ group: FINANCE.toUpperCase() })] },
      `role-maps.json: org_456's line 1 names the group "${FINANCE.toUpperCase()}", which is no id: a group is named by its uuid, never its name`,
    ],
    [
      "one group twice",
      { org_456: [line(), line({ role: "ap_supervisor" })] },
      `role-maps.json: org_456's line 2 names the group ${FINANCE} again: one group, one role`,
    ],
    [
      "no name",
      { org_456: [line({ name: "" })] },
      "role-maps.json: org_456's line 1 must name the group, 1 to 200 letters",
    ],
    [
      "a role roles.json does not have",
      { org_456: [line({ role: "Treasurer" })] },
      'role-maps.json: org_456\'s line 1 gives the role "Treasurer", which roles.json does not have',
    ],
    [
      "a role of DSoR's system logins",
      { org_456: [line({ role: "scheduler" })] },
      "role-maps.json: org_456's line 1 gives scheduler, a role of DSoR's system logins, never a person's",
    ],
    [
      "a company on scim with no map",
      {},
      "role-maps.json: org_456's role source is scim, and it has no map",
    ],
  ])("DSOR-IDN-04a: start-up refuses %s, and names it", (_case, data, problem) => {
    expect(checkRoleMaps(mapsFile(data), scim, roles).problems).toContain(problem);
  });

  it("DSOR-IDN-04a: a role a company's map gives must be one the role table has, whatever table start-up reads", () => {
    const fewer = new Map([...roles].filter(([role]) => role !== "CFO"));
    expect(checkRoleMaps(mapsFile({ org_456: [line()] }), scim, fewer).problems).toStrictEqual([
      'role-maps.json: org_456\'s line 1 gives the role "CFO", which roles.json does not have',
    ]);
  });
});

describe("Step 43c, C1: start-up reads the maps with the role sources", () => {
  /** Builds a registry with these role sources and these maps, and names what start-up refused. */
  const startWith = (settings: string, maps: RoleMapsSource): string =>
    refusal(() =>
      buildRegistry(
        shipped,
        handlers,
        shippedRoles,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        readRoleSettings(settings),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        maps,
      ),
    );

  it("DSOR-IDN-04a: a registry of the scim role sources and the shipped maps starts, and holds org_456's map", () => {
    const registry = buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      readRoleSettings(SCIM_ROLE_SOURCES),
    );
    expect(registry.roleMaps.get("org_456")?.get(FINANCE)?.role).toBe("CFO");
  });

  it("DSOR-IDN-04a: a registry refuses to start when org_456's map gives a role roles.json lacks", () => {
    expect(
      startWith(SCIM_ROLE_SOURCES, mapsFile({ org_456: [line({ role: "Treasurer" })] })),
    ).toContain(
      'role-maps.json: org_456\'s line 1 gives the role "Treasurer", which roles.json does not have',
    );
  });

  it("DSOR-IDN-05: a registry refuses to start when org_456 is on scim and has no map", () => {
    expect(startWith(SCIM_ROLE_SOURCES, mapsFile({}))).toContain(
      "role-maps.json: org_456's role source is scim, and it has no map",
    );
  });
});
