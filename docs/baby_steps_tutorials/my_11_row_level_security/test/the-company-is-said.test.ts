// NEW IN STEP 11: every statement about rows says which company it is for, and says it to
// PostgreSQL in a way that cannot outlive the statement.
//
// Step 10 kept the companies apart with a WHERE in every query. This step adds a second lock inside
// PostgreSQL (migration 005), and a lock inside the database has to be told which company a
// statement is for. These tests pin *how* it is told: per statement, inside that statement's own
// transaction, so that nothing is left behind on the connection for the next request to inherit.
//
// Rule DSOR-RP-01c: the tenant setting MUST be transaction-local.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audit, theHead, theLog, type DecisionToRecord } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { getInvoice, issueInvoice } from "../src/invoice.ts";
import { theDatabase, useDatabase } from "../src/store.ts";
import { aDatabase, forgetTheLog, resetInvoices } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  useDatabase(overPGlite(db));
  await resetInvoices();
  await forgetTheLog("org_456");
});

function aDecision(id: string): DecisionToRecord {
  return {
    kind: "decision",
    subject: "user_123",
    tenant: "org_456",
    requestId: id,
    operation: "invoice.get@1",
    authorization: "ALLOW",
    result: "ALLOWED",
  };
}

describe("a statement that says its company", () => {
  it("DSOR-RP-01c: the company is set while the statement runs", async () => {
    const { rows } = await theDatabase("org_456").query<{ said: string | null }>(
      "SELECT current_setting('dsor.tenant_id', true) AS said",
    );

    expect(rows[0]?.said).toBe("org_456");
  });

  it("DSOR-RP-01c: and is gone when the statement is done, never left on the connection", async () => {
    await theDatabase("org_456").query("SELECT 1");

    // Asked on the bare connection, outside any statement a store ran. NULL if the setting was
    // never made in this session; the empty string if it was made once and died with its
    // transaction. Either is "no company". `org_456` here would be the pool leak §36 warns about:
    // the next request on this connection, for any company, would read org_456's rows.
    const { rows } = await db.query<{ said: string | null }>(
      "SELECT current_setting('dsor.tenant_id', true) AS said",
    );

    expect(rows[0]?.said ?? "").toBe("");
  });

  it("a store cannot ask for rows without saying whose", () => {
    // A bug, and it must be loud. The database's own answer to a missing company is no rows
    // (DSOR-RP-01d), which a store would report as "not found" — a correct refusal that hides a
    // wrong program.
    expect(() => theDatabase("")).toThrow(/no company/);
    expect(() => theDatabase(" ")).toThrow(/no company/); // an evaluation found this one let through
    expect(() => theDatabase(undefined as unknown as string)).toThrow(/no company/);
  });
});

describe("every store statement says the request's company", () => {
  it("the invoices and the log never run a statement about rows without a company", async () => {
    // A connection that remembers what each statement said, in front of the real one.
    const said: Array<string | undefined> = [];
    const real = overPGlite(db);

    useDatabase({
      query: (sql, params, tenant) => {
        said.push(tenant);

        return real.query(sql, params, tenant);
      },
    });

    await getInvoice("org_456", "INV-1008");
    await issueInvoice("org_456", "INV-1009");
    await issueInvoice("org_456", "INV-1009"); // the not-a-draft path: the UPDATE, then the read
    await audit(aDecision("req_1"));
    await theHead("org_456");
    await theLog("org_456");
    await forgetTheLog("org_456");

    // Every store, every path, and not one statement that forgot.
    expect(said.length).toBeGreaterThanOrEqual(9);
    expect(new Set(said)).toStrictEqual(new Set(["org_456"]));
  });
});
