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
import { readNow } from "../src/freshness.ts";
import type { Invoice } from "../src/invoice.ts";
import { callOperation, makeDoor, PIPELINE } from "../src/operations.ts";
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

/** INV-1008 as a handler might hand it over, built in the test rather than read. */
const INV_1008_ROW = Object.freeze({
  uri: INV_1008,
  tenantId: "org_456",
  id: "INV-1008",
  vendor: "VENDOR-44",
  amount: Object.freeze({ value: "31400.00", currency: "USD" }),
  status: "issued",
}) as unknown as Invoice;

/** A door whose invoice.get and invoice.list hand over INV-1008 with whatever label they are given. */
const handingLabel = (label: () => unknown) =>
  makeDoor(PIPELINE, {
    "invoice.get": async (_args, _contract, askedBy) => ({
      kind: "data",
      askedBy,
      invoice: INV_1008_ROW,
      freshness: label() as never,
    }),
    "invoice.list": async (_args, _contract, askedBy) => ({
      kind: "page",
      askedBy,
      page: { invoices: [INV_1008_ROW], next: undefined },
      freshness: label() as never,
    }),
  });

describe("the door insists on a label", () => {
  // Decision 120: the code that reads writes the label, and the door refuses a read without one,
  // as the program's own error, like a row with no address. A read written next year that forgets
  // its label fails loudly instead of answering.
  const notALabel: readonly [string, () => unknown][] = [
    ["no label at all", () => undefined],
    // Decision 120 spells the modes as the schemas do. §27's capitals are not one of them here.
    ["its mode in capitals", () => ({ ...readNow(), mode: "CURRENT" })],
    ["a mode that is not one of the four", () => ({ ...readNow(), mode: "fresh" })],
    ["no time", () => ({ ...readNow(), observed_at: undefined })],
    ["a time that is not a time", () => ({ ...readNow(), observed_at: "yesterday" })],
    ["no connector", () => ({ ...readNow(), connector: "" })],
  ];

  for (const [what, label] of notALabel) {
    it(`DSOR-FRS-01a: a read with ${what} is the program's own error, never to retry`, async () => {
      const door = handingLabel(label);

      for (const answer of [
        await door(AGENT, "invoice.get", { invoice: INV_1008 }),
        await door(AGENT, "invoice.list", {}),
      ]) {
        expect(answer.kind).toBe("error");

        if (answer.kind === "error") {
          expect(answer.envelope.code).toBe("INTERNAL_ERROR");
          expect(answer.envelope.retry).toBe("never");
        }
      }
    });
  }

  it("DSOR-FRS-01a: the label that leaves is exactly its three parts, so nothing rides along in it", async () => {
    // Decision 117's lesson, for the label: built from its named parts, not copied whole.
    const door = handingLabel(() => ({ ...readNow(), copy: INV_1008_ROW }));
    const answer = await door(AGENT, "invoice.get", { invoice: INV_1008 });

    expect(answer.kind).toBe("data");

    if (answer.kind === "data") {
      expect(Object.keys(answer.freshness).sort()).toStrictEqual([
        "connector",
        "mode",
        "observed_at",
      ]);
      expect(JSON.stringify(answer)).not.toContain("31400.00");
    }
  });
});
