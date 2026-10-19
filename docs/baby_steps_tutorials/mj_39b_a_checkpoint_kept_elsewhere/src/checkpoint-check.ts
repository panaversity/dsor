// NEW IN STEP 39b: the log held against its checkpoints (red: not built yet).
import type { KeyObject } from "node:crypto";
import type { ChainHead, ChainReport, ChainRow } from "./audit-chain.ts";

/** The oldest the newest checkpoint may be, from the specification's table of limits, L2. */
export const MAX_AGE_HOURS = 24;

/** What the checker found: each chain, each checkpoint file, what it could not check, the exit. */
export type Checked = {
  exit: 0 | 1 | 2;
  reports: ChainReport[];
  files: { name: string; broken?: string }[];
  notes: string[];
};

export function checkAgainstCheckpoints(
  _rows: readonly ChainRow[],
  _heads: ReadonlyMap<string, ChainHead> | undefined,
  _files: readonly { name: string; text: string }[],
  _publicKey: KeyObject | undefined,
  _now: string,
): Checked {
  throw new Error("not built yet: step 39b");
}
