// NEW IN STEP 43c: each company's directory credential. The owner's pnpm directory-token makes a
//   random token, shows it once to paste into the company's directory, and DSoR keeps its SHA-256
//   only, with the company it names. The SCIM door takes this token and nothing else: never a
//   token of step 05's table, never a person's sign-in. The company comes from the token, never
//   from the request (DSOR-IDN-04a; step 43c's README, claim C2, decision D3). The program keeps
//   the hashes in dsor.directory_clients (postgres.ts); the unit tests keep them in memory, here.
import { createHash } from "node:crypto";
import { directoryLoginOf } from "./company-people.ts";
import type { LoginSource } from "./logins.ts";
import { logins, type Principal } from "./principals.ts";

/** Where DSoR keeps each directory credential: the company a token's hash names, or none. */
export type DirectoryClients = { tenantOf: (hash: string) => Promise<string | undefined> };

/** The hash DSoR keeps of a directory's token. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The credentials in memory, for the unit tests: each token and its company. */
export function memoryClients(entries: readonly [string, string][]): DirectoryClients {
  const kept = new Map(entries.map(([token, tenant]) => [tokenHash(token), tenant]));
  return { tenantOf: async (hash) => kept.get(hash) };
}

// Each company's directory login, from DSoR's table of principals (src/principals.ts).
const BY_ID: ReadonlyMap<string, Principal> = new Map([...logins.values()].map((p) => [p.id, p]));

/** The SCIM door's logins: a directory's own token, and nothing else. */
export function directoryLogins(clients: DirectoryClients): LoginSource {
  return Object.freeze({
    find: async (token: unknown): Promise<Principal | { unavailable: string } | undefined> => {
      if (typeof token !== "string" || token === "") return undefined;
      let tenant: string | undefined;
      try {
        tenant = await clients.tenantOf(tokenHash(token));
      } catch {
        // A table of credentials that cannot be read is an outage, not a wrong token.
        return { unavailable: "DSoR's table of directory credentials" };
      }
      if (tenant === undefined) return undefined;
      // A company with a credential and no directory login is no caller: start-up names it.
      const login = BY_ID.get(directoryLoginOf(tenant));
      return login?.type === "system" ? login : undefined;
    },
  });
}
