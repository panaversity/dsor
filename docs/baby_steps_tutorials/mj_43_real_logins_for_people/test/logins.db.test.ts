// Step 43: DSoR's table of links on PostgreSQL. The owner adds a link with pnpm link-login; the
// program, as dsor_runtime, may only read it. A real login then reaches the checklist over the
// database (DSOR-IDN-01, DSOR-IDN-04a; step 43's README, claim C8, decisions D5 and D9).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { createDbLinks, createDbLog } from "../src/postgres.ts";
import { remoteKeys } from "../src/tokens.ts";
import { dbRegistry, newPool, tryThenRollBack } from "./db.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";

const pool = newPool();
let a: TestIssuer;
// An issuers file that names this test's issuer, for both companies, as DSOR_ISSUERS_FILE.
let issuersFile: string;
beforeAll(async () => {
  a = await startIssuer();
  const one = [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }];
  issuersFile = join(mkdtempSync(join(tmpdir(), "dsor43-")), "issuers.json");
  writeFileSync(issuersFile, JSON.stringify({ org_456: one, org_789: one }));
});
afterAll(async () => {
  await a.close();
  await pool.end();
});

/**
 * Runs pnpm link-login as the owner, with these words, and gives its exit code and what it printed.
 * With the test's issuers file, or with the shipped one.
 */
function linkLogin(...words: string[]): { status: number | null; out: string } {
  return linkLoginWith(issuersFile, ...words);
}
function linkLoginWith(
  file: string | undefined,
  ...words: string[]
): { status: number | null; out: string } {
  const program = fileURLToPath(new URL("../src/link-login.ts", import.meta.url));
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const env = { ...process.env, ...(file === undefined ? {} : { DSOR_ISSUERS_FILE: file }) };
  const run = spawnSync(process.execPath, [program, ...words], {
    encoding: "utf8",
    cwd,
    env,
    timeout: 60_000,
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}`.trim() };
}

describe("C8: the links on PostgreSQL", () => {
  it("Step 43, D5: the owner links a login with pnpm link-login, and dsor_runtime reads it", async () => {
    const subject = `ba_${randomUUID()}`;
    const linked = linkLogin(a.issuer, subject, "cfo_100");
    expect(linked).toStrictEqual({ status: 0, out: `linked ${subject} of ${a.issuer} to cfo_100` });
    expect(await createDbLinks(pool).principalOf(a.issuer, subject)).toBe("cfo_100");
    expect(await createDbLinks(pool).principalOf(a.issuer, "ba_nobody")).toBeUndefined();
  });

  it.each([
    [
      ["https://auth.example.com", "ba_x", "cfo_100"],
      "https://auth.example.com is no issuer in issuers.json",
    ],
    [["http://127.0.0.1:8043", "ba_x", "cfo_999"], "cfo_999 is no person DSoR knows"],
    [
      ["http://127.0.0.1:8043", "ba_x", "accounts-payable-fte"],
      "accounts-payable-fte is no person DSoR knows",
    ],
    [["http://127.0.0.1:8043", ""], "use: pnpm link-login <issuer> <subject> <principal>"],
  ])(
    "Step 43, D5: pnpm link-login %j is refused, with the shipped issuers.json",
    (words, message) => {
      expect(linkLoginWith(undefined, ...words)).toStrictEqual({ status: 1, out: message });
    },
  );

  it("Step 43, D5: a login linked to one person cannot be linked to another", () => {
    const subject = `ba_${randomUUID()}`;
    expect(linkLogin(a.issuer, subject, "user_123").status).toBe(0);
    expect(linkLogin(a.issuer, subject, "cfo_100")).toStrictEqual({
      status: 1,
      out: `${subject} of ${a.issuer} is linked to user_123 already`,
    });
  });

  it.each([
    [
      "INSERT INTO dsor.logins (issuer, subject, principal_id) VALUES ('http://127.0.0.1:8043', 'ba_mine', 'cfo_100')",
    ],
    ["UPDATE dsor.logins SET principal_id = 'user_123'"],
    ["DELETE FROM dsor.logins"],
  ])("Step 43, D5: dsor_runtime may not change the links: %s is refused", async (sql) => {
    await expect(tryThenRollBack(pool, sql, undefined)).rejects.toThrow(/permission denied/);
  });

  it("DSOR-IDN-01: cfo_100's real token, linked on PostgreSQL, reads INV-1008 through the checklist", async () => {
    const subject = `ba_${randomUUID()}`;
    expect(linkLogin(a.issuer, subject, "cfo_100").status).toBe(0);
    const issuers = new Map([
      ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ]);
    const registry = {
      ...dbRegistry(pool),
      logins: realLogins(issuers, createDbLinks(pool), remoteKeys()),
    };
    const answer = await call(
      registry,
      createDbLog(pool),
      { token: await a.sign(subject), tenant: "org_456" },
      "invoice.get",
      {
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    expect(answer).toMatchObject({
      data: { id: "INV-1008" },
      correlation: { principal_id: "cfo_100" },
    });
  });
});
