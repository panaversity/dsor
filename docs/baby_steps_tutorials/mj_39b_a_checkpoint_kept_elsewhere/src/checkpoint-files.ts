// NEW IN STEP 39b: what the checkpoint scripts read (red: not built yet).
import type { KeyObject } from "node:crypto";
import type pg from "pg";
import type { ChainHead, ChainRow } from "./audit-chain.ts";

export async function readLog(
  _client: pg.ClientBase,
): Promise<{ rows: ChainRow[]; heads: Map<string, ChainHead>; now: string }> {
  throw new Error("not built yet: step 39b");
}

export function readCheckpointFiles(_dir: string): { name: string; text: string }[] {
  throw new Error("not built yet: step 39b");
}

export function readPrivateKey(_file: string): KeyObject {
  throw new Error("not built yet: step 39b");
}

export function readPublicKey(_file: string): KeyObject {
  throw new Error("not built yet: step 39b");
}
