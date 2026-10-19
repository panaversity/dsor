// NEW IN STEP 39b: what the checkpoint scripts read, from the database and from the disk. The
// public key is the committed file beside this folder's package.json; the checkpoints are in
// checkpoints/, or in the folder DSOR_CHECKPOINT_DIR names; the private key is the file
// DSOR_CHECKPOINT_KEY names, which only pnpm checkpoint-audit reads (step 39b's README, decisions
// D8, D11, and D12).
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { readChains, readHeads, type ChainHead, type ChainRow } from "./audit-chain.ts";

/** The committed public key: a change to it shows in git, out of the database owner's reach. */
export const PUBLIC_KEY_FILE: string = fileURLToPath(
  new URL("../checkpoint-public-key.pem", import.meta.url),
);

/** This folder: a private key is never written inside it, where git could pick it up. */
const FOLDER = fileURLToPath(new URL("../", import.meta.url));

/**
 * A new Ed25519 key pair: the private key to its own new file, outside this folder, readable by its
 * owner only; the public key to the file given (claim C1). A private key file already there is
 * never overwritten.
 */
export function makeKeyPair(privateFile: string, publicFile: string = PUBLIC_KEY_FILE): void {
  const inside = relative(FOLDER, resolve(privateFile));
  if (!inside.startsWith("..")) {
    throw new Error("the private key must be written outside this folder, where git never sees it");
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(privateFile, privateKey.export({ type: "pkcs8", format: "pem" }), {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(publicFile, publicKey.export({ type: "spki", format: "pem" }));
}

/** Where checkpoints are kept: DSOR_CHECKPOINT_DIR, or checkpoints/ in this folder. */
export function checkpointDir(env: NodeJS.ProcessEnv = process.env): string {
  const named = env["DSOR_CHECKPOINT_DIR"];
  return named !== undefined && named !== ""
    ? named
    : fileURLToPath(new URL("../checkpoints/", import.meta.url));
}

/** Whether this login sees every record: the log forces row-level security (step 39's review, H1). */
export async function seesEveryRecord(client: pg.ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ sees: boolean }>(
    "SELECT rolsuper OR rolbypassrls AS sees FROM pg_roles WHERE rolname = current_user",
  );
  return rows[0]?.sees === true;
}

/**
 * Every record, every head, and the database's clock, read in the caller's transaction. In a
 * REPEATABLE READ transaction the three are of one moment, so the heads and the records agree.
 */
export async function readLog(
  client: pg.ClientBase,
): Promise<{ rows: ChainRow[]; heads: Map<string, ChainHead>; now: string }> {
  const rows = await readChains(client);
  const heads = await readHeads(client);
  const { rows: clock } = await client.query<{ now: string }>(
    `SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
  );
  return { rows, heads, now: clock[0]!.now };
}

/** Every checkpoint file in the folder, by name; none when the folder is not there. */
export function readCheckpointFiles(dir: string): { name: string; text: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

/** An Ed25519 key, or an error that says the file holds another kind. */
function ed25519(key: KeyObject, file: string): KeyObject {
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an Ed25519 key`);
  return key;
}

/** The private key in this file. */
export function readPrivateKey(file: string): KeyObject {
  return ed25519(createPrivateKey(readFileSync(file)), file);
}

/** The public key in this file. */
export function readPublicKey(file: string): KeyObject {
  return ed25519(createPublicKey(readFileSync(file)), file);
}
