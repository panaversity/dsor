// The company the operation's code works in (C8 in step 10's README, decisions 13 and 14).
// The code gets one company's store, never the store itself, and its answer must hold no
// other company's row. Found by the Stage 2 review, and fixed from step 10 on.
import { describe, expect, it } from "vitest";
import { checkAnswerInTenant, companyOf } from "../src/company.ts";
import { memoryInvoices, type Invoice } from "../src/invoice.ts";
import { INV_1008_OF_456, INV_1008_OF_789, INV_2001_OF_789 } from "./helpers.ts";

// What the answer check says inside DSoR. The caller never hears it: it hears the fixed
// message for a bug.
const FOREIGN_ROW = "the operation's answer holds a row of another company";
const NOT_COPYABLE = "the operation's answer cannot be copied as JSON";

// Each company's invoices, in order of id, typed out from step 13's README, decision 7.
const ORG_456 = [
  "INV-1001",
  "INV-1002",
  "INV-1003",
  "INV-1004",
  "INV-1005",
  "INV-1006",
  "INV-1007",
  "INV-1008",
  "INV-1009",
  "INV-1010",
  "INV-1011",
  "INV-1012",
].map((id) => `org_456/${id}`);
const ORG_789 = ["INV-1008", "INV-2001", "INV-2002", "INV-2003", "INV-2004"].map(
  (id) => `org_789/${id}`,
);

/** Each listed invoice as "company/id". */
function idsIn(listed: Invoice[]): string[] {
  return listed.map(({ tenant_id, id }) => `${tenant_id}/${id}`);
}

describe("C8: the code can reach only the active company", () => {
  it("DSOR-IDN-03b: the store the code gets reads only its own company, whatever id it asks for", async () => {
    const in456 = companyOf(memoryInvoices(), "org_456");
    const in789 = companyOf(memoryInvoices(), "org_789");
    expect(await in456.invoices.get("INV-1008")).toStrictEqual(INV_1008_OF_456);
    expect(await in789.invoices.get("INV-1008")).toStrictEqual(INV_1008_OF_789);
    expect(await in789.invoices.get("INV-2001")).toStrictEqual(INV_2001_OF_789);
    // INV-2001 is org_789's. Asked for from org_456, it is not there at all.
    expect(await in456.invoices.get("INV-2001")).toBeUndefined();
    expect(in456.tenant).toBe("org_456");
  });

  // The review's break: `?? await invoices.get("org_456", id)`, a fallback that named
  // another company. It cannot be written against this store: pnpm typecheck refuses a
  // second argument, and at run time a second argument changes nothing.
  it("DSOR-IDN-03b: the code cannot hand the store a company, by type or at run time", async () => {
    const in456 = companyOf(memoryInvoices(), "org_456");
    // @ts-expect-error: get takes an id and nothing more. Typecheck fails if it ever takes two.
    expect(await in456.invoices.get("org_789", "INV-2001")).toBeUndefined();
    // @ts-expect-error: the other way round, too.
    expect(await in456.invoices.get("INV-2001", "org_789")).toBeUndefined();
    // @ts-expect-error: and an id both companies have is still org_456's own.
    expect(await in456.invoices.get("INV-1008", "org_789")).toStrictEqual(INV_1008_OF_456);
  });

  // invoice.list reads through the same bound store: a place in the list and a count, and
  // no company (step 10's README, decision 13). Found by the Stage 2 review, and fixed from
  // step 13 on.
  it("DSOR-IDN-03b: the list the code gets reads only its own company, from any place in it", async () => {
    const in456 = companyOf(memoryInvoices(), "org_456");
    const in789 = companyOf(memoryInvoices(), "org_789");
    expect(idsIn(await in456.invoices.list(undefined, 20))).toStrictEqual(ORG_456);
    expect(idsIn(await in789.invoices.list(undefined, 20))).toStrictEqual(ORG_789);
    // INV-1010 is only org_456's. As a place in org_789's list, it is only a place.
    expect(idsIn(await in789.invoices.list("INV-1010", 20))).toStrictEqual(ORG_789.slice(1));
  });

  it("DSOR-IDN-03b: the code cannot hand the list a company, by type or at run time", async () => {
    const in456 = companyOf(memoryInvoices(), "org_456");
    // @ts-expect-error: list takes a place and a count, and nothing more.
    expect(idsIn(await in456.invoices.list(undefined, 20, "org_789"))).toStrictEqual(ORG_456);
    // @ts-expect-error: the store's own order, with the company first, reads org_456's list
    // after the place "org_789". Every id sorts before it, so nothing comes back, and
    // nothing of org_789's.
    expect(await in456.invoices.list("org_789", undefined, 20)).toStrictEqual([]);
  });

  // No rule id: the code cannot swap its company or its store for others (step 10's README,
  // decision 13).
  it("the company the code is given cannot be changed", () => {
    const in456 = companyOf(memoryInvoices(), "org_456");
    expect(() => {
      (in456 as { tenant: string }).tenant = "org_789";
    }).toThrow(TypeError);
    expect(() => {
      (in456.invoices as { get: unknown }).get = () => INV_1008_OF_789;
    }).toThrow(TypeError);
    // The list too. Found by the Stage 2 review, and fixed from step 13 on.
    expect(() => {
      (in456.invoices as { list: unknown }).list = () => [INV_1008_OF_789];
    }).toThrow(TypeError);
    expect(in456.tenant).toBe("org_456");
  });
});

describe("C8: every tenant_id in the code's answer is the active company", () => {
  const own = { ...INV_1008_OF_456 };
  const theirs = { ...INV_1008_OF_789 };

  it.each([
    ["a row of org_789", theirs],
    ["a list that holds one row of org_789", [own, theirs]],
    ["a row of org_789, deep inside", { page: { rows: [own, { lines: [theirs] }] } }],
    // Every item of a page is checked, as every row anywhere. Found by the Stage 2 review,
    // and fixed from step 13 on.
    ["a page whose second item is a row of org_789", { items: [own, theirs], next_cursor: "X" }],
    // Anything but the active company's own id: another company, none, or not text.
    ["a tenant_id of null", { ...own, tenant_id: null }],
    ["a tenant_id that is a number", { ...own, tenant_id: 456 }],
    ["a tenant_id in capital letters", { ...own, tenant_id: "ORG_456" }],
  ])("step 10's decision 14: an answer with %s fails, in org_456", (_why, answer) => {
    expect(() => checkAnswerInTenant(answer, "org_456")).toThrow(FOREIGN_ROW);
  });

  it.each([
    ["a row of org_456", own],
    ["a list of org_456's rows", [own, own]],
    ["a page of org_456's rows", { items: [own, own], next_cursor: "INV-1008" }],
    ["text", "ran"],
    ["nothing", undefined],
    // The check reads the field the code fills in. A row without it passes. That is the
    // downside of step 10's decision 14, and why a third layer must look for the other
    // company's data itself.
    ["a row with no tenant_id", { id: "INV-1008" }],
  ])("step 10's decision 14: an answer with %s passes, in org_456", (_why, answer) => {
    expect(() => checkAnswerInTenant(answer, "org_456")).not.toThrow();
  });

  // The check reads DSoR's own copy of the answer, and gives that copy back for the caller.
  // Found by a hostile pass on the Stage 2 review's fix: the check read the code's live
  // answer, and the caller got that same object.
  it("step 10's decision 14: the check gives back its own copy, never the code's object", () => {
    const answer = { ...own };
    const copy = checkAnswerInTenant(answer, "org_456");
    expect(copy).toStrictEqual(own);
    expect(copy).not.toBe(answer);
  });

  // An answer that JSON cannot carry is a bug, as an input that JSON cannot copy is refused.
  it.each([
    [
      "holds itself",
      (() => {
        const loop: Record<string, unknown> = { ...own };
        loop["self"] = loop;
        return loop;
      })(),
    ],
    ["holds a BigInt", { ...own, count: 1n }],
    // Step 14's copy refuses what could run code when DSoR reads it, each check alone. Found
    // by a hostile pass on the Stage 2 review's fix: deleting either check left every test
    // green. Fixed from step 14 on.
    ["is a Proxy", new Proxy({ ...own }, {})],
    ["holds a Proxy", { ...own, status: new Proxy({}, {}) }],
    ["holds a function", { ...own, pay: () => "31400.00" }],
    [
      "is made by a class",
      new (class Row {
        tenant_id = "org_456";
      })(),
    ],
    ["holds a Date", { ...own, paid_at: new Date(0) }],
    ["has a toJSON of its own", { ...own, toJSON: () => own }],
    // Each ran code while the copy was made, and was sent. Found by a second hostile pass
    // on the Stage 2 review's fix, and fixed from step 14 on.
    [
      "has a hidden toJSON that hands back the answer itself",
      Object.defineProperty({ ...own }, "toJSON", {
        value(this: object) {
          return this;
        },
      }),
    ],
    ["holds a boxed string, given a plain prototype", { ...own, note: plainBoxed() }],
    ["holds a list with a prototype of its own", { ...own, lines: listWithItsOwnPrototype() }],
    [
      "is nested 100,000 levels deep",
      JSON.parse("[".repeat(100_000) + "]".repeat(100_000)) as unknown,
    ],
  ])("step 10's decision 14: an answer that %s fails", (_why, answer) => {
    expect(() => checkAnswerInTenant(answer, "org_456")).toThrow(NOT_COPYABLE);
  });

  // No rule id: "at any depth". The walk is a list of values still to look at, as the URI
  // check's is, not a function that calls itself.
  it("an answer 3,000 levels deep is walked to its end", () => {
    let deep: unknown = theirs;
    for (let level = 0; level < 3_000; level++) deep = { inner: deep };
    expect(() => checkAnswerInTenant(deep, "org_456")).toThrow(FOREIGN_ROW);
  });
});

/** A String object, whose JSON text comes from its toString, with Object's prototype. */
function plainBoxed(): object {
  const boxed = new String("31400.00");
  Object.defineProperty(boxed, "toString", { value: () => "paid" });
  return Object.setPrototypeOf(boxed, Object.prototype) as object;
}

/** A list with one empty place, whose own prototype fills it when JSON reads it. */
function listWithItsOwnPrototype(): unknown[] {
  const list: unknown[] = [];
  list.length = 1;
  const filler = {};
  Object.defineProperty(filler, "0", { get: () => "INV-1001" });
  return Object.setPrototypeOf(list, filler) as unknown[];
}
