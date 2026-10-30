// The log held against its checkpoints (DSOR-AUD-04b in
// specs/dsor/03-execution.md, section 30). Step 39's checker first; then every checkpoint file
// of this database whose signature holds is used, and each chain it notes must still have, at the
// noted place, the noted fingerprint. A rewrite from an edit on changes that fingerprint, so it
// shows. Each checkpoint must follow the one before it, and the newest must be 24 hours old or less
// by the checker's own clock (step 39b's README, claims C3 to C6, decisions D4 to D7, D9, and D13).
import type { ChainReport } from "./audit-chain.ts";
import { verifyChains } from "./audit-chain.ts";
import { checkpointHash, type Checkpoint, type Log } from "./checkpoint.ts";
import { parseCheckpoint } from "./checkpoint-parse.ts";

/** The oldest the newest checkpoint may be: the specification's table of limits, §44, at L2. */
export const MAX_AGE_HOURS = 24;
/** How far a checkpoint's time may run ahead of the checker's clock: clocks differ a little. */
export const MAX_SKEW_MINUTES = 5;

/** One file of the checkpoint folder: its text, or why it could not be read. */
export type CheckpointFile = { name: string; text: string } | { name: string; broken: string };

/** What the checker found: each chain, each checkpoint file, what it could not check, the exit. */
export type Checked = {
  exit: 0 | 1 | 2;
  reports: ChainReport[];
  files: { name: string; broken?: string }[];
  notes: string[];
  // The newest checkpoint used, which the signer compares with the last one it signed (D13).
  newest?: { name: string; hash: string };
};

/** What the checkpoint cannot see, said every time (claim C6). */
const BLIND =
  "not checked: a record written after the newest checkpoint, a new record the owner adds, a database server that shows the checker other rows than it shows everyone, or anyone holding both the owner's login and the private key";

/** The checkpoints of this database whose signature holds, oldest first; every file's verdict. */
function usable(
  log: Log,
  files: readonly CheckpointFile[],
  publicKey: Parameters<typeof parseCheckpoint>[1],
  now: string,
): { used: { name: string; checkpoint: Checkpoint }[]; verdicts: Checked["files"] } {
  const used: { name: string; checkpoint: Checkpoint }[] = [];
  const verdicts: Checked["files"] = [];
  const latest = Date.parse(now) + MAX_SKEW_MINUTES * 60_000;
  for (const file of files) {
    const parsed = "broken" in file ? file : parseCheckpoint(file.text, publicKey);
    const { name } = file;
    if ("broken" in parsed) verdicts.push({ name, broken: parsed.broken });
    else if (
      parsed.checkpoint.database.system_identifier !== log.database.system_identifier ||
      parsed.checkpoint.database.name !== log.database.name
    ) {
      // Found by the review, M2: one key, two databases, and the other's checkpoint was used.
      verdicts.push({ name, broken: "it is a checkpoint of another database" });
    } else if (Date.parse(parsed.checkpoint.taken_at) > latest) {
      // Found by the review, H2: a checkpoint dated 2099 never grew old.
      verdicts.push({ name, broken: "its time is after the checker's clock" });
    } else {
      verdicts.push({ name });
      used.push({ name, checkpoint: parsed.checkpoint });
    }
  }
  used.sort((a, b) => (a.checkpoint.taken_at < b.checkpoint.taken_at ? -1 : 1));
  // Each follows the one before it; the oldest may follow one removed to keep the folder small.
  for (const [i, { name, checkpoint }] of used.entries()) {
    if (i > 0 && checkpoint.previous !== checkpointHash(used[i - 1]!.checkpoint)) {
      const verdict = verdicts.find((v) => v.name === name)!;
      verdict.broken = "it does not follow the checkpoint before it in the folder: one was removed";
    }
  }
  return { used, verdicts };
}

/**
 * Every chain held against every usable checkpoint. Exit 1 when anything is broken; else 2 when no
 * checkpoint 24 hours old or less by the checker's clock, `now`, vouches for the log; else 0.
 */
export function checkAgainstCheckpoints(
  log: Log,
  files: readonly CheckpointFile[],
  publicKey: Parameters<typeof parseCheckpoint>[1] | undefined,
  now: string,
): Checked {
  const reports = verifyChains(log.rows, log.heads);
  const { used, verdicts } =
    publicKey === undefined ? { used: [], verdicts: [] } : usable(log, files, publicKey, now);
  const checked: Checked = { exit: 0, reports, files: verdicts, notes: [] };
  const places = new Map<string, Map<string, (typeof log.rows)[number]>>();
  for (const row of log.rows) {
    places.set(row.chain, (places.get(row.chain) ?? new Map()).set(row.chain_position, row));
  }
  // Every checkpoint used, not only the newest (D7).
  for (const { name, checkpoint } of used) {
    for (const noted of checkpoint.chains) {
      let report = reports.find((r) => r.chain === noted.chain);
      if (report === undefined) reports.push((report = { chain: noted.chain, records: 0 }));
      // Step 39's own break comes first: it names the record that was changed.
      if (report.broken !== undefined) continue;
      const position = Number(noted.chain_position);
      const record = places.get(noted.chain)?.get(noted.chain_position);
      if (record === undefined) {
        const why = `checkpoint ${name} noted place ${position}, and the chain ends at place ${report.records}`;
        report.broken = { position, record_id: null, why };
      } else if (record.record_hash !== noted.record_hash) {
        const why = `its fingerprint is not the one checkpoint ${name} noted`;
        report.broken = { position, record_id: record.fields[1] ?? null, why };
      }
    }
  }
  reports.sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0));
  const covered = new Set(used.flatMap(({ checkpoint }) => checkpoint.chains.map((c) => c.chain)));
  for (const { chain } of reports) {
    if (!covered.has(chain)) checked.notes.push(`${chain}: not yet in a checkpoint`);
  }
  const newest = used.at(-1);
  if (newest !== undefined) {
    checked.newest = { name: newest.name, hash: checkpointHash(newest.checkpoint) };
  }
  let vouched = false;
  if (publicKey === undefined) {
    checked.notes.push("not checked: there is no public key, checkpoint-public-key.pem");
  } else if (newest === undefined) {
    const which = files.length === 0 ? "" : " whose signature holds";
    checked.notes.push(`not checked: there is no checkpoint${which}`);
  } else if (Date.parse(now) - Date.parse(newest.checkpoint.taken_at) > MAX_AGE_HOURS * 3_600_000) {
    const at = newest.checkpoint.taken_at;
    checked.notes.push(
      `not checked: the newest checkpoint is older than ${MAX_AGE_HOURS} hours (${at})`,
    );
  } else {
    vouched = true;
  }
  checked.notes.push(BLIND);
  const broken = reports.some((r) => r.broken !== undefined) || verdicts.some((f) => f.broken);
  checked.exit = broken ? 1 : vouched ? 0 : 2;
  return checked;
}
