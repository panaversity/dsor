// Step 43, revised by the learner: the book of links and invitations on PostgreSQL (migration 048).
// An invitation is a company's row; its code's hash links the first login that presents it, once,
// within seven days of the database's clock. A link is kept when it ends, so the table is the
// history of who was whom. dsor_runtime adds a link only through an accepted invitation, and ends
// it once (DSOR-IDN-01; step 43's README, revisions R1, R2, R3, and R7).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { hashOf, newCode, realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { createDbBook, createDbLog, requireEnv } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { remoteKeys, type Login } from "../src/tokens.ts";
import { dbRegistry, newPool, tryThenRollBack } from "./db.ts";
import { keyed } from "./helpers.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";

const pool = newPool();
const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
let a: TestIssuer;
let issuersFile: string;
beforeAll(async () => {
  a = await startIssuer();
  const one = [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks, dedicated_to_dsor: true }];
  issuersFile = join(mkdtempSync(join(tmpdir(), "dsor43-")), "issuers.json");
  writeFileSync(issuersFile, JSON.stringify({ org_456: one, org_789: one }));
});
afterAll(async () => {
  await a.close();
  await pool.end();
  await owner.end();
});

const BY = { person: "admin_100", reason: "a step 43 database test" };

// A person has one live login (the review's finding 1), and the tests share one database, so each
//   starts with every person of the story unlinked.
const PEOPLE = [
  ["org_456", "cfo_100"],
  ["org_456", "user_123"],
  ["org_456", "admin_100"],
  ["org_789", "user_700"],
  ["org_789", "admin_700"],
];
beforeEach(async () => {
  const book = createDbBook(pool);
  for (const [tenant, person] of PEOPLE) await book.unlink(tenant as string, person as string, BY);
});
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The registry over the database, with real logins read from the database's book. */
function world() {
  const book = createDbBook(pool);
  const issuers = new Map([
    ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ["org_789", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
  ]);
  const registry = { ...dbRegistry(pool), logins: realLogins(issuers, book, remoteKeys()) };
  const log = createDbLog(pool);
  // A read, so no idempotency key.
  const ask = (who: RequestEnvelope): Promise<Answer> =>
    call(registry, log, who, "invoice.get", INV_1008);
  return { book, ask };
}

/** A new login of the test's issuer, never seen before. */
function aLogin(): Login {
  return { issuer: a.issuer, subject: `ba_${randomUUID()}` };
}

describe("R1 on PostgreSQL: a code links a login once", () => {
  it("DSOR-IDN-01: invited as cfo_100, a new login's first call with the code reads INV-1008 as cfo_100, and so does the next", async () => {
    const { book, ask } = world();
    const { invitation, code } = await book.invite("org_456", "cfo_100", BY);
    const subject = `ba_${randomUUID()}`;
    const token = await a.sign(subject);
    expect(await ask({ token, tenant: "org_456", invitation: code })).toMatchObject({
      data: { id: "INV-1008" },
      correlation: { principal_id: "cfo_100" },
    });
    expect(await ask({ token, tenant: "org_456" })).toMatchObject({
      correlation: { principal_id: "cfo_100" },
    });
    const { rows } = await owner.query(
      `SELECT i.principal_id, i.code_hash, i.accepted_issuer, i.accepted_subject, l.invitation_id
         FROM dsor.invitations i JOIN dsor.logins l ON l.invitation_id = i.id WHERE i.id = $1`,
      [invitation.id],
    );
    expect(rows).toStrictEqual([
      {
        principal_id: "cfo_100",
        code_hash: hashOf(code),
        accepted_issuer: a.issuer,
        accepted_subject: subject,
        invitation_id: invitation.id,
      },
    ]);
  });

  it("Step 43, R1: a code works once: a second login with it is no caller", async () => {
    const { book, ask } = world();
    const { code } = await book.invite("org_456", "cfo_100", BY);
    await ask({ token: await a.sign(`ba_${randomUUID()}`), tenant: "org_456", invitation: code });
    const second = await ask({
      token: await a.sign(`ba_${randomUUID()}`),
      tenant: "org_456",
      invitation: code,
    });
    expect(second).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("Step 43, R1: two logins that send one code at once: one is linked, the other is no caller", async () => {
    const book = createDbBook(pool);
    const { code } = await book.invite("org_456", "cfo_100", BY);
    const won = await Promise.all(
      Array.from({ length: 6 }, () => book.redeem("org_456", code, aLogin())),
    );
    expect(won.filter((person) => person === "cfo_100")).toHaveLength(1);
    expect(won.filter((person) => person === undefined)).toHaveLength(5);
  });

  it("Step 43, R2: one login that sends two codes at once is linked once", async () => {
    const book = createDbBook(pool);
    const login = aLogin();
    const one = await book.invite("org_456", "cfo_100", BY);
    const two = await book.invite("org_456", "user_123", BY);
    const won = await Promise.all([
      book.redeem("org_456", one.code, login),
      book.redeem("org_456", two.code, login),
    ]);
    expect(won.filter((person) => person !== undefined)).toHaveLength(1);
    const { rows } = await owner.query(
      "SELECT count(*)::int AS n FROM dsor.logins WHERE issuer = $1 AND subject = $2",
      [login.issuer, login.subject],
    );
    expect(rows[0].n).toBe(1);
    // And the code that lost stays open: its acceptance was undone with the link that failed.
    const open = await owner.query(
      "SELECT count(*)::int AS n FROM dsor.invitations WHERE id = ANY($1) AND accepted_at IS NULL",
      [[one.invitation.id, two.invitation.id]],
    );
    expect(open.rows[0].n).toBe(1);
  });

  it("Step 43, R1: a code past its seven days, by the database's clock, links nothing", async () => {
    const code = newCode();
    const id = `inv_${randomUUID()}`;
    // The owner writes the past: dsor_runtime cannot name an end date at all.
    await inCompanyAsOwner("org_456", (c) =>
      c.query(
        `INSERT INTO dsor.invitations (tenant_id, id, principal_id, code_hash, invited_by, reason, expires_at)
         VALUES ('org_456', $1, 'cfo_100', $2, 'admin_100', 'old', now() - interval '1 second')`,
        [id, hashOf(code)],
      ),
    );
    expect(await createDbBook(pool).redeem("org_456", code, aLogin())).toBeUndefined();
  });

  it("Step 43, R1: org_456's code, sent with org_789 as the company, links nothing", async () => {
    const book = createDbBook(pool);
    const { code } = await book.invite("org_456", "cfo_100", BY);
    expect(await book.redeem("org_789", code, aLogin())).toBeUndefined();
    expect(await book.redeem("org_456", code, aLogin())).toBe("cfo_100");
  });
});

describe("From the review of R1 to R7, finding 1, on PostgreSQL: one live login for each person", () => {
  it("Step 43, the review's finding 1: the book refuses to invite a person who has a login", async () => {
    const book = createDbBook(pool);
    await book.redeem("org_456", (await book.invite("org_456", "user_123", BY)).code, aLogin());
    await expect(book.invite("org_456", "user_123", BY)).rejects.toThrow(
      "user_123 has a login already: unlink it first",
    );
  });

  it("Step 43, the review's finding 1: two logins with two codes of one person at once: one is linked, and the other code stays open", async () => {
    const book = createDbBook(pool);
    const one = await book.invite("org_456", "cfo_100", BY);
    const two = await book.invite("org_456", "cfo_100", BY);
    const won = await Promise.all([
      book.redeem("org_456", one.code, aLogin()),
      book.redeem("org_456", two.code, aLogin()),
    ]);
    expect(won.filter((person) => person === "cfo_100")).toHaveLength(1);
    const { rows } = await owner.query(
      "SELECT count(*)::int AS n FROM dsor.invitations WHERE id = ANY($1) AND accepted_at IS NULL",
      [[one.invitation.id, two.invitation.id]],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("R7 on PostgreSQL: unlinking is the off-switch, and is kept", () => {
  it("DSOR-IDN-01: once cfo_100 is unlinked, her next call is no caller, her open invitation is cancelled, and her old link is kept", async () => {
    const { book, ask } = world();
    const subject = `ba_${randomUUID()}`;
    const token = await a.sign(subject);
    const { code } = await book.invite("org_456", "cfo_100", BY);
    // Changed by the review's finding 1: a linked person cannot be invited, so the spare comes first.
    const spare = await book.invite("org_456", "cfo_100", BY);
    await ask({ token, tenant: "org_456", invitation: code });
    const ended = await book.unlink("org_456", "cfo_100", BY);
    expect(ended.logins).toBeGreaterThanOrEqual(1);
    expect(ended.invitations).toBeGreaterThanOrEqual(1);
    expect(await ask({ token, tenant: "org_456" })).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(await book.redeem("org_456", spare.code, aLogin())).toBeUndefined();
    const { rows } = await owner.query(
      "SELECT principal_id, unlinked_by, unlinked_at IS NOT NULL AS ended FROM dsor.logins WHERE subject = $1",
      [subject],
    );
    expect(rows).toStrictEqual([
      { principal_id: "cfo_100", unlinked_by: "admin_100", ended: true },
    ]);
  });

  it("Step 43, R7: an unlinked login may be invited again, and joins again", async () => {
    const book = createDbBook(pool);
    const login = aLogin();
    await book.redeem("org_456", (await book.invite("org_456", "user_123", BY)).code, login);
    await book.unlink("org_456", "user_123", BY);
    const again = await book.invite("org_456", "user_123", BY);
    expect(await book.redeem("org_456", again.code, login)).toBe("user_123");
    expect(await book.principalOf(login.issuer, login.subject)).toBe("user_123");
  });
});

describe("R1 and R7: what dsor_runtime may do to the two tables", () => {
  it.each([
    [
      "a link with no invitation",
      "INSERT INTO dsor.logins (issuer, subject, principal_id) VALUES ('http://127.0.0.1:8043', 'ba_mine', 'cfo_100')",
      /a login is linked only by an invitation it accepted/,
    ],
    [
      "a link that names an invitation it did not accept",
      "INSERT INTO dsor.logins (issuer, subject, principal_id, invitation_id) VALUES ('http://127.0.0.1:8043', 'ba_mine', 'cfo_100', 'inv_00000000-0000-4000-8000-000000000000')",
      /a login is linked only by an invitation it accepted/,
    ],
    [
      "moving a link to another person",
      "UPDATE dsor.logins SET principal_id = 'user_123'",
      /permission denied/,
    ],
    ["taking back an end", "UPDATE dsor.logins SET unlinked_at = NULL", /permission denied/],
    ["deleting a link", "DELETE FROM dsor.logins", /permission denied/],
    [
      "naming an invitation's end date",
      "UPDATE dsor.invitations SET expires_at = now() + interval '1 year'",
      /permission denied/,
    ],
    [
      "changing whom an invitation invites",
      "UPDATE dsor.invitations SET principal_id = 'admin_100'",
      /permission denied/,
    ],
    ["deleting an invitation", "DELETE FROM dsor.invitations", /permission denied/],
  ])("Step 43, R1: dsor_runtime is refused %s", async (_what, sql, refused) => {
    await expect(tryThenRollBack(pool, sql, "org_456")).rejects.toThrow(refused);
  });

  // From the review of R1 to R7, finding 4: the link trigger reads the invitations under the
  //   company the transaction set, and checks the person.
  it.each([
    ["accepted in org_789, linked while the company is org_456", "org_789", "user_700", "user_700"],
    ["for user_123, linked as cfo_100", "org_456", "user_123", "cfo_100"],
  ])(
    "Step 43, the review's finding 4: dsor_runtime is refused a link to an invitation %s",
    async (_what, home, invited, linkedAs) => {
      const client = await pool.connect();
      const id = `inv_${randomUUID()}`;
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [home]);
        await client.query(
          `INSERT INTO dsor.invitations (tenant_id, id, principal_id, code_hash, invited_by, reason)
           VALUES ($1, $2, $3, $4, 'admin_100', 'x')`,
          [home, id, invited, hashOf(newCode())],
        );
        await client.query(
          "UPDATE dsor.invitations SET accepted_issuer = $2, accepted_subject = 'ba_x' WHERE id = $1",
          [id, a.issuer],
        );
        await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
        await expect(
          client.query(
            `INSERT INTO dsor.logins (issuer, subject, principal_id, invitation_id)
             VALUES ($1, 'ba_x', $2, $3)`,
            [a.issuer, linkedAs, id],
          ),
        ).rejects.toThrow(/a login is linked only by an invitation it accepted/);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );

  it("Step 43, R1: an invitation is accepted or cancelled once, never both, never again", async () => {
    const book = createDbBook(pool);
    const { invitation, code } = await book.invite("org_456", "cfo_100", BY);
    await book.redeem("org_456", code, aLogin());
    for (const sql of [
      "UPDATE dsor.invitations SET cancelled_by = 'admin_100' WHERE id = $1",
      "UPDATE dsor.invitations SET accepted_subject = 'ba_other' WHERE id = $1",
    ]) {
      await expect(tryThenRollBack(pool, sql, "org_456", [invitation.id])).rejects.toThrow(
        /an invitation is accepted or cancelled once/,
      );
    }
  });

  it("Step 43, R7: a link ends once", async () => {
    const book = createDbBook(pool);
    const login = aLogin();
    await book.redeem("org_456", (await book.invite("org_456", "user_123", BY)).code, login);
    await book.unlink("org_456", "user_123", BY);
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.logins SET unlinked_by = 'admin_100' WHERE subject = $1",
        undefined,
        [login.subject],
      ),
    ).rejects.toThrow(/a link ends once/);
  });

  it("Step 43, R1: org_789 sees none of org_456's invitations", async () => {
    await createDbBook(pool).invite("org_456", "cfo_100", BY);
    const { rows } = await tryThenRollBack(
      pool,
      "SELECT count(*)::int AS n FROM dsor.invitations WHERE tenant_id = 'org_456'",
      "org_789",
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("R2 on PostgreSQL: login.invite and login.unlink, inside their claims", () => {
  it("DSOR-IDN-01: admin_100 invites cfo_100 over the database; the code links a new login", async () => {
    const { ask } = world();
    // admin_100 keeps step 05's token in the world of fake logins, which dbRegistry gives; the
    //   invitation is then redeemed through the real logins of world().
    const registry = dbRegistry(pool);
    const invited = (await call(
      registry,
      createDbLog(pool),
      keyed({ token: "tok_a100", tenant: "org_456" }),
      "login.invite",
      { person: "dsor://org_456/person/cfo_100", reason: "new CFO" },
    )) as Answer & { data: { code: string } };
    expect(invited).toMatchObject({ outcome: "COMMITTED", data: { person: "cfo_100" } });
    const first = { token: await a.sign(`ba_${randomUUID()}`), tenant: "org_456" };
    expect(await ask({ ...first, invitation: invited.data.code })).toMatchObject({
      correlation: { principal_id: "cfo_100" },
    });
  });
});

describe("R3: the owner invites the first administrator with pnpm invite", () => {
  /** Runs pnpm invite as the owner, and gives its exit code and what it printed. */
  function invite(...words: string[]): { status: number | null; out: string } {
    const program = fileURLToPath(new URL("../src/invite.ts", import.meta.url));
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const run = spawnSync(process.execPath, [program, ...words], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, DSOR_ISSUERS_FILE: issuersFile },
      timeout: 60_000,
    });
    return { status: run.status, out: `${run.stdout}${run.stderr}`.trim() };
  }

  it("Step 43, R3: pnpm invite org_456 admin_100 prints a code once, and the code links a new login", async () => {
    const made = invite("org_456", "admin_100", "the first administrator");
    expect(made.status).toBe(0);
    const code = /code: ([A-Za-z0-9_-]{22})/.exec(made.out)?.[1];
    expect(code).toBeDefined();
    expect(made.out).toMatch(/^invited admin_100 to org_456 until \S+Z\ncode: /);
    expect(await createDbBook(pool).redeem("org_456", code as string, aLogin())).toBe("admin_100");
    const { rows } = await owner.query(
      "SELECT invited_by FROM dsor.invitations WHERE code_hash = $1",
      [hashOf(code as string)],
    );
    expect(rows).toStrictEqual([{ invited_by: "owner" }]);
  });

  it("Step 43, the review's finding 1: pnpm invite refuses a person who has a login", async () => {
    const book = createDbBook(pool);
    await book.redeem("org_456", (await book.invite("org_456", "admin_100", BY)).code, aLogin());
    expect(invite("org_456", "admin_100", "again")).toStrictEqual({
      status: 1,
      out: "admin_100 has a login already: unlink it first",
    });
  });

  it.each([
    [["org_456", "cfo_999", "x"], "cfo_999 is no person of org_456"],
    [["org_456", "accounts-payable-fte", "x"], "accounts-payable-fte is no person of org_456"],
    [["org_456", "user_700", "x"], "user_700 is no person of org_456"],
    [["org_999", "cfo_100", "x"], "org_999 is no company in issuers.json"],
    [["org_456", "cfo_100"], "use: pnpm invite <company> <person> <reason>"],
  ])("Step 43, R3: pnpm invite %j is refused", (words, message) => {
    expect(invite(...words)).toStrictEqual({ status: 1, out: message });
  });
});

/** Runs this work as the owner, in one company. */
async function inCompanyAsOwner(
  tenant: string,
  work: (client: pg.PoolClient) => Promise<unknown>,
): Promise<void> {
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [tenant]);
    await work(client);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}
