// NEW IN STEP 19: line ③'s last question. Does the person who signed the slip still hold her
// job, and which roles does she hold now? DSoR asks her company's directory, never the
// request (DSOR-IDN-05 and DSOR-IDN-06 in specs/dsor/02-security.md, section 12.1).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Directories } from "./directory.ts";
import { Refusal } from "./envelope.ts";
import { principalNamed, type Principal } from "./principals.ts";
import type { Slip } from "./slips.ts";

/** What line ③ learned about the signer: her roles in this company, from where, and as of when. */
export type SignerAuthority = { roles: string[]; source: "role_source"; as_of: string };

/** One company's role source setting, once start-up has checked it. */
export type RoleSetting = { kind: "idp_lookup"; max_staleness: string; ms: number };

/** Each company's role source setting, by company. */
export type RoleSettings = ReadonlyMap<string, RoleSetting>;

/** The settings file, as it was read from disk: its name and its text. */
export type RoleSettingsSource = { file: string; text: string };

/** An answer DSoR checked and kept, with the time it arrived by DSoR's clock. */
export type Kept = { answer: Record<string, unknown>; at: number };

/** DSoR's side of the role source: the signer's current authority, or a refusal. */
export type RoleSource = {
  authorityOf: (tenant: string, slip: Slip, name: string) => Promise<SignerAuthority>;
};

const SHIPPED = fileURLToPath(new URL("../role-sources.json", import.meta.url));

/** Reads the settings file: this step's own, unless another is named. */
export function readRoleSettings(path: string = SHIPPED): RoleSettingsSource {
  return { file: "role-sources.json", text: readFileSync(path, "utf8") };
}

/** Checks each company's setting, and names every problem. */
export function checkRoleSettings(
  _source: RoleSettingsSource,
  _principals: Iterable<Principal>,
): { settings: RoleSettings; problems: string[] } {
  // A shell for the red tests: no setting is read, and nothing is refused.
  return { settings: new Map(), problems: [] };
}

/** The key a kept answer is kept under: its company and its person (DSOR-TEN-02a). */
export function keptKey(tenant: string, person: string): string {
  return JSON.stringify([tenant, person]);
}

/** DSoR's side of each company's role source, holding the answers it keeps. */
export function createRoleSource(
  _settings: RoleSettings,
  _directories: Directories,
  _kept: Map<string, Kept> = new Map(),
): RoleSource {
  // A shell for the red tests, with step 18's behaviour: the signer's roles come from DSoR's
  // login table, loaded at start-up, and no directory is asked.
  return Object.freeze({
    authorityOf: async (tenant: string, slip: Slip, name: string): Promise<SignerAuthority> => {
      const signer = principalNamed(slip.delegator);
      const membership = signer?.memberships.find((m) => m.tenant_id === tenant);
      if (signer?.type !== "human" || membership === undefined) {
        const why = `slip ${slip.id} is signed by ${slip.delegator}, who is not a person in ${tenant}`;
        throw new Refusal("AUTHORIZATION_DENIED", `${name}: ${why}`);
      }
      return {
        roles: [...membership.roles],
        source: "role_source",
        as_of: new Date().toISOString(),
      };
    },
  });
}
