// pnpm verify-audit. It reads every chain of DSoR's log, and each chain's head, as
// the database's owner, read only, recomputes every fingerprint, and names the first broken record
// of each chain. It exits 0 when every chain is whole, 1 when one is not, and 2 when it could not
// check: a login that cannot see every record would see an empty log and call it whole (found by
// step 39's review, H1). The owner's login comes from .env and is never printed (DSOR-AUD-04b;
// step 39's README, decision D4).
// It also holds every chain against every checkpoint of this database whose
// signature holds with the committed public key, and exits 2 when no checkpoint 24 hours old or
// less, by this computer's clock, vouches for the log (step 39b's README, claims C3 to C6).
import { existsSync } from "node:fs";
import pg from "pg";
import { checkAgainstCheckpoints } from "./checkpoint-check.ts";
import { readLogAsOwner } from "./checkpoint-db.ts";
import {
  checkpointDir,
  PUBLIC_KEY_FILE,
  readCheckpointFiles,
  readPublicKey,
} from "./checkpoint-files.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** What the script found: 0 whole, 1 broken, 2 not checked. */
async function check(): Promise<0 | 1 | 2> {
  loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_CHECKPOINT_DIR"]);
  const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
  // One moment for the records and the heads, read trusting as little of the
  //   owner's database as it can (decisions D12 and D15).
  const read = await readLogAsOwner(owner).finally(() => owner.end());
  if ("refused" in read) {
    console.log(`${read.exit === 1 ? "broken" : "not checked"}: ${read.refused}`);
    return read.exit;
  }
  const publicKey = existsSync(PUBLIC_KEY_FILE) ? readPublicKey(PUBLIC_KEY_FILE) : undefined;
  const files = readCheckpointFiles(checkpointDir());
  // This computer's clock, never the database's, which the owner controls (step 39b's review, H2).
  const now = new Date().toISOString();
  const checked = checkAgainstCheckpoints(read.log, files, publicKey, now);
  for (const { name, broken } of checked.files) {
    const said = broken === undefined ? "signature holds" : `broken: ${broken}`;
    console.log(`checkpoint ${name}: ${said}`);
  }
  for (const { chain, records, broken: at } of checked.reports) {
    if (at === undefined) {
      console.log(`${chain}: whole, ${records} records`);
    } else {
      const where = `place ${at.position}, record ${at.record_id ?? "?"}`;
      console.log(`${chain}: broken at ${where}: ${at.why}`);
    }
  }
  if (checked.reports.length === 0) console.log("the log holds no record");
  // What it could not check, and what a checkpoint cannot see, said every time (claim C6).
  for (const note of checked.notes) console.log(note);
  return checked.exit;
}

try {
  process.exitCode = await check();
} catch (error) {
  // Never the error itself: a connection error can repeat the login.
  console.log(
    `not checked: the log could not be read (${(error as { code?: string }).code ?? "error"})`,
  );
  process.exitCode = 2;
}
