// STEP 12: the generated cross-tenant suite, on PGlite.
//
// One test per operation, from the registry — see test/support/cross-tenant-suite.ts for what it
// asks and why. This file only says where the rows live for this run.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll } from "vitest";
import { crossTenantSuite, ROWS_OF, type Row } from "./support/cross-tenant-suite.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

crossTenantSuite({
  reset: async () => {
    await resetTheStory();
    await forgetTheLog("org_456");
    await forgetTheLog("org_789");
  },
  rowsOf: (tenant) =>
    asTheOwner(async () => {
      // STEP 17: invoices and payments, from the one query both tiers run.
      const { rows } = await db.query<Row>(ROWS_OF, [tenant]);

      return rows;
    }),
});
