// STEP 12: the generated cross-tenant suite, on PGlite.
//
// One test per operation, from the registry — see test/support/cross-tenant-suite.ts for what it
// asks and why. This file only says where the rows live for this run.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll } from "vitest";
import { crossTenantSuite } from "./support/cross-tenant-suite.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetInvoices } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

crossTenantSuite({
  reset: async () => {
    await resetInvoices();
    await forgetTheLog("org_456");
    await forgetTheLog("org_789");
  },
  rowsOf: (tenant) =>
    asTheOwner(async () => {
      const { rows } = await db.query<{ id: string; status: string }>(
        `SELECT tenant_id, id, vendor, amount_value::text AS amount, amount_currency, status
         FROM public.invoices WHERE tenant_id = $1 ORDER BY id`,
        [tenant],
      );

      return rows;
    }),
});
