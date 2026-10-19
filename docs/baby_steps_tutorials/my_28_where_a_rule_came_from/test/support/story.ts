// STEP 17: the statements that put the story's rows back, in one place for both tiers.
//
// Three places did this for the invoices alone, each deleting them and running 004 again. Since
// step 17 a payment points at its invoice, so the payments must go first and come back after, and
// the next payment's number starts again. Three copies of that longer list would drift apart.
//
// The story's two companies only, so a database that also holds somebody else's rows keeps them.
// The rows come from the migrations that wrote them, never from a second copy here.

import { fileURLToPath } from "node:url";
import { migrationsIn } from "../../src/migrations.ts";

/** Each statement, in order, for a connection that may run several in one string. */
export function storyStatements(): readonly string[] {
  const migrations = migrationsIn(fileURLToPath(new URL("../../migrations", import.meta.url)));
  const rowsFrom = (name: string): string => {
    const migration = migrations.find((m) => m.name === name);

    if (migration === undefined) {
      throw new TypeError(`the story's rows are in ${name}, and there is no such migration`);
    }

    return migration.sql;
  };

  return [
    // STEP 22: the proposals and their moves, moves first because they point at them.
    // STEP 25: and the brakes, so each test starts with none on.
    "DELETE FROM dsor.agent_controls WHERE tenant IN ('org_456', 'org_789')",
    // STEP 27: and the controls, which a test may switch on.
    "DELETE FROM dsor.controls WHERE tenant IN ('org_456', 'org_789')",
    "DELETE FROM dsor.proposal_moves WHERE tenant IN ('org_456', 'org_789')",
    // STEP 24: and the reservations and the day totals, which point at proposals and slips.
    "DELETE FROM dsor.reservations WHERE tenant IN ('org_456', 'org_789')",
    "DELETE FROM dsor.day_totals WHERE tenant IN ('org_456', 'org_789')",
    "DELETE FROM dsor.proposals WHERE tenant IN ('org_456', 'org_789')",
    "DELETE FROM public.payments WHERE tenant_id IN ('org_456', 'org_789')",
    // STEP 18: and the slips, which a test may revoke or expire.
    "DELETE FROM dsor.delegations WHERE tenant IN ('org_456', 'org_789')",
    "DELETE FROM public.invoices WHERE tenant_id IN ('org_456', 'org_789')",
    rowsFrom("004_running_example.sql"),
    // STEP 26: and VENDOR-44's bills in rupees and in pounds.
    rowsFrom("027_bills_in_rupees_and_pounds.sql"),
    rowsFrom("010_payments_running_example.sql"),
    rowsFrom("014_delegations_running_example.sql"),
    // STEP 19: and del_100's mode, which 015's default does not give it (decision 130).
    rowsFrom("017_del_100_may_be_used_unattended.sql"),
    // STEP 24: and its daily limit.
    rowsFrom("023_del_100_has_a_daily_limit.sql"),
    // STEP 25: and org_789's slip, of the same number.
    rowsFrom("026_org_789_has_a_slip_too.sql"),
    // STEP 27: and org_456's CFO control, waiting for review.
    rowsFrom("029_the_cfo_control.sql"),
    // So a test that makes a payment knows it is PAY-902, whatever ran before it.
    "ALTER SEQUENCE public.payment_numbers RESTART WITH 902",
    // STEP 22: and so a test's first proposal is prop_1.
    "ALTER SEQUENCE dsor.proposal_numbers RESTART WITH 1",
  ];
}
