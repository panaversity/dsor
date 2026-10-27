// NEW IN STEP 44: where a call's login comes from. Each world chooses. pnpm start and the earlier
//   tests keep step 42's table of keys. pnpm serve takes a person's signed token, made for DSoR by
//   the one sign-in server it trusts, and an agent's key. A token proves who signed in; DSoR's own
//   table says which companies and roles that person holds (DSOR-IDN-01, DSOR-IDN-04a,
//   DSOR-IDN-04b; step 44's README, claims C3 and C4, decisions 44-5, 44-6, 44-7, and 44-10).
import type { TokenOfRecord } from "./log.ts";
import { logins as STEP_42, type Principal } from "./principals.ts";
import type { SignIn } from "./sign-in.ts";
import {
  checkedLogin,
  type KeySets,
  type Login,
  type Refused,
  type Unavailable,
} from "./tokens.ts";

/**
 * A token login that counts: the person DSoR's table names, and the login the token gave, which
 * the record keeps (step 44's README, decision 44-11).
 */
export type Signed = { signed: Login; caller: Principal };

/**
 * Who a token or key belongs to, or why a token was refused, or that it could not be checked now.
 * It never throws: line ① refuses a call with no caller, and answers an outage as one.
 */
export type LoginSource = {
  find: (token: unknown) => Promise<Principal | Signed | Unavailable | Refused | undefined>;
};

/**
 * What a call's record keeps of what the logins found: the issuer and client of a token that
 * counts, or why a token was refused and who it speaks for. Nothing for a key (decision 44-11).
 */
export function tokenOfRecord(
  found: Principal | Signed | Unavailable | Refused | undefined,
): TokenOfRecord | undefined {
  if (found === undefined) return undefined;
  if ("signed" in found) {
    return { login: { issuer: found.signed.issuer, client: found.signed.client } };
  }
  if ("refused" in found) return { refused_token: { cause: found.refused, ...found.signer } };
  return undefined;
}

// Step 42's table, as every world had it until now (decision 44-6).
export const FAKE_LOGINS: LoginSource = Object.freeze({
  find: async (token: unknown): Promise<Principal | undefined> =>
    typeof token === "string" ? STEP_42.get(token) : undefined,
});

// Three parts separated by dots, as every signed token has, is a token; anything else is a key. A
//   token is never looked up as a key, and a key is never read as a token (decision 44-7).
function hasTokenForm(token: unknown): token is string {
  return typeof token === "string" && token.split(".").length === 3;
}

/**
 * pnpm serve's logins. A token must be made for DSoR (tokens.ts), and its subject must be a person
 * in the table, whose companies and roles come from the table, never from the token. A key counts
 * only for an agent or a system login: a person's key is refused (decisions 44-5 and 44-6).
 */
export function realLogins(
  signIn: SignIn,
  keys: KeySets,
  table: ReadonlyMap<string, Principal> = STEP_42,
): LoginSource {
  // The people of the table, by id. Only a person signs in with a token: a token whose subject
  //   names an agent or a system login makes nobody that agent.
  const people = new Map(
    [...table.values()].filter((p) => p.type === "human").map((p) => [p.id, p]),
  );
  return Object.freeze({
    find: async (
      token: unknown,
    ): Promise<Principal | Signed | Unavailable | Refused | undefined> => {
      if (!hasTokenForm(token)) {
        const holder = typeof token === "string" ? table.get(token) : undefined;
        return holder === undefined || holder.type === "human" ? undefined : holder;
      }
      const login = await checkedLogin(token, signIn, keys);
      if ("unavailable" in login || "refused" in login) return login;
      const person = people.get(login.subject);
      // A good token for nobody in the table is refused as every bad login is, and its record
      //   names the login, so an administrator can see why (decisions 44-10 and 44-11).
      if (person === undefined) return { refused: "unlisted", signer: { ...login } };
      return { signed: login, caller: person };
    },
  });
}
