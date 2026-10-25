// Step 43c: the copy of a company's directory on PostgreSQL (migration 050). A push over the database
// is read by line ① through the map; when DSoR last heard is read from the audit; and the database
// holds the rules too: each company writes only its own rows, a user's ids never change, an id
// another company has is taken, a member is a live user, and only the owner makes a credential.
// Every test works on fresh ids, so a second run finds nothing of the first in its way (step 43c's
// README, claims C3, C5, C7, and C8, decisions D2, D3, and D6).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkRoleSettings, readRoleSettings, SCIM_ROLE_SOURCES } from "../src/authority.ts";
import { companyPeople } from "../src/company-people.ts";
import type { Answer } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { checkRoles } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import {
  createDbClaims,
  createDbInvoices,
  createDbLog,
  createDbPayments,
  createDbPeople,
  createDbSlips,
} from "../src/postgres.ts";
import { createDbClients, createDbCopy, createDbHeard } from "../src/postgres-copy.ts";
import { logins } from "../src/principals.ts";
import { buildRegistry, type Registry } from "../src/registry.ts";
import { ownWorkFor } from "../src/revocation.ts";
import { checkRoleMaps, type RoleMapsSource } from "../src/role-maps.ts";
import { scimDoorOver } from "../src/scim-door.ts";
import { listen } from "../src/server.ts";
import { tokenHash } from "../src/directory-clients.ts";
import { newPool, tryThenRollBack } from "./db.ts";
import { keyed, shipped, shippedInputs, shippedLabels, shippedRoles } from "./helpers.ts";

const pool = newPool();
afterAll(async () => {
  await pool.end();
});

const DIRECTORY_456 = { token: "tok_5c1a", tenant: "org_456" };
const HERE = fileURLToPath(new URL("..", import.meta.url));
const SCIM = readRoleSettings(SCIM_ROLE_SOURCES);
const settings = checkRoleSettings(SCIM, logins.values()).settings;

// A group of this run's own, so a second run of the suite never meets the first one's group.
const FINANCE = randomUUID();
const MAPS: RoleMapsSource = {
  file: "role-maps.json",
  text: JSON.stringify({ org_456: [{ group: FINANCE, name: "Finance-Approvers", role: "CFO" }] }),
};
const maps = checkRoleMaps(MAPS, settings, checkRoles(shippedRoles, logins.values()).roles).maps;

/** The program's registry over the database, with org_456 on its directory and this run's map. */
function scimRegistry(): Registry {
  const people = companyPeople(createDbPeople(pool), createDbCopy(pool), {
    settings,
    maps,
    heard: createDbHeard(pool),
  });
  return buildRegistry(
    shipped,
    handlersFor(),
    shippedRoles,
    shippedInputs,
    shippedLabels,
    createDbInvoices(pool),
    createDbPayments(pool),
    createDbSlips(pool),
    undefined,
    SCIM,
    createDbClaims(pool, undefined, { settings, maps }),
    ownWorkFor(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    people,
    MAPS,
  );
}

const registry = scimRegistry();
const company = "dsor://org_456/tenant/org_456";
const push = (change: Record<string, unknown>): Promise<Answer> =>
  call(registry, createDbLog(pool), keyed(DIRECTORY_456), "directory.push", { company, change });

/** A fresh person's username and uuid. */
function fresh(): { name: string; uuid: string } {
  return { name: `s_${randomUUID().slice(0, 8)}`, uuid: randomUUID() };
}

/** The data of a committed answer. */
function dataOf(answer: Answer): Record<string, unknown> {
  expect(answer).toMatchObject({ outcome: "COMMITTED" });
  return (answer as { data: Record<string, unknown> }).data;
}

describe("Step 43c, C8: the copy on PostgreSQL, read by line ① through the map", () => {
  it("DSOR-IDN-05: org_456's directory pushes a user and a group with her; DSoR's people store then reads her as its CFO", async () => {
    const p = fresh();
    const user = dataOf(
      await push({
        kind: "user.create",
        account: { user_name: p.name, external_id: p.uuid, active: true },
      }),
    );
    const group = dataOf(
      await push({
        kind: "group.create",
        group: { name: "Finance-Approvers", external_id: FINANCE, members: [user["id"]] },
      }),
    );
    expect(group["members"]).toStrictEqual([{ id: user["id"] }]);
    expect(await registry.people.memberOf("org_456", p.name)).toStrictEqual({
      status: "active",
      roles: ["CFO"],
    });
    // Out of the group, and then deleted: the change is what line ① reads next.
    dataOf(await push({ kind: "group.change", id: group["id"], add: [], remove: [user["id"]] }));
    expect((await registry.people.memberOf("org_456", p.name))?.roles).toStrictEqual([]);
    dataOf(await push({ kind: "user.delete", id: user["id"] }));
    expect((await registry.people.memberOf("org_456", p.name))?.status).toBe("deprovisioned");
  });

  it("DSOR-IDN-06: decision D2: when DSoR last heard from org_456's directory is read from the audit, by the database's clock", async () => {
    const p = fresh();
    dataOf(
      await push({
        kind: "user.create",
        account: { user_name: p.name, external_id: p.uuid, active: true },
      }),
    );
    const heard = createDbHeard(pool);
    const at = await heard("org_456");
    expect(at).toBeDefined();
    expect(Date.now() - (at as number)).toBeLessThan(60_000);
    // A company whose directory never spoke has no time at all.
    expect(await heard("org_999")).toBeUndefined();
  });

  // From the real run of 2026-10-26: pushes that all failed kept an empty copy "current".
  it("DSOR-IDN-06: decision D2: a push refused in its work leaves when DSoR last heard where it was", async () => {
    const p = fresh();
    dataOf(
      await push({
        kind: "user.create",
        account: { user_name: p.name, external_id: p.uuid, active: true },
      }),
    );
    const heard = createDbHeard(pool);
    const before = (await heard("org_456")) as number;
    expect(
      await push({
        kind: "group.create",
        group: { name: "x", external_id: randomUUID(), members: [randomUUID()] },
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    const after = (await heard("org_456")) as number;
    // The same moment, the successful push's, give or take the two clocks' reading.
    expect(Math.abs(after - before)).toBeLessThan(250);
  });

  it("DSOR-IDN-03a: an id DSoR's table gives a person of org_789 is taken for org_456's directory", async () => {
    expect(
      await push({
        kind: "user.create",
        account: { user_name: "admin_700", external_id: randomUUID(), active: true },
      }),
    ).toMatchObject({ code: "CONFLICT", message: "the id admin_700 is taken: choose another" });
  });
});

describe("Step 43c, C8: the database's own rules on the copy", () => {
  it("DSOR-TEN-02b: dsor_runtime cannot add a user to org_789's copy inside org_456", async () => {
    await expect(
      tryThenRollBack(
        pool,
        `INSERT INTO dsor.scim_users (tenant_id, external_id, principal_id, user_name, active)
         VALUES ('org_789', $1, $2, $2, true)`,
        "org_456",
        [randomUUID(), fresh().name],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("DSOR-IDN-03a: the database refuses an id another company's table has, when the program forgets to ask", async () => {
    await expect(
      tryThenRollBack(
        pool,
        `INSERT INTO dsor.scim_users (tenant_id, external_id, principal_id, user_name, active)
         VALUES ('org_789', $1, 'cfo_100', 'cfo_100', true)`,
        "org_789",
        [randomUUID()],
      ),
    ).rejects.toThrow("the id cfo_100 is taken");
  });

  it.each(["principal_id", "external_id", "tenant_id"])(
    "DSOR-IDN-05: the learner's L5: dsor_runtime may never change a user's %s",
    async (column) => {
      await expect(
        tryThenRollBack(pool, `UPDATE dsor.scim_users SET ${column} = ${column}`, "org_456"),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it("DSOR-IDN-07: a deleted user changes no more, and joins no group", async () => {
    const p = fresh();
    const user = dataOf(
      await push({
        kind: "user.create",
        account: { user_name: p.name, external_id: p.uuid, active: true },
      }),
    );
    dataOf(await push({ kind: "user.delete", id: user["id"] }));
    await expect(
      tryThenRollBack(pool, "UPDATE dsor.scim_users SET active = true WHERE id = $1", "org_456", [
        user["id"],
      ]),
    ).rejects.toThrow("a deleted user changes no more");
    const group = dataOf(
      await push({
        kind: "group.create",
        group: { name: "Anyone", external_id: randomUUID(), members: [] },
      }),
    );
    await expect(
      tryThenRollBack(
        pool,
        "INSERT INTO dsor.scim_members (tenant_id, group_id, user_id) VALUES ('org_456', $1, $2)",
        "org_456",
        [group["id"], user["id"]],
      ),
    ).rejects.toThrow("a member joins a live group as a live user");
  });

  it("DSOR-IDN-04a: decision D3: dsor_runtime cannot make a directory's credential", async () => {
    await expect(
      tryThenRollBack(
        pool,
        "INSERT INTO dsor.directory_clients (token_hash, company) VALUES ($1, 'org_456')",
        undefined,
        ["a".repeat(64)],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("DSOR-AUD-04a: no kind of table lets dsor_runtime delete a row of the copy", async () => {
    for (const table of ["scim_users", "scim_groups", "scim_members", "directory_clients"]) {
      await expect(tryThenRollBack(pool, `DELETE FROM dsor.${table}`, "org_456")).rejects.toThrow(
        /permission denied/,
      );
    }
  });
});

describe("Step 43c, C2 and C7: the owner's programs", () => {
  /** Runs one of the owner's programs, with org_456 on its directory, and gives its exit and its words. */
  function owner(program: string, ...words: string[]): { status: number | null; out: string } {
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../src/${program}`, import.meta.url)), ...words],
      {
        encoding: "utf8",
        cwd: HERE,
        timeout: 60_000,
        env: { ...process.env, DSOR_ROLE_SOURCES_FILE: SCIM_ROLE_SOURCES },
      },
    );
    return { status: run.status, out: `${run.stdout}${run.stderr}`.trim() };
  }

  it("DSOR-IDN-04a: decision D3: pnpm directory-token org_456 shows a token once, which names org_456; a second run ends the first", async () => {
    const clients = createDbClients(pool);
    const first = owner("directory-token.ts", "org_456");
    expect(first.status).toBe(0);
    const token1 = first.out.split("\n").at(-1) as string;
    expect(token1).toMatch(/^[0-9a-f]{48}$/);
    expect(await clients.tenantOf(tokenHash(token1))).toBe("org_456");
    const second = owner("directory-token.ts", "org_456");
    const token2 = second.out.split("\n").at(-1) as string;
    expect(await clients.tenantOf(tokenHash(token2))).toBe("org_456");
    expect(await clients.tenantOf(tokenHash(token1))).toBeUndefined();
  });

  it("DSOR-IDN-05: the learner's L10: pnpm directory-token org_789 is refused: org_789 is on DSoR's own table", () => {
    expect(owner("directory-token.ts", "org_789")).toStrictEqual({
      status: 1,
      out: "org_789's role source is dsor_assignments, not scim: its people are DSoR's table's",
    });
  });

  it("DSOR-IDN-05: the learner's L10: pnpm grant into org_456, on its directory, is refused", () => {
    expect(owner("grant.ts", "org_456", "user_123", "tenant_admin", "x")).toStrictEqual({
      status: 1,
      out: "org_456's people come from its own directory: change them there",
    });
  });

  it("DSOR-EXE-02: the SCIM door over the database: the owner's token pushes a user into org_456, recorded by its directory login", async () => {
    const made = owner("directory-token.ts", "org_456");
    const token = made.out.split("\n").at(-1) as string;
    const log = createDbLog(pool);
    const server = scimDoorOver(registry, log, createDbClients(pool));
    const port = await listen(server, "127.0.0.1", 0);
    try {
      const p = fresh();
      const body = JSON.stringify({ userName: p.name, externalId: p.uuid, active: true });
      const status = await new Promise<number>((done, fail) => {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            path: "/scim/v2/Users",
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
          },
          (res) => {
            res.resume();
            res.on("end", () => done(res.statusCode ?? 0));
          },
        );
        req.on("error", fail);
        req.end(body);
      });
      expect(status).toBe(201);
      expect((await registry.people.memberOf("org_456", p.name))?.status).toBe("active");
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});
