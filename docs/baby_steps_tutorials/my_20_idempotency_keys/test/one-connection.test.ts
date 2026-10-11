// STEP 11: PGlite has one connection, and a statement with a company must be a unit on it.
//
// The adapter says the company inside a transaction, then runs the statement. On a pool each
// transaction has its own connection. On PGlite there is one, and if a plain statement could slip
// in between the two — while the transaction is open — it would run INSIDE that transaction and see
// that company's rows. The README's rule DSOR-RP-01c relies on PGlite serialising its transaction;
// this measures it rather than trusting the library.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { overPGlite } from "../src/database.ts";
import { aDatabase } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase(); // as the application
});

afterAll(async () => {
  await db.close();
});

const FORGOT_THE_COMPANY =
  "SELECT tenant_id FROM public.invoices WHERE id = 'INV-1008' ORDER BY tenant_id";

describe("one connection, three statements at once", () => {
  it("a plain statement cannot slip inside another company's open transaction", async () => {
    const companies = (rows: { tenant_id: string }[]): string[] => rows.map((r) => r.tenant_id);

    // A transaction for org_456 that holds the connection open for a while after saying the
    // company — the window a stranger's statement would have to slip into.
    const slow = db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await new Promise((resolve) => setTimeout(resolve, 100));

      return companies((await tx.query<{ tenant_id: string }>(FORGOT_THE_COMPANY)).rows);
    });
    // Issued while that transaction is open: a statement with no company, and one for org_789.
    const plain = db
      .query<{ tenant_id: string }>(FORGOT_THE_COMPANY)
      .then((r) => companies(r.rows));
    const other = overPGlite(db)
      .query<{ tenant_id: string }>(FORGOT_THE_COMPANY, undefined, "org_789")
      .then((r) => companies(r.rows));

    expect(await Promise.all([slow, plain, other])).toStrictEqual([["org_456"], [], ["org_789"]]);
  });
});
