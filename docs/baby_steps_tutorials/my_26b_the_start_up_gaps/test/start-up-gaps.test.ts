// NEW IN STEP 26b: the four questions start-up never asked (decision 161).
//
// Every time the program starts, it asks the database what its own login may do, and refuses to
// start if the answer is too much. Decision 145 wrote down four ways round those questions. Each
// needs a careless database administrator, not a clever agent (decision 119), and each case below
// first does the damage, so the route is shown to be real, and then asks start-up.
//
// Rule DSOR-RP-01a: `dsor_runtime` MUST NOT be a superuser, hold `BYPASSRLS`, or own tenant tables.
// Rule DSOR-DEL-01a: A state-changing command from an agent principal MUST be evaluated under an
// active delegation held in the DSoR control-plane store.

import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overPGlite, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { audit } from "../src/audit.ts";
import { aDatabase, asTheOwner } from "./support/database.ts";

let db: PGlite;

beforeEach(async () => {
  db = await aDatabase(); // as the application, like the program's own door
});

afterEach(async () => {
  await db.close();
});

/** The slips with this id, in any company, counted by the owner, whom no policy hides them from. */
async function slipsCalled(id: string): Promise<number> {
  return asTheOwner(async () => {
    const { rows } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM dsor.delegations WHERE id = $1",
      [id],
    );

    return rows[0]?.n ?? -1;
  });
}

/** The application issues org_456's draft invoice, INV-1009, as `invoice.issue` does. */
async function issueInv1009(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
    await tx.query(
      `UPDATE public.invoices SET status = 'issued'
        WHERE tenant_id = 'org_456' AND id = 'INV-1009' AND status = 'draft'`,
    );
  });
}

describe("a rule on a tenant table", () => {
  it("DSOR-DEL-01a: a rule that signs a slip inside the application's own invoice.issue is refused", async () => {
    // A rule is code the table's owner attached, like a trigger, and it runs with the owner's
    // rights inside the application's own statement. Start-up asked about triggers and not rules,
    // and decision 149 measured del_100's limit lifted through one in step 18. Here the rule signs
    // a new slip with no limit at all, for an agent nobody named.
    await asTheOwner(() =>
      db.exec(`CREATE RULE sign_one AS ON UPDATE TO public.invoices
               DO ALSO INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions,
                                                     status, expires_at)
               VALUES ('org_456', 'del_666', 'user_123', 'a-new-fte', ARRAY['payment:create'],
                       'active', '2099-12-31T23:59:59Z')`),
    );

    expect(await slipsCalled("del_666")).toBe(0);

    // Not testing nothing: an ordinary invoice.issue, and a slip nobody signed is in the store.
    await issueInv1009();
    expect(await slipsCalled("del_666")).toBe(1);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/a rule on it/);
  });

  for (const table of [
    "public.invoices",
    "public.vendors",
    "public.payments",
    "dsor.audit",
    "dsor.delegations",
    "dsor.idempotency_keys",
    "dsor.proposals",
    "dsor.proposal_moves",
    "dsor.day_totals",
    "dsor.reservations",
    "dsor.agent_controls",
  ]) {
    it(`DSOR-EXE-02: a rule that swallows what the application writes to ${table} is refused`, async () => {
      // `DO INSTEAD NOTHING` writes nothing and says nothing: on the log, a decision the program
      // believes recorded is not. Any rule on any tenant table is refused, whatever it does.
      await asTheOwner(() =>
        db.exec(`CREATE RULE swallow AS ON INSERT TO ${table} DO INSTEAD NOTHING`),
      );

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(/a rule on it/);
    });
  }
});

describe("a view the application may write through", () => {
  /** An owner's view over the slips, the kind an administrator makes for a reporting tool. */
  const aSlipDesk = (): Promise<unknown> =>
    asTheOwner(() => db.exec("CREATE VIEW public.slip_desk AS SELECT * FROM dsor.delegations"));

  /** The application signs a slip through the desk, naming only columns, reading nothing back. */
  async function signThroughTheDesk(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await tx.query(
        `INSERT INTO public.slip_desk (tenant, id, delegator, delegate, permissions, status,
                                       expires_at)
         VALUES ('org_456', $1, 'user_123', 'a-new-fte', ARRAY['payment:create'], 'active',
                 '2099-12-31T23:59:59Z')`,
        [id],
      );
    });
  }

  it("DSOR-DEL-01a: a view over the slips that the application may write through, and not read, is refused", async () => {
    // A view runs with its owner's rights. Start-up asked whether the application may READ a view
    // beside the tenant tables, and this one it may not; it may only INSERT. Decision 149 measured
    // del_100's limit lifted through such a view in step 18. Here the application signs itself a
    // slip with no limit at all, which start-up exists to stop (decision 127).
    await aSlipDesk();
    await asTheOwner(() => db.exec("GRANT INSERT ON public.slip_desk TO dsor_runtime"));

    await signThroughTheDesk("del_667");
    expect(await slipsCalled("del_667")).toBe(1);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may write to `public\.slip_desk`/,
    );
  });

  it("DSOR-AUD-04a: a view over the log that the application may update, and not read, is refused", async () => {
    // The log is append-only because the application holds no UPDATE on it (step 09). Through an
    // owner's view, an UPDATE with no WHERE needs no SELECT, and rewrites every company's records.
    await asTheOwner(async () => {
      await db.exec("CREATE VIEW public.log_desk AS SELECT * FROM dsor.audit");
      await db.exec("GRANT UPDATE ON public.log_desk TO dsor_runtime");
    });

    await audit({
      kind: "decision",
      subject: "user_123",
      tenant: "org_456",
      requestId: "req_1",
      operation: "invoice.get@1",
      authorization: "ALLOW",
      result: "OK",
    });

    // Not testing nothing: one statement, no company said, and the record says what it never said.
    await db.query("UPDATE public.log_desk SET reason = 'nothing happened'");
    const reasons = await asTheOwner(async () => {
      const { rows } = await db.query<{ reason: string | null }>("SELECT reason FROM dsor.audit");

      return rows.map((r) => r.reason);
    });
    expect(reasons).toStrictEqual(["nothing happened"]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may write to `public\.log_desk`/,
    );
  });

  for (const [how, grant] of [
    [
      "one SET ROLE away",
      "CREATE ROLE desk; GRANT INSERT ON public.slip_desk TO desk; GRANT desk TO dsor_runtime WITH INHERIT FALSE",
    ],
    [
      "through a helper function's owner",
      `CREATE ROLE clerk; GRANT INSERT ON public.slip_desk TO clerk;
       CREATE FUNCTION public.a_helper() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
       ALTER FUNCTION public.a_helper() OWNER TO clerk`,
    ],
    [
      "by naming columns",
      "GRANT INSERT (tenant, id, delegator, delegate, permissions, status, expires_at) ON public.slip_desk TO dsor_runtime",
    ],
  ] as const) {
    it(`DSOR-DEL-01a: the same view, written ${how}, is refused`, async () => {
      // The write questions about the tenant tables have been asked this way since step 17
      // (decisions 126 and 148); the question about everything beside them is asked the same way.
      await aSlipDesk();
      await asTheOwner(() => db.exec(grant));

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        /may write to `public\.slip_desk`/,
      );
    });
  }

  it("DSOR-DEL-01a: a plain table beside the tenant tables that the application may write is refused too", async () => {
    // The application writes the tenant tables and nothing else. A table beside them has no lock,
    // and is no place for a company's records.
    await asTheOwner(async () => {
      await db.exec("CREATE TABLE public.scratch (note TEXT)");
      await db.exec("GRANT INSERT ON public.scratch TO dsor_runtime");
    });

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may write to `public\.scratch`/,
    );
  });

  it("a view the application may not write through, or read, does not refuse start-up", async () => {
    // Views are not refused for existing: a report people read harms nothing the application can
    // reach. Not testing nothing: the same desk refuses the moment the application may write to it.
    await aSlipDesk();

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).resolves.toBeUndefined();
  });
});
