// NEW IN STEP 15: every answer says how old its data is, and from where.
//
// Measured on step 14's demo: the agent's answer for INV-1008 is `issued`, and nothing more. It
// does not say when that was true, or where it came from. An agent that keeps the answer in its
// memory cannot tell an hour-old copy from a fresh read, and neither can a person checking its work.
//
// Rule DSOR-FRS-01a: every query result MUST state `observed_at`, the `resource_version` where one
// exists, the connector, and the freshness mode actually delivered.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callOperation } from "../src/operations.ts";
import { aDatabase, resetInvoices } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
  await resetInvoices();
});

afterAll(async () => {
  await db.close();
});

describe("every answer says how old its data is", () => {
  it("DSOR-FRS-01a: the agent's INV-1008 says it is current, read from postgres within this request", async () => {
    const before = Date.now();
    const answer = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });
    const after = Date.now();

    expect(answer.kind).toBe("data");

    if (answer.kind === "data") {
      expect(answer.freshness.mode).toBe("current");
      expect(answer.freshness.connector).toBe("postgres");

      const observed = Date.parse(answer.freshness.observed_at);

      expect(observed).toBeGreaterThanOrEqual(before);
      expect(observed).toBeLessThanOrEqual(after);
      // Decision 120: no invoice has a version until step 21, so the label names none.
      expect("resource_version" in answer.freshness).toBe(false);
    }
  });

  it("DSOR-FRS-01a: a page says it too, once for the whole page, because a page is one read", async () => {
    const before = Date.now();
    const answer = await callOperation(SUPERVISOR, "invoice.list", { limit: 3 });
    const after = Date.now();

    expect(answer.kind).toBe("page");

    if (answer.kind === "page") {
      expect(answer.freshness.mode).toBe("current");
      expect(answer.freshness.connector).toBe("postgres");

      const observed = Date.parse(answer.freshness.observed_at);

      expect(observed).toBeGreaterThanOrEqual(before);
      expect(observed).toBeLessThanOrEqual(after);
    }
  });
});
