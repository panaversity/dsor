// NEW IN STEP 39b: checkpoints of DSoR's log (DSOR-AUD-04b and DSOR-AUD-04d in
// specs/dsor/03-execution.md, section 30). A checkpoint notes where every chain of one database
// ended at one moment, names the checkpoint before it, and is signed with an Ed25519 private key
// that lives outside the database. Kept in a file, it lets the checker catch a chain the owner
// rewrote from an edit on, which step 39's chain alone cannot (step 39b's README, decisions D1, D2,
// D10, D11, and D13).
import { createHash, sign, type KeyObject } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyChains, type ChainHead, type ChainReport, type ChainRow } from "./audit-chain.ts";

/** One database, as PostgreSQL names it: the server's own id and the database's name. */
export type DatabaseId = { system_identifier: string; name: string };

/** The log as the checkpoint scripts read it: every record, every head, and its database. */
export type Log = {
  rows: readonly ChainRow[];
  heads?: ReadonlyMap<string, ChainHead>;
  database: DatabaseId;
};

/** One chain as a checkpoint notes it: its last place and that record's fingerprint. */
export type NotedChain = { chain: string; chain_position: string; record_hash: string };

/** Where every chain of one database ended at one moment, and the checkpoint before it. */
export type Checkpoint = {
  database: DatabaseId;
  taken_at: string;
  previous: string | null;
  chains: NotedChain[];
};

/** A checkpoint and its signature, as the file holds them. */
export type SignedCheckpoint = { checkpoint: Checkpoint; signature: string };

/**
 * The text that is signed: the checkpoint as JSON, its fields in a fixed order and its chains
 * sorted by name, so the checker makes exactly the same text from the file's values (decision D11).
 */
export function checkpointText(checkpoint: Checkpoint): string {
  const { database, taken_at, previous } = checkpoint;
  const chains = [...checkpoint.chains]
    .sort((a, b) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0))
    .map(({ chain, chain_position, record_hash }) => ({ chain, chain_position, record_hash }));
  const named = { system_identifier: database.system_identifier, name: database.name };
  return JSON.stringify({ database: named, taken_at, previous, chains });
}

/** A checkpoint's own fingerprint, which the next checkpoint names as its previous (D13). */
export function checkpointHash(checkpoint: Checkpoint): string {
  return `sha256:${createHash("sha256").update(checkpointText(checkpoint), "utf8").digest("hex")}`;
}

/** The file a checkpoint is kept in: its time, with no colon, which some disks refuse. */
export function checkpointFileName(checkpoint: Checkpoint): string {
  return `${checkpoint.taken_at.replaceAll(":", "-")}.json`;
}

/**
 * A checkpoint of the log, or the reason there is none. Every chain is checked first, as step 39's
 * checker does, against its head: a checkpoint of a broken log would vouch for the break, so a
 * broken log is never signed (decision D10). Every chain is noted, so each checkpoint covers every
 * chain (DSOR-AUD-04d).
 */
export function takeCheckpoint(
  log: Log,
  taken_at: string,
  previous: string | null,
): { checkpoint: Checkpoint } | { refused: ChainReport[] } {
  const reports = verifyChains(log.rows, log.heads);
  if (reports.some((report) => report.broken !== undefined)) return { refused: reports };
  const last = new Map<string, ChainRow>();
  for (const row of log.rows) {
    const seen = last.get(row.chain);
    if (seen === undefined || Number(row.chain_position) > Number(seen.chain_position)) {
      last.set(row.chain, row);
    }
  }
  const chains = reports.map(({ chain }) => ({
    chain,
    chain_position: last.get(chain)!.chain_position,
    record_hash: last.get(chain)!.record_hash,
  }));
  return { checkpoint: { database: log.database, taken_at, previous, chains } };
}

/** The checkpoint and its signature, made with the private key over the checkpoint's text. */
export function signCheckpoint(checkpoint: Checkpoint, key: KeyObject): SignedCheckpoint {
  // Ed25519 takes no separate hash, so the first argument is null.
  const signature = sign(null, Buffer.from(checkpointText(checkpoint), "utf8"), key);
  return { checkpoint, signature: signature.toString("base64") };
}

/** Signs the checkpoint and writes it to its own new file in the folder; returns the file's name. */
export function writeCheckpoint(dir: string, checkpoint: Checkpoint, key: KeyObject): string {
  mkdirSync(dir, { recursive: true });
  const name = checkpointFileName(checkpoint);
  // "wx": a file already there is never overwritten, not even by a checkpoint of the same moment.
  writeFileSync(join(dir, name), `${JSON.stringify(signCheckpoint(checkpoint, key), null, 2)}\n`, {
    flag: "wx",
  });
  return name;
}
