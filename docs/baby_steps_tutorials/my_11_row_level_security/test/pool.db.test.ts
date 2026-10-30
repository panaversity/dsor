// NEW IN STEP 11: the second trap on the map, on real connections.
//
// A company set on a connection stays on that connection. A pool hands the same connection to the
// next statement that asks, whoever that statement is for — so a company set *per connection* is
// met again by a stranger. PGlite has one connection and cannot show this; a `pg` pool against a
// real server can, and does, below. Then the program's own adapter is shown not to do it.
//
// Runs only under `pnpm test:db`, with DSOR_DB_URL and DSOR_DB_OWNER_URL set, like audit.db.test.ts.
//
// Rule DSOR-RP-01c: the tenant setting MUST be transaction-local.
// Rule DSOR-RP-01d: a query executed with no tenant setting MUST yield no rows.

import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overPool } from "../src/database.ts";
import { applyMigrations, asRunner } from "../src/migrations.ts";

const APPLICATION = process.env.DSOR_DB_URL;
const OWNER = process.env.DSOR_DB_OWNER_URL;
const haveAServer = (APPLICATION ?? "").trim() !== "" && (OWNER ?? "").trim() !== "";

const FORGOT_THE_COMPANY = "SELECT tenant_id FROM public.invoices WHERE id = 'INV-1008' ORDER BY 1";
const WHAT_WAS_SAID = "SELECT current_setting('dsor.tenant_id', true) AS said";

let owner: Pool;

beforeAll(async () => {
  if (!haveAServer) {
    return;
  }

  owner = new Pool({ connectionString: OWNER, max: 1 });
  await applyMigrations(asRunner(owner), fileURLToPath(new URL("../migrations", import.meta.url)));
});

afterAll(async () => {
  await owner?.end();
});

describe.skipIf(!haveAServer)("a company said per connection, on a real pool", () => {
  it("is met again by the next statement on that connection — the trap, demonstrated", async () => {
    // One connection in the pool, so the next statement is certain to get the same one.
    const pool = new Pool({ connectionString: APPLICATION, max: 1 });

    try {
      // The wrong way: `false` means "for this session", and a pooled session outlives a request.
      await pool.query("SELECT set_config('dsor.tenant_id', 'org_456', false)");

      // A later statement, for nobody in particular, sees org_456's rows.
      const later = await pool.query<{ said: string }>(WHAT_WAS_SAID);
      const rows = await pool.query<{ tenant_id: string }>(FORGOT_THE_COMPANY);

      expect(later.rows[0]?.said).toBe("org_456");
      expect(rows.rows.map((r) => r.tenant_id)).toStrictEqual(["org_456"]);
    } finally {
      await pool.end(); // and the poisoned connection with it
    }
  });
});

describe.skipIf(!haveAServer)("the program's adapter, on a real pool", () => {
  it("DSOR-RP-01c: leaves nothing on the connection it hands back", async () => {
    const pool = new Pool({ connectionString: APPLICATION, max: 1 });

    try {
      const db = overPool(pool);

      // The statement itself saw the company…
      const during = await db.query<{ said: string }>(WHAT_WAS_SAID, undefined, "org_456");

      expect(during.rows[0]?.said).toBe("org_456");

      // …and the next statement on the very same connection does not. The empty string is what
      // PostgreSQL reports for a setting that was made once, transaction-locally, and has died.
      const after = await pool.query<{ said: string }>(WHAT_WAS_SAID);

      expect(after.rows[0]?.said ?? "").toBe("");
      expect((await pool.query(FORGOT_THE_COMPANY)).rows).toStrictEqual([]);
    } finally {
      await pool.end();
    }
  });

  it("DSOR-RP-01c: three companies' statements at once, on three real connections, each see their own", async () => {
    const pool = new Pool({ connectionString: APPLICATION, max: 3 });

    try {
      const db = overPool(pool);
      const seen = await Promise.all(
        ["org_456", "org_789", "org_456"].map((tenant) =>
          db
            .query<{ tenant_id: string }>(FORGOT_THE_COMPANY, undefined, tenant)
            .then((r) => r.rows.map((row) => row.tenant_id)),
        ),
      );

      expect(seen).toStrictEqual([["org_456"], ["org_789"], ["org_456"]]);
    } finally {
      await pool.end();
    }
  });

  it("DSOR-RP-01d: as the real login, a statement with no company gets no rows", async () => {
    // Not `SET ROLE`: logged in as dsor_runtime, the way the program is on a server.
    const pool = new Pool({ connectionString: APPLICATION, max: 1 });

    try {
      const who = await pool.query<{ u: string }>("SELECT current_user AS u");

      expect(who.rows[0]?.u).toBe("dsor_runtime");
      expect((await pool.query(FORGOT_THE_COMPANY)).rows).toStrictEqual([]);
    } finally {
      await pool.end();
    }

    // While the owner sees both — the rows are there to be hidden.
    const both = await owner.query<{ tenant_id: string }>(FORGOT_THE_COMPANY);

    expect(both.rows.map((r) => r.tenant_id)).toStrictEqual(["org_456", "org_789"]);
  });
});
