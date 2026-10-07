// NEW IN STEP 11: the program refuses to start as an account the second lock does not apply to.
//
// Step 09's start-up check asks what the connection MAY DO: UPDATE the log, become a role that
// may, call a function that may. Row-level security adds a question no privilege check answers,
// because bypassing it is not a privilege on a table — it is a property of the role. An account
// with BYPASSRLS holds no UPDATE, no DELETE and no INSERT it should not, every check of step 09
// says "may not", and every policy of migration 005 does nothing for it. Measured below, before
// the check existed: two companies' rows through a query that said one.
//
// Rule DSOR-RP-01a: `dsor_runtime` MUST NOT be a superuser, hold `BYPASSRLS`, or own tenant tables.

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPLICATION_ROLE, overPGlite, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { aDatabase, asTheOwner } from "./support/database.ts";

let db: PGlite;

beforeEach(async () => {
  db = await aDatabase(); // as the application, like the program's own door
});

afterEach(async () => {
  await db.close();
});

/** The query step 10 could not survive, run as whoever is connected, for org_456. */
async function companiesSeenForOrg456(): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");

    const { rows } = await tx.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM public.invoices WHERE id = 'INV-1008' ORDER BY tenant_id",
    );

    return rows.map((r) => r.tenant_id);
  });
}

describe("an account the lock does not apply to", () => {
  it("DSOR-RP-01a: BYPASSRLS is refused, though every privilege check says the account may not", async () => {
    // As the migrations leave it: the lock applies, and the check is content.
    expect(await companiesSeenForOrg456()).toStrictEqual(["org_456"]);
    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).resolves.toBeUndefined();

    await asTheOwner(() => db.exec(`ALTER ROLE ${APPLICATION_ROLE} BYPASSRLS`));

    // Not testing nothing. Same account, same grants, same query — and the lock is gone.
    expect(await companiesSeenForOrg456()).toStrictEqual(["org_456", "org_789"]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/BYPASSRLS/);
  });

  it("DSOR-RP-01a: membership of a role that bypasses the lock is refused — Neon's neon_superuser, by name", async () => {
    // The third trap on the map. On Neon, a user made in the Console is a member of
    // `neon_superuser`, which holds BYPASSRLS, so the user skips every policy while holding no
    // right of its own that a privilege check would see. The role is created here by that name so
    // that the refusal names it back.
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE neon_superuser BYPASSRLS");
      await db.exec("GRANT SELECT ON public.invoices TO neon_superuser");
      await db.exec(`GRANT neon_superuser TO ${APPLICATION_ROLE}`);
    });

    // Measured 2026-10-06, and it corrected this test: BYPASSRLS is a role *attribute*, and
    // PostgreSQL never passes attributes down through membership — only privileges. So the
    // member itself is still filtered…
    expect(await companiesSeenForOrg456()).toStrictEqual(["org_456"]);

    // …and is one SET ROLE away from not being. The same shape as step 09's `editor` role: the
    // account holds nothing, and can become something that holds everything.
    await db.exec("SET ROLE neon_superuser");
    expect(await companiesSeenForOrg456()).toStrictEqual(["org_456", "org_789"]);
    await db.exec(`SET ROLE ${APPLICATION_ROLE}`);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/neon_superuser/);
  });

  it("DSOR-RP-01a: an account that may become the owner of a tenant table is refused", async () => {
    // Direct ownership is caught by step 09's privilege checks, because an owner may do everything
    // to its table. Ownership one SET ROLE away is not: `WITH INHERIT FALSE` gives the application
    // no privilege at all, and `SET ROLE a_plain_owner` would give it the table — including the
    // right to drop the policy on it.
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE a_plain_owner");
      await db.exec("ALTER TABLE public.invoices OWNER TO a_plain_owner");
      await db.exec(`GRANT a_plain_owner TO ${APPLICATION_ROLE} WITH INHERIT FALSE`);
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/owner/);
  });
});

describe("a window past the lock", () => {
  // Three attacks a hostile review measured against the first version of the check, which asked
  // only whether the account held BYPASSRLS and whether a policy existed. Each is an owner's
  // mistake, not a caller's — and each left the forgotten query returning both companies while the
  // check said the lock was on.

  it("DSOR-RP-01a: a SECURITY DEFINER function owned by a role that bypasses the lock is refused", async () => {
    // Step 09 refuses a helper whose owner may rewrite the log. This owner may not: it holds SELECT
    // and BYPASSRLS, so the helper reads every company's rows and the privilege checks say nothing.
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE reader BYPASSRLS");
      await db.exec("GRANT SELECT ON public.invoices TO reader");
      await db.exec(`CREATE FUNCTION all_invoices() RETURNS SETOF text LANGUAGE sql SECURITY DEFINER
                     AS $$ SELECT tenant_id FROM public.invoices WHERE id = 'INV-1008' ORDER BY 1 $$`);
      await db.exec("ALTER FUNCTION all_invoices() OWNER TO reader");
    });

    // Not testing nothing: as the application, with no company said, the helper leaks.
    const { rows } = await db.query<{ all_invoices: string }>("SELECT * FROM all_invoices()");

    expect(rows.map((r) => r.all_invoices)).toStrictEqual(["org_456", "org_789"]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/SECURITY DEFINER/);
  });

  it("DSOR-RP-01a: a view the owner made is a window past the lock, and is refused", async () => {
    // A view runs with its owner's rights, and its owner is a superuser here — so a view over the
    // invoices shows every company, to anybody who may SELECT from the view.
    await asTheOwner(async () => {
      await db.exec("CREATE VIEW all_invoices AS SELECT tenant_id, id FROM public.invoices");
      await db.exec(`GRANT SELECT ON all_invoices TO ${APPLICATION_ROLE}`);
    });

    const { rows } = await db.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM all_invoices WHERE id = 'INV-1008' ORDER BY 1",
    );

    expect(rows.map((r) => r.tenant_id)).toStrictEqual(["org_456", "org_789"]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/all_invoices/);
  });

  it("DSOR-RP-01b: a second policy that lets everything through is refused", async () => {
    // Policies are permissive and OR'd together: one more that says `true` and the lock is gone,
    // while "is there a policy" still says yes. The check asks for the one policy the migration
    // wrote, word for word.
    await asTheOwner(() => db.exec("CREATE POLICY wide_open ON public.invoices USING (true)"));

    expect(await companiesSeenForOrg456()).toStrictEqual(["org_456", "org_789"]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/policy/);
  });

  it("DSOR-RP-01a: a superuser is refused, by step 09's question, before this step's are asked", async () => {
    await db.exec("RESET ROLE");

    const { rows } = await db.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );

    expect(rows[0]?.rolsuper).toBe(true);

    // A superuser may UPDATE the log, and that is what the refusal says. `rolsuper` itself is not
    // asked, because a line this one makes unreachable is a line no test can kill.
    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/may UPDATE/);
  });
});

describe("a lock that is not there", () => {
  // A program that relies on the database to hide rows, run against a database that does not,
  // would leak quietly. So the check also asks whether the lock is on, the way it asks whether a
  // trigger is there: a guarantee the program depends on is checked, not assumed.
  for (const [undo, reason] of [
    ["ALTER TABLE public.invoices NO FORCE ROW LEVEL SECURITY", /forced/],
    ["ALTER TABLE public.audit DISABLE ROW LEVEL SECURITY", /row-level security/],
    ["DROP POLICY tenant_isolation ON public.audit", /policy/],
    ["CREATE POLICY for_app ON public.audit TO dsor_runtime USING (true)", /policy/],
  ] as const) {
    it(`DSOR-RP-01b: refuses to start when the lock is off — ${undo}`, async () => {
      await asTheOwner(() => db.exec(undo));

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(reason);
    });
  }
});
