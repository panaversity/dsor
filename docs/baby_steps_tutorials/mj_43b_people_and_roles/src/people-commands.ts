// NEW IN STEP 43b: five commands of DSoR's own that change the table of people. person.add and
// person.remove, role.grant, role.confirm, and role.revoke. Only a tenant administrator, a person,
// may call them (roles.json; people_only in their contracts); a powerful role waits for a second
// administrator's role.confirm; each call is recorded like any other (step 43b's README, claims C3
// to C6, decisions L1 to L4, D3, and D7).
import { Refusal } from "./envelope.ts";
import { isPowerful, type Grant } from "./people.ts";
import { logins } from "./principals.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import { formatUri, parseUri } from "./uri.ts";

type PersonInput = { person: string; reason: string };
type RoleInput = { person: string; role: string; reason: string };
type ConfirmInput = { grant: string; reason: string };

// The person's id, from the address that line ⑥ checked and line ② found in the company. An address
//   of another kind, such as dsor://org_456/invoice/cfo_100, names no person.
function personOf(input: unknown): string | undefined {
  const { entity, id } = parseUri((input as PersonInput).person);
  return entity === "person" ? id : undefined;
}

// One answer for every person who is no active member here, so it tells nothing about other
//   companies (as login.invite answers since step 43).
function noPerson(person: string | undefined, tenant: string): Refusal {
  return new Refusal(
    "RESOURCE_NOT_FOUND",
    `no person ${JSON.stringify(person ?? "")} in ${tenant}`,
  );
}

/** The person must be an active member of this company now. */
async function mustBeMember(input: unknown, look: OwnLook): Promise<string> {
  const person = personOf(input);
  const found = person === undefined ? undefined : await look.people.memberOf(look.tenant, person);
  if (person === undefined || found?.status !== "active") throw noPerson(person, look.tenant);
  return person;
}

// A new person's id: a person's, never an agent's or a system login's, which stay in
//   src/principals.ts until step 44 (decision D1).
// not copied: the tutorial's own form of a person's id, the one migration 049's CHECK uses; the
//   specification gives a principal's id no pattern.
const PERSON_ID = /^[a-z][a-z0-9_-]{0,63}$/;
async function mayAdd(input: unknown, look: OwnLook): Promise<void> {
  const person = personOf(input);
  if (person === undefined || !PERSON_ID.test(person)) {
    throw new Refusal(
      "VALIDATION_FAILED",
      "person.add names a person's address, such as dsor://org_456/person/jane_200",
    );
  }
  const story = [...logins.values()].find((p) => p.id === person);
  if (story !== undefined && story.type !== "human") {
    throw new Refusal(
      "VALIDATION_FAILED",
      `${person} is an agent or a system login, never a person`,
    );
  }
  if ((await look.people.memberOf(look.tenant, person))?.status === "active") {
    throw new Refusal("CONFLICT", `${person} is a person of ${look.tenant} already`, "internal");
  }
}

/** The role must be one roles.json has: what a role may do is DSoR's to say (decision L6). */
async function mayGrant(input: unknown, look: OwnLook): Promise<void> {
  await mustBeMember(input, look);
  const { role } = input as RoleInput;
  if (!look.roleTable.has(role)) {
    throw new Refusal("VALIDATION_FAILED", `roles.json has no role ${JSON.stringify(role)}`);
  }
}

async function mayRevoke(input: unknown, look: OwnLook): Promise<void> {
  await mustBeMember(input, look);
}

// A grant's address, such as dsor://org_456/grant/grt_…. Any other kind names no grant here.
function grantOf(input: unknown): string | undefined {
  const { entity, id } = parseUri((input as ConfirmInput).grant);
  return entity === "grant" ? id : undefined;
}

/** A grant as the answer shows it: its address, whom it names, and where it stands. */
function shown(grant: Grant): Record<string, unknown> {
  return {
    grant: formatUri({ tenant_id: grant.tenant, entity: "grant", id: grant.id }),
    person: grant.person,
    role: grant.role,
    state: grant.state,
    ...(grant.state === "pending" && grant.expires_at !== undefined
      ? { expires_at: grant.expires_at }
      : {}),
  };
}

/** The work of the five commands, for DSoR's own work. */
export function peopleWorkFor(): Record<string, OwnWork> {
  return {
    "person.add": {
      check: mayAdd,
      change: async (input: unknown, work: OwnStores): Promise<unknown> => {
        const person = personOf(input) as string;
        const { reason } = input as PersonInput;
        await work.stores.people.add(work.tenant, person, { person: work.caller.id, reason });
        return { person, status: "active" };
      },
    },
    "person.remove": {
      check: async (input, look) => {
        await mustBeMember(input, look);
      },
      change: async (input: unknown, work: OwnStores): Promise<unknown> => {
        const person = personOf(input) as string;
        const { reason } = input as PersonInput;
        const { roles } = await work.stores.people.remove(work.tenant, person, {
          person: work.caller.id,
          reason,
        });
        return { person, status: "deprovisioned", roles };
      },
    },
    "role.grant": {
      check: mayGrant,
      change: async (input: unknown, work: OwnStores): Promise<unknown> => {
        const person = personOf(input) as string;
        const { role, reason } = input as RoleInput;
        const powerful = isPowerful(role, work.roleTable);
        const grant = await work.stores.people.grant(work.tenant, person, role, powerful, {
          person: work.caller.id,
          reason,
        });
        return shown(grant);
      },
    },
    "role.confirm": {
      // The grant is read in the claim's own store, so its state is the state the confirm moves.
      check: async () => {},
      change: async (input: unknown, work: OwnStores): Promise<unknown> => {
        const id = grantOf(input);
        const { reason } = input as ConfirmInput;
        if (id === undefined) throw new Refusal("RESOURCE_NOT_FOUND", `no grant waits here`);
        const grant = await work.stores.people.confirm(work.tenant, id, {
          person: work.caller.id,
          reason,
        });
        return shown(grant);
      },
    },
    "role.revoke": {
      check: mayRevoke,
      change: async (input: unknown, work: OwnStores): Promise<unknown> => {
        const person = personOf(input) as string;
        const { role, reason } = input as RoleInput;
        const ended = await work.stores.people.revoke(work.tenant, person, role, {
          person: work.caller.id,
          reason,
        });
        if (ended === 0) {
          throw new Refusal(
            "RESOURCE_NOT_FOUND",
            `${person} holds no ${JSON.stringify(role)} in ${work.tenant}`,
          );
        }
        return { person, role, ended };
      },
    },
  };
}
