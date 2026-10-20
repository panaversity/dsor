// STEP 26b: the four questions start-up never asked (decision 161).
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
    // STEP 27: and the controls.
    "dsor.controls",
    // STEP 29: and what a proposal waits for.
    "dsor.requirements",
    // STEP 29: and the approvals.
    "dsor.approvals",
  ]) {
    // The log's case is DSOR-EXE-02's: a decision the program believes recorded, swallowed. Every other
    // table's is the second lock's: a rule runs with the owner's rights, past it (decision 163).
    const rule = table === "dsor.audit" ? "DSOR-EXE-02" : "DSOR-TEN-01b";

    it(`${rule}: a rule on ${table} is refused, whatever it does`, async () => {
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

  it("DSOR-AUD-04a: a view over the log that the application may delete from, and not read, is refused", async () => {
    // Found by a review: with the write question's DELETE and TRUNCATE taken out, every test still
    // passed, because every other DELETE in the suite is on a tenant table, which an earlier
    // question refuses first. One statement through such a view erases every company's records.
    await asTheOwner(async () => {
      await db.exec("CREATE VIEW public.log_desk AS SELECT * FROM dsor.audit");
      await db.exec("GRANT DELETE ON public.log_desk TO dsor_runtime");
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

    // Not testing nothing: no WHERE, no SELECT needed, and the log is empty.
    await db.query("DELETE FROM public.log_desk");
    const left = await asTheOwner(async () => {
      const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM dsor.audit");

      return rows[0]?.n;
    });
    expect(left).toBe(0);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may write to `public\.log_desk`/,
    );
  });

  it("DSOR-DEL-01a: a table beside the tenant tables that the application may only truncate is refused", async () => {
    await asTheOwner(async () => {
      await db.exec("CREATE TABLE public.scratch (note TEXT)");
      await db.exec("GRANT TRUNCATE ON public.scratch TO dsor_runtime");
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

describe("a view the application may read some other way", () => {
  /** An owner's view over every company's invoices, the window decision 156 measured. */
  const everyInvoice = (): Promise<unknown> =>
    asTheOwner(() =>
      db.exec("CREATE VIEW public.every_invoice AS SELECT tenant_id, id FROM public.invoices"),
    );

  /** Who holds INV-1008, as read through the window, by whatever statement reaches it. */
  async function companiesThrough(statement: string): Promise<string[]> {
    const { rows } = await db.query<{ tenant_id: string }>(statement);

    return rows.map((r) => r.tenant_id).sort();
  }

  it("DSOR-TEN-01b: a view readable one SET ROLE away is refused", async () => {
    // Start-up asked whether the application itself may read beside the tenant tables. The write
    // questions have also asked every role it can become since step 17 (decision 126).
    await everyInvoice();
    await asTheOwner(() =>
      db.exec(
        "CREATE ROLE reader; GRANT SELECT ON public.every_invoice TO reader; GRANT reader TO dsor_runtime WITH INHERIT FALSE",
      ),
    );

    // Not testing nothing: one SET ROLE, and both companies' INV-1008.
    await db.exec("SET ROLE reader");
    expect(
      await companiesThrough("SELECT tenant_id FROM public.every_invoice WHERE id = 'INV-1008'"),
    ).toStrictEqual(["org_456", "org_789"]);
    await db.exec("SET ROLE dsor_runtime");

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may read `public\.every_invoice`/,
    );
  });

  it("DSOR-TEN-01b: a view readable through a helper function's owner is refused", async () => {
    // A SECURITY DEFINER helper runs with its owner's rights, whoever calls it (decision 148).
    await everyInvoice();
    await asTheOwner(() =>
      db.exec(`CREATE ROLE peeker; GRANT SELECT ON public.every_invoice TO peeker;
               CREATE FUNCTION public.peek() RETURNS SETOF text LANGUAGE sql SECURITY DEFINER
                 AS $$ SELECT tenant_id FROM public.every_invoice WHERE id = 'INV-1008' $$;
               ALTER FUNCTION public.peek() OWNER TO peeker;
               GRANT EXECUTE ON FUNCTION public.peek() TO dsor_runtime`),
    );

    expect(await companiesThrough("SELECT peek AS tenant_id FROM public.peek()")).toStrictEqual([
      "org_456",
      "org_789",
    ]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may read `public\.every_invoice`/,
    );
  });

  it("DSOR-TEN-01b: a view granted on some of its columns only is refused", async () => {
    // `has_table_privilege` says no to a grant that names columns, as step 17 found for writing.
    await everyInvoice();
    await asTheOwner(() =>
      db.exec("GRANT SELECT (tenant_id, id) ON public.every_invoice TO dsor_runtime"),
    );

    expect(
      await companiesThrough("SELECT tenant_id FROM public.every_invoice WHERE id = 'INV-1008'"),
    ).toStrictEqual(["org_456", "org_789"]);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may read `public\.every_invoice`/,
    );
  });
});

describe("a schema that only looks like one PostgreSQL keeps for itself", () => {
  // Found by a review: the questions skipped schemas by name, and a view in `information_schema`,
  // or in a schema named `pgxtemp`, which `LIKE 'pg_temp%'` matched because `_` matches any
  // character, passed start-up. They ask now by what a relation is (decision 163).
  for (const schema of ["information_schema", "pgxtemp"]) {
    it(`DSOR-TEN-01b: a view over every company's invoices in ${schema} is refused`, async () => {
      await asTheOwner(async () => {
        if (schema !== "information_schema") {
          await db.exec(`CREATE SCHEMA ${schema}; GRANT USAGE ON SCHEMA ${schema} TO dsor_runtime`);
        }

        await db.exec(
          `CREATE VIEW ${schema}.every_invoice AS SELECT tenant_id, id FROM public.invoices`,
        );
        await db.exec(`GRANT SELECT ON ${schema}.every_invoice TO dsor_runtime`);
      });

      // Not testing nothing: both companies' INV-1008, through the view.
      const { rows } = await db.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM ${schema}.every_invoice WHERE id = 'INV-1008' ORDER BY 1`,
      );
      expect(rows.map((r) => r.tenant_id)).toStrictEqual(["org_456", "org_789"]);

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        new RegExp(`may read \`${schema}\\.every_invoice\``),
      );
    });
  }
});

describe("a number the application may set", () => {
  // `setval` needs UPDATE on a sequence, and `ALTER SEQUENCE` needs its owner. Start-up asked about
  // one sequence, the payments'. A proposal's number, a brake's number and a move's place come from
  // three more, and a later step's sequence would be a fifth (decisions 153, 156 and 161).
  for (const sequence of [
    "dsor.proposal_numbers",
    "dsor.control_numbers",
    "dsor.proposal_moves_seq_seq",
  ]) {
    it(`an application that may set ${sequence} is refused at start-up`, async () => {
      await asTheOwner(() => db.exec(`GRANT UPDATE ON SEQUENCE ${sequence} TO dsor_runtime`));

      // Not testing nothing: the application sets the next number, backward if it likes.
      const { rows } = await db.query<{ n: string }>(
        `SELECT setval('${sequence}', 4999)::text AS n`,
      );
      expect(rows[0]?.n).toBe("4999");

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        new RegExp(`may set the next number of \`${sequence.replace(".", "\\.")}\``),
      );
    });
  }

  for (const [how, grant] of [
    [
      "one SET ROLE away",
      "CREATE ROLE numberer; GRANT UPDATE ON SEQUENCE dsor.proposal_numbers TO numberer; GRANT numberer TO dsor_runtime WITH INHERIT FALSE",
    ],
    [
      "through a helper function's owner",
      `CREATE ROLE counter; GRANT UPDATE ON SEQUENCE dsor.proposal_numbers TO counter;
       CREATE FUNCTION public.a_helper() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
       ALTER FUNCTION public.a_helper() OWNER TO counter`,
    ],
  ] as const) {
    it(`the proposals' numbers, set ${how}, are refused`, async () => {
      await asTheOwner(() => db.exec(grant));

      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        /may set the next number of `dsor\.proposal_numbers`/,
      );
    });
  }

  it("a sequence no step has made yet is asked too", async () => {
    // Every sequence, not a list: the next one a migration adds is asked without anyone
    // remembering to add it here (decision 161).
    await asTheOwner(() =>
      db.exec(
        "CREATE SEQUENCE public.ticket_numbers; GRANT UPDATE ON SEQUENCE public.ticket_numbers TO dsor_runtime",
      ),
    );

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may set the next number of `public\.ticket_numbers`/,
    );
  });

  it("a sequence the application may become the owner of is refused", async () => {
    // Its owner may ALTER SEQUENCE ... RESTART with no UPDATE at all: the owner here gives up its
    // own rights on it, which an owner may, and keeps ALTER, which only ownership gives. Found by
    // breaking the check on purpose: while the owner kept UPDATE, the UPDATE question refused it
    // first, and the ownership question had no case of its own. PostgreSQL will not hand over a
    // sequence that belongs to a table's column, so this one belongs to nothing.
    await asTheOwner(() =>
      db.exec(`CREATE SEQUENCE public.ticket_numbers; CREATE ROLE keeper;
               ALTER SEQUENCE public.ticket_numbers OWNER TO keeper;
               REVOKE ALL ON SEQUENCE public.ticket_numbers FROM keeper;
               GRANT keeper TO dsor_runtime WITH INHERIT FALSE`),
    );

    // Not testing nothing: one SET ROLE, and the next number is whatever the application says.
    await db.exec("SET ROLE keeper");
    await db.exec("ALTER SEQUENCE public.ticket_numbers RESTART WITH 5000");
    await db.exec("SET ROLE dsor_runtime");

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
      /may set the next number of `public\.ticket_numbers`/,
    );
  });

  it("taking the next number, which the application must, does not refuse start-up", async () => {
    // USAGE is nextval's right, and every new payment, proposal and brake needs it.
    const { rows } = await db.query<{ n: string }>(
      "SELECT nextval('dsor.proposal_numbers')::text AS n",
    );
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);

    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).resolves.toBeUndefined();
  });
});
