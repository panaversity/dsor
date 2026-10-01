// The company an operation's code works in: the active tenant, which line ② checked, and
// that company's invoices only. The code never holds a store that takes a company, so it
// cannot name another one (step 10's README, decision 13). And its answer must hold no row
// of another company (step 10's README, decision 14). DSOR-IDN-03b in
// specs/dsor/02-security.md, section 12.
// Found by the Stage 2 review, and fixed from step 10 on.
import { types } from "node:util";
import { checkedLabel, type Freshness } from "./freshness.ts";
import { jsonCopy, NOT_JSON } from "./inputs.ts";
import type { Invoice, InvoiceStore } from "./invoice.ts";

/** One company's invoices. Whoever holds this can read that company's invoices, and no others. */
export type CompanyInvoices = {
  /** Finds one invoice of this company by its id: a copy, or `undefined` when there is none. */
  readonly get: (id: string) => Promise<Invoice | undefined>;
  // invoice.list reads through the same company: a place in the list and a count, and no
  // company to name (step 13's README, decision 4). Found by the Stage 2 review, and fixed
  // from step 13 on.
  /** Copies of the first `count` invoices of this company whose id comes after `after`, in order of id. */
  readonly list: (after: string | undefined, count: number) => Promise<Invoice[]>;
};

/** What the code of an operation is given: the active company's id, and its invoices. */
export type Company = {
  // For code that must name its own company, such as in a URI. It is never needed to read.
  readonly tenant: string;
  readonly invoices: CompanyInvoices;
};

/**
 * The store, bound to one company. Every read is that company's, whatever the code passes.
 * The label of each read is noted in `reads`, which the code never sees.
 */
export function companyOf(store: InvoiceStore, tenant: string, reads: Freshness[] = []): Company {
  // get takes an id, and list a place and a count, and nothing more. The company is fixed
  // here, out of the code's reach, so an extra argument changes nothing. Frozen, so the
  // code cannot swap the company or the store for others (step 10's README, decision 13).
  // NEW IN STEP 15: the store gives each read's label beside the rows. The label is checked
  // and noted here, before the code gets the rows, and the code gets the rows only. A label
  // that fails the check throws, so the code gets nothing from that read. The list belongs
  // to the checklist, so the code cannot see, add to, or change a label (step 15's README,
  // decisions 5 and 6).
  const invoices: CompanyInvoices = Object.freeze({
    get: async (id: string) => {
      const { invoice, freshness } = await store.get(tenant, id);
      reads.push(checkedLabel(freshness));
      return invoice;
    },
    list: async (after: string | undefined, count: number) => {
      const { rows, freshness } = await store.list(tenant, after, count);
      reads.push(checkedLabel(freshness));
      return rows;
    },
  });
  return Object.freeze({ tenant, invoices });
}

/**
 * DSoR's own copy of the code's answer, once every `tenant_id` in it, at any depth, is the
 * active company's (step 10's README, decision 14). The caller gets this copy, the one that
 * was checked.
 */
export function checkAnswerInTenant(answer: unknown, tenant: string): unknown {
  // One copy, through JSON text, as line ① makes of the input (step 07's README, decision
  // 9). It holds plain values only, so nothing the code does after it returns can change
  // what was checked: no getter, no toJSON, no row changed later. An answer that JSON cannot
  // carry is a bug too. Found by a hostile pass on the Stage 2 review's fix, and fixed from
  // step 10 on.
  // In step 14 this is the one copy of the answer: masking walks it next, and the record and
  // the answer both come from it (step 14's README, decision 3). Found by the Stage 2
  // review, and fixed from step 14 on.
  const copy = jsonCopy(answer, plainDataOnly);
  if (copy === NOT_JSON) throw new Error("the operation's answer cannot be copied as JSON");
  // A list of values still to look at, as checkUrisInTenant does. A copy made through JSON
  // text holds nothing twice and nothing that holds itself, so the walk always ends. The
  // items of invoice.list's page are values like any other, so each row on a page is
  // checked too.
  const todo: unknown[] = [copy];
  while (todo.length > 0) {
    const value = todo.pop();
    if (typeof value !== "object" || value === null) continue;
    for (const [key, inner] of Object.entries(value)) {
      // Not a Refusal: a row of another company in the answer is a bug in the code. So the
      // caller hears only DSoR's fixed message for a bug, and nothing of the row (step 04's
      // README, decision 8).
      if (key === "tenant_id" && inner !== tenant) {
        throw new Error("the operation's answer holds a row of another company");
      }
      todo.push(inner);
    }
  }
  return copy;
}

// Plain data only: text, numbers, true, false, null, plain objects, and lists. Step 14's
// decision 3 refuses what could run code when DSoR reads it: a function, a Proxy, an object
// made by a class, such as a Date, a list with a prototype of its own, a boxed string,
// number, or true or false, whose JSON text comes from its own toString, and a toJSON of its
// own. JSON calls a toJSON by itself, before this function sees the value, so the value is
// also compared with the one its object holds: if they differ, a toJSON ran. A getter, and
// whatever it hands back, still runs once, while the copy is made, and the copy is fixed
// after it. structuredClone refused much of this in step 14 before the Stage 2 review, but
// it stops at about 2,000 levels, and the walk above must reach any depth JSON can carry.
// Found by the Stage 2 review, and fixed from step 14 on; the boxed value, the list, and
// the hidden toJSON by a second hostile pass on that fix.
function plainDataOnly(this: unknown, key: string, value: unknown): unknown {
  if (typeof value === "function" || types.isProxy(value)) throw new Error("code in the answer");
  if (typeof value === "object" && value !== null) {
    const made = Object.getPrototypeOf(value) as unknown;
    const usual = Array.isArray(value) ? made === Array.prototype : made === Object.prototype;
    if (!(usual || made === null) || types.isBoxedPrimitive(value)) {
      throw new Error("not plain data");
    }
    if (Object.getOwnPropertyDescriptor(value, "toJSON") !== undefined) {
      throw new Error("a toJSON of its own");
    }
  }
  const held = Object.getOwnPropertyDescriptor(this, key);
  if (held !== undefined && "value" in held && !Object.is(held.value, value)) {
    throw new Error("a toJSON ran");
  }
  return value;
}
