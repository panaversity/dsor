// Step 43c: org_456 on its own directory, in memory. The copy holds what org_456's authentik pushed
// in the real check of 2026-10-26: its people, its groups, and who is in each (step 43c's README,
// "The real check").
import { readRoleSettings, SCIM_ROLE_SOURCES } from "../src/authority.ts";
import { memoryCopy, type DirectoryCopy } from "../src/directory-copy.ts";
import type { Heard } from "../src/company-people.ts";
import { ruleWorld, type RuleWorld } from "./rule-world.ts";

/** The ids authentik gave org_456's people and groups in the real check. */
export const UUIDS = {
  cfo_100: "ab5c9807-47db-4ff3-af03-14e1f01f1a04",
  user_123: "b7b2b6a4-e17a-4478-a76f-1e7f5f8df5e4",
  admin_100: "ceec068e-3846-4dcd-8aee-84150c24b14c",
  finance: "65f59cd5-727e-4dfd-bbca-bd79023adb29",
  supervisors: "4c4650fa-861e-4480-acd5-6ab376c04683",
  admins: "f029a971-5869-4063-9241-499171bb694a",
} as const;

/** org_456's people and groups, pushed into this copy as authentik pushed them. */
export async function pushStory(copy: DirectoryCopy): Promise<void> {
  const ids = new Map<string, string>();
  for (const [person, name] of [
    ["cfo_100", "Carla Fernandez"],
    ["user_123", "Umar Khan"],
    ["admin_100", "Ada Mensah"],
  ] as const) {
    const user = await copy.createUser("org_456", {
      user_name: person,
      external_id: UUIDS[person],
      display_name: name,
      active: true,
    });
    ids.set(person, user.id);
  }
  for (const [name, group, person] of [
    ["Finance-Approvers", UUIDS.finance, "cfo_100"],
    ["AP-Supervisors", UUIDS.supervisors, "user_123"],
    ["Tenant-Admins", UUIDS.admins, "admin_100"],
  ] as const) {
    await copy.createGroup("org_456", {
      name,
      external_id: group,
      members: [ids.get(person) as string],
    });
  }
}

/** A fresh copy holding org_456's story. */
export async function storyCopy(): Promise<DirectoryCopy> {
  const copy = memoryCopy();
  await pushStory(copy);
  return copy;
}

/** A directory that last spoke this many minutes ago, by DSoR's clock. */
export function spokeMinutesAgo(minutes: number): Heard {
  return async () => Date.now() - minutes * 60_000;
}

/**
 * Tuesday's world, with org_456 on its own directory (role-sources.scim.json), its story pushed, and
 * a directory that last spoke when `heard` says: the audit's record unless a test gives another.
 */
export async function scimWorldOnTuesday(heard?: Heard): Promise<RuleWorld> {
  const copy = await storyCopy();
  const w = ruleWorld(
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
    readRoleSettings(SCIM_ROLE_SOURCES),
    { copy, ...(heard === undefined ? {} : { heard }) },
  );
  await w.rates.load("org_456", {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:00:00.000Z",
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  return w;
}
