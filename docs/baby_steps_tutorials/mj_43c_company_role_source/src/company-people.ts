// NEW IN STEP 43c: each company's people, from the one source its role-sources.json names. A company
//   on DSoR's own table is answered by step 43b's table. A company on scim is answered by its
//   directory's copy, through its role map, and only while its directory has spoken within the
//   company's max_staleness. Line ①, the role source, and every command read this one store, so
//   one company never has two truths (DSOR-IDN-05, DSOR-IDN-06; step 43c's README, claims C4 and
//   C5, decisions L2, L7, L10, D2, and D8).
import type { RoleSettings } from "./authority.ts";
import type { DirectoryCopy } from "./directory-copy.ts";
import { Refusal } from "./envelope.ts";
import type { DecisionRecord } from "./log.ts";
import { taken, type PeopleStore } from "./people.ts";
import type { RoleMaps } from "./role-maps.ts";

/** When DSoR last heard from this company's directory, by DSoR's clock in milliseconds, or never. */
export type Heard = (tenant: string) => Promise<number | undefined>;

/** What the store needs to read a company on scim: the settings, the maps, and when each spoke. */
export type DirectorySetup = {
  settings: RoleSettings;
  maps: RoleMaps;
  heard: Heard;
  now?: () => number;
};

/** The system login of a company's directory, the one principal that pushes its copy (decision D1). */
export function directoryLoginOf(tenant: string): string {
  return `directory-${tenant}`;
}

/**
 * When DSoR last heard from each company's directory, as its log says: the time of the latest ALLOW
 * record of that directory's login in that company. The program's log is the database's audit, and
 * reads it there (postgres.ts); this is the same question, of records in memory (decision D2).
 */
export function heardFrom(log: { records: () => Promise<DecisionRecord[]> }): Heard {
  return async (tenant) => {
    const login = directoryLoginOf(tenant);
    const times = (await log.records())
      .filter(
        (r) =>
          r.tenant === tenant &&
          r.authorization === "ALLOW" &&
          r.correlation.principal_id === login,
      )
      .map((r) => Date.parse(r.at));
    return times.length === 0 ? undefined : Math.max(...times);
  };
}

/** The refusal of a change to the people of a company whose people come from its directory (L10). */
export function fromItsDirectory(tenant: string): Refusal {
  const why = `${tenant}'s people come from its own directory: change them there`;
  return new Refusal("CONFLICT", why, "internal");
}

/** Who a login is by its uuid: the person a directory's copy names, or none (the learner's L6). */
export type ByUuid = (issuer: string, subject: string) => Promise<string | undefined>;

/**
 * A login's person by the uuid its directory pushed: in each company on scim that trusts the
 * login's issuer, the copy's person whose externalId is the token's sub. One person, or none: a
 * uuid that two companies' copies name differently names nobody. Nothing else in the token is read
 * (DSOR-IDN-04b; step 43c's README, claim C6).
 */
export function copyLogins(
  copy: Pick<DirectoryCopy, "personOf">,
  settings: RoleSettings,
  issuers: ReadonlyMap<string, readonly { issuer: string }[]>,
): ByUuid {
  return async (issuer, subject) => {
    const tenants = [...issuers]
      .filter(
        ([tenant, list]) =>
          settings.get(tenant)?.kind === "scim" && list.some((i) => i.issuer === issuer),
      )
      .map(([tenant]) => tenant);
    const people = new Set<string>();
    for (const tenant of tenants) {
      const person = await copy.personOf(tenant, subject);
      if (person !== undefined) people.add(person);
    }
    return people.size === 1 ? [...people][0] : undefined;
  };
}

/** The error of a copy too old to use. Line ① answers it as an outage; the role source as no answer. */
export class StaleCopy extends Error {}

/** One store over both sources, each company read from the one its setting names. */
export function companyPeople(
  table: PeopleStore,
  copy: DirectoryCopy,
  setup: DirectorySetup,
): PeopleStore {
  const now = setup.now ?? Date.now;
  const onCopy = (tenant: string): boolean => setup.settings.get(tenant)?.kind === "scim";
  // The copy counts only while its directory spoke within the company's bound, and never from a
  //   time after now: a clock that went back would make an old copy look young (step 19's
  //   decision 15, kept).
  const fresh = async (tenant: string): Promise<void> => {
    const at = await setup.heard(tenant);
    const age = at === undefined ? Number.NaN : now() - at;
    const bound = setup.settings.get(tenant)?.ms ?? 0;
    if (!(age >= 0 && age < bound)) {
      throw new StaleCopy(`DSoR has not heard from the directory of ${tenant} recently enough`);
    }
  };
  // A person's roles here: the role of each of her groups the company's map names, once each.
  const rolesOf = (tenant: string, groups: readonly string[]): string[] => {
    const map = setup.maps.get(tenant);
    const roles = groups.flatMap((g) => {
      const line = map?.get(g);
      return line === undefined ? [] : [line.role];
    });
    return [...new Set(roles)];
  };
  const standing = async (tenant: string, person: string) => {
    await fresh(tenant);
    const found = await copy.standing(tenant, person);
    if (found === undefined) return undefined;
    // Only an active person holds roles: a suspended one may come back, and holds none meanwhile.
    return {
      status: found.status,
      roles: found.status === "active" ? rolesOf(tenant, found.groups) : [],
    };
  };
  const refuseOnCopy = (tenant: string): void => {
    if (onCopy(tenant)) throw fromItsDirectory(tenant);
  };
  return {
    membershipsOf: async (person) => {
      const fromTable = (await table.membershipsOf(person)).filter((m) => !onCopy(m.tenant_id));
      const fromCopies = [];
      for (const tenant of (await copy.tenantsOf(person)).filter(onCopy)) {
        const found = await standing(tenant, person);
        if (found?.status === "active") fromCopies.push({ tenant_id: tenant, roles: found.roles });
      }
      return [...fromTable, ...fromCopies];
    },
    memberOf: async (tenant, person) =>
      onCopy(tenant) ? standing(tenant, person) : table.memberOf(tenant, person),
    add: async (tenant, person, by, alone) => {
      refuseOnCopy(tenant);
      // An id a directory's copy has, or had, is taken here too (L5).
      if (alone === true && (await copy.companiesOf(person)).some((t) => t !== tenant)) {
        throw taken(person);
      }
      return table.add(tenant, person, by, alone);
    },
    remove: async (tenant, person, by) => {
      refuseOnCopy(tenant);
      return table.remove(tenant, person, by);
    },
    grant: async (tenant, person, role, powerful, by) => {
      refuseOnCopy(tenant);
      return table.grant(tenant, person, role, powerful, by);
    },
    confirm: async (tenant, grant, by) => {
      refuseOnCopy(tenant);
      return table.confirm(tenant, grant, by);
    },
    revoke: async (tenant, person, role, by) => {
      refuseOnCopy(tenant);
      return table.revoke(tenant, person, role, by);
    },
    companiesOf: async (person) =>
      [
        ...new Set([...(await table.companiesOf(person)), ...(await copy.companiesOf(person))]),
      ].sort(),
    grantOf: async (tenant, grant) => (onCopy(tenant) ? undefined : table.grantOf(tenant, grant)),
  };
}
