// NEW IN STEP 39b: checkpoints (red: not built yet).
import type { KeyObject } from "node:crypto";
import type { ChainHead, ChainReport, ChainRow } from "./audit-chain.ts";

/** One chain as a checkpoint notes it: its last place and that record's fingerprint. */
export type NotedChain = { chain: string; chain_position: string; record_hash: string };

/** Where every chain ended at one moment. */
export type Checkpoint = { taken_at: string; chains: NotedChain[] };

/** A checkpoint and its signature, as the file holds them. */
export type SignedCheckpoint = { checkpoint: Checkpoint; signature: string };

export function checkpointText(_checkpoint: Checkpoint): string {
  throw new Error("not built yet: step 39b");
}

export function checkpointFileName(_checkpoint: Checkpoint): string {
  throw new Error("not built yet: step 39b");
}

export function takeCheckpoint(
  _rows: readonly ChainRow[],
  _heads: ReadonlyMap<string, ChainHead> | undefined,
  _taken_at: string,
): { checkpoint: Checkpoint } | { refused: ChainReport[] } {
  throw new Error("not built yet: step 39b");
}

export function signCheckpoint(_checkpoint: Checkpoint, _key: KeyObject): SignedCheckpoint {
  throw new Error("not built yet: step 39b");
}

export function writeCheckpoint(_dir: string, _checkpoint: Checkpoint, _key: KeyObject): string {
  throw new Error("not built yet: step 39b");
}
