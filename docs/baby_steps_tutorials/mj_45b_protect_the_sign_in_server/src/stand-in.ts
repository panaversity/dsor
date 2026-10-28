// NEW IN STEP 45: the stand-in for each company's sign-in server, in pnpm start and the older tests
// (step 45's README, C8 and D7). pnpm serve asks the real one, through lookups.json. The stand-in
// knows the story's people twice over, as a sign-in server does: whom each person's key names, and
// what each company says about each person, in the lookup contract's shape. DSoR's own table,
// src/principals.ts, holds no person any more: only agents and the timer jobs' logins (D6).
import { fakeDirectory, type FakeDirectory, type Person } from "./directory.ts";

/** What each company says about the story's people: their status, and their roles while active. */
export const STAND_IN_PEOPLE: Readonly<Record<string, Readonly<Record<string, Person>>>> = {
  org_456: {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
    // Org_456's tenant administrator, who may tear up any slip of the company (DSOR-DEL-04a). The
    // specification defines no such role, so tenant_admin is this tutorial's own (step 25's
    // README, decision L2).
    admin_100: { status: "active", roles: ["tenant_admin"] },
  },
  org_789: {
    user_700: { status: "active", roles: ["ap_supervisor"] },
    // Org_789's tenant administrator (step 28's README, decision D19).
    admin_700: { status: "active", roles: ["tenant_admin"] },
  },
};

/**
 * The key each of the story's people signs in with at the stand-in, and whom it names. A key names
 * a person and nothing more: which companies and roles she holds, line ② asks her company.
 */
export const STAND_IN_KEYS: ReadonlyMap<string, string> = new Map([
  ["tok_2c91", "user_123"],
  ["tok_d4e8", "cfo_100"],
  ["tok_a100", "admin_100"],
  ["tok_e1a7", "user_700"],
  ["tok_a700", "admin_700"],
]);

/** The stand-in's directories, new and on, one for each company, so each world may change its own. */
export function standInDirectories(): Map<string, FakeDirectory> {
  return new Map(
    Object.entries(STAND_IN_PEOPLE).map(([tenant, people]) => [
      tenant,
      fakeDirectory(tenant, people),
    ]),
  );
}
