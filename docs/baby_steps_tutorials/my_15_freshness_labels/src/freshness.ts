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
