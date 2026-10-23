// NEW IN STEP 43: where a call's login comes from. Each world chooses: step 05's table, or real
//   logins for people. A real login is a signed token, checked (tokens.ts), then looked up in DSoR's
//   own table of links: which principal is this user of this issuer? A login proves who you are;
//   DSoR decides which principal that is, and in which companies (DSOR-IDN-01, DSOR-IDN-04a,
//   DSOR-IDN-04b; step 43's README, claims C3 to C5, decisions D1, D5, D6, and D8).
import type { Issuers } from "./issuers.ts";
import { logins as STEP_05, type Principal } from "./principals.ts";
import { checkedLogin, type KeySets, type Unavailable } from "./tokens.ts";

/**
 * Who a token belongs to, or none, or that it could not be checked now (R5). It never throws: line
 * ① refuses a token with no caller, and answers an outage as one.
 */
export type LoginSource = {
  find: (token: unknown) => Promise<Principal | Unavailable | undefined>;
};

// Step 05's table, as every world had it until now. The stories of pnpm start and the earlier
//   tests keep it (decision D8).
export const FAKE_LOGINS: LoginSource = Object.freeze({
  find: async (token: unknown): Promise<Principal | undefined> =>
    typeof token === "string" ? STEP_05.get(token) : undefined,
});

/** One row of DSoR's own table: this user of this issuer is this principal. */
export type Link = { issuer: string; subject: string; principal: string };

/** DSoR's table of links: the principal of a login, or none. */
export type LinkStore = {
  principalOf: (issuer: string, subject: string) => Promise<string | undefined>;
};

/** The table of links in memory, for the unit tests. */
export function memoryLinks(rows: readonly Link[]): LinkStore {
  const kept = new Map(rows.map((r) => [JSON.stringify([r.issuer, r.subject]), r.principal]));
  return Object.freeze({
    principalOf: async (issuer: string, subject: string) =>
      kept.get(JSON.stringify([issuer, subject])),
  });
}

// Every principal DSoR knows, by id: their type, companies, and roles stay DSoR's own (step 05's
//   table holds them), whatever a token says (DSOR-IDN-04b).
const PRINCIPALS: ReadonlyMap<string, Principal> = new Map(
  [...STEP_05.values()].map((p) => [p.id, p]),
);

/**
 * Real logins for people. A token from step 05's table is still taken for an agent or a system
 * login, until step 44, and never for a person. Any other token must be a signed token of a
 * configured issuer, linked to a person; that person keeps only the companies whose issuers include
 * the token's (decisions D1, D5, and D6).
 */
export function realLogins(
  issuers: Issuers,
  links: LinkStore,
  keys: KeySets,
  now: () => number = Date.now,
): LoginSource {
  return Object.freeze({
    find: async (token: unknown): Promise<Principal | Unavailable | undefined> => {
      const fake = typeof token === "string" ? STEP_05.get(token) : undefined;
      if (fake !== undefined) return fake.type === "human" ? undefined : fake;
      const login = await checkedLogin(token, issuers, keys, now);
      if (login === undefined || "unavailable" in login) return login;
      let id: string | undefined;
      try {
        id = await links.principalOf(login.issuer, login.subject);
      } catch {
        // A table that cannot be read is an outage, not a bad login: still no caller, and the
        //   caller may try again (changed by the learner's R5).
        return { unavailable: "DSoR's table of logins" };
      }
      const person = id === undefined ? undefined : PRINCIPALS.get(id);
      if (person === undefined || person.type !== "human") return undefined;
      const trusted = (tenant: string): boolean =>
        (issuers.get(tenant) ?? []).some((i) => i.issuer === login.issuer);
      return { ...person, memberships: person.memberships.filter((m) => trusted(m.tenant_id)) };
    },
  });
}
