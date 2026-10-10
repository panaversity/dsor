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

import {
  type Classification,
  clearanceOf,
  highestOf,
  holdsMoney,
  isAbove,
  labelOf,
} from "./classification.ts";
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

/** A value with no parts inside: text, a number, a boolean, nothing. */
function isScalar(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

/** Money's shape: `{ value, currency }`, both text, and nothing else. */
function isMoney(value: unknown): boolean {
  if (isScalar(value)) {
    return false;
  }

  const keys = Object.keys(value as object);

  return (
    keys.length === 2 &&
    keys.includes("value") &&
    keys.includes("currency") &&
    typeof (value as { value: unknown }).value === "string" &&
    typeof (value as { currency: unknown }).currency === "string"
  );
}

/**
 * A value, and not a row: what `cannotBeFiltered` refuses where a row was expected.
 *
 * NEW IN STEP 14, decision 110: a question of its own. It was `isPlain`, and so the same function
 * answered "is this a row?" for the door and "can the label see this whole?" for the filter.
 * Measured: Break 13 made `isPlain` say yes to everything, and all 65 of its failures were the
 * door refusing every answer as not a row. Three of those tests are about the label, and they are
 * the only ones that fail when the filter alone says yes.
 */
function isValue(value: unknown): boolean {
  return isScalar(value) || isMoney(value);
}

/**
 * Whether this field's label can describe this value whole, or there are parts inside it nobody
 * labelled.
 *
 * A value with no parts, and one compound value: money, which is `{ value, currency }` and one
 * amount in this program's vocabulary — NEW IN STEP 14, decision 110 — in a field declared to hold
 * money. The specification's entity schema declares the type of every field
 * (`amount: { type: money, classification: confidential }`), and the field's type decides, not the
 * value's shape. Money anywhere else is a value with parts inside: a handler that moved the amount
 * into `vendor` sent it to the agent, labelled `internal`, until this asked about the field.
 *
 * Measured, and the reason money is named at all: with every object treated as something the label
 * cannot see, the table's own `amount: "confidential"` stopped mattering, because the rule
 * re-raised an `internal` amount to confidential anyway. Lowering the amount's label in the table
 * then changed nothing anywhere — a break that had failed twenty-six tests failed two. A label
 * that cannot be lowered is a label nobody is reading.
 */
function isPlain(value: unknown, entity: string, field: string): boolean {
  return isScalar(value) || (isMoney(value) && holdsMoney(entity, field));
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
    // A label describes a value it can see the whole of. A value with parts inside — an object, an
    // array, a thing with its own `toJSON` — is confidential whatever its field is called: a
    // reviewer got the amount out of the agent's answer inside a `vendor` that was an object, and
    // this is `DSOR-CLS-01` one level down. The amount is confidential already, so nothing in the
    // story moves; the day a field holds something with parts, the agent does not see it. Money is
    // a value with parts too, except in a field declared to hold money (decision 110).
    const label = isPlain(value, entity, field)
      ? labelOf(entity, field)
      : highestOf([labelOf(entity, field), "confidential"]);

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

/** What a value is, for a message: `null`, or its type. */
const whatItIs = (value: unknown): string => (value === null ? "null" : typeof value);

/**
 * NEW IN STEP 14: why the door cannot filter this answer, or nothing.
 *
 * A handler that answers with no row, or with a row that is not a row, is a bug in this program,
 * and the door says so in an envelope with a code and a retry class. A review handed the door a
 * `data` answer whose invoice was `null` and got a raw `TypeError` out of it instead — after the
 * decision was recorded, and for a command after the side effect, with nothing a caller can read.
 */
export function cannotBeFiltered(answer: HandlerAnswer): string | undefined {
  if (answer.kind === "data") {
    return isValue(answer.invoice)
      ? `returned ${whatItIs(answer.invoice)} where one row was expected`
      : undefined;
  }

  if (answer.kind === "page") {
    if (isValue(answer.page) || !Array.isArray(answer.page.invoices)) {
      return "returned a page with no rows in it";
    }

    const row = answer.page.invoices.findIndex((held) => isValue(held));

    return row === -1
      ? undefined
      : `returned ${whatItIs(answer.page.invoices[row])} as row ${row + 1} of a page`;
  }

  return undefined;
}

/**
 * What the handler's answer becomes on its way out. An error's envelope is untouched: it carries
 * no data. Everything else is filtered by who is asking, labelled, and told what it lost.
 *
 * NEW IN STEP 14, decision 112: every way out builds the answer here, from its known parts, and
 * writes who asked from the principal the pipeline checked. What a handler wrote in `askedBy` is
 * never read: a handler that put the row there, behind a cast, sent the amount past the filter,
 * with `amount` listed as withheld beside it.
 */
export function leaveTheDoor(principal: Principal, answer: HandlerAnswer): OperationAnswer {
  // One thing this boundary does not do, said here because a review measured it. An error's
  // envelope is untouched: its message is free text, so a handler must never put a field's value in
  // one — a rule for handlers, not a filter. A value with parts inside is the filter's job: it is
  // confidential whatever its field is called (decision 107), and money, the one exception, takes
  // its field's label only in a field declared to hold money (`isPlain`, decision 110).
  if (answer.kind === "error") {
    return Object.freeze({ kind: "error", askedBy: principal.id, envelope: answer.envelope });
  }

  if (answer.kind === "data") {
    const { shown, labels, withheld } = filterRow(principal, answer.invoice);

    return Object.freeze({
      kind: "data",
      askedBy: principal.id,
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

    // The cursor is a row's address. A caller who may not see the rows' addresses may not see
    // the next one either — a review found `uri` listed as withheld with `next` carrying the
    // same address beside it.
    const next = withheld.has("uri") ? undefined : answer.page.next;

    if (withheld.has("uri") && answer.page.next !== undefined) {
      withheld.add("next");
    }

    return Object.freeze({
      kind: "page",
      askedBy: principal.id,
      page: Object.freeze({ invoices: Object.freeze(invoices), next }),
      classification: highestOf(labels),
      redactions: redactionsFor(withheld),
    });
  }

  // A command's receipt carries the row it changed, in `data`, and the result envelope has a place
  // for the label and the list (result-envelope.schema.json). Rebuilt, and validated again, because
  // `success` validated the envelope it built and this is a different one.
  //
  // `data` is optional in that schema, and step 17's first PENDING_APPROVAL receipt will have
  // none. A receipt with no data has nothing to filter and nothing to label, so its envelope leaves
  // as it came: a review made the door throw on it, after the command had run.
  if (answer.envelope.data === undefined) {
    return Object.freeze({ kind: "result", askedBy: principal.id, envelope: answer.envelope });
  }

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

  return Object.freeze({ kind: "result", askedBy: principal.id, envelope });
}
