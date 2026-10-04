// NEW IN STEP 17: payments in the database. The unit tests prove the commands in memory.
// These prove the table: the database numbers each draft, keeps it inside its company,
// lets dsor_runtime change only its status, decides between two cancels, and refuses a
// key into another company (step 17's README, C5 to C7, and decisions 3, 9, and 16).
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { OUR_EXTENSIONS, SUPERVISOR, THE_SUPERVISOR, correlationFor } from "./helpers.ts";
import { NO_PRIVILEGE, dbRegistry, newPool, requestId, tryThenRollBack } from "./db.ts";

// The program's own pool, and the test's window into the database, both dsor_runtime.
const pool = newPool();
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** user_123 drafts a payment for INV-1008, and gives back the answer and the payment's id. */
async function draft(who: RequestEnvelope = SUPERVISOR): Promise<{ answer: Answer; id: string }> {
  const answer = await call(registry, log, who, "payment.create", INV_1008);
  const id = "data" in answer ? (answer.data as { id?: unknown }).id : undefined;
  if (typeof id !== "string") throw new Error(`no draft: ${JSON.stringify(answer)}`);
  return { answer, id };
}

/** user_123 cancels one of org_456's payments, by its id. */
function cancel(id: string): Promise<Answer> {
  return call(registry, log, SUPERVISOR, "payment.cancel", {
    payment: `dsor://org_456/payment/${id}`,
  });
}

/** The payment's row as dsor_runtime sees it inside this company, read straight from SQL. */
async function rowsOf(company: string, id: string): Promise<unknown[]> {
  const sql = `SELECT tenant_id, id, invoice_id, vendor_id, amount_value, amount_currency, status
                 FROM app.payments WHERE id = $1`;
  return (await tryThenRollBack(observer, sql, company, [id])).rows;
}

// One column list for the inserts below, written by hand as a broken program would.
const INSERT = `INSERT INTO app.payments
                  (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
                VALUES ($1, $2, $3, $4, 'USD', 'draft')`;

describe("the drafts, on the database", () => {
  // Every run adds a draft, so the number is PAY-901 only on a fresh branch.
  it("step 17's decision 4: user_123 drafts INV-1008: 31,400.00 USD for VENDOR-44, numbered by the database", async () => {
    const { answer, id } = await draft();
    expect(answer).toStrictEqual({
      data: {
        tenant_id: "org_456",
        id: expect.stringMatching(/^PAY-\d+$/),
        invoice_id: "INV-1008",
        vendor_id: "VENDOR-44",
        amount: { value: "31400.00", currency: "USD" },
        status: "draft",
      },
      classification: "confidential",
      semantics: "compensatable",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(Number(id.slice("PAY-".length))).toBeGreaterThanOrEqual(901);
    expect(await rowsOf("org_456", id)).toStrictEqual([
      {
        tenant_id: "org_456",
        id,
        invoice_id: "INV-1008",
        vendor_id: "VENDOR-44",
        amount_value: "31400.00",
        amount_currency: "USD",
        status: "draft",
      },
    ]);
  });

  it("DSOR-TEN-01b: org_456's draft is invisible inside org_789", async () => {
    const { id } = await draft();
    expect(await rowsOf("org_789", id)).toStrictEqual([]);
  });

  it("DSOR-EXE-02: the draft's record is committed before the answer, with the payment's URI", async () => {
    const request_id = requestId("payment-create");
    const { id } = await draft({ ...SUPERVISOR, request_id });
    const sql = `SELECT operation, "authorization", result, tenant, resources, row_count, extensions
                   FROM dsor.audit WHERE correlation->>'request_id' = $1`;
    const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
    expect(rows).toStrictEqual([
      {
        operation: "payment.create@1",
        authorization: "ALLOW",
        result: "ok",
        tenant: "org_456",
        resources: [`dsor://org_456/payment/${id}`],
        row_count: 1,
        extensions: { [OUR_EXTENSIONS]: { classification: "confidential" } },
      },
    ]);
  });
});

describe("the cancels, on the database", () => {
  it("step 17's decision 9: cancel, then cancel again: CONFLICT, and the row stays cancelled", async () => {
    const { id } = await draft();
    expect(await cancel(id)).toMatchObject({
      semantics: "atomic",
      data: { id, status: "cancelled" },
    });
    expect(await cancel(id)).toMatchObject({ code: "CONFLICT" });
    expect(await rowsOf("org_456", id)).toMatchObject([{ status: "cancelled" }]);
  });

  // Numbers start at 901, so PAY-0 never exists, however many runs the branch has seen.
  it("step 17's decision 9: a payment that does not exist gets RESOURCE_NOT_FOUND", async () => {
    expect(await cancel("PAY-0")).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no payment "PAY-0"',
    });
  });

  // The UPDATE decides, so the second waits for the first, finds no draft, and looks again.
  it("step 17's decision 9: two cancels of one draft at the same moment: exactly one succeeds", async () => {
    const { id } = await draft();
    const answers = await Promise.all([cancel(id), cancel(id)]);
    const heard = answers.map((answer) => ("data" in answer ? "ok" : answer.code)).sort();
    expect(heard).toStrictEqual(["CONFLICT", "ok"]);
  });
});

describe("what dsor_runtime may do to app.payments", () => {
  it.each([
    ["change a draft's amount", "UPDATE app.payments SET amount_value = 1 WHERE id = $1"],
    ["remove a draft", "DELETE FROM app.payments WHERE id = $1"],
  ])("step 17's decision 3: dsor_runtime cannot %s", async (_what, sql) => {
    const { id } = await draft();
    await expect(tryThenRollBack(observer, sql, "org_456", [id])).rejects.toMatchObject(
      NO_PRIVILEGE,
    );
  });

  // The key is (tenant_id, invoice_id), so it can point only at an invoice of the row's own
  // company. org_456 has no INV-2001 (step 11's README, decision 9).
  it("step 17's decision 16: a payment of org_456 cannot point at org_789's INV-2001", async () => {
    const values = ["org_456", "INV-2001", "VENDOR-77", "12500.00"];
    await expect(tryThenRollBack(observer, INSERT, "org_456", values)).rejects.toMatchObject({
      code: "23503",
    });
  });

  // The policy checks the row written, as it filters the rows read.
  it("DSOR-TEN-01b: a row of org_789 cannot be written inside org_456", async () => {
    const values = ["org_789", "INV-1008", "VENDOR-77", "99000.00"];
    await expect(tryThenRollBack(observer, INSERT, "org_456", values)).rejects.toMatchObject(
      NO_PRIVILEGE,
    );
  });
});
