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
    "DELETE FROM public.payments WHERE tenant_id IN ('org_456', 'org_789')",
    // STEP 18: and the slips, which a test may revoke or expire.
    "DELETE FROM dsor.delegations WHERE tenant IN ('org_456', 'org_789')",
    "DELETE FROM public.invoices WHERE tenant_id IN ('org_456', 'org_789')",
    rowsFrom("004_running_example.sql"),
    rowsFrom("010_payments_running_example.sql"),
    rowsFrom("014_delegations_running_example.sql"),
    // STEP 19: and del_100's mode, which 015's default does not give it (decision 130).
    rowsFrom("017_del_100_may_be_used_unattended.sql"),
    // So a test that makes a payment knows it is PAY-902, whatever ran before it.
    "ALTER SEQUENCE public.payment_numbers RESTART WITH 902",
  ];
}
