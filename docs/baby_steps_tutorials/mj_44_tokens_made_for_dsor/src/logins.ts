// NEW IN STEP 44: where a call's login comes from. Each world chooses. pnpm start and the earlier
//   tests keep step 42's table of keys. pnpm serve takes a person's signed token, made for DSoR by
//   the one sign-in server it trusts, and an agent's key. A token proves who signed in; DSoR's own
//   table says which companies and roles that person holds (DSOR-IDN-01, DSOR-IDN-04a,
//   DSOR-IDN-04b; step 44's README, claims C3 and C4, decisions 44-5, 44-6, 44-7, and 44-10).
import { logins as STEP_42, type Principal } from "./principals.ts";
import type { SignIn } from "./sign-in.ts";
import { checkedLogin, type KeySets, type Login, type Unavailable } from "./tokens.ts";

/**
 * A good token made for DSoR, whose subject DSoR's table lists as no person. Line ① refuses it as
 * it refuses a bad token, and its record names the login, so an administrator can see why (44-10).
 */
export type Unlisted = { unlisted: Login };

/**
 * Who a token or key belongs to, or none, or that it could not be checked now. It never throws:
 * line ① refuses a call with no caller, and answers an outage as one.
 */
export type LoginSource = {
  find: (token: unknown) => Promise<Principal | Unavailable | Unlisted | undefined>;
};

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
    find: async (token: unknown): Promise<Principal | Unavailable | Unlisted | undefined> => {
      if (!hasTokenForm(token)) {
        const holder = typeof token === "string" ? table.get(token) : undefined;
        return holder === undefined || holder.type === "human" ? undefined : holder;
      }
      const login = await checkedLogin(token, signIn, keys);
      if (login === undefined || "unavailable" in login) return login;
      return people.get(login.subject) ?? { unlisted: login };
    },
  });
}
