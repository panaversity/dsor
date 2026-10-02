// The two things one in-process connection cannot prove.
//
// `audit-permissions.test.ts` runs against PGlite — real PostgreSQL, in-process — and proves that
// `UPDATE audit` is refused. It has one connection, so it reaches the application's account with
// `SET ROLE` rather than by logging in as it, and it cannot race itself. Those two gaps are what
// this file is for, and they need a server.
//
// It runs only under `pnpm test:db`, and only with DSOR_DB_URL set. `pnpm check` never collects it,
// so the step still runs with no database and no network — and a skipped test says so in the report
// rather than passing quietly.
//
// Rule DSOR-AUD-04a: the DSoR runtime identity MUST NOT be able to update or delete audit records.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, asRunner } from "../src/migrations.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

/**
 * Two pools, which is the point of the file: one connected as the owner, one as the application.
 *
 * The in-process tests cannot do this. `SET ROLE` applies the same privilege checks, so what is
 * untested there is whether `dsor_runtime` *connecting* is given the same answers — and a role whose
 * rights differ depending on how it arrived is exactly the kind of thing worth not assuming.
 */
let owner: Pool;
let application: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  application = new Pool({ connectionString: APPLICATION, max: 3 });

  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
  await owner.query("DELETE FROM audit");
});

afterAll(async () => {
  await owner?.end();
  await application?.end();
});

/** One decision, shaped like the record the program writes. */
function aDecision(sequence: number, id = `audit:org_456:${sequence}`): [string, unknown[]] {
  return [
    `INSERT INTO audit (
       record_id, chain, sequence, previous_hash, record_hash, at, tenant, kind,
       identity, correlation, result
     ) VALUES ($1, 'audit:org_456', $2, $3, $4, now(), 'org_456', 'decision', $5, $6, 'ALLOWED')`,
    [
      id,
      sequence,
      `sha256:${"0".repeat(64)}`,
      `sha256:${sequence}`,
      JSON.stringify({
        mode: "direct",
        subject: "user_123",
        actor_chain: [],
        subject_authority: { source: "role_source", as_of: new Date().toISOString() },
      }),
      JSON.stringify({ request_id: `req_${sequence}` }),
    ],
  ];
}

describe.skipIf(!haveAServer)("against a real server, as a real second user", () => {
  it("DSOR-AUD-04a: the application connects as itself and may add a record", async () => {
    const who = await application.query<{ user: string }>("SELECT current_user AS user");

    // Logged in as the application, not a role assumed from somewhere more privileged.
    expect(who.rows[0]!.user).toBe("dsor_runtime");

    const [sql, params] = aDecision(0);

    await expect(application.query(sql, params)).resolves.toBeDefined();
  });

  it("DSOR-AUD-04a: the application, logged in as itself, may not change or delete a record", async () => {
    for (const forbidden of [
      "UPDATE audit SET result = 'ALLOWED'",
      "DELETE FROM audit",
      "TRUNCATE audit",
    ]) {
      await expect(application.query(forbidden), forbidden).rejects.toThrow(/permission denied/);
    }

    // Still there, which is the assertion that matters.
    const left = await owner.query<{ n: string }>("SELECT count(*)::text AS n FROM audit");

    expect(left.rows[0]!.n).not.toBe("0");
  });

  /**
   * Two writers, racing for one position in the chain.
   *
   * `src/audit.ts` reads the tail and then inserts, and it has to: `sequence` and `previous_hash` are
   * both inside the hash, so they are known before the record exists. Step 08 did the same thing in
   * an array, where both writers won and the log quietly held two records at one position.
   *
   * `UNIQUE (chain, sequence)` is what makes that safe, and this is the only test that can see it —
   * one connection cannot race itself, which is why the in-process tests leave this gap open and say
   * so. Exactly one writer must win.
   */
  it("DSOR-AUD-01: two writers cannot both claim one position in the chain", async () => {
    await owner.query("DELETE FROM audit");

    const [sql, params] = aDecision(0);
    // The same insert, three times at once, on three connections from the pool. All three compute
    // the same position, because none of them has committed yet.
    const bothAtOnce = await Promise.allSettled([
      application.query(sql, params),
      application.query(sql, [...params]),
      application.query(sql, [...params]),
    ]);
    const won = bothAtOnce.filter((one) => one.status === "fulfilled");
    const lost = bothAtOnce.filter((one) => one.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost.length).toBeGreaterThanOrEqual(1);

    const rows = await owner.query<{ n: string }>("SELECT count(*)::text AS n FROM audit");

    expect(rows.rows[0]!.n).toBe("1");
  });

  it("DSOR-AUD-04a: the application cannot grant itself the rights back", async () => {
    // Accepted with a warning and granting nothing, which is PostgreSQL's way — so the assertion is
    // about the privilege, never about whether the statement threw. Lesson 19.
    await application.query("GRANT UPDATE ON audit TO dsor_runtime").catch(() => undefined);

    const held = await application.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dsor_runtime' AND table_name = 'audit' ORDER BY privilege_type`,
    );

    expect(held.rows.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });
});
