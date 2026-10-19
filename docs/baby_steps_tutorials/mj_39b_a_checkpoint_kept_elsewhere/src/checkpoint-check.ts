// NEW IN STEP 39b: the log held against its checkpoints (DSOR-AUD-04b in
// specs/dsor/03-execution.md, section 30). Step 39's checker first; then every checkpoint file
// whose signature holds is used, and each chain it notes must still have, at the noted place, the
// noted fingerprint. A rewrite from an edit on changes that fingerprint, so it shows (step 39b's
// README, claims C3 to C6, decisions D4 to D7 and D9).
import { verify, type KeyObject } from "node:crypto";
import { verifyChains, type ChainHead, type ChainReport, type ChainRow } from "./audit-chain.ts";
import { checkpointText, type Checkpoint } from "./checkpoint.ts";

/** The oldest the newest checkpoint may be: the specification's table of limits, §44, at L2. */
export const MAX_AGE_HOURS = 24;

/** What the checker found: each chain, each checkpoint file, what it could not check, the exit. */
export type Checked = {
  exit: 0 | 1 | 2;
  reports: ChainReport[];
  files: { name: string; broken?: string }[];
  notes: string[];
};

/** What the checkpoint cannot see, said every time (claim C6). */
const BLIND =
  "not checked: a record written after the newest checkpoint, a new record the owner adds, or anyone holding both the owner's login and the private key";

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLACE = /^[1-9][0-9]*$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

/** An object with exactly these keys, and no other. */
function exactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

/** The file's checkpoint and signature, or undefined when the file is not exactly a checkpoint. */
function parse(text: string): { checkpoint: Checkpoint; signature: string } | undefined {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!exactly(file, ["checkpoint", "signature"]) || typeof file["signature"] !== "string") return;
  const checkpoint = file["checkpoint"];
  if (!exactly(checkpoint, ["taken_at", "chains"]) || !Array.isArray(checkpoint["chains"])) return;
  if (typeof checkpoint["taken_at"] !== "string" || !TIME.test(checkpoint["taken_at"])) return;
  const names = new Set<string>();
  for (const noted of checkpoint["chains"] as unknown[]) {
    if (!exactly(noted, ["chain", "chain_position", "record_hash"])) return;
    const { chain, chain_position, record_hash } = noted;
    if (typeof chain !== "string" || names.has(chain)) return;
    if (typeof chain_position !== "string" || !PLACE.test(chain_position)) return;
    if (typeof record_hash !== "string" || !HASH.test(record_hash)) return;
    names.add(chain);
  }
  return { checkpoint: checkpoint as Checkpoint, signature: file["signature"] };
}

/**
 * Every chain held against every checkpoint file whose signature holds with the public key. Exit 1
 * when anything is broken; else 2 when the log is not vouched for by a checkpoint 24 hours old or
 * less; else 0. `now` is the database's clock (decision D12).
 */
export function checkAgainstCheckpoints(
  rows: readonly ChainRow[],
  heads: ReadonlyMap<string, ChainHead> | undefined,
  files: readonly { name: string; text: string }[],
  publicKey: KeyObject | undefined,
  now: string,
): Checked {
  const reports = verifyChains(rows, heads);
  const places = new Map<string, Map<string, ChainRow>>();
  for (const row of rows) {
    places.set(row.chain, (places.get(row.chain) ?? new Map()).set(row.chain_position, row));
  }
  const checked: Checked = { exit: 0, reports, files: [], notes: [] };
  const used: { name: string; checkpoint: Checkpoint }[] = [];
  for (const { name, text } of publicKey === undefined ? [] : files) {
    const file = parse(text);
    const signed = (c: Checkpoint, s: string) =>
      verify(null, Buffer.from(checkpointText(c), "utf8"), publicKey!, Buffer.from(s, "base64"));
    if (file === undefined) checked.files.push({ name, broken: "it is not a checkpoint" });
    else if (!signed(file.checkpoint, file.signature)) {
      checked.files.push({ name, broken: "its signature does not match the committed public key" });
    } else {
      checked.files.push({ name });
      used.push({ name, checkpoint: file.checkpoint });
    }
  }
  // Every checkpoint kept, not only the newest: delete the newest, and the older still hold (D7).
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
  let vouched = true;
  const newest = used
    .map(({ checkpoint }) => checkpoint.taken_at)
    .sort()
    .at(-1);
  if (publicKey === undefined) {
    checked.notes.push("not checked: there is no public key, checkpoint-public-key.pem");
    vouched = false;
  } else if (newest === undefined) {
    const which = files.length === 0 ? "" : " whose signature holds";
    checked.notes.push(`not checked: there is no checkpoint${which}`);
    vouched = false;
  } else if (Date.parse(now) - Date.parse(newest) > MAX_AGE_HOURS * 3_600_000) {
    checked.notes.push(
      `not checked: the newest checkpoint is older than ${MAX_AGE_HOURS} hours (${newest})`,
    );
    vouched = false;
  }
  checked.notes.push(BLIND);
  const broken = reports.some((r) => r.broken !== undefined) || checked.files.some((f) => f.broken);
  checked.exit = broken ? 1 : vouched ? 0 : 2;
  return checked;
}
