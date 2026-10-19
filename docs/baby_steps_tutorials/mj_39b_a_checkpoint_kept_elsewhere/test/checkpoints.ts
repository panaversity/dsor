// Step 39b: the story's log, its keys, and checkpoints made from them, shared by the checkpoint
// tests. Not a test file.
import { generateKeyPairSync, type KeyObject, type KeyPairKeyObjectResult } from "node:crypto";
import { fingerprint, GENESIS, type ChainHead, type ChainRow } from "../src/audit-chain.ts";
import {
  checkpointFileName,
  checkpointHash,
  signCheckpoint,
  takeCheckpoint,
  type Checkpoint,
  type DatabaseId,
} from "../src/checkpoint.ts";
import {
  checkAgainstCheckpoints,
  type CheckpointFile,
  type Checked,
} from "../src/checkpoint-check.ts";

/** A chain of records, fingerprinted as the database does. */
export function chainOf(chain: string, records: (string | null)[][]): ChainRow[] {
  const rows: ChainRow[] = [];
  let previous = GENESIS;
  records.forEach((fields, i) => {
    const position = String(i + 1);
    const record_hash = fingerprint(previous, chain, position, fields);
    rows.push({ chain, chain_position: position, previous_hash: previous, record_hash, fields });
    previous = record_hash;
  });
  return rows;
}

/** org_456's three records: a draft, the denied reconcile, a release. */
export const STORY = (): (string | null)[][] => [
  ["1", "aud_1", "2026-10-20T09:00:00.000000Z", "decision", "payment.create@1", "ALLOW"],
  ["2", "aud_2", "2026-10-20T09:01:00.000000Z", "decision", "payment.reconcile@1", "DENY"],
  ["3", "aud_3", "2026-10-20T09:02:00.000000Z", "decision", "proposal.execute@1", "ALLOW"],
];

/** The log of the story: org_456's three records, and one record of no company. */
export const LOG = (): ChainRow[] => [
  ...chainOf("org_456", STORY()),
  ...chainOf("no_company", [["4", "aud_4", "2026-10-20T09:03:00.000000Z", "decision"]]),
];

/** The careful editor: place 2 turned to ALLOW, and every fingerprint from there written again. */
export function rewritten(): ChainRow[] {
  const story = STORY();
  story[1]![5] = "ALLOW";
  return [...chainOf("org_456", story), ...LOG().filter((r) => r.chain === "no_company")];
}

export const KEYS: KeyPairKeyObjectResult = generateKeyPairSync("ed25519");
export const OTHER: KeyPairKeyObjectResult = generateKeyPairSync("ed25519");
export const AT_9 = "2026-10-20T09:00:00.000Z";
export const AT_10 = "2026-10-20T10:00:00.000Z";
/** The story's database, as PostgreSQL names it. */
export const DB: DatabaseId = { system_identifier: "7300000000000000001", name: "neondb" };

/** A file the script would write, and the checkpoint's fingerprint. */
export type File = { name: string; text: string; hash: string; checkpoint: Checkpoint };

/** A checkpoint of these rows, taken at this time, signed, as the file the script would write. */
export function fileOf(
  rows: ChainRow[],
  taken_at: string,
  options: { key?: KeyObject; previous?: string | null; database?: DatabaseId } = {},
): File {
  const database = options.database ?? DB;
  const taken = takeCheckpoint({ rows, database }, taken_at, options.previous ?? null);
  if (!("checkpoint" in taken)) throw new Error("the test's log is broken");
  const signed = signCheckpoint(taken.checkpoint, options.key ?? KEYS.privateKey);
  return {
    name: checkpointFileName(taken.checkpoint),
    text: JSON.stringify(signed, null, 2),
    hash: checkpointHash(taken.checkpoint),
    checkpoint: taken.checkpoint,
  };
}

/** The log held against these files, as verify-audit would, by the checker's clock `now`. */
export function check(
  rows: ChainRow[],
  files: CheckpointFile[],
  now: string = AT_10,
  heads?: ReadonlyMap<string, ChainHead>,
): Checked {
  return checkAgainstCheckpoints({ rows, heads, database: DB }, files, KEYS.publicKey, now);
}

/**
 * A file of this checkpoint, changed by `edit`, then signed with the right key: so only the
 * checker's own rules about a checkpoint's form can refuse it, never its signature.
 */
export function signedAfter(file: File, edit: (checkpoint: Checkpoint) => void): File {
  const checkpoint = structuredClone(file.checkpoint);
  edit(checkpoint);
  const text = JSON.stringify(signCheckpoint(checkpoint, KEYS.privateKey));
  return { ...file, text, checkpoint, hash: checkpointHash(checkpoint) };
}
