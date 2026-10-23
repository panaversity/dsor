// NEW IN STEP 43: where a call's login comes from. Each world chooses: step 05's table, or real
//   logins for people. A real login is a signed token, checked (tokens.ts), then looked up in DSoR's
//   own table of links: which principal is this user of this issuer? A login proves who you are;
//   DSoR decides which principal that is, and in which companies (DSOR-IDN-01, DSOR-IDN-04a,
//   DSOR-IDN-04b; step 43's README, claims C3 to C5, decisions D1, D5, D6, and D8).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Issuers } from "./issuers.ts";
import { logins as STEP_05, type Principal } from "./principals.ts";
import { checkedLogin, type KeySets, type Login, type Unavailable } from "./tokens.ts";

/**
 * Who a token belongs to, or none, or that it could not be checked now (R5). It never throws: line
 * ① refuses a token with no caller, and answers an outage as one.
 */
// Changed by the learner's R1: and what else the envelope carries for a first call, the company it
//   names and an invitation's code.
export type LoginSource = {
  find: (token: unknown, first?: FirstCall) => Promise<Principal | Unavailable | undefined>;
};

/** What a person's first call carries beside the token: the company it names, and the code. */
export type FirstCall = { tenant?: unknown; invitation?: unknown };

// Step 05's table, as every world had it until now. The stories of pnpm start and the earlier
//   tests keep it (decision D8).
export const FAKE_LOGINS: LoginSource = Object.freeze({
  find: async (token: unknown): Promise<Principal | undefined> =>
    typeof token === "string" ? STEP_05.get(token) : undefined,
});

/** One row of DSoR's own table: this user of this issuer is this principal. */
export type Link = { issuer: string; subject: string; principal: string };

/** DSoR's table of links: the principal of a login, or none. An ended link is none. */
export type LinkStore = {
  principalOf: (issuer: string, subject: string) => Promise<string | undefined>;
};

/** One invitation, as DSoR keeps it: never its code, only who was invited, by whom, and its end. */
export type Invitation = {
  tenant: string;
  id: string;
  person: string;
  invited_by: string;
  reason: string;
  expires_at: string;
  accepted_by?: { issuer: string; subject: string };
  cancelled_by?: string;
};

/** Who invites or unlinks, and why. */
export type BookBy = { person: string; reason: string };

/**
 * NEW IN STEP 43, the learner's R1, R2, R3, and R7: DSoR's book of links and invitations. An
 * invitation names a person of a company; its code, kept only as a hash, links the first login
 * that presents it, once, within seven days. Unlinking ends every login of a person, and cancels
 * their open invitations in the company.
 */
export type LoginBook = LinkStore & {
  // Links this login to the person a code invites in this company, both or neither; the person, or
  //   none when the code is wrong, used, cancelled, expired, or of another company.
  redeem: (tenant: string, code: string, login: Login) => Promise<string | undefined>;
  invite: (
    tenant: string,
    person: string,
    by: BookBy,
  ) => Promise<{ invitation: Invitation; code: string }>;
  unlink: (
    tenant: string,
    person: string,
    by: BookBy,
  ) => Promise<{ logins: number; invitations: number }>;
};

// A code is 16 random bytes, 22 letters of base64url; DSoR keeps its SHA-256 only, so a copy of the
//   book cannot be used to join (decision R1).
const DAYS_7 = 7 * 86_400_000;
export function newCode(): string {
  return randomBytes(16).toString("base64url");
}
export function hashOf(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** The book in memory, for the unit tests, what a test reads of it, and a link a test sets up. */
export type MemoryLoginBook = LoginBook & {
  invitations: () => Promise<Invitation[]>;
  link: (link: Link) => Promise<void>;
};

/** No book: no login is linked, and nobody can be invited. Step 05's worlds have none. */
export const NO_BOOK: LoginBook = Object.freeze({
  principalOf: async () => undefined,
  redeem: async () => undefined,
  invite: async (): Promise<never> => {
    throw new Error("this world keeps no invitations");
  },
  unlink: async (): Promise<never> => {
    throw new Error("this world keeps no links");
  },
});

/** A book of links and invitations in memory, with these links to start, and its own clock. */
export function memoryLoginBook(
  rows: readonly Link[],
  now: () => number = Date.now,
): MemoryLoginBook {
  const links = rows.map((r) => ({ ...r, ended: false }));
  const kept: (Invitation & { hash: string; expires: number })[] = [];
  const activeOf = (issuer: string, subject: string) =>
    links.find((l) => !l.ended && l.issuer === issuer && l.subject === subject);
  return Object.freeze({
    principalOf: async (issuer: string, subject: string) => activeOf(issuer, subject)?.principal,
    redeem: async (tenant: string, code: string, login: Login) => {
      const found = kept.find((i) => i.tenant === tenant && i.hash === hashOf(code));
      const open =
        found !== undefined && found.accepted_by === undefined && found.cancelled_by === undefined;
      if (!open || found.expires <= now() || activeOf(login.issuer, login.subject) !== undefined) {
        return undefined;
      }
      found.accepted_by = { issuer: login.issuer, subject: login.subject };
      links.push({
        issuer: login.issuer,
        subject: login.subject,
        principal: found.person,
        ended: false,
      });
      return found.person;
    },
    invite: async (tenant: string, person: string, by: BookBy) => {
      const code = newCode();
      const expires = now() + DAYS_7;
      const invitation: Invitation = {
        tenant,
        id: `inv_${randomUUID()}`,
        person,
        invited_by: by.person,
        reason: by.reason,
        expires_at: new Date(expires).toISOString(),
      };
      kept.push({ ...invitation, hash: hashOf(code), expires });
      return { invitation: structuredClone(invitation), code };
    },
    unlink: async (tenant: string, person: string, by: BookBy) => {
      const ended = links.filter((l) => !l.ended && l.principal === person);
      for (const link of ended) link.ended = true;
      const open = kept.filter(
        (i) =>
          i.tenant === tenant &&
          i.person === person &&
          i.accepted_by === undefined &&
          i.cancelled_by === undefined,
      );
      for (const invitation of open) invitation.cancelled_by = by.person;
      return { logins: ended.length, invitations: open.length };
    },
    invitations: async () =>
      kept.map(({ hash: _h, expires: _e, ...rest }) => structuredClone(rest)),
    link: async (link: Link) => {
      links.push({ ...link, ended: false });
    },
  });
}

/** The table of links in memory, for the tests that need no invitation. */
export function memoryLinks(rows: readonly Link[]): MemoryLoginBook {
  return memoryLoginBook(rows);
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
  links: LinkStore | LoginBook,
  keys: KeySets,
  now: () => number = Date.now,
): LoginSource {
  return Object.freeze({
    find: async (
      token: unknown,
      first: FirstCall = {},
    ): Promise<Principal | Unavailable | undefined> => {
      const fake = typeof token === "string" ? STEP_05.get(token) : undefined;
      if (fake !== undefined) return fake.type === "human" ? undefined : fake;
      const login = await checkedLogin(token, issuers, keys, now);
      if (login === undefined || "unavailable" in login) return login;
      let id: string | undefined;
      try {
        id = await links.principalOf(login.issuer, login.subject);
        // Changed by the learner's R1: a login with no link, whose call carries a code, joins by
        //   it, in the company the call names. A linked login never redeems a code (R2).
        const { tenant, invitation } = first;
        if (
          id === undefined &&
          "redeem" in links &&
          typeof tenant === "string" &&
          typeof invitation === "string"
        ) {
          id = await links.redeem(tenant, invitation, login);
        }
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
