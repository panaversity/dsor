// NEW IN STEP 43c: the copy of each company's directory, the directory credentials, and when DSoR
//   last heard from each directory, on PostgreSQL (migration 050). The same store as memoryCopy in
//   src/directory-copy.ts: each write inside one company, a read of one company names it, and a row
//   of another company is "not found". Nothing is ever deleted: a deleted user, a deleted group, and
//   a member who left are kept, ended at a time, as no kind of table allows DELETE (step 16's README,
//   decision 3; step 43c's README, claim C8, decisions D2, D3, D4, and D6).
import type pg from "pg";
import { directoryLoginOf, type Heard } from "./company-people.ts";
import type { DirectoryClients } from "./directory-clients.ts";
import {
  membersAfter,
  membersNamed,
  nameAfter,
  type CopyGroup,
  type CopyUser,
  type DirectoryCopy,
  type Filter,
  type GroupInput,
  type UserInput,
} from "./directory-copy.ts";
import { Refusal } from "./envelope.ts";
import { taken } from "./people.ts";
import { inCompany, onPool, type Runner } from "./postgres.ts";

type UserRow = {
  id: string;
  external_id: string;
  principal_id: string;
  user_name: string;
  display_name: string | null;
  active: boolean;
};
const USER = "id, external_id::text, principal_id, user_name, display_name, active";
const userOf = (row: UserRow): CopyUser => ({
  id: row.id,
  external_id: row.external_id,
  person: row.principal_id,
  user_name: row.user_name,
  ...(row.display_name === null ? {} : { display_name: row.display_name }),
  active: row.active,
});

// A group with its live members, in the order they joined.
const GROUP = `g.id, g.external_id::text, g.name,
  coalesce(array_agg(m.user_id::text ORDER BY m.added_at) FILTER (WHERE m.id IS NOT NULL), '{}') AS members`;
const GROUP_FROM = `dsor.scim_groups g
  LEFT JOIN dsor.scim_members m ON m.group_id = g.id AND m.removed_at IS NULL`;
type GroupRow = { id: string; external_id: string; name: string; members: string[] };
const groupOf = (row: GroupRow): CopyGroup => ({ ...row });

// A search's field, as a column of each table. A value is compared as text, so a search for a value
//   that is no uuid finds nothing, as in memory.
const USER_FIELD = {
  userName: "user_name",
  externalId: "external_id::text",
  displayName: "display_name",
};
const GROUP_FIELD = { userName: "NULL", externalId: "g.external_id::text", displayName: "g.name" };

/** The copy, on the pool: each write in a transaction of its own, inside its company. */
export function createDbCopy(pool: pg.Pool): DirectoryCopy {
  return copyThrough(pool, onPool(pool));
}

/**
 * The same statements through a runner: on the pool, or inside a claim, where directory.push writes
 * in the claim's own transaction, with its record. A read is on the reader, and names its company.
 */
export function copyThrough(reader: pg.Pool | pg.ClientBase, run: Runner): DirectoryCopy {
  const oneGroup = async (client: pg.Pool | pg.ClientBase, tenant: string, id: string) => {
    const { rows } = await client.query<GroupRow>(
      `SELECT ${GROUP} FROM ${GROUP_FROM}
        WHERE g.tenant_id = $1 AND g.id::text = $2 AND g.deleted_at IS NULL GROUP BY g.id`,
      [tenant, id],
    );
    return rows[0] === undefined ? undefined : groupOf(rows[0]);
  };
  // Every member a push names is a live user of this company's copy (decision D6).
  const mustBeUsers = async (client: pg.ClientBase, tenant: string, ids: readonly string[]) => {
    for (const id of new Set(ids)) {
      const found = await client.query(
        "SELECT 1 FROM dsor.scim_users WHERE tenant_id = $1 AND id::text = $2 AND deleted_at IS NULL",
        [tenant, id],
      );
      if (found.rowCount !== 1) {
        throw new Refusal("VALIDATION_FAILED", `member ${id} is no user in ${tenant}'s copy`);
      }
    }
  };
  // The group's members made exactly these: those who left are ended, those who join are added.
  const setMembers = async (
    client: pg.ClientBase,
    tenant: string,
    group: string,
    want: string[],
  ) => {
    await client.query(
      `UPDATE dsor.scim_members SET removed_at = now()
        WHERE tenant_id = $1 AND group_id = $2 AND removed_at IS NULL AND NOT (user_id::text = ANY($3))`,
      [tenant, group, want],
    );
    for (const user of new Set(want)) {
      await client.query(
        `INSERT INTO dsor.scim_members (tenant_id, group_id, user_id)
         SELECT $1, $2::uuid, $3::uuid WHERE NOT EXISTS (SELECT 1 FROM dsor.scim_members
            WHERE group_id = $2::uuid AND user_id = $3::uuid AND removed_at IS NULL)`,
        [tenant, group, user],
      );
    }
  };
  const live = async (client: pg.ClientBase, tenant: string, id: string, table: string) => {
    const { rows } = await client.query<{ external_id: string }>(
      `SELECT external_id::text FROM dsor.${table}
        WHERE tenant_id = $1 AND id::text = $2 AND deleted_at IS NULL FOR UPDATE`,
      [tenant, id],
    );
    return rows[0]?.external_id;
  };
  return Object.freeze({
    createUser: async (tenant: string, input: UserInput) =>
      run(tenant, async (client) => {
        const person = input.user_name;
        // The id's lock, the one step 43b's person.add takes: a push and an add of one id at the
        //   same moment are one after the other, and the second sees the first (the learner's L5).
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('dsor.people/' || $1, 0))",
          [person],
        );
        // Changed by the review of step 43c, finding 1: and an id this company had under another
        //   externalId, so a new hire never inherits a leaver's slips and approvals.
        const elsewhere = await client.query(
          `SELECT 1 FROM dsor.scim_users WHERE principal_id = $1
              AND (tenant_id <> $2 OR external_id::text <> $3)
           UNION ALL SELECT 1 FROM dsor.people WHERE principal_id = $1 AND tenant_id <> $2 LIMIT 1`,
          [person, tenant, input.external_id],
        );
        if (elsewhere.rowCount !== 0) throw taken(person);
        const here = await client.query(
          `SELECT 1 FROM dsor.scim_users WHERE tenant_id = $1 AND deleted_at IS NULL
              AND (principal_id = $2 OR external_id::text = $3)`,
          [tenant, person, input.external_id],
        );
        if (here.rowCount !== 0) {
          throw new Refusal("CONFLICT", `${person} is in ${tenant}'s copy already`, "internal");
        }
        const { rows } = await client.query<UserRow>(
          `INSERT INTO dsor.scim_users (tenant_id, external_id, principal_id, user_name, display_name, active)
           VALUES ($1, $2, $3, $3, $4, $5) RETURNING ${USER}`,
          [tenant, input.external_id, person, input.display_name ?? null, input.active],
        );
        return userOf(rows[0] as UserRow);
      }),
    replaceUser: async (tenant: string, id: string, input: UserInput) =>
      run(tenant, async (client) => {
        const external = await live(client, tenant, id, "scim_users");
        if (external === undefined) return undefined;
        if (external !== input.external_id) {
          throw new Refusal("CONFLICT", "a user's externalId never changes", "internal");
        }
        // Her DSoR id stays the one of her first push; only the name authentik shows changes (L5).
        const { rows } = await client.query<UserRow>(
          `UPDATE dsor.scim_users SET user_name = $3, display_name = $4, active = $5
            WHERE tenant_id = $1 AND id::text = $2 RETURNING ${USER}`,
          [tenant, id, input.user_name, input.display_name ?? null, input.active],
        );
        return userOf(rows[0] as UserRow);
      }),
    deleteUser: async (tenant: string, id: string) =>
      run(tenant, async (client) => {
        if ((await live(client, tenant, id, "scim_users")) === undefined) return false;
        await client.query(
          `UPDATE dsor.scim_members SET removed_at = now()
            WHERE tenant_id = $1 AND user_id::text = $2 AND removed_at IS NULL`,
          [tenant, id],
        );
        await client.query(
          "UPDATE dsor.scim_users SET deleted_at = now() WHERE tenant_id = $1 AND id::text = $2",
          [tenant, id],
        );
        return true;
      }),
    createGroup: async (tenant: string, input: GroupInput) =>
      run(tenant, async (client) => {
        const here = await client.query(
          "SELECT 1 FROM dsor.scim_groups WHERE tenant_id = $1 AND external_id::text = $2 AND deleted_at IS NULL",
          [tenant, input.external_id],
        );
        if (here.rowCount !== 0) {
          throw new Refusal(
            "CONFLICT",
            `group ${input.external_id} is in ${tenant}'s copy already`,
            "internal",
          );
        }
        await mustBeUsers(client, tenant, input.members);
        const { rows } = await client.query<{ id: string }>(
          "INSERT INTO dsor.scim_groups (tenant_id, external_id, name) VALUES ($1, $2, $3) RETURNING id",
          [tenant, input.external_id, input.name],
        );
        const id = (rows[0] as { id: string }).id;
        await setMembers(client, tenant, id, input.members);
        return (await oneGroup(client, tenant, id)) as CopyGroup;
      }),
    replaceGroup: async (tenant: string, id: string, input: GroupInput) =>
      run(tenant, async (client) => {
        const external = await live(client, tenant, id, "scim_groups");
        if (external === undefined) return undefined;
        if (external !== input.external_id) {
          throw new Refusal("CONFLICT", "a group's externalId never changes", "internal");
        }
        await mustBeUsers(client, tenant, input.members);
        await client.query(
          "UPDATE dsor.scim_groups SET name = $3 WHERE tenant_id = $1 AND id::text = $2",
          [tenant, id, input.name],
        );
        await setMembers(client, tenant, id, input.members);
        return oneGroup(client, tenant, id);
      }),
    changeGroup: async (tenant, id, change) =>
      run(tenant, async (client) => {
        if ((await live(client, tenant, id, "scim_groups")) === undefined) return undefined;
        await mustBeUsers(client, tenant, membersNamed(change.operations));
        const now = (await oneGroup(client, tenant, id)) as CopyGroup;
        // In the PATCH's order (the review of step 43c, finding 2).
        await setMembers(client, tenant, id, membersAfter(now.members, change.operations));
        const name = nameAfter(now.name, change.operations);
        if (name !== now.name) {
          await client.query(
            "UPDATE dsor.scim_groups SET name = $3 WHERE tenant_id = $1 AND id::text = $2",
            [tenant, id, name],
          );
        }
        return oneGroup(client, tenant, id);
      }),
    deleteGroup: async (tenant: string, id: string) =>
      run(tenant, async (client) => {
        if ((await live(client, tenant, id, "scim_groups")) === undefined) return false;
        await setMembers(client, tenant, id, []);
        await client.query(
          "UPDATE dsor.scim_groups SET deleted_at = now() WHERE tenant_id = $1 AND id::text = $2",
          [tenant, id],
        );
        return true;
      }),
    users: async (tenant: string, filter?: Filter) => {
      const where = filter === undefined ? "" : ` AND ${USER_FIELD[filter.field]} = $2`;
      const { rows } = await reader.query<UserRow>(
        `SELECT ${USER} FROM dsor.scim_users WHERE tenant_id = $1 AND deleted_at IS NULL${where}
          ORDER BY created_at`,
        filter === undefined ? [tenant] : [tenant, filter.value],
      );
      return rows.map(userOf);
    },
    user: async (tenant: string, id: string) => {
      const { rows } = await reader.query<UserRow>(
        `SELECT ${USER} FROM dsor.scim_users WHERE tenant_id = $1 AND id::text = $2 AND deleted_at IS NULL`,
        [tenant, id],
      );
      return rows[0] === undefined ? undefined : userOf(rows[0]);
    },
    groups: async (tenant: string, filter?: Filter) => {
      const where = filter === undefined ? "" : ` AND ${GROUP_FIELD[filter.field]} = $2`;
      const { rows } = await reader.query<GroupRow>(
        `SELECT ${GROUP} FROM ${GROUP_FROM}
          WHERE g.tenant_id = $1 AND g.deleted_at IS NULL${where} GROUP BY g.id ORDER BY g.created_at`,
        filter === undefined ? [tenant] : [tenant, filter.value],
      );
      return rows.map(groupOf);
    },
    group: async (tenant: string, id: string) => oneGroup(reader, tenant, id),
    standing: async (tenant: string, person: string) => {
      const { rows } = await reader.query<{ active: boolean; deleted: boolean; groups: string[] }>(
        `SELECT u.active, u.deleted_at IS NOT NULL AS deleted,
                coalesce(array_agg(g.external_id::text ORDER BY g.external_id)
                  FILTER (WHERE g.id IS NOT NULL), '{}') AS groups
           FROM dsor.scim_users u
           LEFT JOIN dsor.scim_members m ON m.user_id = u.id AND m.removed_at IS NULL
           LEFT JOIN dsor.scim_groups g ON g.id = m.group_id AND g.deleted_at IS NULL
          WHERE u.tenant_id = $1 AND u.principal_id = $2
          GROUP BY u.id ORDER BY u.deleted_at DESC NULLS FIRST LIMIT 1`,
        [tenant, person],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      if (row.deleted) return { status: "deprovisioned" as const, groups: [] };
      return {
        status: row.active ? ("active" as const) : ("suspended" as const),
        groups: row.groups,
      };
    },
    personOf: async (tenant: string, external_id: string) => {
      const { rows } = await reader.query<{ principal_id: string }>(
        `SELECT principal_id FROM dsor.scim_users
          WHERE tenant_id = $1 AND external_id::text = $2 AND deleted_at IS NULL`,
        [tenant, external_id],
      );
      return rows[0]?.principal_id;
    },
    companiesOf: async (person: string) => {
      const { rows } = await reader.query<{ tenant_id: string }>(
        "SELECT DISTINCT tenant_id FROM dsor.scim_users WHERE principal_id = $1 ORDER BY tenant_id",
        [person],
      );
      return rows.map((r) => r.tenant_id);
    },
    tenantsOf: async (person: string) => {
      const { rows } = await reader.query<{ tenant_id: string }>(
        `SELECT DISTINCT tenant_id FROM dsor.scim_users
          WHERE principal_id = $1 AND deleted_at IS NULL ORDER BY tenant_id`,
        [person],
      );
      return rows.map((r) => r.tenant_id);
    },
  });
}

/** The directory credentials, in dsor.directory_clients: dsor_runtime only reads them (D3). */
export function createDbClients(pool: pg.Pool): DirectoryClients {
  return {
    tenantOf: async (hash) => {
      const { rows } = await pool.query<{ company: string }>(
        "SELECT company FROM dsor.directory_clients WHERE token_hash = $1 AND ended_at IS NULL",
        [hash],
      );
      return rows[0]?.company;
    },
  };
}

/**
 * When DSoR last heard from each company's directory, from the audit, by the database's clock: the age
 * of the latest ALLOW record of the directory's login that succeeded (changed by the real run of
 * 2026-10-26: a push refused in its work is an ALLOW record too), and DSoR's time is now less that age, so two
 * clocks never disagree about how old the copy is. Read as dsor_runtime, inside a transaction that
 * sets the company, so row-level security shows that company's records only (decision D2).
 */
export function createDbHeard(pool: pg.Pool): Heard {
  return async (tenant) => inCompany(pool, tenant, (client) => heardOn(client, tenant));
}

/**
 * The same, on a claim's own connection, whose transaction has set the claim's company already. A
 * second connection inside a claim starves the pool (step 43b's README, "Found while building"). For
 * any other company, row-level security shows nothing, which is "never heard": refused, never let
 * through.
 */
export function heardThrough(client: pg.ClientBase): Heard {
  return async (tenant) => heardOn(client, tenant);
}

async function heardOn(client: pg.ClientBase, tenant: string): Promise<number | undefined> {
  const { rows } = await client.query<{ ms: number | null }>(
    `SELECT extract(epoch FROM clock_timestamp() - max(at)) * 1000 AS ms
       FROM dsor.audit
      WHERE tenant = $1 AND "authorization" = 'ALLOW' AND result = 'ok'
        AND correlation->>'principal_id' = $2`,
    [tenant, directoryLoginOf(tenant)],
  );
  const ms = rows[0]?.ms;
  return ms === null || ms === undefined ? undefined : Date.now() - Number(ms);
}
