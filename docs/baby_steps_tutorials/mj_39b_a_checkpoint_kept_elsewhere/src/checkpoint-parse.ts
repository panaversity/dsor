// NEW IN STEP 39b: reading one checkpoint file. A file is used only when it is exactly a checkpoint,
// field for field, and its signature holds with the committed public key. Anything else is named,
// never trusted (step 39b's README, claim C3, decisions D9 and D11).
import { verify, type KeyObject } from "node:crypto";
import { checkpointText, type Checkpoint } from "./checkpoint.ts";

export const NOT_A_CHECKPOINT = "it is not a checkpoint";
export const NOT_SIGNED = "its signature does not match the committed public key";

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PLACE = /^[1-9][0-9]*$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SERVER = /^[0-9]+$/;
// An Ed25519 signature is 64 bytes: 86 letters of base64 and "==". Node skips any letter that is
//   not base64, so the form is checked here (found by the review, L3).
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;

/** An object with exactly these keys, and no other. */
function exactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

/** A real moment, written exactly as JavaScript writes it: no 30 February, no hour 25. */
function isTime(value: unknown): value is string {
  if (typeof value !== "string" || !TIME.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** The file's checkpoint, when it is exactly one, field for field. */
function form(file: unknown): { checkpoint: Checkpoint; signature: string } | undefined {
  if (!exactly(file, ["checkpoint", "signature"])) return undefined;
  const { checkpoint: c, signature } = file;
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) return undefined;
  if (!exactly(c, ["database", "taken_at", "previous", "chains"])) return undefined;
  const database = c["database"];
  if (!exactly(database, ["system_identifier", "name"])) return undefined;
  const { system_identifier, name } = database;
  if (typeof system_identifier !== "string" || !SERVER.test(system_identifier)) return undefined;
  if (typeof name !== "string" || name === "") return undefined;
  if (!isTime(c["taken_at"])) return undefined;
  const previous = c["previous"];
  if (previous !== null && (typeof previous !== "string" || !HASH.test(previous))) return;
  if (!Array.isArray(c["chains"])) return undefined;
  const names = new Set<string>();
  for (const noted of c["chains"] as unknown[]) {
    if (!exactly(noted, ["chain", "chain_position", "record_hash"])) return undefined;
    const { chain, chain_position, record_hash } = noted;
    if (typeof chain !== "string" || chain === "" || names.has(chain)) return undefined;
    if (typeof chain_position !== "string" || !PLACE.test(chain_position)) return undefined;
    if (typeof record_hash !== "string" || !HASH.test(record_hash)) return undefined;
    names.add(chain);
  }
  return { checkpoint: c as Checkpoint, signature };
}

/** The checkpoint in this file's text, or why it is not used. */
export function parseCheckpoint(
  text: string,
  publicKey: KeyObject,
): { checkpoint: Checkpoint } | { broken: string } {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { broken: NOT_A_CHECKPOINT };
  }
  const found = form(file);
  if (found === undefined) return { broken: NOT_A_CHECKPOINT };
  const signed = Buffer.from(checkpointText(found.checkpoint), "utf8");
  if (!verify(null, signed, publicKey, Buffer.from(found.signature, "base64"))) {
    return { broken: NOT_SIGNED };
  }
  return { checkpoint: found.checkpoint };
}
