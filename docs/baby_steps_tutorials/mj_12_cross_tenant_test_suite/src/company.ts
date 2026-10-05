// The company an operation's code works in: the active tenant, which line ② checked, and
// that company's invoices only. The code never holds a store that takes a company, so it
// cannot name another one (step 10's README, decision 13). And its answer must hold no row
// of another company (step 10's README, decision 14). DSOR-IDN-03b in
// specs/dsor/02-security.md, section 12.
// Found by the Stage 2 review, and fixed from step 10 on.
import { jsonCopy, NOT_JSON } from "./inputs.ts";
import type { Invoice, InvoiceStore } from "./invoice.ts";

/** One company's invoices. Whoever holds this can read that company's invoices, and no others. */
export type CompanyInvoices = {
  /** Finds one invoice of this company by its id: a copy, or `undefined` when there is none. */
  readonly get: (id: string) => Promise<Invoice | undefined>;
};

/** What the code of an operation is given: the active company's id, and its invoices. */
export type Company = {
  // For code that must name its own company, such as in a URI. It is never needed to read.
  readonly tenant: string;
  readonly invoices: CompanyInvoices;
};

/** The store, bound to one company. Every read is that company's, whatever the code passes. */
export function companyOf(store: InvoiceStore, tenant: string): Company {
  // get takes an id and nothing more. The company is fixed here, out of the code's reach, so
  // a second argument changes nothing. Frozen, so the code cannot swap the company or the
  // store for others (step 10's README, decision 13).
  const invoices: CompanyInvoices = Object.freeze({ get: (id: string) => store.get(tenant, id) });
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
  const copy = jsonCopy(answer);
  if (copy === NOT_JSON) throw new Error("the operation's answer cannot be copied as JSON");
  // A list of values still to look at, as checkUrisInTenant does. A copy made through JSON
  // text holds nothing twice and nothing that holds itself, so the walk always ends.
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
