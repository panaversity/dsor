// NEW IN STEP 43c: the copy of each company's directory, as its SCIM pushes left it. It holds what
//   the directory said: users, groups, and who is in each. It never holds a role: the company's map
//   turns groups into roles when the copy is read (company-people.ts). Every read and every write is
//   inside one company, and a row of another company is "not found" (DSOR-IDN-03a, DSOR-IDN-05;
//   step 43c's README, claim C3, decisions L5, D4, D6, and D8). The program keeps it in PostgreSQL
//   (postgres.ts); the unit tests keep it in memory, here.
import { randomUUID } from "node:crypto";
import { Refusal } from "./envelope.ts";
import { taken, type Status } from "./people.ts";

/** One user of one company's copy. `id` is DSoR's, given at the first push; `person` is her DSoR id. */
export type CopyUser = {
  id: string;
  external_id: string;
  person: string;
  user_name: string;
  display_name?: string;
  active: boolean;
};

/** One group of one company's copy, and the ids of its members. */
export type CopyGroup = { id: string; external_id: string; name: string; members: string[] };

/** What a push says about a user. */
export type UserInput = {
  user_name: string;
  external_id: string;
  display_name?: string;
  active: boolean;
};

/** What a push says about a group, whole. */
export type GroupInput = { name: string; external_id: string; members: string[] };

/** A change to a group's members, or its name, as a PATCH sends it. */
export type GroupChange = { add: string[]; remove: string[]; replace?: string[]; name?: string };

/** A search, as authentik asks after a conflict: one field equal to one value. */
export type Filter = { field: "userName" | "externalId" | "displayName"; value: string };

/** The copy of every company's directory. */
export type DirectoryCopy = {
  createUser: (tenant: string, input: UserInput) => Promise<CopyUser>;
  // undefined: no user with this id in this company.
  replaceUser: (tenant: string, id: string, input: UserInput) => Promise<CopyUser | undefined>;
  deleteUser: (tenant: string, id: string) => Promise<boolean>;
  createGroup: (tenant: string, input: GroupInput) => Promise<CopyGroup>;
  replaceGroup: (tenant: string, id: string, input: GroupInput) => Promise<CopyGroup | undefined>;
  changeGroup: (tenant: string, id: string, change: GroupChange) => Promise<CopyGroup | undefined>;
  deleteGroup: (tenant: string, id: string) => Promise<boolean>;
  users: (tenant: string, filter?: Filter) => Promise<CopyUser[]>;
  user: (tenant: string, id: string) => Promise<CopyUser | undefined>;
  groups: (tenant: string, filter?: Filter) => Promise<CopyGroup[]>;
  group: (tenant: string, id: string) => Promise<CopyGroup | undefined>;
  // What the people store reads: the person's standing here and her groups' ids, or none.
  standing: (
    tenant: string,
    person: string,
  ) => Promise<{ status: Status; groups: string[] } | undefined>;
  // The person a login's uuid names in this company, while she is not deleted (the learner's L6).
  personOf: (tenant: string, external_id: string) => Promise<string | undefined>;
  // Every company whose copy has, or had, this person: an id one company used is taken (L5).
  companiesOf: (person: string) => Promise<string[]>;
  // The companies whose copy has this person now, deleted or not counted.
  tenantsOf: (person: string) => Promise<string[]>;
};

/** No copy: nobody was ever pushed, and nothing can be. A query's stores, and a dry run's, hold this. */
export const NO_COPY: DirectoryCopy = Object.freeze({
  createUser: async (): Promise<never> => {
    throw new Error("this call keeps no copy of a directory");
  },
  replaceUser: async () => undefined,
  deleteUser: async () => false,
  createGroup: async (): Promise<never> => {
    throw new Error("this call keeps no copy of a directory");
  },
  replaceGroup: async () => undefined,
  changeGroup: async () => undefined,
  deleteGroup: async () => false,
  users: async () => [],
  user: async () => undefined,
  groups: async () => [],
  group: async () => undefined,
  standing: async () => undefined,
  personOf: async () => undefined,
  companiesOf: async () => [],
  tenantsOf: async () => [],
});

type Row = CopyUser & { tenant: string; deleted: boolean };
type GroupRow = CopyGroup & { tenant: string };

/** The copy in memory, for the unit tests. */
export function memoryCopy(): DirectoryCopy {
  const users: Row[] = [];
  const groups: GroupRow[] = [];
  const live = (tenant: string) => users.filter((u) => u.tenant === tenant && !u.deleted);
  const shown = ({ tenant: _t, deleted: _d, ...user }: Row): CopyUser => structuredClone(user);
  const shownGroup = ({ tenant: _t, ...group }: GroupRow): CopyGroup => structuredClone(group);
  const matches = (row: Record<string, unknown>, filter?: Filter): boolean => {
    if (filter === undefined) return true;
    const field = { userName: "user_name", externalId: "external_id", displayName: "name" };
    return row[field[filter.field]] === filter.value;
  };
  // Every member a push names must be a user of this company's copy now (decision D6).
  const mustBeUsers = (tenant: string, ids: readonly string[]): void => {
    for (const id of ids) {
      if (!live(tenant).some((u) => u.id === id)) {
        throw new Refusal("VALIDATION_FAILED", `member ${id} is no user in ${tenant}'s copy`);
      }
    }
  };
  return {
    createUser: async (tenant, input) => {
      const person = input.user_name;
      // An id another company has, or had, is taken; the answer names no company (L5).
      if (users.some((u) => u.person === person && u.tenant !== tenant)) throw taken(person);
      // Changed by the review of step 43c, finding 1: and an id this company had under another
      //   externalId is taken too. Slips and approvals name the id, so a new hire under a leaver's
      //   username would inherit them. Only the same person, by her externalId, comes back.
      if (
        users.some(
          (u) => u.tenant === tenant && u.person === person && u.external_id !== input.external_id,
        )
      ) {
        throw taken(person);
      }
      if (live(tenant).some((u) => u.person === person || u.external_id === input.external_id)) {
        throw new Refusal("CONFLICT", `${person} is in ${tenant}'s copy already`, "internal");
      }
      const row: Row = { ...input, id: randomUUID(), person, tenant, deleted: false };
      users.push(row);
      return shown(row);
    },
    replaceUser: async (tenant, id, input) => {
      const row = live(tenant).find((u) => u.id === id);
      if (row === undefined) return undefined;
      if (row.external_id !== input.external_id) {
        throw new Refusal("CONFLICT", "a user's externalId never changes", "internal");
      }
      // Her DSoR id stays the one of her first push; only the name authentik shows changes (L5).
      Object.assign(row, { ...input, person: row.person });
      return shown(row);
    },
    deleteUser: async (tenant, id) => {
      const row = live(tenant).find((u) => u.id === id);
      if (row === undefined) return false;
      row.deleted = true;
      for (const g of groups.filter((g) => g.tenant === tenant)) {
        g.members = g.members.filter((m) => m !== id);
      }
      return true;
    },
    createGroup: async (tenant, input) => {
      if (groups.some((g) => g.tenant === tenant && g.external_id === input.external_id)) {
        throw new Refusal(
          "CONFLICT",
          `group ${input.external_id} is in ${tenant}'s copy already`,
          "internal",
        );
      }
      mustBeUsers(tenant, input.members);
      const row: GroupRow = {
        ...input,
        members: [...new Set(input.members)],
        id: randomUUID(),
        tenant,
      };
      groups.push(row);
      return shownGroup(row);
    },
    replaceGroup: async (tenant, id, input) => {
      const row = groups.find((g) => g.tenant === tenant && g.id === id);
      if (row === undefined) return undefined;
      if (row.external_id !== input.external_id) {
        throw new Refusal("CONFLICT", "a group's externalId never changes", "internal");
      }
      mustBeUsers(tenant, input.members);
      Object.assign(row, { name: input.name, members: [...new Set(input.members)] });
      return shownGroup(row);
    },
    changeGroup: async (tenant, id, change) => {
      const row = groups.find((g) => g.tenant === tenant && g.id === id);
      if (row === undefined) return undefined;
      mustBeUsers(tenant, [...change.add, ...(change.replace ?? [])]);
      let members = change.replace ?? row.members;
      members = [...new Set([...members, ...change.add])].filter((m) => !change.remove.includes(m));
      Object.assign(row, { members, ...(change.name === undefined ? {} : { name: change.name }) });
      return shownGroup(row);
    },
    deleteGroup: async (tenant, id) => {
      const at = groups.findIndex((g) => g.tenant === tenant && g.id === id);
      if (at < 0) return false;
      groups.splice(at, 1);
      return true;
    },
    users: async (tenant, filter) =>
      live(tenant)
        .filter((u) => matches(u as unknown as Record<string, unknown>, filter))
        .map(shown),
    user: async (tenant, id) => {
      const row = live(tenant).find((u) => u.id === id);
      return row === undefined ? undefined : shown(row);
    },
    groups: async (tenant, filter) =>
      groups
        .filter(
          (g) => g.tenant === tenant && matches(g as unknown as Record<string, unknown>, filter),
        )
        .map(shownGroup),
    group: async (tenant, id) => {
      const row = groups.find((g) => g.tenant === tenant && g.id === id);
      return row === undefined ? undefined : shownGroup(row);
    },
    standing: async (tenant, person) => {
      const row = live(tenant).find((u) => u.person === person);
      if (row === undefined) {
        const gone = users.some((u) => u.tenant === tenant && u.person === person);
        return gone ? { status: "deprovisioned", groups: [] } : undefined;
      }
      const held = groups.filter((g) => g.tenant === tenant && g.members.includes(row.id));
      return {
        status: row.active ? "active" : "suspended",
        groups: held.map((g) => g.external_id),
      };
    },
    personOf: async (tenant, external_id) =>
      live(tenant).find((u) => u.external_id === external_id)?.person,
    companiesOf: async (person) =>
      [...new Set(users.filter((u) => u.person === person).map((u) => u.tenant))].sort(),
    tenantsOf: async (person) =>
      [
        ...new Set(users.filter((u) => u.person === person && !u.deleted).map((u) => u.tenant)),
      ].sort(),
  };
}
