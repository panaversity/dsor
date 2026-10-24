// NEW IN STEP 43b: each company's people, and the roles they hold there, in DSoR's own table. Line
//   ① reads it for a person on the call, and a company whose role source is dsor_assignments reads
//   it for an absent signer. Agents and DSoR's system logins stay in src/principals.ts until step 44
//   (DSOR-IDN-01, DSOR-IDN-05; step 43b's README, claims C1 to C6, decisions L1, L5, D1 to D7).
import { randomUUID } from "node:crypto";
import type { Directory } from "./directory.ts";
import { Refusal } from "./envelope.ts";
import { logins as STEP_05, type Membership, type Principal } from "./principals.ts";

/** A member's standing in one company, in the words of a directory (step 19's README, decision 11). */
export type Status = "active" | "suspended" | "deprovisioned";

/** Who changed the table, and why. The owner's pnpm grant names "owner" (decision L3). */
export type PeopleBy = { person: string; reason: string };

/** One role given to one member. A powerful one counts only once someone else confirms it. */
export type Grant = {
  tenant: string;
  id: string;
  person: string;
  role: string;
  asked_by: string;
  reason: string;
  // pending: powerful, waiting for a second administrator; active: it counts; ended: revoked,
  //   expired, or cancelled. An ended grant is kept (decision D6).
  state: "pending" | "active" | "ended";
  expires_at?: string;
  confirmed_by?: string;
};

/** DSoR's table of people. Each change is inside one company; a read may span them (decision D5). */
export type PeopleStore = {
  // Every company where the person is active, with the roles they hold there now.
  membershipsOf: (person: string) => Promise<Membership[]>;
  // The person in one company, any status, or none: what a role source answers.
  memberOf: (
    tenant: string,
    person: string,
  ) => Promise<{ status: Status; roles: string[] } | undefined>;
  add: (tenant: string, person: string, by: PeopleBy) => Promise<void>;
  // Marks the person deprovisioned here, and ends their roles and pending grants here.
  remove: (tenant: string, person: string, by: PeopleBy) => Promise<{ roles: number }>;
  grant: (
    tenant: string,
    person: string,
    role: string,
    powerful: boolean,
    by: PeopleBy,
  ) => Promise<Grant>;
  confirm: (tenant: string, grant: string, by: PeopleBy) => Promise<Grant>;
  // Ends the person's role here, active or pending; the number of grants it ended.
  revoke: (tenant: string, person: string, role: string, by: PeopleBy) => Promise<number>;
  // The active administrators of a company, for the owner's pnpm grant (decision L3).
  admins: (tenant: string) => Promise<number>;
};

// A pending grant lasts seven days, as an invitation does (decision D7).
const DAYS_7 = 7 * 86_400_000;

/** The refusal of a change the table cannot make. */
function conflict(why: string): Refusal {
  return new Refusal("CONFLICT", why, "internal");
}

/** The table in memory, starting with these people, and its own clock. */
export function memoryPeople(
  seed: Iterable<Principal> = storySeed(),
  now: () => number = Date.now,
): PeopleStore {
  const members = new Map<string, { tenant: string; person: string; status: Status }>();
  const grants: (Grant & { expires: number })[] = [];
  const key = (tenant: string, person: string): string => `${tenant}/${person}`;
  // Only an active grant counts. A pending one past its seven days is ended, at every read.
  const counts = (g: Grant & { expires: number }): boolean => g.state === "active";
  const live = (g: Grant & { expires: number }): boolean =>
    g.state === "active" || (g.state === "pending" && g.expires > now());
  const rolesOf = (tenant: string, person: string): string[] =>
    grants
      .filter((g) => g.tenant === tenant && g.person === person && counts(g))
      .map((g) => g.role);
  for (const principal of seed) {
    if (principal.type !== "human") continue;
    for (const { tenant_id, roles } of principal.memberships) {
      members.set(key(tenant_id, principal.id), {
        tenant: tenant_id,
        person: principal.id,
        status: "active",
      });
      for (const role of roles) {
        grants.push({
          tenant: tenant_id,
          id: `grt_${randomUUID()}`,
          person: principal.id,
          role,
          asked_by: "owner",
          reason: "the story's people (step 43b's README, decision D2)",
          state: "active",
          expires: Number.POSITIVE_INFINITY,
        });
      }
    }
  }
  const shown = ({ expires: _e, ...grant }: Grant & { expires: number }): Grant =>
    structuredClone(grant);
  const active = (tenant: string, person: string) => {
    const member = members.get(key(tenant, person));
    if (member?.status !== "active") throw conflict(`${person} is no active person of ${tenant}`);
    return member;
  };
  return {
    membershipsOf: async (person) =>
      [...members.values()]
        .filter((m) => m.person === person && m.status === "active")
        .map((m) => ({ tenant_id: m.tenant, roles: rolesOf(m.tenant, person) })),
    memberOf: async (tenant, person) => {
      const member = members.get(key(tenant, person));
      return member === undefined
        ? undefined
        : { status: member.status, roles: rolesOf(tenant, person) };
    },
    add: async (tenant, person, _by) => {
      if (members.get(key(tenant, person))?.status === "active") {
        throw conflict(`${person} is a person of ${tenant} already`);
      }
      members.set(key(tenant, person), { tenant, person, status: "active" });
    },
    remove: async (tenant, person, by) => {
      const member = active(tenant, person);
      member.status = "deprovisioned";
      let ended = 0;
      for (const g of grants) {
        if (g.tenant === tenant && g.person === person && live(g)) {
          g.state = "ended";
          ended += 1;
        }
      }
      void by;
      return { roles: ended };
    },
    grant: async (tenant, person, role, powerful, by) => {
      active(tenant, person);
      const held = grants.some(
        (g) => g.tenant === tenant && g.person === person && g.role === role && live(g),
      );
      if (held) throw conflict(`${person} holds ${role} in ${tenant} already, or it waits`);
      const at = now();
      const grant: Grant & { expires: number } = {
        tenant,
        id: `grt_${randomUUID()}`,
        person,
        role,
        asked_by: by.person,
        reason: by.reason,
        state: powerful ? "pending" : "active",
        expires: powerful ? at + DAYS_7 : Number.POSITIVE_INFINITY,
        ...(powerful ? { expires_at: new Date(at + DAYS_7).toISOString() } : {}),
      };
      grants.push(grant);
      return shown(grant);
    },
    confirm: async (tenant, id, by) => {
      const grant = grants.find((g) => g.tenant === tenant && g.id === id);
      if (grant === undefined || grant.state !== "pending" || grant.expires <= now()) {
        throw conflict(`no grant waits as ${id} in ${tenant}`);
      }
      // Someone else: neither the one who asked nor the one who gets the role (decision D3).
      if (by.person === grant.asked_by || by.person === grant.person) {
        throw sameHands(by.person, grant);
      }
      grant.state = "active";
      grant.confirmed_by = by.person;
      return shown(grant);
    },
    revoke: async (tenant, person, role, _by) => {
      let ended = 0;
      for (const g of grants) {
        if (g.tenant === tenant && g.person === person && g.role === role && live(g)) {
          g.state = "ended";
          ended += 1;
        }
      }
      return ended;
    },
    admins: async (tenant) =>
      [...members.values()].filter(
        (m) =>
          m.tenant === tenant &&
          m.status === "active" &&
          rolesOf(tenant, m.person).includes("tenant_admin"),
      ).length,
  };
}

/** The story's people, from src/principals.ts, as the table's first rows (decision D2). */
function storySeed(): Principal[] {
  return [...STEP_05.values()];
}

/** A fresh table of the story's people, for a world in memory. */
export function storyPeople(now?: () => number): PeopleStore {
  return memoryPeople(storySeed(), now);
}

/** No table: nobody is a person of any company. */
export const NO_PEOPLE: PeopleStore = memoryPeople([]);

// The permissions that make a role powerful: to approve, or to change people and roles. Read from
//   roles.json, so a role that gains one becomes powerful by itself (the learner's L1).
const POWERFUL: ReadonlySet<string> = new Set([
  "proposal:approve",
  "payment:approve",
  "person:add",
  "role:grant",
  "role:confirm",
]);

/** Whether a grant of this role waits for a second administrator (decision L1). */
export function isPowerful(role: string, roles: ReadonlyMap<string, Iterable<string>>): boolean {
  return [...(roles.get(role) ?? [])].some((permission) => POWERFUL.has(permission));
}

/** The refusal of a confirm by the one who asked, or by the one the grant names (decision D3). */
export function sameHands(confirmer: string, grant: Grant): Refusal {
  const why = confirmer === grant.asked_by ? "asked for it" : "is the person it names";
  return new Refusal(
    "SOD_VIOLATION",
    `${confirmer} may not confirm grant ${grant.id}: ${confirmer} ${why}`,
    "internal",
  );
}

/** A company's directory, read from the table: what the role source dsor_assignments asks. */
export function peopleDirectory(tenant: string, people: PeopleStore): Directory {
  return {
    ask: async (person: string): Promise<unknown> => {
      const found = await people.memberOf(tenant, person);
      if (found === undefined) return { tenant, person, listed: false };
      return { tenant, person, listed: true, status: found.status, roles: found.roles };
    },
  };
}

/**
 * A person on the call, with the companies and roles the table gives them now, kept to the
 * companies where their login may count. An agent or a system login is as src/principals.ts says.
 * A person the table does not know anywhere is no caller.
 */
export async function withPeople(
  found: Principal,
  people: PeopleStore,
): Promise<Principal | undefined> {
  if (found.type !== "human") return found;
  const held = await people.membershipsOf(found.id);
  // Active nowhere: never added, or removed from every company.
  if (held.length === 0) return undefined;
  const where = new Set(found.memberships.map((m) => m.tenant_id));
  return { ...found, memberships: held.filter((m) => where.has(m.tenant_id)) };
}
