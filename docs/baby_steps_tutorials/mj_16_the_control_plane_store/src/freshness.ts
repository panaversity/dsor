// How fresh a read was. Every query's answer states the mode delivered,
// observed_at, and the connector (DSOR-FRS-01a in specs/dsor/03-execution.md, section 27).
// The store that served the read writes the label, never the operation's code (step 15's
// README, decision 5).

// Written as common.schema.json writes them, in lower case. §27's table writes CURRENT
// (step 15's README, decision 3).
/** The four freshness modes of §27. */
export type FreshnessMode = "current" | "bounded_staleness" | "connector_defined" | "observational";

/** How fresh one read was: its mode, when it was read, and which connector served it. */
export type Freshness = { mode: FreshnessMode; observed_at: string; connector: string };

// Strongest first. §27 does not rank connector_defined. This tutorial puts it below
// bounded_staleness, because its promise is the connector's, not DSoR's (step 15's README,
// decision 6).
const MODES: readonly string[] = [
  "current",
  "bounded_staleness",
  "connector_defined",
  "observational",
];

// not copied: common.schema.json's timestamp says only "format": "date-time". This is that
// format, RFC 3339's date-time, typed out: a date, a time, and Z or an offset. Found by
// step 15's review: at most 9 digits after the second, a nanosecond, so a label stays small.
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

// not copied: connector.schema.json gives a connector's id no pattern. This tutorial names a
// connector by a short id, so a label stays small and prints on one line (step 15's README,
// decision 6). Found by the review.
const CONNECTOR = /^[a-z][a-z0-9._-]{0,63}$/;

/**
 * The label a store gave, checked, with its three fields only: one of the four modes, a real
 * date and time with its time zone, and a connector. Anything else is a bug in the store.
 */
export function checkedLabel(label: unknown): Freshness {
  // Each field is read once, so what is checked is what is kept. A mode DSoR does not know
  // has no place in the order of decision 6, and a guess could rank it above current (step
  // 15's README, decision 6).
  const { mode, observed_at, connector } = (label ?? {}) as Record<string, unknown>;
  if (typeof mode !== "string" || !MODES.includes(mode)) {
    throw new Error("a read's label has no mode DSoR knows");
  }
  if (typeof observed_at !== "string" || !isDateTime(observed_at)) {
    throw new Error("a read's label has no date and time");
  }
  if (typeof connector !== "string" || !CONNECTOR.test(connector)) {
    throw new Error("a read's label names no connector");
  }
  return { mode: mode as FreshnessMode, observed_at, connector };
}

/** Whether the text is an RFC 3339 date-time that names a real day. */
function isDateTime(text: string): boolean {
  const parts = DATE_TIME.exec(text);
  if (parts === null) return false;
  // JavaScript reads 30 February as 2 March, without a word. So the day is built and read
  // back: a day that does not exist comes back as another.
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * One call's reads, as the bound store notes them for the checklist: each read's label,
 * whether a store gave a label that failed its check, and whether line ⑨ has ended. The code
 * never holds it (step 15's README, decisions 5 and 6).
 */
export type Reads = { labels: Freshness[]; broken: boolean; closed: boolean };

/** A notebook for one call, with no read in it yet. */
export function newReads(): Reads {
  return { labels: [], broken: false, closed: false };
}

/**
 * The label of an answer built from these reads: the weakest mode, and the oldest time with
 * the connector that read it. A query that read nothing has none.
 */
export function stalest({ labels: reads, broken }: Reads): Freshness {
  // One label that failed its check refuses the call, even when the code
  // caught the error and read again (step 15's README, decision 6). Found by the review.
  if (broken) throw new Error("a store gave a label that failed its check");
  // A label for an answer that read nothing would be invented (step 15's README, decision 6).
  if (reads.length === 0) throw new Error("the query's code returned data without a read");
  // An answer is only as fresh as its stalest part. The weakest mode and the oldest time can
  // come from two reads, and each is taken from its own (step 15's README, decision 6).
  let weakest = reads[0]!.mode;
  let oldest = reads[0]!;
  for (const read of reads) {
    if (MODES.indexOf(read.mode) > MODES.indexOf(weakest)) weakest = read.mode;
    // As moments, never as text: 09:00 at +05:00 is earlier than 05:00 in UTC.
    if (Date.parse(read.observed_at) < Date.parse(oldest.observed_at)) oldest = read;
  }
  return { mode: weakest, observed_at: oldest.observed_at, connector: oldest.connector };
}
