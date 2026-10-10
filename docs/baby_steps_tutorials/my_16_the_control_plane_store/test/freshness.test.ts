// STEP 15: every answer says how old its data is, and from where.
//
// Measured on step 14's demo: the agent's answer for INV-1008 is `issued`, and nothing more. It
// does not say when that was true, or where it came from. An agent that keeps the answer in its
// memory cannot tell an hour-old copy from a fresh read, and neither can a person checking its work.
//
// Rule DSOR-FRS-01a: every query result MUST state `observed_at`, the `resource_version` where one
// exists, the connector, and the freshness mode actually delivered.
// Rule DSOR-FRS-01b: DSoR MUST NOT label a cached value `CURRENT`.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leaveTheDoor } from "../src/boundary.ts";
import { overPGlite } from "../src/database.ts";
import { success } from "../src/envelopes.ts";
import { cannotBeLabelled, readNow } from "../src/freshness.ts";
import type { Invoice } from "../src/invoice.ts";
import { callOperation, makeDoor, PIPELINE } from "../src/operations.ts";
import { findPerson } from "../src/people.ts";
import { useDatabase } from "../src/store.ts";
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
    // Decision 121: an exact ISO time only, and not one in the future. JavaScript reads "2026" as
    // a date, and a date object is not text at all. The year is labelled observational, so the
    // check on an old `current` cannot be what refuses it: measured, it was, until this said so.
    [
      "a time that is only a year",
      () => ({ ...readNow(), mode: "observational", observed_at: "2026" }),
    ],
    ["a time that is a date object", () => ({ ...readNow(), observed_at: new Date() })],
    [
      "a time in the future",
      () => ({ ...readNow(), observed_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
    ],
    ["an empty connector", () => ({ ...readNow(), connector: "" })],
    ["no connector at all", () => ({ mode: "current", observed_at: new Date().toISOString() })],
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

  it("DSOR-FRS-01a: a query that answers with a command's receipt is the program's own error, never to retry", async () => {
    // Decision 121. A receipt carries no freshness label, so a query whose code copied
    // invoice.issue's shape would leave unlabelled, and its read would not be written down either.
    const door = makeDoor(PIPELINE, {
      "invoice.get": async (_args, _contract, askedBy) => ({
        kind: "result",
        askedBy,
        envelope: success({
          data: INV_1008_ROW as unknown as Readonly<Record<string, unknown>>,
          semantics: "atomic",
          payloadHash: "sha256:0",
          tenant: "org_456",
          requestId: "req_0",
          principalId: askedBy,
        }),
      }),
    });
    const answer = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(answer.kind).toBe("error");

    if (answer.kind === "error") {
      expect(answer.envelope.code).toBe("INTERNAL_ERROR");
      expect(answer.envelope.retry).toBe("never");
    }
  });

  it("DSOR-FRS-01a: the label that leaves is exactly its three parts, so nothing rides along in it", async () => {
    // Decision 117's lesson, for the label: built from its named parts, not copied whole. On a
    // single invoice and on a page (decision 121), and through `leaveTheDoor` alone as well.
    const door = handingLabel(() => ({ ...readNow(), copy: INV_1008_ROW }));
    const direct = leaveTheDoor(findPerson("accounts-payable-fte")!, {
      kind: "data",
      askedBy: "accounts-payable-fte",
      invoice: INV_1008_ROW,
      freshness: { ...readNow(), copy: INV_1008_ROW } as never,
    });

    for (const answer of [
      await door(AGENT, "invoice.get", { invoice: INV_1008 }),
      await door(AGENT, "invoice.list", {}),
      direct,
    ]) {
      expect(answer.kind === "data" || answer.kind === "page").toBe(true);

      if (answer.kind === "data" || answer.kind === "page") {
        expect(Object.keys(answer.freshness).sort()).toStrictEqual([
          "connector",
          "mode",
          "observed_at",
        ]);
        expect(JSON.stringify(answer)).not.toContain("31400.00");
      }
    }
  });
});

describe("a value read before this request is never current", () => {
  // §27: `current` is read from the system of record within this request. A label that says
  // `current` with a time from before the request began is a saved copy calling itself fresh, the
  // lie DSOR-FRS-01b forbids. The door knows when the request began, on the program's own clock,
  // the same clock the label's time comes from (decision 120).
  const anHourAgo = (): string => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it("DSOR-FRS-01b: a value read an hour ago and labelled current is the program's own error, never to retry", async () => {
    const door = handingLabel(() => ({ ...readNow(), observed_at: anHourAgo() }));

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

  it("DSOR-FRS-01b: the same saved value, labelled for what it is, leaves with its label and its time", async () => {
    // Decision 120 rejected relabelling: the door does not change a label, it refuses a false one.
    // A label that tells the truth about a saved copy is no lie, and leaves as it came.
    const savedAt = anHourAgo();
    const door = handingLabel(() => ({
      mode: "observational",
      observed_at: savedAt,
      connector: "postgres",
    }));
    const answer = await door(AGENT, "invoice.get", { invoice: INV_1008 });

    expect(answer.kind).toBe("data");

    if (answer.kind === "data") {
      expect(answer.freshness).toStrictEqual({
        mode: "observational",
        observed_at: savedAt,
        connector: "postgres",
      });
    }
  });

  it("DSOR-FRS-01b: the line is the moment the request began: read then is current, a millisecond earlier is not", () => {
    // Decision 121: only an hour-old label was tested, so a door that allowed any slack under an
    // hour would have passed.
    const startedAt = Date.now() - 1000;
    const readAt = (ms: number) => ({
      kind: "data" as const,
      askedBy: "accounts-payable-fte",
      invoice: INV_1008_ROW,
      freshness: {
        mode: "current" as const,
        observed_at: new Date(ms).toISOString(),
        connector: "postgres",
      },
    });

    expect(cannotBeLabelled(readAt(startedAt), startedAt, "query")).toBeUndefined();
    expect(cannotBeLabelled(readAt(startedAt - 1), startedAt, "query")).toMatch(
      /before this request began/,
    );
  });
});

describe("when the label's time is taken", () => {
  it("DSOR-FRS-01a: before the query, so the data is at least as fresh as the label says", async () => {
    // Decision 121. Taken after the reply, the time was a round trip later than the data, so the
    // label claimed more freshness than was true. A connection that answers 50 ms late shows it:
    // the label's time must be no later than the moment the invoices were asked for.
    const real = overPGlite(db);
    let asked = 0;

    useDatabase({
      query: async <T>(sql: string, params?: unknown[], tenant?: string) => {
        if (sql.includes("FROM public.invoices")) {
          asked = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        return real.query<T>(sql, params, tenant);
      },
    });

    try {
      const answer = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });

      expect(answer.kind).toBe("data");

      if (answer.kind === "data") {
        expect(asked).toBeGreaterThan(0);
        expect(Date.parse(answer.freshness.observed_at)).toBeLessThanOrEqual(asked);
      }
    } finally {
      useDatabase(real);
    }
  });
});
