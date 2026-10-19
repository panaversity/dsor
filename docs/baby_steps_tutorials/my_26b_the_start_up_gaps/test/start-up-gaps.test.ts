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
