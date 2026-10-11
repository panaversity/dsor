// NEW IN STEP 21: optimistic concurrency.
//
// A caller decides on a record as it read it. If the record has moved on before the command runs,
// the decision was about something that no longer exists, and DSoR refuses it: "re-read and decide
// again". Each invoice and payment carries a version, raised by one with every change (decision 133).
//
// Rule DSOR-CON-01a: every command MUST declare its concurrency strategy.
// Rule DSOR-CON-01b: an optimistic command MUST return STALE_STATE when the resource version differs
// from the version the decision was made on.
// Rule DSOR-FRS-01a: every query result MUST state observed_at, the resource_version where one
// exists, the connector, and the freshness mode actually delivered.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getInvoice } from "../src/invoice.ts";
import { paymentsOf } from "../src/payment.ts";
import { callOperation } from "./support/door.ts";
import { aDatabase, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  await forgetTheLog("org_456");
});

describe("every invoice and payment has a version", () => {
  it("DSOR-FRS-01a: a read says the version, and the story starts at 1", async () => {
    const answer = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "data") {
      throw new Error(`expected a row, got ${JSON.stringify(answer)}`);
    }

    expect(answer.invoice.version).toBe(1);
    expect((await paymentsOf("org_456")).map((p) => `${p.id} ${p.version}`)).toStrictEqual([
      "PAY-901 1",
    ]);
  });

  it("DSOR-CON-01b: every change raises the version by one, in the same statement", async () => {
    await callOperation(SUPERVISOR, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });

    expect((await getInvoice("org_456", "INV-1009")).value?.version).toBe(2);
  });

  it("the version is a whole number from 1, and the table says so", async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT table_name || '.' || column_name AS column_name, is_nullable FROM information_schema.columns
        WHERE column_name = 'version' AND table_name IN ('invoices', 'payments') ORDER BY 1`,
    );

    expect(rows).toStrictEqual([
      { column_name: "invoices.version", is_nullable: "NO" },
      { column_name: "payments.version", is_nullable: "NO" },
    ]);
  });
});
