// Since step 43, the learner's R2 and R7: two commands of DSoR's own. login.invite asks DSoR for an
// invitation of a person of the company, and answers its one-time code; login.unlink ends every
// login of a person and cancels their open invitations. Only a tenant administrator, a person, may
// call them (login:invite, login:unlink in roles.json; people_only in their contracts), and each call
// is recorded like any other (step 43's README, revisions R1, R2, and R7).
import { Refusal } from "./envelope.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { formatUri, parseUri } from "./uri.ts";

type PersonInput = { person: string; reason: string };

// The person's id, from the address line ⑥ checked and line ② found in the company.
const idOf = (input: unknown): string => parseUri((input as PersonInput).person).id;

// The person must be a person of this company: never an agent, a system login, or someone of
//   another company. One answer for each, so the answer tells nothing about other companies.
//   An address of another kind, such as dsor://org_456/invoice/cfo_100, names no person either.
async function mustBePersonOfCompany(input: unknown, look: OwnLook): Promise<void> {
  const { entity } = parseUri((input as PersonInput).person);
  const person = idOf(input);
  // Changed in step 43b: DSoR's table of people, never src/principals.ts (step 43b's README, C3).
  const found = entity === "person" ? await look.people.memberOf(look.tenant, person) : undefined;
  if (found?.status !== "active") {
    throw new Refusal(
      "RESOURCE_NOT_FOUND",
      `no person ${JSON.stringify(person)} in ${look.tenant}`,
    );
  }
}

async function invite(input: unknown, work: OwnStores): Promise<unknown> {
  const { reason } = input as PersonInput;
  const person = idOf(input);
  const by = { person: work.caller.id, reason };
  const { invitation, code } = await work.stores.logins.invite(work.tenant, person, by);
  return {
    invitation: formatUri({ tenant_id: work.tenant, entity: "invitation", id: invitation.id }),
    person,
    // The one time the code leaves DSoR; DSoR keeps only its hash (decision R1).
    code,
    expires_at: invitation.expires_at,
  };
}

async function unlink(input: unknown, work: OwnStores): Promise<unknown> {
  const { reason } = input as PersonInput;
  const person = idOf(input);
  const ended = await work.stores.logins.unlink(work.tenant, person, {
    person: work.caller.id,
    reason,
  });
  return { person, ...ended };
}

/** The work of login.invite and login.unlink, for DSoR's own work. */
export function invitationWorkFor(): Record<string, OwnWork> {
  return {
    "login.invite": { check: mustBePersonOfCompany, change: invite },
    "login.unlink": { check: mustBePersonOfCompany, change: unlink },
  };
}
