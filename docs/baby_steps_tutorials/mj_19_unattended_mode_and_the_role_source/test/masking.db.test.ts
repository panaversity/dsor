// The agent's answers from the database are masked too (DSOR-CLS-02a;
// step 14's README, C2). The same claims as test/masking.test.ts, asked of app.invoices.
import { afterAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog, openPool } from "../src/postgres.ts";
import { RUNTIME_URL, dbRegistry } from "./db.ts";
import { AGENT, FIRM_IN_789, MASKED_1008_OF_456, MASKED_1008_OF_789 } from "./helpers.ts";

const pool = openPool(RUNTIME_URL);
afterAll(async () => {
  await pool.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

/** The data of an answer, or the whole answer when it was refused. */
function dataOf(answer: Answer): unknown {
  return "data" in answer ? answer.data : answer;
}

describe("C2 on the database: for an agent, every field above its clearance is left out", () => {
  it("DSOR-CLS-02a: on the database, accounts-payable-fte's INV-1008 has no amount and no open_amount", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(dataOf(answer)).toStrictEqual(MASKED_1008_OF_456);
  });

  it("DSOR-CLS-02a: on the database, firm-ap-fte's org_789 INV-1008 has no amount and no open_amount", async () => {
    const answer = await call(registry, log, FIRM_IN_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(dataOf(answer)).toStrictEqual(MASKED_1008_OF_789);
  });

  it("DSOR-CLS-02a: on the database, no item of the agent's page has amount or open_amount, and the page keeps its next_cursor", async () => {
    const page = dataOf(await call(registry, log, AGENT, "invoice.list", {})) as {
      items: object[];
      next_cursor?: string;
    };
    expect(page.items).toHaveLength(10);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toStrictEqual(["id", "status", "tenant_id", "vendor_id"]);
    }
    expect(page.next_cursor).toBe("INV-1010");
  });

  // The rules table claimed both agents' invoice.list on the database, and only
  // accounts-payable-fte's was asked here. Found by the Stage 2 review.
  it("DSOR-CLS-02a: on the database, no item of firm-ap-fte's page in org_789 has amount or open_amount", async () => {
    const page = dataOf(await call(registry, log, FIRM_IN_789, "invoice.list", {})) as {
      items: object[];
      next_cursor?: string;
    };
    // org_789's five invoices fit on one page, so there is no cursor.
    expect(page.items).toHaveLength(5);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toStrictEqual(["id", "status", "tenant_id", "vendor_id"]);
    }
    expect(page.next_cursor).toBeUndefined();
  });
});
