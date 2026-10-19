// NEW IN STEP 39b: pnpm checkpoint-audit. As the database's owner, read only, it reads every chain,
// every head, and the database's clock at one moment, checks every chain as step 39 does, and only
// then signs a checkpoint with the private key DSOR_CHECKPOINT_KEY names and writes it to its own
// file. It exits 0 when written, 1 when the log is broken and nothing was signed, and 2 when it
// could not take one. Neither the owner's login nor the key is ever printed (DSOR-AUD-04b,
// DSOR-AUD-04d; step 39b's README, claim C2, decisions D3, D10, and D12).
import pg from "pg";
import { takeCheckpoint, writeCheckpoint } from "./checkpoint.ts";
import { checkpointDir, readLog, readPrivateKey, seesEveryRecord } from "./checkpoint-files.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** What the script did: 0 written, 1 refused on a broken log, 2 not taken. */
async function take(): Promise<0 | 1 | 2> {
  loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_CHECKPOINT_KEY", "DSOR_CHECKPOINT_DIR"]);
  const keyFile = process.env["DSOR_CHECKPOINT_KEY"];
  if (keyFile === undefined || keyFile === "") {
    console.log("not taken: DSOR_CHECKPOINT_KEY does not name the private key's file");
    return 2;
  }
  const key = readPrivateKey(keyFile);
  const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
  const client = await owner.connect();
  let log: Awaited<ReturnType<typeof readLog>>;
  try {
    // One moment for the records, the heads, and the clock (decision D12).
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (!(await seesEveryRecord(client))) {
      console.log("not taken: this login cannot see every record of the log (it needs BYPASSRLS)");
      return 2;
    }
    log = await readLog(client);
    await client.query("COMMIT");
  } finally {
    client.release();
    await owner.end();
  }
  const taken = takeCheckpoint(log.rows, log.heads, log.now);
  if ("refused" in taken) {
    for (const { chain, broken } of taken.refused) {
      if (broken !== undefined)
        console.log(`${chain}: broken at place ${broken.position}: ${broken.why}`);
    }
    console.log("not taken: the log is broken, and a checkpoint would vouch for the break");
    return 1;
  }
  const name = writeCheckpoint(checkpointDir(), taken.checkpoint, key);
  console.log(`checkpoint written: ${name}, ${taken.checkpoint.chains.length} chains`);
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
