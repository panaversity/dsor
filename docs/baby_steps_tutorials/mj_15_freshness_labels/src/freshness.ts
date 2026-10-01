// NEW IN STEP 15: how fresh a read was. Every query's answer states the mode delivered,
// observed_at, and the connector (DSOR-FRS-01a in specs/dsor/03-execution.md, section 27).
// The store that served the read writes the label, never the operation's code (step 15's
// README, decision 5).

// Written as common.schema.json writes them, in lower case. §27's table writes CURRENT
// (step 15's README, decision 3).
/** The four freshness modes of §27. */
export type FreshnessMode = "current" | "bounded_staleness" | "connector_defined" | "observational";

/** How fresh one read was: its mode, when it was read, and which connector served it. */
export type Freshness = { mode: FreshnessMode; observed_at: string; connector: string };

/** The label of an answer built from these reads. A query that read nothing has none. */
export function stalest(reads: Freshness[]): Freshness {
  // A label for an answer that read nothing would be invented (step 15's README, decision 6).
  if (reads.length === 0) throw new Error("the query's code returned data without a read");
  // Several reads, the stalest of them: not built yet, so refused rather than guessed.
  if (reads.length > 1) throw new Error("an answer from several reads has no label yet");
  return reads[0]!;
}
