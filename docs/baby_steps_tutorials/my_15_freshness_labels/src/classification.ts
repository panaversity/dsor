// STEP 14: every field has a label that says how sensitive it is, and the agent has a
// clearance that says how far up it may read.
//
// Measured on step 13's demo: `accounts-payable-fte` reads INV-1008 and gets `31400.00 USD`, the
// same line as `user_123` — and an agent's answer travels to a model provider outside the
// company. Nothing in the program knew which field was sensitive, because no field carried a
// label. §19: writes get the attention, but most real incidents are reads.
//
// One file for every entity's labels (decision 105). A field that is not in the table is
// confidential, which is the rule and not a convenience: the day someone adds `bank_account` to
// an invoice and forgets to label it, the agent does not see it.
//
// Rule DSOR-CLS-01: a field with no declared classification MUST be treated as CONFIDENTIAL.
// Rule DSOR-CLS-03: every query response MUST carry a classification label equal to the highest
// classification among the fields it contains.

import type { Principal } from "./people.ts";

export type Classification = "public" | "internal" | "confidential" | "restricted";

/** The four labels, lowest first. The order is the whole meaning of "above". */
export const LABELS: readonly Classification[] = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
]);

/**
 * Every labelled field of every entity.
 *
 * The invoice's labels are modelled on the specification's own entity schema (§6 of 01-model.md,
 * `DSOR-ENT-01b`): the amount is confidential and the fields that describe the row are internal.
 * Not a copy of it: §6's invoice has `vendor_id` and `open_amount`, and `uri` and `tenantId` are
 * this tutorial's own. A review found this comment citing §4, which is about authority boundaries.
 * `bank_account` is labelled before any column holds one, because the label comes with the design.
 */
const labels: Readonly<Record<string, Readonly<Record<string, Classification>>>> = Object.freeze({
  invoice: Object.freeze({
    uri: "internal",
    tenantId: "internal",
    id: "internal",
    vendor: "internal",
    amount: "confidential",
    status: "internal",
    // Labelled before any column exists: the label comes with the design, so that the day a bank
    // account is stored it is already restricted. The fourth label reaches the door through it.
    bank_account: "restricted",
  }),
});

/**
 * STEP 14, decision 110: the fields declared to hold money, by entity.
 *
 * Money, `{ value, currency }`, is one value only in one of these fields, and its field's label
 * describes it whole. Anywhere else it is a value with parts inside, and at least confidential. The
 * specification's entity schema gives every field a type as well as a label (§6, DSOR-ENT-01b):
 * `amount: { type: money, classification: confidential }`. This list is that type, for money only.
 * If it ever disagrees with the labels, the stricter answer wins.
 */
const moneyFields: Readonly<Record<string, readonly string[]>> = Object.freeze({
  invoice: Object.freeze(["amount"]),
});

/** Whether this field is declared to hold money. Asks for the list's own keys only. */
export function holdsMoney(entity: string, field: string): boolean {
  return Object.hasOwn(moneyFields, entity) && (moneyFields[entity] ?? []).includes(field);
}

/** The label of one field. A field, or an entity, that nobody labelled is confidential. */
export function labelOf(entity: string, field: string): Classification {
  // STEP 14, decision 111: the table's own names only, for the entity and for the field.
  // `labels[entity]?.[field]` walked the prototype chain: `toString` found a built-in function,
  // which is no label, and `constructor` found `Object`. Neither is ever above a clearance, so a
  // field with either name left for the agent. Decision 36 fixed the same bug for roles.
  const fields = Object.hasOwn(labels, entity) ? labels[entity] : undefined;

  return fields !== undefined && Object.hasOwn(fields, field)
    ? (fields[field] ?? "confidential")
    : "confidential";
}

/** Where a label sits in the order: public 0, restricted 3. */
function rankOf(label: Classification): number {
  return LABELS.indexOf(label);
}

/** Whether `label` is strictly above `clearance`: a field at the clearance itself may be read. */
export function isAbove(label: Classification, clearance: Classification): boolean {
  return rankOf(label) > rankOf(clearance);
}

/** The highest of some labels — the label of an answer that holds those fields. None is public. */
export function highestOf(found: readonly Classification[]): Classification {
  let highest: Classification = "public";

  for (const label of found) {
    if (isAbove(label, highest)) {
      highest = label;
    }
  }

  return highest;
}

/**
 * How far up a principal may read. An agent nobody cleared reads public fields only: the lock
 * stays locked when the paperwork is missing, like every other default in this program.
 */
export function clearanceOf(principal: Principal): Classification {
  return principal.clearance ?? "public";
}
