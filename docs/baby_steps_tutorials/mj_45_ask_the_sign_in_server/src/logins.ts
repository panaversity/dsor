// Where a call's login comes from. Each world chooses. pnpm start and the earlier
//   tests keep step 42's table of keys. pnpm serve takes a person's signed token, made for DSoR by
//   the one sign-in server it trusts, and an agent's key. A token proves who signed in; DSoR's own
//   table says which companies and roles that person holds (DSOR-IDN-01, DSOR-IDN-04a,
//   DSOR-IDN-04b; step 44's README, claims C3 and C4, decisions 44-5, 44-6, 44-7, and 44-10).
import type { TokenOfRecord } from "./log.ts";
import { logins as STEP_42, type Principal } from "./principals.ts";
import { STAND_IN_KEYS } from "./stand-in.ts";
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
// NEW IN STEP 45: or a person's key at the stand-in sign-in server, which names her and nothing
//   more. What she holds, line ② asks her company (step 45's README, C2 and D7).
export const FAKE_LOGINS: LoginSource = Object.freeze({
  find: async (token: unknown): Promise<Principal | undefined> => {
    if (typeof token !== "string") return undefined;
    const person = STAND_IN_KEYS.get(token);
    if (person !== undefined) return { id: person, type: "human", memberships: [] };
    return STEP_42.get(token);
  },
});

// Three parts separated by dots, as every signed token has, is a token; anything else is a key. A
//   token is never looked up as a key, and a key is never read as a token (decision 44-7).
function hasTokenForm(token: unknown): token is string {
  return typeof token === "string" && token.split(".").length === 3;
}

/**
 * pnpm serve's logins. A token must be made for DSoR (tokens.ts), and its subject is a person.
 * Since step 45, her companies and roles come from her company's lookup, which line ② asks, never
 * from the table and never from the token (step 45's README, C2). A key counts
 * for anyone in the table who is not a person, an agent, an application, or a system login: a
 * person's key is refused (decisions 44-5 and 44-6; worded so by step 44's review).
 */
export function realLogins(
  signIn: SignIn,
  keys: KeySets,
  table: ReadonlyMap<string, Principal> = STEP_42,
): LoginSource {
  // Only a person signs in with a token: a token whose subject names an agent, an application, or
  //   a system login in the table makes nobody that login.
  // Changed in step 45: the table holds no person, so any other subject is a person, whose
  //   companies and roles line ② asks of her company (step 45's README, C2).
  const others = new Set([...table.values()].filter((p) => p.type !== "human").map((p) => p.id));
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
      // A good token for a login that is no person is refused as every bad login is, and its
      //   record names the login, so an administrator can see why (decisions 44-10 and 44-11).
      if (others.has(login.subject)) return { refused: "unlisted", signer: { ...login } };
      return { signed: login, caller: { id: login.subject, type: "human", memberships: [] } };
    },
  });
}
