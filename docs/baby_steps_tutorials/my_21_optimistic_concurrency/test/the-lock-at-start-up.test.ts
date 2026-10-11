// STEP 11: the program refuses to start as an account the second lock does not apply to.
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
    // `neon_superuser`, which holds BYPASSRLS. Measured on Neon 2026-10-08: such a user holds
    // BYPASSRLS itself as well, which the question above refuses first, and the membership also
    // carries UPDATE on the log, which step 09's question refuses before either. This test is the
    // membership alone, on PostgreSQL's own rules, so that the question has a case that only it
    // answers. The role is created here by that name so that the refusal names it back.
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

  // STEP 16: the schemas the tenant tables are in. A schema's owner may drop any table in
  // it, even one it does not own, and nothing above asked who owns them. A review measured it:
  // `dsor` handed to the application, start-up passed, and one `DROP TABLE dsor.audit` erased
  // every record (decision 123). Each case then drops the table, so the route is shown to be real.
  for (const [id, schema, table] of [
    ["DSOR-AUD-04a", "dsor", "dsor.audit"],
    ["DSOR-RP-01a", "public", "public.invoices"],
  ] as const) {
    it(`${id}: an account that owns the schema ${schema} is refused — it may drop ${table}`, async () => {
      await asTheOwner(() => db.exec(`ALTER SCHEMA ${schema} OWNER TO ${APPLICATION_ROLE}`));

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        new RegExp(`may become the owner of, the schema \`${schema}\``),
      );

      await expect(db.exec(`DROP TABLE ${table} CASCADE`)).resolves.toBeDefined();
    });
  }

  it("DSOR-RP-01a: an account that may become the owner of the payments is refused", async () => {
    // STEP 17, decision 126: the payments are a tenant table, asked about like the invoices.
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE a_plain_owner");
      await db.exec("ALTER TABLE public.payments OWNER TO a_plain_owner");
      await db.exec(`GRANT a_plain_owner TO ${APPLICATION_ROLE} WITH INHERIT FALSE`);
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/owner of, a tenant/);
  });

  it("DSOR-AUD-04a: an account that owns the database is refused, even with public given back", async () => {
    // STEP 16: one login that owns its own database is the commonest careless setup. It was
    // caught only because `public` belongs to `pg_database_owner`, and doing what that refusal said,
    // giving the schema back, let the program start (decision 124). A database's owner may drop it.
    await asTheOwner(() =>
      db.exec(`DO $$ BEGIN
                 EXECUTE format('ALTER DATABASE %I OWNER TO ${APPLICATION_ROLE}', current_database());
               END $$;
               ALTER SCHEMA public OWNER TO postgres;`),
    );

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may become the owner of, the database/,
    );
  });

  it("DSOR-AUD-04a: an account that may become the owner of the schema dsor is refused", async () => {
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE a_plain_owner");
      await db.exec("ALTER SCHEMA dsor OWNER TO a_plain_owner");
      await db.exec(`GRANT a_plain_owner TO ${APPLICATION_ROLE} WITH INHERIT FALSE`);
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may become the owner of, the schema `dsor`/,
    );
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

  it("DSOR-AUD-04a: a SECURITY DEFINER function whose owner owns the schema dsor is refused", async () => {
    // STEP 16: the question asked of the connection, asked of a helper's owner too, as the
    // check already does for a tenant table's owner. This owner holds no right on the log, and
    // owns its schema: the helper may drop the log for whoever calls it (decision 123).
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE folder_keeper");
      await db.exec("ALTER SCHEMA dsor OWNER TO folder_keeper");
      await db.exec(`CREATE FUNCTION drop_the_log() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
                     AS $$ BEGIN DROP TABLE dsor.audit; END $$`);
      await db.exec("ALTER FUNCTION drop_the_log() OWNER TO folder_keeper");
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/SECURITY DEFINER/);

    // And the route is real: as the application, one call, and the log is gone.
    await db.exec("SELECT drop_the_log()");
    const { rows } = await db.query<{ log: string | null }>(
      "SELECT to_regclass('dsor.audit')::text AS log",
    );

    expect(rows[0]?.log).toBeNull();
  });

  it("DSOR-MOD-01: a SECURITY DEFINER function whose owner may create in the schema dsor is refused", async () => {
    // STEP 16: the application may create nothing in dsor, and through a helper whose owner
    // may, it made dsor.proposals anyway, a review measured (decision 124).
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE a_builder");
      await db.exec("GRANT USAGE, CREATE ON SCHEMA dsor TO a_builder");
      await db.exec(`CREATE FUNCTION make_proposals() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
                     AS $$ BEGIN CREATE TABLE dsor.proposals (id text); END $$`);
      await db.exec("ALTER FUNCTION make_proposals() OWNER TO a_builder");
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/SECURITY DEFINER/);

    // And the route is real: as the application, one call, and a table stands in dsor.
    await db.exec("SELECT make_proposals()");
    const { rows } = await db.query<{ owner: string }>(
      "SELECT tableowner AS owner FROM pg_tables WHERE schemaname = 'dsor' AND tablename = 'proposals'",
    );

    expect(rows).toStrictEqual([{ owner: "a_builder" }]);
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

describe("what an evaluation found past the first fixes", () => {
  // Three more ways round the function question, measured by an independent evaluation after
  // the hostile review, and two edges of the check itself.

  it("DSOR-RP-01a: a trigger on the invoices rewrites the application's own UPDATE, and is refused", async () => {
    // Step 09 asked about triggers on the audit table only. A trigger on the invoices fires inside
    // the application's own statement. The evaluation's version used a SECURITY DEFINER function
    // owned by a superuser and smuggled every company's rows into a column — which the helper
    // question above now refuses on its own. This one is the trigger question's own case: a plain
    // function, no SECURITY DEFINER, no owner that holds anything, that simply changes what the
    // application wrote. Only a question about triggers can see it.
    await asTheOwner(async () => {
      await db.exec(`CREATE FUNCTION tamper() RETURNS trigger LANGUAGE plpgsql
                     AS $$ BEGIN NEW.status := 'paid'; RETURN NEW; END $$`);
      await db.exec("CREATE ROLE a_quiet_owner");
      await db.exec("ALTER FUNCTION tamper() OWNER TO a_quiet_owner");
      await db.exec(`CREATE TRIGGER tamper BEFORE UPDATE ON public.invoices
                     FOR EACH ROW EXECUTE FUNCTION tamper()`);
    });

    // Not testing nothing: the application issues org_456's draft, and the row comes back paid.
    const landed = await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");

      const { rows } = await tx.query<{ status: string }>(
        `UPDATE public.invoices SET status = 'issued'
         WHERE tenant_id = 'org_456' AND id = 'INV-1009' AND status = 'draft' RETURNING status`,
      );

      return rows[0]?.status;
    });

    expect(landed).toBe("paid");

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/trigger on it/);
  });

  it("DSOR-RP-01a: a helper reached through an aggregate, with EXECUTE on the helper revoked, is refused", async () => {
    // The first fix asked whether the application may EXECUTE the helper. It may not — and it may
    // call an aggregate whose transition function is the helper, which runs it all the same.
    await asTheOwner(async () => {
      await db.exec(`CREATE FUNCTION leak_step(acc text, x text) RETURNS text LANGUAGE sql SECURITY DEFINER
                     AS $$ SELECT string_agg(tenant_id || '/' || id, ';' ORDER BY 1) FROM public.invoices $$`);
      await db.exec("REVOKE EXECUTE ON FUNCTION leak_step(text, text) FROM PUBLIC");
      await db.exec("CREATE AGGREGATE leak_agg(text) (SFUNC = leak_step, STYPE = text)");
    });

    const { rows } = await db.query<{ leak_agg: string }>(
      "SELECT leak_agg(x) FROM (VALUES ('a')) AS v(x)",
    );

    expect(rows[0]?.leak_agg).toContain("org_789/INV-1008");

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/SECURITY DEFINER/);
  });

  it("DSOR-RP-01a: a helper whose EXECUTE arrives through an INHERIT FALSE membership is refused", async () => {
    await asTheOwner(async () => {
      await db.exec(`CREATE FUNCTION leak() RETURNS text LANGUAGE sql SECURITY DEFINER
                     AS $$ SELECT string_agg(tenant_id, ';' ORDER BY 1) FROM public.invoices $$`);
      await db.exec("REVOKE EXECUTE ON FUNCTION leak() FROM PUBLIC");
      await db.exec("CREATE ROLE helper");
      await db.exec("GRANT EXECUTE ON FUNCTION leak() TO helper");
      await db.exec(`GRANT helper TO ${APPLICATION_ROLE} WITH INHERIT FALSE`);
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/SECURITY DEFINER/);
  });

  it("a connection that already carries a company before any statement said one is refused", async () => {
    // A statement with no company runs with whatever the session holds. A pooler, or an
    // administrator's ALTER ROLE … SET, could leave a company on the session; every plain
    // statement would then be that company's.
    await db.exec("SELECT set_config('dsor.tenant_id', 'org_789', false)");

    try {
      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/already carries/);
    } finally {
      await db.exec("SELECT set_config('dsor.tenant_id', '', false)");
    }
  });

  it("the application's own temporary table is not a window, and does not refuse start-up", async () => {
    await db.exec("CREATE TEMP TABLE scratch (x int)");

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).resolves.toBeUndefined();
  });

  it("a missing tenant table is refused in the step's own words, not PostgreSQL's", async () => {
    await asTheOwner(() => db.exec("DROP TABLE public.invoices CASCADE"));

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /tenant table is missing/,
    );
  });

  it("a server that missed migration 008 is refused in the step's own words too", async () => {
    // STEP 16: the log where migrations 001 to 007 leave it, in public, and no dsor at all.
    // The test above drops the invoices only, and for the log the step's own words never appeared:
    // a review measured `schema "dsor" does not exist` instead (decision 123).
    // STEP 18: CASCADE, because a server that missed 008 missed every migration after it too, and
    // dsor holds the slips of 013 now.
    await asTheOwner(() =>
      db.exec("ALTER TABLE dsor.audit SET SCHEMA public; DROP SCHEMA dsor CASCADE;"),
    );

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /tenant table is missing/,
    );
  });
});

describe("a schema the application may create things in", () => {
  // STEP 16: only the migrations, run as the owner, put tables in DSoR's schema or the
  // business's. A table the application made there would be its own, every row of it, and a later
  // step's migration would find its name taken. A review measured the application making
  // `dsor.proposals` six steps before step 22 builds it (decision 123). Migration 008 takes
  // CREATE back, and start-up asks PostgreSQL, because a later grant passes the migrations by.
  for (const [id, schema] of [
    ["DSOR-MOD-01", "dsor"],
    ["DSOR-RP-01a", "public"],
  ] as const) {
    it(`${id}: an account that may create in the schema ${schema} is refused`, async () => {
      await asTheOwner(() => db.exec(`GRANT CREATE ON SCHEMA ${schema} TO ${APPLICATION_ROLE}`));

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        new RegExp(
          `only the migrations should, itself or one SET ROLE away: ${APPLICATION_ROLE} on ${schema}`,
        ),
      );

      // And the route is real: as the application, a table of a later step's name, its own.
      await db.exec(`CREATE TABLE ${schema}.proposals (id text)`);
      const { rows } = await db.query<{ owner: string }>(
        `SELECT tableowner AS owner FROM pg_tables WHERE schemaname = '${schema}' AND tablename = 'proposals'`,
      );

      expect(rows).toStrictEqual([{ owner: APPLICATION_ROLE }]);
    });
  }

  it("DSOR-MOD-01: an account one SET ROLE away from creating in the schema dsor is refused", async () => {
    await asTheOwner(async () => {
      await db.exec("CREATE ROLE a_builder");
      await db.exec("GRANT USAGE, CREATE ON SCHEMA dsor TO a_builder");
      await db.exec(`GRANT a_builder TO ${APPLICATION_ROLE} WITH INHERIT FALSE`);
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /only the migrations should, itself or one SET ROLE away: a_builder on dsor/,
    );
  });
});

describe("a lock that is not there", () => {
  // A program that relies on the database to hide rows, run against a database that does not,
  // would leak quietly. So the check also asks whether the lock is on, the way it asks whether a
  // trigger is there: a guarantee the program depends on is checked, not assumed.
  for (const [undo, reason] of [
    ["ALTER TABLE public.invoices NO FORCE ROW LEVEL SECURITY", /forced/],
    ["ALTER TABLE dsor.audit DISABLE ROW LEVEL SECURITY", /row-level security/],
    ["DROP POLICY tenant_isolation ON dsor.audit", /policy/],
    ["CREATE POLICY for_app ON dsor.audit TO dsor_runtime USING (true)", /policy/],
    // STEP 17: the vendors and the payments too, which the code refused already and no test said
    // (decision 126).
    ["ALTER TABLE public.payments NO FORCE ROW LEVEL SECURITY", /forced/],
    ["ALTER TABLE public.vendors DISABLE ROW LEVEL SECURITY", /row-level security/],
    ["DROP POLICY tenant_isolation ON public.payments", /policy/],
    ["CREATE POLICY for_app ON public.vendors TO dsor_runtime USING (true)", /policy/],
    // STEP 18: and the permission slips.
    ["ALTER TABLE dsor.delegations NO FORCE ROW LEVEL SECURITY", /forced/],
    ["DROP POLICY tenant_isolation ON dsor.delegations", /policy/],
  ] as const) {
    it(`DSOR-RP-01b: refuses to start when the lock is off — ${undo}`, async () => {
      await asTheOwner(() => db.exec(undo));

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(reason);
    });
  }
});
