// NEW IN STEP 13: a query has a ceiling the server holds, whatever the caller asks for.
//
// invoice.list is the first operation here that returns many rows. Measured on a copy of step 12
// with a list written the obvious way: `{ limit: 1,000,000 }` returned all 50,002 of org_456's
// invoices, three megabytes, in a tenth of a second. §7.1 says it in one sentence: an agent in a
// loop should not be able to download the whole customer table.
//
// Rule DSOR-QRY-01: DSoR MUST enforce a server-side maximum page size and maximum result size on
// every query, whether or not the client asks for a limit.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Invoice } from "../src/invoice.ts";
import { callOperation, makeDoor, PIPELINE, type Handler } from "../src/operations.ts";
import { bytesOf, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_RESULT_BYTES } from "../src/queries.ts";
import { overPGlite } from "../src/database.ts";
import { useDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetInvoices } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT_FOR_789 = { loggedInAs: "accounts-payable-fte", tenant: "org_789" };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
  await resetInvoices();
  // Three hundred more invoices for org_456 and thirty for org_789, as the owner: enough for three
  // full pages and a partial one, and enough to see that a page never crosses a company.
  await asTheOwner(() =>
    db.exec(`INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status)
             SELECT 'org_456', 'INV-' || lpad(g::text, 5, '0'), 'VENDOR-44', g, 'USD', 'issued'
               FROM generate_series(2000, 2299) AS g
             UNION ALL
             SELECT 'org_789', 'INV-' || lpad(g::text, 5, '0'), 'VENDOR-44', g, 'USD', 'draft'
               FROM generate_series(2000, 2029) AS g`),
  );
});

afterAll(async () => {
  await db.close();
});

/** One page, or a thrown error naming what came back instead. */
async function pageFor(login: typeof SUPERVISOR, args: Record<string, unknown>) {
  const answer = await callOperation(login, "invoice.list", args);

  if (answer.kind !== "page") {
    throw new Error(`expected a page, got ${JSON.stringify(answer)}`);
  }

  return answer.page;
}

describe("the ceiling", () => {
  it("DSOR-QRY-01: asking for one million rows returns one page", async () => {
    const page = await pageFor(SUPERVISOR, { limit: 1_000_000 });

    // The literal, not the constant: a test that compares the page with the number the code reads
    // passes whatever the number is. A mutation pass changed the default to fifty and every test
    // stayed green. Changing the ceiling is allowed; it is a visible act here.
    expect(page.invoices).toHaveLength(100);
    expect(MAX_PAGE_SIZE).toBe(100);
    // And the page says where the next one starts, as an address.
    expect(page.next).toBe(page.invoices.at(-1)?.uri);
  });

  it("DSOR-QRY-01: with no limit at all, the server picks the page size", async () => {
    const page = await pageFor(SUPERVISOR, {});

    expect(page.invoices).toHaveLength(25); // the literal, for the reason above
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(page.next).toBeDefined();
  });

  it("a smaller limit is the caller's to choose", async () => {
    const page = await pageFor(SUPERVISOR, { limit: 3 });

    expect(page.invoices.map((i) => i.id)).toStrictEqual(["INV-02000", "INV-02001", "INV-02002"]);
  });

  it("a limit that is not a whole number above zero is refused, not quietly fixed", async () => {
    for (const limit of [0, -1, 2.5, "ten", null, NaN, Infinity]) {
      const answer = await callOperation(SUPERVISOR, "invoice.list", { limit });

      expect(answer.kind, String(limit)).toBe("error");

      if (answer.kind === "error") {
        expect(answer.envelope.code).toBe("VALIDATION_FAILED");
        // And the refusal names what was sent. NaN and Infinity have no JSON, so a message built
        // with JSON.stringify said "got null" for both; a review caught it.
        expect(answer.envelope.message).toContain(String(limit));
      }
    }
  });
});

describe("where the ceiling is", () => {
  it("DSOR-QRY-01: the cap is in the SQL, not after the fact — the database hands back at most one row more than the page", async () => {
    // A connection that counts what each statement returned, in front of the real one. A list
    // that fetched everything and cut the page afterwards would pass every test above and still
    // pull fifty thousand rows across the wire; this is the one that sees it.
    const real = overPGlite(db);
    const returned: number[] = [];

    useDatabase({
      query: async <T>(sql: string, params?: unknown[], tenant?: string) => {
        const result = await real.query<T>(sql, params, tenant);

        // Every statement that reads the table, not only the one shaped like the list: a review
        // added a second, unordered SELECT of the whole table before the slice, and a count keyed
        // to `ORDER BY id` never saw it.
        if (sql.includes("public.invoices")) {
          returned.push(result.rows.length);
        }

        return result;
      },
    });

    try {
      await pageFor(SUPERVISOR, { limit: 1_000_000 });
      await pageFor(SUPERVISOR, {});

      expect(returned).toStrictEqual([MAX_PAGE_SIZE + 1, DEFAULT_PAGE_SIZE + 1]);
    } finally {
      useDatabase(real);
    }
  });
});

describe("the second layer: the door", () => {
  // The query written next year forgets its LIMIT. The handler's SQL is the first layer; this is
  // the second: after any handler runs, the door measures the answer against both maxima and
  // refuses one that exceeds them as the program's own error. Nothing oversize leaves the door.
  const careless = (invoices: Invoice[]): Handler => {
    return async (_args, _contract, askedBy) => ({
      kind: "page",
      askedBy,
      page: { invoices, next: undefined },
    });
  };
  const anInvoice = (i: number, vendor = "VENDOR-44"): Invoice =>
    Object.freeze({
      uri: `dsor://org_456/invoice/INV-${i}`,
      tenantId: "org_456",
      id: `INV-${i}`,
      vendor,
      amount: Object.freeze({ value: "1.00", currency: "USD" }),
      status: "issued" as const,
    });

  it("DSOR-QRY-01: a handler that returns more rows than a page is refused by the door, as the program's own error", async () => {
    const door = makeDoor(PIPELINE, {
      "invoice.list": careless(Array.from({ length: MAX_PAGE_SIZE + 1 }, (_u, i) => anInvoice(i))),
    });
    const answer = await door(SUPERVISOR, "invoice.list", {});

    expect(answer.kind).toBe("error");

    if (answer.kind === "error") {
      expect(answer.envelope.code).toBe("INTERNAL_ERROR");
      expect(answer.envelope.message).toMatch(/101 rows/);
    }
  });

  it("DSOR-QRY-01: an answer bigger than the result size is refused too, however few rows", async () => {
    const door = makeDoor(PIPELINE, {
      "invoice.list": careless(Array.from({ length: 4 }, (_u, i) => anInvoice(i, "V".repeat(20_000)))),
    });
    const answer = await door(SUPERVISOR, "invoice.list", {});

    expect(answer.kind).toBe("error");

    if (answer.kind === "error") {
      expect(answer.envelope.code).toBe("INTERNAL_ERROR");
      expect(answer.envelope.message).toMatch(/bytes/);
    }
  });

  it("DSOR-QRY-01: an oversize error answer is refused too — every kind of answer is measured", async () => {
    // A review found the measuring skipped errors, so a handler whose refusal carried the whole
    // table in its message walked out of the door at ten megabytes.
    const small = await callOperation(SUPERVISOR, "invoice.list", { limit: 0 });

    if (small.kind !== "error") {
      throw new Error("expected a refusal to copy");
    }

    const door = makeDoor(PIPELINE, {
      "invoice.list": async (_args, _contract, askedBy) => ({
        kind: "error",
        askedBy,
        envelope: { ...small.envelope, message: "E".repeat(MAX_RESULT_BYTES) },
      }),
    });
    const answer = await door(SUPERVISOR, "invoice.list", {});

    expect(answer.kind).toBe("error");

    if (answer.kind === "error") {
      expect(answer.envelope.code).toBe("INTERNAL_ERROR");
      expect(answer.envelope.message).toMatch(/bytes/);
      expect(bytesOf(answer)).toBeLessThan(1024);
    }
  });

  it("a full page of real invoices is well inside both maxima, so the door is not refusing the honest list", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.list", { limit: MAX_PAGE_SIZE });

    expect(answer.kind).toBe("page");

    if (answer.kind === "page") {
      expect(answer.page.invoices).toHaveLength(MAX_PAGE_SIZE);
      // The whole answer, which is what the door measures — not the page inside it.
      expect(bytesOf(answer)).toBeLessThan(MAX_RESULT_BYTES / 2);
    }
  });

  it("DSOR-QRY-01: one real row wider than the result size makes invoice.list and invoice.get refuse, not shrink", async () => {
    // The byte ceiling refuses; it does not trim. `vendor` is unbounded text (migration 003), so a
    // row can be wider than an answer may be, and then its page and its own invoice.get are
    // unreadable until the column is bounded. Pinned here so the README's sentence stays true.
    const wide = "dsor://org_456/invoice/INV-00001";

    await asTheOwner(() =>
      db.query(
        `INSERT INTO public.invoices (tenant_id, id, vendor, amount_value, amount_currency, status)
         VALUES ('org_456', 'INV-00001', repeat('V', $1), 1, 'USD', 'issued')`,
        [MAX_RESULT_BYTES + 1],
      ),
    );

    try {
      for (const [operation, args] of [
        ["invoice.list", { limit: 1 }],
        ["invoice.get", { invoice: wide }],
      ] as const) {
        const answer = await callOperation(SUPERVISOR, operation, args);

        expect(answer.kind, operation).toBe("error");

        if (answer.kind === "error") {
          expect(answer.envelope.code).toBe("INTERNAL_ERROR");
          expect(answer.envelope.message).toMatch(/bytes/);
        }
      }
    } finally {
      await asTheOwner(() => db.query("DELETE FROM public.invoices WHERE id = 'INV-00001'"));
    }
  });
});

describe("the next page", () => {
  it("after walks the pages in order, and the last page has no next", async () => {
    const seen: string[] = [];
    let after: string | undefined;

    for (let pages = 0; pages < 20; pages++) {
      const page = await pageFor(SUPERVISOR, { limit: MAX_PAGE_SIZE, ...(after ? { after } : {}) });

      seen.push(...page.invoices.map((i) => i.id));
      after = page.next;

      if (after === undefined) {
        break;
      }
    }

    // 300 seeded here, and the story's INV-1008 and INV-1009: every one of them, once, in the
    // database's own order. Its order and not JavaScript's `sort()`, because the two agree on
    // this PGlite and need not on a server whose collation ignores punctuation (a review's point).
    const { rows } = await asTheOwner(() =>
      db.query<{ id: string }>("SELECT id FROM public.invoices WHERE tenant_id = 'org_456' ORDER BY id"),
    );

    expect(seen).toHaveLength(302);
    expect(seen).toStrictEqual(rows.map((r) => r.id));
  });

  it("after an invoice that does not exist still pages from that point, in order", async () => {
    const page = await pageFor(SUPERVISOR, { after: "dsor://org_456/invoice/INV-02100x", limit: 2 });

    expect(page.invoices.map((i) => i.id)).toStrictEqual(["INV-02101", "INV-02102"]);
  });

  it("DSOR-SRC-02b: a cursor in another company is refused with TENANT_MISMATCH", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.list", {
      after: "dsor://org_789/invoice/INV-02000",
    });

    expect(answer.kind).toBe("error");

    if (answer.kind === "error") {
      expect(answer.envelope.code).toBe("TENANT_MISMATCH");
    }
  });

  it("a cursor that is not an address is refused as invalid input", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.list", { after: "INV-02000" });

    expect(answer.kind).toBe("error");

    if (answer.kind === "error") {
      expect(answer.envelope.code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("whose rows", () => {
  it("DSOR-IDN-03b: a page never crosses a company", async () => {
    const ours = await pageFor(SUPERVISOR, { limit: 1_000_000 });
    const theirs = await pageFor(AGENT_FOR_789, { limit: 1_000_000 });

    expect(new Set(ours.invoices.map((i) => i.tenantId))).toStrictEqual(new Set(["org_456"]));
    expect(new Set(theirs.invoices.map((i) => i.tenantId))).toStrictEqual(new Set(["org_789"]));
    expect(theirs.invoices).toHaveLength(33); // 30 seeded, INV-1008, INV-1009, INV-2001: one page
    expect(theirs.next).toBeUndefined();
  });
});
