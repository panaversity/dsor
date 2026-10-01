// NEW IN STEP 15: the label comes from the store that served the read, through the bound
// store. The operation's code never writes it, and cannot change it (step 15's README, C4 and
// decision 5). Each store here is planted under the bound store, where a connector sits.
import { describe, expect, it } from "vitest";
import type { Company } from "../src/company.ts";
import type { Freshness } from "../src/freshness.ts";
import { memoryInvoices, type InvoiceStore } from "../src/invoice.ts";
import { call } from "../src/pipeline.ts";
import { AGENT, CFO, UNEXPECTED, log, omitted } from "./helpers.ts";
import { cacheOver, freshnessOf, registryOver, relabelled, runOver } from "./stores.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// What a slower store says: no older than a stated time, read at 08:59:30.
const BOUNDED = {
  mode: "bounded_staleness",
  observed_at: "2026-10-01T08:59:30.000Z",
  connector: "warehouse",
};
// What a cache says: an old copy.
const STALE = {
  mode: "observational",
  observed_at: "2026-10-01T08:00:00.000Z",
  connector: "cache",
};
// What code would like the answer to say.
const FAKE = { mode: "current", observed_at: "2099-01-01T00:00:00.000Z", connector: "made-up" };

/** The code of an operation that reads INV-1008, then writes "current" into the data. */
async function claimsCurrent(_input: unknown, company: Company): Promise<unknown> {
  return { ...(await company.invoices.get("INV-1008")), freshness: "current" };
}

describe("C4: the label comes from the store, and the code cannot write it", () => {
  it("DSOR-FRS-01a: a store that delivers bounded_staleness gives an answer that says so, with its time and its name", async () => {
    const answer = await call(
      registryOver(relabelled([BOUNDED])),
      log,
      CFO,
      "invoice.get",
      GET_1008,
    );
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(freshnessOf(answer)).toStrictEqual(BOUNDED);
  });

  it("decision 5: code that writes freshness: current into its data leaves the store's label on the answer", async () => {
    const answer = await runOver(relabelled([STALE]), CFO, claimsCurrent);
    expect(freshnessOf(answer)).toStrictEqual(STALE);
    // For a person, the code's field is only data, inside data.
    expect(answer).toMatchObject({ data: { id: "INV-1008", freshness: "current" } });
  });

  // Step 14 refuses an object in a field with no label, for everyone, so the code's own label
  // never leaves at all. Changed before any code, 2026-10-01: the first red run showed it.
  it("decision 5: code that writes a whole label object into its data is refused, for everyone", async () => {
    const answer = await runOver(relabelled([STALE]), CFO, async (_input, company) => ({
      ...(await company.invoices.get("INV-1008")),
      freshness: FAKE,
    }));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    expect(answer).not.toHaveProperty("freshness");
  });

  // classifications.json does not name freshness as a field of an Invoice, so step 14
  // withholds it from an agent, under a name that carries nothing.
  it("decision 5: for the agent, the code's own freshness field is withheld as <unlabelled>", async () => {
    const answer = await runOver(relabelled([STALE]), AGENT, claimsCurrent);
    expect(freshnessOf(answer)).toStrictEqual(STALE);
    expect(answer).toMatchObject({ redactions: expect.arrayContaining([omitted("<unlabelled>")]) });
    expect((answer as { data: object }).data).not.toHaveProperty("freshness");
  });

  // Break Z6: the code reaches the list of recorded reads and changes it. The code tries
  // everything it can reach from what it is given: the company, its invoices, their
  // functions, their prototypes, and the rows it read. It cannot make the label fresher.
  // Added before any code, 2026-10-01: the learner's prediction for Z6 showed the design had
  // no such test.
  it("decision 5: code that tries to change its recorded reads, through everything it was given, leaves the label as the store gave it", async () => {
    const answer = await runOver(relabelled([STALE]), CFO, async (_input, company) => {
      const invoice = await company.invoices.get("INV-1008");
      // A clean copy to answer with: step 14 would refuse the lists the tampering adds.
      const clean = structuredClone(invoice);
      tamperWith(company);
      tamperWith(invoice);
      return clean;
    });
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(freshnessOf(answer)).toStrictEqual(STALE);
  });
});

describe("C4: a label DSoR cannot rank is a bug, and a label has three fields", () => {
  // Added before any code, 2026-10-01 (step 15's README, decision 6, second point).
  const broken: [string, unknown][] = [
    ["a mode in capitals, as §27's table writes it", { ...BOUNDED, mode: "CURRENT" }],
    ["a mode that is none of the four", { ...BOUNDED, mode: "fresh" }],
    ["no mode", { observed_at: BOUNDED.observed_at, connector: "warehouse" }],
    ["no time", { mode: "current", connector: "warehouse" }],
    ["a time that is not a date and a time", { ...BOUNDED, observed_at: "yesterday" }],
    // JavaScript reads 30 February as 2 March, without a word.
    ["a time that names no real day", { ...BOUNDED, observed_at: "2026-02-30T09:00:00Z" }],
    // Without Z or an offset, the same text is a different moment on every server.
    ["a time with no time zone", { ...BOUNDED, observed_at: "2026-10-01T08:59:30" }],
    ["a time given as a number", { ...BOUNDED, observed_at: Date.parse(BOUNDED.observed_at) }],
    ["no connector", { mode: "current", observed_at: BOUNDED.observed_at }],
    ["an empty connector", { ...BOUNDED, connector: "" }],
    ["no label at all", undefined],
    ["null for a label", null],
    // Added by the review, 2026-10-02: a label is small (decision 6).
    ["a connector of 65 characters", { ...BOUNDED, connector: "w".repeat(65) }],
    ["a connector with a space in it", { ...BOUNDED, connector: "ware house" }],
    ["a connector in capitals", { ...BOUNDED, connector: "Warehouse" }],
    ["a time with 10 digits after the second", { ...BOUNDED, observed_at: "2026-10-01T08:59:30.0000000001Z" }],
    // Found by the mutation sweep, 2026-10-02: each part of the time's pattern, so a pattern
    // that lost its ^ or $, or allowed hour 24, passed every test.
    ["text after the time", { ...BOUNDED, observed_at: "2026-10-01T08:59:30.000Zjunk" }],
    ["text before the time", { ...BOUNDED, observed_at: "on 2026-10-01T08:59:30.000Z" }],
    ["hour 24", { ...BOUNDED, observed_at: "2026-10-01T24:00:00Z" }],
    ["minute 60", { ...BOUNDED, observed_at: "2026-10-01T08:60:00Z" }],
    ["an offset of 24 hours", { ...BOUNDED, observed_at: "2026-10-01T08:59:30+24:00" }],
    ["a month of one digit", { ...BOUNDED, observed_at: "2026-1-01T08:59:30Z" }],
    ["a space for the T", { ...BOUNDED, observed_at: "2026-10-01 08:59:30Z" }],
    ["a time that is a String object, not text", { ...BOUNDED, observed_at: new String(BOUNDED.observed_at) }],
  ];
  for (const [what, label] of broken) {
    it(`decision 6: a store's label with ${what} gives INTERNAL_ERROR`, async () => {
      const answer = await call(
        registryOver(relabelled([label])),
        log,
        CFO,
        "invoice.get",
        GET_1008,
      );
      expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    });
  }

  it("decision 6: a store's label with a fourth field gives a label of three", async () => {
    const answer = await call(
      registryOver(relabelled([{ ...BOUNDED, trust_me: "it is fresh" }])),
      log,
      CFO,
      "invoice.get",
      GET_1008,
    );
    expect(freshnessOf(answer)).toStrictEqual(BOUNDED);
  });

  // The edges of decision 6's limits, kept. Added by the review, 2026-10-02.
  it("decision 6: a connector of 64 characters and a time with 9 digits after the second are kept", async () => {
    const longest = {
      mode: "bounded_staleness",
      observed_at: "2026-10-01T08:59:30.123456789Z",
      connector: `w${"0".repeat(63)}`,
    };
    const answer = await call(registryOver(relabelled([longest])), log, CFO, "invoice.get", GET_1008);
    expect(freshnessOf(answer)).toStrictEqual(longest);
  });

  // Found by the review: the bad label's error went to the code, which could catch it, read
  // again, and succeed. Now one bad label refuses the call (decision 6).
  it("decision 6: code that catches a bad label's error and reads again still gets INTERNAL_ERROR", async () => {
    const answer = await runOver(
      relabelled([{ ...BOUNDED, mode: "fresh" }, BOUNDED]),
      CFO,
      async (_input, company) => {
        try {
          await company.invoices.get("INV-1008");
        } catch {
          // The code swallows the error, and tries again.
        }
        return company.invoices.get("INV-1008");
      },
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
  });
});

// Found by the mutation sweep, 2026-10-02: every broken-label test above read with get, so a
// list that noted its label unchecked passed. And a store that changed its label object after
// handing it over could change the label, if DSoR kept the store's object, not its own copy.
describe("C4, from the sweep: every read's label is checked, and kept as it was checked", () => {
  it("decision 6: a page whose store gives a label with an unknown mode gives INTERNAL_ERROR", async () => {
    const store = relabelled([{ ...BOUNDED, mode: "fresh" }]);
    const answer = await call(registryOver(store), log, CFO, "invoice.list", {});
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
  });

  it("decision 6: a store that changes its first label after handing it over does not change the answer's label", async () => {
    const inner = memoryInvoices();
    const first: Freshness = { mode: "observational", observed_at: STALE.observed_at, connector: "cache" };
    const fresh: Freshness = { mode: "current", observed_at: "2026-10-01T09:00:00.000Z", connector: "memory" };
    let reads = 0;
    // The first read is an old copy. At the second read, the store rewrites the first label
    // to look fresh, and gives a current one.
    const shifty: InvoiceStore = {
      get: async (tenant, id) => {
        const { invoice } = await inner.get(tenant, id);
        if (reads++ === 0) return { invoice, freshness: first };
        Object.assign(first, { mode: "current", observed_at: "2026-10-01T09:30:00.000Z" });
        return { invoice, freshness: fresh };
      },
      list: inner.list,
    };
    const answer = await runOver(shifty, CFO, async (_input, company) => {
      const invoice = await company.invoices.get("INV-1008");
      await company.invoices.get("INV-1008");
      return invoice;
    });
    expect(freshnessOf(answer)).toStrictEqual(STALE);
  });
});

// Found by the review: a Company the code kept from an earlier call still read, and its read's
// label went into that earlier call's list, which nobody read again. Now the bound store
// closes when line ⑨ ends (decision 5).
describe("C4, from the review: the bound store closes when line ⑨ ends", () => {
  it("decision 5: a call that reads the cache through an earlier call's Company fails, and is never current", async () => {
    const store = cacheOver(memoryInvoices());
    let kept: Company | undefined;
    // The first call reads INV-1008, so the cache holds it, and the code keeps its Company.
    const first = await runOver(store, CFO, async (_input, company) => {
      kept = company;
      return company.invoices.get("INV-1008");
    });
    expect(freshnessOf(first)).toMatchObject({ mode: "current" });
    // The second reads the cached INV-1008 through the kept Company, and INV-1001, fresh,
    // through its own, then answers with the cached copy.
    const second = await runOver(store, CFO, async (_input, company) => {
      const old = await kept!.invoices.get("INV-1008");
      await company.invoices.get("INV-1001");
      return old;
    });
    expect(second).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
  });

  it("decision 5: once its call has ended, a kept Company's get and list both throw", async () => {
    let kept: Company | undefined;
    await runOver(memoryInvoices(), CFO, async (_input, company) => {
      kept = company;
      return company.invoices.get("INV-1008");
    });
    await expect(kept!.invoices.get("INV-1008")).rejects.toThrow();
    await expect(kept!.invoices.list(undefined, 1)).rejects.toThrow();
  });
});

/**
 * Tries to make every label it can reach say FAKE: empties or rewrites every list, and every
 * mode and observed_at, in everything reachable from `start`, prototypes included. Each try
 * that fails, such as a write to a frozen object, is skipped. JavaScript's own prototypes are
 * shared by the whole program, so changing them is not this test's attack.
 */
function tamperWith(start: unknown): void {
  // First everything reachable, changing nothing, so the walk never visits what it added.
  // Found on the first red run: adding a list inside the walk made the walk endless.
  const builtIn = new Set<unknown>([Object.prototype, Function.prototype, Array.prototype]);
  const found = new Set<object>();
  const todo: unknown[] = [start];
  while (todo.length > 0) {
    const value = todo.pop();
    const reachable = (typeof value === "object" && value !== null) || typeof value === "function";
    if (!reachable || found.has(value) || builtIn.has(value)) continue;
    found.add(value);
    for (const key of Reflect.ownKeys(value)) {
      attempt(() => todo.push((value as Record<PropertyKey, unknown>)[key]));
    }
    todo.push(Object.getPrototypeOf(value));
  }
  // Then every change on each of them, each with a copy of FAKE of its own.
  for (const value of found) {
    const target = value as Record<PropertyKey, unknown>;
    if (Array.isArray(target)) attempt(() => target.splice(0, target.length, { ...FAKE }));
    attempt(() => (target["mode"] = FAKE.mode));
    attempt(() => (target["observed_at"] = FAKE.observed_at));
    attempt(() => (target["freshness"] = { ...FAKE }));
    attempt(() => (target["reads"] = [{ ...FAKE }]));
  }
}

/** Runs the change, and skips it when it throws, as a write to a frozen object does. */
function attempt(change: () => void): void {
  try {
    change();
  } catch {
    // A frozen object refuses, and that is the point.
  }
}
