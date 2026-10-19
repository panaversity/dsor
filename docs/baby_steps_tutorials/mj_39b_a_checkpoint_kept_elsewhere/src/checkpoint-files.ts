// NEW IN STEP 39b: what the checkpoint scripts read and write on the disk. The public key is the
// committed file beside this folder's package.json; the checkpoints are in checkpoints/, or in the
// folder DSOR_CHECKPOINT_DIR names; the private key is the file DSOR_CHECKPOINT_KEY names, outside
// the repository, which only pnpm checkpoint-audit reads (step 39b's README, claim C1, decisions D8
// and D11).
import { spawnSync } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckpointFile } from "./checkpoint-check.ts";

/** The committed public key: a change to it shows in git, out of the database owner's reach. */
export const PUBLIC_KEY_FILE: string = fileURLToPath(
  new URL("../checkpoint-public-key.pem", import.meta.url),
);

/** The largest checkpoint file read: a real one is a few kilobytes (found by the review, M1). */
export const MAX_FILE_BYTES = 1_048_576;

/** This folder. */
const FOLDER = fileURLToPath(new URL("../", import.meta.url));

/** The repository this folder is in, or this folder when it is in none. */
function repositoryRoot(): string {
  const git = spawnSync("git", ["-C", FOLDER, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  return git.status === 0 ? git.stdout.trim() : FOLDER;
}

/** Whether the file is the folder or under it. "..secret.pem" is under it (the review, M3). */
function within(folder: string, file: string): boolean {
  const path = relative(folder, resolve(file));
  return path === "" || !(path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path));
}

/**
 * A new Ed25519 key pair: the private key to its own new file, outside the repository, readable by
 * its owner only; the public key to the file given (claim C1). A private key file already there is
 * never overwritten, and a public key already there only when replacing it is asked for, because
 * every checkpoint signed with the old pair then fails its signature (the review, L4).
 */
export function makeKeyPair(
  privateFile: string,
  publicFile: string = PUBLIC_KEY_FILE,
  options: { replace?: boolean; root?: string } = {},
): void {
  if (within(options.root ?? repositoryRoot(), privateFile) || within(FOLDER, privateFile)) {
    throw new Error(
      "the private key must be written outside the repository, where git never sees it",
    );
  }
  if (existsSync(publicFile) && options.replace !== true) {
    throw new Error("a public key is already there; to replace it, run again with --replace");
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

/**
 * Every .json entry in the folder, by name, oldest first; none when the folder is not there. An
 * entry that is not a regular file of at most 1 MB is named, never read: a folder, a link, a pipe
 * that never ends, or a file too large (the review, M1).
 */
export function readCheckpointFiles(dir: string): CheckpointFile[] {
  if (!existsSync(dir)) return [];
  const odd = "it is not a file of at most 1 MB";
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      try {
        const entry = lstatSync(join(dir, name));
        if (!entry.isFile() || entry.size > MAX_FILE_BYTES) return { name, broken: odd };
        return { name, text: readFileSync(join(dir, name), "utf8") };
      } catch {
        return { name, broken: "it could not be read" };
      }
    });
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
