// NEW IN STEP 39b: pnpm checkpoint-audit. As the database's owner, read only, it reads every chain,
// every head, and the database's id at one moment. It holds the log against every checkpoint kept,
// as pnpm verify-audit does, and checks that the folder's newest checkpoint is the last one this
// key signed. Only then does it sign a new checkpoint, which follows that one, with the private key
// DSOR_CHECKPOINT_KEY names, and writes it to its own file. It exits 0 when written, 1 when
// something is broken and nothing was signed, and 2 when it could not take one. Neither the owner's
// login nor the key is ever printed (DSOR-AUD-04b, DSOR-AUD-04d; step 39b's README, claim C2,
// decisions D3, D10, D12, D13, and D14).
import { createPublicKey } from "node:crypto";
import { existsSync } from "node:fs";
import pg from "pg";
import { takeCheckpoint, writeCheckpoint, checkpointHash } from "./checkpoint.ts";
import { checkAgainstCheckpoints, MAX_SKEW_MINUTES } from "./checkpoint-check.ts";
import { readLogAsOwner } from "./checkpoint-db.ts";
import {
  checkpointDir,
  PUBLIC_KEY_FILE,
  readCheckpointFiles,
  readPrivateKey,
  readPublicKey,
} from "./checkpoint-files.ts";
import { mayTake, readLastSigned, writeLastSigned } from "./checkpoint-signer.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** What the script did: 0 written, 1 refused because something is broken, 2 not taken. */
async function take(): Promise<0 | 1 | 2> {
  loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_CHECKPOINT_KEY", "DSOR_CHECKPOINT_DIR"]);
  const keyFile = process.env["DSOR_CHECKPOINT_KEY"];
  if (keyFile === undefined || keyFile === "") {
    console.log("not taken: DSOR_CHECKPOINT_KEY does not name the private key's file");
    return 2;
  }
  const key = readPrivateKey(keyFile);
  const publicKey = createPublicKey(key);
  const pem = (k: typeof publicKey) => k.export({ type: "spki", format: "pem" }).toString();
  if (existsSync(PUBLIC_KEY_FILE) && pem(readPublicKey(PUBLIC_KEY_FILE)) !== pem(publicKey)) {
    console.log("not taken: this private key is not the pair of checkpoint-public-key.pem");
    return 2;
  }
  const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
  const read = await readLogAsOwner(owner).finally(() => owner.end());
  if ("refused" in read) {
    console.log(`not taken: ${read.refused}`);
    return read.exit;
  }
  const { log } = read;
  // The checkpoint's time is this computer's clock; the database's must agree (the review, H2).
  const now = new Date().toISOString();
  if (Math.abs(Date.parse(log.databaseNow) - Date.parse(now)) > MAX_SKEW_MINUTES * 60_000) {
    console.log(
      `not taken: the database's clock and this computer's differ by more than ${MAX_SKEW_MINUTES} minutes`,
    );
    return 2;
  }
  const checked = checkAgainstCheckpoints(
    log,
    readCheckpointFiles(checkpointDir()),
    publicKey,
    now,
  );
  const decision = mayTake(checked, readLastSigned(keyFile));
  const taken = "refused" in decision ? undefined : takeCheckpoint(log, now, decision.previous);
  if (taken === undefined || "refused" in taken) {
    for (const { name, broken } of checked.files)
      if (broken) console.log(`checkpoint ${name}: broken: ${broken}`);
    for (const { chain, broken } of checked.reports) {
      if (broken) console.log(`${chain}: broken at place ${broken.position}: ${broken.why}`);
    }
    const why =
      "refused" in decision
        ? decision.refused
        : "the log is broken, and a checkpoint would vouch for the break";
    console.log(`not taken: ${why}`);
    return 1;
  }
  const name = writeCheckpoint(checkpointDir(), taken.checkpoint, key);
  writeLastSigned(keyFile, { name, hash: checkpointHash(taken.checkpoint) });
  console.log(`checkpoint written: ${name}, ${taken.checkpoint.chains.length} chains`);
  // Said every time (the review, M4; decision D14).
  console.log(
    "for learning only: whoever signs here also holds the owner's login; in production another person signs, with a read-only login",
  );
  return 0;
}

try {
  process.exitCode = await take();
} catch (error) {
  // Never the error itself: a connection error can repeat the login.
  console.log(
    `not taken: the log or the key could not be read (${(error as { code?: string }).code ?? "error"})`,
  );
  process.exitCode = 2;
}
