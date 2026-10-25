// Since step 43, the learner's R2 and R7: two commands of DSoR's own. login.invite asks DSoR for an
// invitation of a person of the company, and answers its one-time code; login.unlink ends every
// login of a person and cancels their open invitations. Only a tenant administrator, a person, may
// call them (login:invite, login:unlink in roles.json; people_only in their contracts), and each call
// is recorded like any other (step 43's README, revisions R1, R2, and R7).
import { mustBeMember } from "./people-commands.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { formatUri, parseUri } from "./uri.ts";

type PersonInput = { person: string; reason: string };

// The person's id, from the address line ⑥ checked and line ② found in the company.
const idOf = (input: unknown): string => parseUri((input as PersonInput).person).id;

// The person must be a person of this company: never an agent, a system login, or someone of
//   another company. Changed in step 43b: the one check the commands of people use, on DSoR's
//   table of people (the code review of step 43b, finding 8).
async function mustBePersonOfCompany(input: unknown, look: OwnLook): Promise<void> {
  await mustBeMember(input, look);
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
