// NEW IN STEP 14: the model boundary. Whatever leaves the door for an agent is, in practice, sent
// to a model provider's servers. So the door takes out every field above the agent's clearance
// before the answer leaves, lists what it took out, and labels what is left.
//
// Measured on step 13's demo: the agent reads INV-1008 and gets `31400.00 USD`, the same line as
// the supervisor. No attack was needed, only a missing filter. This file is the filter.
//
// Three choices, taken by the learner (decision 105): the labels live in one file; a field above
// the clearance is left out rather than masked, and listed; and agents only are filtered, because
// a human reads on a screen and the role already decides what a human may do.
//
// Rule DSOR-CLS-02a: for agent principals, DSoR MUST omit, mask, or tokenize any field above the
// agent's clearance or barred by the tenant's model-egress policy before the response leaves DSoR.
// Rule DSOR-CLS-02b: a response from which fields were withheld MUST list the redactions.
// Rule DSOR-CLS-03: every query response MUST carry a classification label equal to the highest
// classification among the fields it contains.

import { type Classification, clearanceOf, highestOf, isAbove, labelOf } from "./classification.ts";
import { validateEnvelope } from "./envelopes.ts";
import type { Invoice } from "./invoice.ts";
import type { HandlerAnswer, OperationAnswer } from "./operations.ts";
import type { Principal } from "./people.ts";
import { parseUri } from "./uri.ts";

/** One line of the list an agent gets with its answer: which field, why, and how. */
export interface Redaction {
  readonly field: string;
  readonly reason: "clearance" | "egress_policy";
  readonly treatment: "omitted" | "masked" | "tokenized";
}

/** A row as it leaves: every field is there, or it is not. */
export type Shown<T> = { readonly [K in keyof T]?: T[K] };

/** One page as it leaves. */
export interface ShownPage {
  readonly invoices: readonly Shown<Invoice>[];
  readonly next: string | undefined;
}

interface Filtered {
  readonly shown: Readonly<Record<string, unknown>>;
  /** The label of every field that is still there — the answer's label is the highest of them. */
  readonly labels: readonly Classification[];
  readonly withheld: readonly string[];
}

/**
 * The entity a row belongs to, read from the row's own address: `dsor://org_456/invoice/INV-1008`
 * is an invoice. A row with no address belongs to no entity in the table, so every field of it
 * is confidential (DSOR-CLS-01) — the lock stays locked when the paperwork is missing.
 */
function entityOf(row: object): string {
  const uri = (row as Readonly<Record<string, unknown>>)["uri"];

  if (typeof uri !== "string") {
    return "(no address)";
  }

  try {
    return parseUri(uri).entity;
  } catch {
    return "(no address)";
  }
}

/** One row, as `principal` may see it. A human sees every field; an agent sees up to its clearance. */
// `object`, not a record: an Invoice is an interface, which TypeScript does not treat as a record,
// and the filter reads whatever fields a row has — including the one nobody labelled.
function filterRow(principal: Principal, row: object): Filtered {
  const entity = entityOf(row);
  const filtered = principal.type === "agent";
  const clearance = clearanceOf(principal);
  const shown: Record<string, unknown> = {};
  const labels: Classification[] = [];
  const withheld: string[] = [];

  for (const [field, value] of Object.entries(row)) {
    const label = labelOf(entity, field);

    if (filtered && isAbove(label, clearance)) {
      withheld.push(field);
      continue;
    }

    shown[field] = value;
    labels.push(label);
  }

  return { shown: Object.freeze(shown), labels, withheld };
}

const redactionsFor = (fields: Iterable<string>): readonly Redaction[] =>
  Object.freeze(
    [...fields].map((field) =>
      Object.freeze({ field, reason: "clearance", treatment: "omitted" } as const),
    ),
  );

/**
 * What the handler's answer becomes on its way out. An error is untouched: it carries no data.
 * Everything else is filtered by who is asking, labelled, and told what it lost.
 */
export function leaveTheDoor(principal: Principal, answer: HandlerAnswer): OperationAnswer {
  if (answer.kind === "error") {
    return answer;
  }

  if (answer.kind === "data") {
    const { shown, labels, withheld } = filterRow(principal, answer.invoice);

    return Object.freeze({
      kind: "data",
      askedBy: answer.askedBy,
      // What filterRow hands back is the invoice with zero or more fields gone, and that is what
      // Shown<Invoice> says. The cast is the one place the two meet.
      invoice: shown as Shown<Invoice>,
      classification: highestOf(labels),
      redactions: redactionsFor(withheld),
    });
  }

  if (answer.kind === "page") {
    const invoices: Shown<Invoice>[] = [];
    const labels: Classification[] = [];
    // Listed once per field, not once per row: a page of a hundred says "amount" one time.
    const withheld = new Set<string>();

    for (const invoice of answer.page.invoices) {
      const row = filterRow(principal, invoice);

      invoices.push(row.shown as Shown<Invoice>);
      labels.push(...row.labels);

      for (const field of row.withheld) {
        withheld.add(field);
      }
    }

    return Object.freeze({
      kind: "page",
      askedBy: answer.askedBy,
      page: Object.freeze({ invoices: Object.freeze(invoices), next: answer.page.next }),
      classification: highestOf(labels),
      redactions: redactionsFor(withheld),
    });
  }

  // A command's receipt carries the row it changed, in `data`, and the result envelope has a place
  // for the label and the list (result-envelope.schema.json). Rebuilt, and validated again, because
  // `success` validated the envelope it built and this is a different one.
  const { shown, labels, withheld } = filterRow(principal, answer.envelope.data);
  const envelope = Object.freeze({
    ...answer.envelope,
    data: shown,
    classification: highestOf(labels),
    redactions: redactionsFor(withheld),
  });

  if (!validateEnvelope("result", envelope)) {
    throw new TypeError("built a result envelope that does not validate, after filtering it");
  }

  return Object.freeze({ kind: "result", askedBy: answer.askedBy, envelope });
}
