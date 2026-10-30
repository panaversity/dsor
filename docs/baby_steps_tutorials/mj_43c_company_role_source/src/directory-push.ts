// NEW IN STEP 43c: directory.push and directory.read, the two operations of a company's directory.
//   Only that company's directory login may call them (directory_sync in roles.json; system_only in
//   their contracts). A push changes the company's copy, inside the claim, after DSoR's own check
//   at line ⑨; a read shows the company's copy only. Each is recorded like any other call, and the
//   records are when DSoR last heard from the directory (DSOR-IDN-03a, DSOR-IDN-05, DSOR-EXE-02;
//   step 43c's README, claim C3, decisions D1, D2, D4, D5, and D6).
import type { CopyGroup, CopyUser, Filter, GroupChange, UserInput } from "./directory-copy.ts";
import { Refusal } from "./envelope.ts";
import { taken } from "./people.ts";
import { logins } from "./principals.ts";
import type { OwnLook, OwnStores, OwnWork } from "./revocation.ts";
import type { OwnRead, OwnReadLook } from "./alert-list.ts";

// A pushed user is an `account`: since step 05 an argument named user is refused (DSOR-SRC-02b).
// The input names its company, which line ② has checked is the caller's; the change is one of seven.
type Push =
  | { kind: "user.create"; account: UserInput }
  | { kind: "user.replace"; id: string; account: UserInput }
  | { kind: "user.delete" | "group.delete"; id: string }
  | { kind: "group.create"; group: { name: string; external_id: string; members: string[] } }
  | {
      kind: "group.replace";
      id: string;
      group: { name: string; external_id: string; members: string[] };
    }
  | ({ kind: "group.change"; id: string } & GroupChange);
type PushInput = { company: string; change: Push };

// A person's DSoR id, the form step 43b's table and migration 049 use; the specification gives a
//   principal's id no pattern (step 43b's README).
// not copied: the tutorial's own form of a person's id.
const PERSON_ID = /^[a-z][a-z0-9_-]{0,63}$/;
// DSoR's own names, and every agent's and system login's id, are never a person's (decision D5).
const RESERVED: ReadonlySet<string> = new Set([
  "owner",
  "dsor",
  ...[...logins.values()].filter((p) => p.type !== "human").map((p) => p.id),
]);

/** The refusal of a username that cannot be a person's DSoR id (decision D5). */
function noPersonId(name: string): Refusal {
  const why =
    "is no DSoR id: a person's id is lowercase letters, digits, _ and -, and never a login of DSoR's";
  return new Refusal("VALIDATION_FAILED", `the username ${JSON.stringify(name)} ${why}`);
}

/** Line ⑨: a push into a company on its own directory, of a user DSoR can key, under an id not taken. */
async function mayPush(input: unknown, look: OwnLook): Promise<void> {
  // One truth per company: a company on DSoR's own table takes no push (the learner's L10).
  if (look.roleKind !== "scim") {
    const why = `${look.tenant}'s role source is DSoR's own table, not its directory`;
    throw new Refusal("CONFLICT", why, "internal");
  }
  const push = (input as PushInput).change;
  if (push.kind !== "user.create") return;
  const name = push.account.user_name;
  if (!PERSON_ID.test(name) || RESERVED.has(name)) throw noPersonId(name);
  // An id another company has, or had, in DSoR's table or a directory's copy, is taken; the answer
  //   names no company (the learner's L5; step 43b's review, finding 1).
  if ((await look.people.companiesOf(name)).some((t) => t !== look.tenant)) throw taken(name);
}

/** "Not found" for an id that is no row of this company's copy: another company's row too (D4). */
function notFound(id: string, tenant: string): Refusal {
  return new Refusal("RESOURCE_NOT_FOUND", `no ${id} in ${tenant}'s copy`);
}

/** A row as the answer shows it. */
function shownUser(user: CopyUser): Record<string, unknown> {
  return { kind: "user", ...user };
}
// Each member as a record of its own: since step 14 a list in an answer is a list of records whose
//   every field has a label, never of bare values (classifications.json, DirectoryMember).
function shownGroup(group: CopyGroup): Record<string, unknown> {
  return { kind: "group", ...group, members: group.members.map((id) => ({ id })) };
}

/**
 * Every active slip the person signed in this company, suspended in this push's own transaction, with
 * one record each, as step 19b suspends a gone signer's at line ③. The learner's L8b, after the review
 * of step 43c, finding 1: at the next use, a person suspended and made active again before the agent
 * called never had her slips suspended, though her directory had said so (DSOR-IDN-07).
 */
async function leaves(work: OwnStores, person: string, word: string): Promise<void> {
  await work.stores.slips.suspend(work.tenant, person, {
    word,
    as_of: work.now,
    correlation: work.correlation,
  });
}

/** The change, after line ⑩, inside the claim. */
async function pushChange(input: unknown, work: OwnStores): Promise<unknown> {
  const copy = work.stores.copy;
  const { tenant } = work;
  const push = (input as PushInput).change;
  const found = <T>(row: T | undefined, id: string): T => {
    if (row === undefined) throw notFound(id, tenant);
    return row;
  };
  switch (push.kind) {
    case "user.create":
      return shownUser(await copy.createUser(tenant, push.account));
    case "user.replace": {
      const user = found(await copy.replaceUser(tenant, push.id, push.account), push.id);
      if (!user.active) await leaves(work, user.person, "suspended");
      return shownUser(user);
    }
    case "user.delete": {
      const user = found(await copy.user(tenant, push.id), push.id);
      await copy.deleteUser(tenant, push.id);
      await leaves(work, user.person, "deprovisioned");
      return { kind: "user", id: push.id, deleted: true };
    }
    case "group.create":
      return shownGroup(await copy.createGroup(tenant, push.group));
    case "group.replace":
      return shownGroup(found(await copy.replaceGroup(tenant, push.id, push.group), push.id));
    case "group.change": {
      const { kind: _k, id, ...change } = push;
      return shownGroup(found(await copy.changeGroup(tenant, id, change), id));
    }
    case "group.delete":
      found((await copy.deleteGroup(tenant, push.id)) || undefined, push.id);
      return { kind: "group", id: push.id, deleted: true };
  }
}

/**
 * The read: a page of the company's own users or groups, the one with an id, all, or those a search
 * finds, and never another company's. Always a page, an empty one too: the SCIM door answers an empty
 * page for one id as SCIM's 404 (decision D4).
 */
async function readCopy(input: unknown, look: OwnReadLook): Promise<unknown> {
  const { what, id, filter } = input as { what: "users" | "groups"; id?: string; filter?: Filter };
  if (what === "users") {
    const rows = id === undefined ? await look.copy.users(filter) : [await look.copy.user(id)];
    const kept = rows.filter((r): r is CopyUser => r !== undefined && matches(r, filter));
    return { items: kept.map(shownUser) };
  }
  const rows = id === undefined ? await look.copy.groups(filter) : [await look.copy.group(id)];
  const kept = rows.filter((r): r is CopyGroup => r !== undefined && matches(r, filter));
  return { items: kept.map(shownGroup) };
}

/** Whether a row read by its id also meets the search given with it. */
function matches(row: CopyUser | CopyGroup, filter: Filter | undefined): boolean {
  if (filter === undefined) return true;
  const value = {
    userName: (row as CopyUser).user_name,
    externalId: row.external_id,
    displayName: (row as CopyGroup).name,
  }[filter.field];
  return value === filter.value;
}

/** The work of directory.push, for DSoR's own work. */
export function directoryWorkFor(): Record<string, OwnWork> {
  return { "directory.push": { check: mayPush, change: pushChange } };
}

/** The read of directory.read, for DSoR's own reads. Who may call it is its contract's to say. */
export function directoryReadsFor(): Record<string, OwnRead> {
  return { "directory.read": { check: async () => {}, read: readCopy } };
}
