// NEW IN STEP 09: the invoices come from the table app.invoices, and money never becomes
// a number on the way (C6 in step 09's README, decisions 7 and 12).
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbInvoices, createDbLog, openPool } from "../src/postgres.ts";
import {
  NO_PRIVILEGE,
  RUNTIME_URL,
  dbRegistry,
  newPool,
  requestId,
  rowsFor,
  tryThenRollBack,
} from "./db.ts";
import { AGENT } from "./helpers.ts";

const pool = openPool(RUNTIME_URL);
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});

// INV-1008, typed out again from the running example rather than read from the migration.
// NEW IN STEP 10: with its company (step 10's README, decision 10).
const INV_1008 = {
  tenant_id: "org_456",
  id: "INV-1008",
  vendor_id: "VENDOR-44",
  amount: { value: "31400.00", currency: "USD" },
  open_amount: { value: "31400.00", currency: "USD" },
  status: "issued",
};

describe("C6: invoices come from the database, and money stays a string", () => {
  it("DSOR-MON-01: invoice.get returns INV-1008 from app.invoices, its money exactly 31400.00", async () => {
    const answer = await call(dbRegistry(pool), createDbLog(pool), AGENT, "invoice.get", {
      id: "INV-1008",
    });
    // toStrictEqual: "31400" or the number 31400 would both fail here.
    expect(answer).toMatchObject({ data: INV_1008 });
    expect((answer as { data: unknown }).data).toStrictEqual(INV_1008);
  });

  it("the store gives back undefined for an invoice that is not there", async () => {
    expect(await createDbInvoices(pool).get("org_456", "INV-9999")).toBeUndefined();
  });

  // Found by the review: this test said "recorded" and never read the record.
  it("DSOR-EXE-02: invoice.get for INV-9999 is refused as not found, and recorded", async () => {
    const id = requestId("c6-missing");
    const answer = await call(
      dbRegistry(pool),
      createDbLog(pool),
      { ...AGENT, request_id: id },
      "invoice.get",
      { id: "INV-9999" },
    );
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(await rowsFor(observer, id)).toMatchObject([
      { authorization: "ALLOW", result: "RESOURCE_NOT_FOUND" },
    ]);
  });

  // Found by the review: pasting the id into the SQL passed every test. The id travels
  // to Postgres as a value ($1), never as part of the SQL text.
  it("an id written as SQL finds nothing: the id is a value, never SQL", async () => {
    const answer = await call(dbRegistry(pool), createDbLog(pool), AGENT, "invoice.get", {
      id: "INV-9999' OR '1'='1",
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  // dsor_runtime reads the company's data and never changes it. Commands come later.
  // No rule id: this is our decision 5, not a rule of DSoR.
  it("UPDATE on app.invoices as dsor_runtime fails with 42501", async () => {
    await expect(
      tryThenRollBack(observer, "UPDATE app.invoices SET status = 'paid' WHERE id = 'INV-1008'"),
    ).rejects.toMatchObject(NO_PRIVILEGE);
  });
});
