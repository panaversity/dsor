// STEP 12: the generated cross-tenant suite, on PGlite.
//
// One test per operation, from the registry — see test/support/cross-tenant-suite.ts for what it
// asks and why. This file only says where the rows live for this run.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { crossTenantSuite, ROWS_OF, type Row } from "./support/cross-tenant-suite.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

const rowsOf = (tenant: string): Promise<readonly Row[]> =>
  asTheOwner(async () => {
    // STEP 17: invoices and payments, from the one query both tiers run.
    const { rows } = await db.query<Row>(ROWS_OF, [tenant]);

    return rows;
  });

crossTenantSuite({
  reset: async () => {
    await resetTheStory();
    await forgetTheLog("org_456");
    await forgetTheLog("org_789");
  },
  rowsOf,
});

// Decision 152: the suite's question "are the other company's rows exactly as they were?" is only as
// good as what rowsOf reads. Since step 21 every invoice and payment has a version, which the
// application may set to any value, and rowsOf did not read it: a careless command that changed
// another company's versions, and nothing else, passed.
it("rowsOf sees a write to the other company that changes nothing but a version", async () => {
  for (const table of ["invoices", "payments"]) {
    await resetTheStory();

    const before = await rowsOf("org_789");

    await asTheOwner(() =>
      db.exec(`UPDATE public.${table} SET version = version + 5 WHERE tenant_id = 'org_789'`),
    );

    expect(await rowsOf("org_789"), table).not.toStrictEqual(before);
  }
});
