// Step 43b: the table of people on PostgreSQL (migration 049). Line ① and the five commands read and
// write dsor.people and dsor.role_grants; the database holds the rules too: a grant is confirmed by
// someone else, once; each company writes only its own rows; a grant, an invitation, and a link
// name only an active person of their company. Each test works on fresh people, so the story's are
// as the migration wrote them (step 43b's README, claims C1, C3 to C8).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { hashOf, newCode } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { createDbBook, createDbLog, createDbPeople } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { dbRegistry, newPool, tryThenRollBack } from "./db.ts";
import { keyed, withPlanted } from "./helpers.ts";

const pool = newPool();
afterAll(async () => {
  await pool.end();
});

const people = createDbPeople(pool);
const OWNER = { person: "owner", reason: "a step 43b database test" };
const ADMIN: RequestEnvelope = { token: "tok_a100", tenant: "org_456" };
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** A person no test has used, with a planted login of their own. */
function fresh(): { id: string; token: string } {
  const id = `p_${randomUUID().slice(0, 8)}`;
  return { id, token: `tok_${id}` };
}

/** A person of org_456 holding these roles, as the owner's rows would give them. */
function personWith(id: string, roles: string[], tenant = "org_456"): Principal {
  return { id, type: "human", memberships: [{ tenant_id: tenant, roles }] };
}

/** A call over the database, with the table of people the program reads. */
function ask(who: RequestEnvelope, name: string, input: unknown): Promise<Answer> {
  return call(dbRegistry(pool), createDbLog(pool), who, name, input);
}

/** The data of a committed answer. */
function dataOf(answer: Answer): Record<string, unknown> {
  expect(answer).toMatchObject({ outcome: "COMMITTED" });
  return (answer as { data: Record<string, unknown> }).data;
}

describe("C1 on PostgreSQL: line ① reads the table", () => {
  it("DSOR-IDN-01: the story's people are the migration's first rows: cfo_100 is CFO of org_456 in dsor.people", async () => {
    expect(await people.memberOf("org_456", "cfo_100")).toStrictEqual({
      status: "active",
      roles: ["CFO"],
    });
    expect(await people.membershipsOf("admin_700")).toStrictEqual([
      { tenant_id: "org_789", roles: ["tenant_admin"] },
    ]);
  });

  it("DSOR-IDN-01: a person with ap_clerk in the table reads INV-1008; once role.revoke ends it, they are refused", async () => {
    const p = fresh();
    const who = { token: p.token, tenant: "org_456" };
    await withPlanted(
      p.token,
      personWith(p.id, ["ap_clerk"]),
      async () => {
        expect(await ask(who, "invoice.get", INV_1008)).toMatchObject({ data: { id: "INV-1008" } });
        const revoked = await ask(keyed(ADMIN), "role.revoke", {
          person: `dsor://org_456/person/${p.id}`,
          role: "ap_clerk",
          reason: "moved",
        });
        expect(dataOf(revoked)).toStrictEqual({ person: p.id, role: "ap_clerk", ended: 1 });
        expect(await ask(who, "invoice.get", INV_1008)).toMatchObject({
          code: "AUTHORIZATION_DENIED",
        });
      },
      people,
    );
  });
});

describe("C3 to C6 on PostgreSQL: the commands, inside their claims", () => {
  it("Step 43b, C3: admin_100 adds a person over the database, who then has no role", async () => {
    const p = fresh();
    const added = await ask(keyed(ADMIN), "person.add", {
      person: `dsor://org_456/person/${p.id}`,
      reason: "new hire",
    });
    expect(dataOf(added)).toStrictEqual({ person: p.id, status: "active" });
    expect(await people.memberOf("org_456", p.id)).toStrictEqual({ status: "active", roles: [] });
  });

  it("DSOR-SOD-04c: a CFO grant waits; its asker cannot confirm it; a second administrator does, and it counts", async () => {
    const p = fresh();
    const second = fresh();
    await people.add("org_456", p.id, OWNER);
    await withPlanted(
      second.token,
      personWith(second.id, ["tenant_admin"]),
      async () => {
        const asked = dataOf(
          await ask(keyed(ADMIN), "role.grant", {
            person: `dsor://org_456/person/${p.id}`,
            role: "CFO",
            reason: "promoted",
          }),
        );
        expect(asked).toMatchObject({ person: p.id, role: "CFO", state: "pending" });
        expect((await people.memberOf("org_456", p.id))?.roles).toStrictEqual([]);
        expect(
          await ask(keyed(ADMIN), "role.confirm", { grant: asked["grant"], reason: "me" }),
        ).toMatchObject({
          code: "SOD_VIOLATION",
        });
        const confirmed = await ask(
          keyed({ token: second.token, tenant: "org_456" }),
          "role.confirm",
          {
            grant: asked["grant"],
            reason: "agreed",
          },
        );
        expect(dataOf(confirmed)).toMatchObject({ state: "active" });
        expect((await people.memberOf("org_456", p.id))?.roles).toStrictEqual(["CFO"]);
      },
      people,
    );
  });

  it("DSOR-SOD-04c: two administrators confirm one grant at the same moment: one confirms it, the other hears CONFLICT", async () => {
    const p = fresh();
    const [b, c] = [fresh(), fresh()];
    await people.add("org_456", p.id, OWNER);
    const grant = await people.grant("org_456", p.id, "CFO", true, OWNER);
    const confirmBy = (id: string) =>
      people.confirm("org_456", grant.id, { person: id, reason: "race" });
    const both = await Promise.allSettled([confirmBy(b.id), confirmBy(c.id)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      both
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason.code),
    ).toStrictEqual(["CONFLICT"]);
  });

  it("DSOR-IDN-07: person.remove over the database: the person's next call is no caller, and their roles have ended", async () => {
    const p = fresh();
    const who = { token: p.token, tenant: "org_456" };
    await withPlanted(
      p.token,
      personWith(p.id, ["ap_clerk"]),
      async () => {
        const removed = await ask(keyed(ADMIN), "person.remove", {
          person: `dsor://org_456/person/${p.id}`,
          reason: "left the company",
        });
        expect(dataOf(removed)).toStrictEqual({ person: p.id, status: "deprovisioned", roles: 1 });
        expect(await ask(who, "invoice.get", INV_1008)).toMatchObject({
          code: "AUTHENTICATION_REQUIRED",
        });
        expect(await people.memberOf("org_456", p.id)).toStrictEqual({
          status: "deprovisioned",
          roles: [],
        });
      },
      people,
    );
  });
});

describe("From the review of step 43b, findings 1 and 4, on PostgreSQL", () => {
  it("Step 43b, the review's finding 4: a grant and a removal at the same moment, twenty times: never a live grant for a removed person", async () => {
    for (let i = 0; i < 20; i += 1) {
      const p = fresh();
      await people.add("org_456", p.id, OWNER);
      await Promise.allSettled([
        people.grant("org_456", p.id, "ap_clerk", false, OWNER),
        people.remove("org_456", p.id, OWNER),
      ]);
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM dsor.role_grants g JOIN dsor.people p
            ON p.tenant_id = g.tenant_id AND p.principal_id = g.principal_id
         WHERE g.principal_id = $1 AND g.ended_at IS NULL AND p.removed_at IS NOT NULL`,
        [p.id],
      );
      expect(rows[0].n).toBe(0);
    }
  });

  it("DSOR-IDN-03a: one new id added by two administrators to org_456 and org_789 at the same moment, ten times: always one company (the code review of step 43b, finding 3)", async () => {
    for (let i = 0; i < 10; i += 1) {
      const p = fresh();
      const both = await Promise.allSettled([
        people.add("org_456", p.id, OWNER, true),
        people.add("org_789", p.id, OWNER, true),
      ]);
      expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await people.companiesOf(p.id)).toHaveLength(1);
    }
  });

  it("DSOR-IDN-03a: org_789's unlink of a person in both companies ends no login that org_456's invitation made", async () => {
    const p = fresh();
    await people.add("org_456", p.id, OWNER);
    await people.add("org_789", p.id, OWNER);
    const book = createDbBook(pool);
    const { code } = await book.invite("org_456", p.id, { person: "admin_100", reason: "x" });
    const login = { issuer: "http://127.0.0.1:8043", subject: `ba_${p.id}` };
    expect(await book.redeem("org_456", code, login)).toBe(p.id);
    expect(await book.unlink("org_789", p.id, { person: "admin_700", reason: "x" })).toMatchObject({
      logins: 0,
    });
    expect(await book.principalOf(login.issuer, login.subject)).toBe(p.id);
  });
});

describe("C8: what dsor_runtime may do to the two tables", () => {
  it.each([
    [
      "moving a grant to another role",
      "UPDATE dsor.role_grants SET role = 'CFO'",
      /permission denied/,
    ],
    [
      "naming a grant's end date",
      "UPDATE dsor.role_grants SET expires_at = now() + interval '1 year'",
      /permission denied/,
    ],
    ["deleting a grant", "DELETE FROM dsor.role_grants", /permission denied/],
    [
      "moving a person to another id",
      "UPDATE dsor.people SET principal_id = 'cfo_100'",
      /permission denied/,
    ],
    ["deleting a person", "DELETE FROM dsor.people", /permission denied/],
    [
      "a grant to someone who is no person of org_456",
      "INSERT INTO dsor.role_grants (id, tenant_id, principal_id, role, asked_by, reason, needs_confirm) VALUES ('grt_00000000-0000-4000-8000-000000000001', 'org_456', 'user_700', 'CFO', 'admin_100', 'x', false)",
      /a role is granted only to an active person of its company/,
    ],
    [
      "a person written into org_456 while the company is org_789",
      "INSERT INTO dsor.people (tenant_id, principal_id, added_by, reason) VALUES ('org_456', 'p_sneak', 'admin_700', 'x')",
      /row-level security/,
    ],
    [
      "an invitation for someone who is no person of org_456",
      `INSERT INTO dsor.invitations (tenant_id, id, principal_id, code_hash, invited_by, reason) VALUES ('org_456', 'inv_00000000-0000-4000-8000-000000000001', 'user_700', '${hashOf(newCode())}', 'admin_100', 'x')`,
      /an invitation names an active person of its company/,
    ],
  ])("Step 43b, C8: dsor_runtime is refused %s", async (what, sql, refused) => {
    const company = what.includes("org_789") ? "org_789" : "org_456";
    await expect(tryThenRollBack(pool, sql, company)).rejects.toThrow(refused);
  });

  it.each([
    ["by the administrator who asked", (g: { asked: string; person: string }) => g.asked],
    ["by the person it names", (g: { asked: string; person: string }) => g.person],
  ])("Step 43b, D3: dsor_runtime is refused a confirm %s", async (_who, by) => {
    const p = fresh();
    await people.add("org_456", p.id, OWNER);
    const grant = await people.grant("org_456", p.id, "CFO", true, {
      person: "admin_100",
      reason: "x",
    });
    const confirmer = by({ asked: "admin_100", person: p.id });
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.role_grants SET confirmed_by = $2 WHERE id = $1",
        "org_456",
        [grant.id, confirmer],
      ),
    ).rejects.toThrow(/a grant is confirmed by someone who neither asked nor gets the role/);
  });

  it("Step 43b, C8: a grant ended once moves no more, and a confirmed grant is not confirmed again", async () => {
    const p = fresh();
    await people.add("org_456", p.id, OWNER);
    const grant = await people.grant("org_456", p.id, "CFO", true, OWNER);
    await people.confirm("org_456", grant.id, { person: "admin_100", reason: "x" });
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.role_grants SET confirmed_by = 'user_123' WHERE id = $1",
        "org_456",
        [grant.id],
      ),
    ).rejects.toThrow(/a grant is confirmed once, while it waits/);
    await people.revoke("org_456", p.id, "CFO", OWNER);
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.role_grants SET ended_by = 'user_123' WHERE id = $1",
        "org_456",
        [grant.id],
      ),
    ).rejects.toThrow(/an ended grant moves no more/);
  });

  it("Step 43b, the review of step 43's revisions, R-M2: a link for a person removed from the invitation's company is refused", async () => {
    const p = fresh();
    await people.add("org_456", p.id, OWNER);
    const client = await pool.connect();
    const id = `inv_${randomUUID()}`;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query(
        `INSERT INTO dsor.invitations (tenant_id, id, principal_id, code_hash, invited_by, reason)
         VALUES ('org_456', $1, $2, $3, 'admin_100', 'x')`,
        [id, p.id, hashOf(newCode())],
      );
      await client.query(
        "UPDATE dsor.invitations SET accepted_issuer = 'http://127.0.0.1:8043', accepted_subject = 'ba_gone' WHERE id = $1",
        [id],
      );
      await client.query(
        "UPDATE dsor.people SET removed_by = 'admin_100' WHERE tenant_id = 'org_456' AND principal_id = $1",
        [p.id],
      );
      await expect(
        client.query(
          "INSERT INTO dsor.logins (issuer, subject, principal_id, invitation_id) VALUES ('http://127.0.0.1:8043', 'ba_gone', $1, $2)",
          [p.id, id],
        ),
      ).rejects.toThrow(/a login is linked only by an invitation it accepted/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("C7: the owner's pnpm grant", () => {
  /** Runs pnpm grant as the owner, and gives its exit code and what it printed. */
  function grant(...words: string[]): { status: number | null; out: string } {
    const program = fileURLToPath(new URL("../src/grant.ts", import.meta.url));
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const run = spawnSync(process.execPath, [program, ...words], {
      encoding: "utf8",
      cwd,
      timeout: 60_000,
    });
    return { status: run.status, out: `${run.stdout}${run.stderr}`.trim() };
  }

  it("Step 43b, L3: with admin_700 alone, pnpm grant makes a person of org_789 its second administrator, once; then it is refused", async () => {
    const p = fresh();
    await people.add("org_789", p.id, { person: "owner", reason: "x" });
    try {
      expect(grant("org_789", p.id, "tenant_admin", "the second administrator")).toStrictEqual({
        status: 0,
        out: `granted tenant_admin to ${p.id} in org_789`,
      });
      expect((await people.memberOf("org_789", p.id))?.roles).toStrictEqual(["tenant_admin"]);
      const other = fresh();
      await people.add("org_789", other.id, { person: "owner", reason: "x" });
      expect(grant("org_789", other.id, "tenant_admin", "a third")).toStrictEqual({
        status: 1,
        out: "org_789 has two administrators already: ask them, with role.grant and role.confirm",
      });
    } finally {
      // Back to admin_700 alone, so the next run of this suite starts where this one did.
      await people.revoke("org_789", p.id, "tenant_admin", {
        person: "owner",
        reason: "the test ends",
      });
    }
  });

  it.each([
    [
      ["org_789", "user_700", "CFO", "x"],
      "pnpm grant gives tenant_admin only: every other role is role.grant's",
    ],
    [["org_789", "cfo_999", "tenant_admin", "x"], "cfo_999 is no person of org_789"],
    [["org_789", "user_700"], "use: pnpm grant <company> <person> tenant_admin <reason>"],
  ])("Step 43b, L3: pnpm grant %j is refused", (words, message) => {
    expect(grant(...words)).toStrictEqual({ status: 1, out: message });
  });
});
