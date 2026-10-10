// NEW IN STEP 15: every answer says how old its data is, and from where.
//
// Measured on step 14's demo: the agent's answer for INV-1008 is `issued`, and nothing more. At
// 09:00 the agent reads it and keeps it in its memory; at 09:30 user_123 pays the invoice; at 10:00
// the agent plans the day's payments from its memory, and nothing tells it, or a person checking
// its work, that its copy is an hour old. And from the inside: a cache added later must never pass
// a saved "unpaid" off as fresh, or a check that should stop a second payment would pass.
//
// Rule DSOR-FRS-01a: every query result MUST state `observed_at`, the `resource_version` where one
// exists, the connector, and the freshness mode actually delivered.
// Rule DSOR-FRS-01b: DSoR MUST NOT label a cached value `CURRENT`.

import type { HandlerAnswer } from "./operations.ts";

/**
 * How fresh an answer is, in the schemas' own spelling (decision 120). `current` is read from the
 * system of record within this request. `bounded_staleness` is no older than an agreed age.
 * `observational` is whatever was saved, with no promise. `connector_defined` is what the connector
 * documents. §27 writes them in capitals; the schemas, and our contracts, write them in lowercase.
 */
export type FreshnessMode = "current" | "bounded_staleness" | "observational" | "connector_defined";

/**
 * What an answer says about its data. There is no `resource_version`: the rule asks for one where
 * one exists, and no invoice has a version until step 21 (decision 120).
 */
export interface Freshness {
  readonly mode: FreshnessMode;
  /** When the rows were read, on this program's own clock, in ISO 8601. */
  readonly observed_at: string;
  /** Where they were read from. */
  readonly connector: string;
}

/** The four modes, spelled as the schemas spell them. Anything else is not a mode. */
const MODES: readonly string[] = Object.freeze([
  "current",
  "bounded_staleness",
  "observational",
  "connector_defined",
]);

/** What a read hands back: the rows, and how fresh they are. */
export interface Labelled<T> {
  readonly value: T;
  readonly freshness: Freshness;
}

/** The one connector this program reads through: the PostgreSQL database that holds the invoices. */
export const CONNECTOR = "postgres";

/** The label of rows read from the system of record just now: `current`, on this program's clock. */
export function readNow(): Freshness {
  return Object.freeze({
    mode: "current",
    observed_at: new Date().toISOString(),
    connector: CONNECTOR,
  });
}

/**
 * Rows just read from the system of record, labelled `current`, because they were read within this
 * request. The label is taken right after the read returns, by the code that read (decision 120):
 * the door does not know where data came from, so it cannot write the label, only insist on one.
 */
export function justRead<T>(value: T): Labelled<T> {
  return Object.freeze({ value, freshness: readNow() });
}

/**
 * A label as the door keeps it: its three named parts, each read once, and nothing else, so nothing
 * rides along in it (decision 117's lesson, for the label). Anything that is not an object stays as
 * it is, for `cannotBeLabelled` to refuse.
 */
export function labelFrom(handed: unknown): unknown {
  if (handed === null || typeof handed !== "object") {
    return handed;
  }

  const { mode, observed_at, connector } = handed as Readonly<Record<string, unknown>>;

  return Object.freeze({ mode, observed_at, connector });
}

/**
 * Why the door cannot let this read leave, as far as its label goes, or nothing.
 *
 * The code that reads writes the label, and the door insists on one (decision 120): a single
 * invoice or a page with no label, or with a label that is not one, is a bug in this program,
 * refused in an envelope with a code and a retry class. The messages never repeat what the handler
 * wrote, because a label that is not one could be carrying anything.
 *
 * `startedAt` is when this request began, on this program's clock, the clock the label's time
 * comes from. A `current` label from before it is a saved copy calling itself fresh: DSOR-FRS-01b.
 * `kind` is the operation's, from its contract: a query must answer with a read.
 */
export function cannotBeLabelled(
  answer: HandlerAnswer,
  startedAt: number,
  kind: string,
): string | undefined {
  // Decision 121: a receipt carries no freshness label, so a query whose code answered with one,
  // the way a command's code does, would leave unlabelled. The door knows which are queries.
  if (kind === "query" && answer.kind === "result") {
    return "answered a query with a command's receipt, which says nothing about how old it is";
  }

  if (answer.kind !== "data" && answer.kind !== "page") {
    return undefined;
  }

  const label: unknown = answer.freshness;

  if (label === null || typeof label !== "object") {
    return "returned a read with no freshness label";
  }

  const { mode, observed_at, connector } = label as Readonly<Record<string, unknown>>;

  if (typeof mode !== "string" || !MODES.includes(mode)) {
    return "returned a read whose label names no freshness mode";
  }

  if (typeof observed_at !== "string" || Number.isNaN(Date.parse(observed_at))) {
    return "returned a read whose label says no time it was read";
  }

  if (typeof connector !== "string" || connector === "") {
    return "returned a read whose label names no connector";
  }

  // §27: `current` means read from the system of record within this request. A time from before
  // the request began was not, so the label lies, and the door refuses it rather than correcting
  // it: relabelling would let the data out and hide the bug that wrote the lie (decision 120).
  if (mode === "current" && Date.parse(observed_at) < startedAt) {
    return "returned a value labelled current that was read before this request began";
  }

  return undefined;
}
