// NEW IN STEP 39b: the signer keeps its own note of the last checkpoint it signed, beside the
// private key, out of the database owner's reach. Before it signs again, the log must hold against
// every checkpoint kept, and the folder's newest checkpoint must be that last one. Otherwise the
// owner could rewrite the chain, delete the older checkpoints, and wait for a routine checkpoint
// to vouch for the rewrite (found by step 39b's review, H1; step 39b's README, decision D13).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Checked } from "./checkpoint-check.ts";

/** The last checkpoint this key signed: its file's name and its fingerprint. */
export type LastSigned = { name: string; hash: string };

/** The note's file: the private key's file, with .last after it. */
const noteOf = (keyFile: string): string => `${keyFile}.last`;

/** The last checkpoint this key signed, or undefined before the first. */
export function readLastSigned(keyFile: string): LastSigned | undefined {
  if (!existsSync(noteOf(keyFile))) return undefined;
  const { name, hash } = JSON.parse(readFileSync(noteOf(keyFile), "utf8")) as LastSigned;
  return { name, hash };
}

/** Notes the checkpoint just signed, readable by its owner only, as the key is. */
export function writeLastSigned(keyFile: string, last: LastSigned): void {
  writeFileSync(noteOf(keyFile), `${JSON.stringify(last)}\n`, { mode: 0o600 });
}

/** Whether a new checkpoint may be signed, and the checkpoint it follows. */
export function mayTake(
  checked: Checked,
  last: LastSigned | undefined,
): { previous: string | null } | { refused: string } {
  if (checked.exit === 1) {
    return {
      refused: "the log or a checkpoint is broken, and a new checkpoint would vouch for the break",
    };
  }
  if (last !== undefined && checked.newest?.hash !== last.hash) {
    return {
      refused: `the newest checkpoint this key signed, ${last.name}, is not the newest in the folder`,
    };
  }
  return { previous: checked.newest?.hash ?? null };
}
