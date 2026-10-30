// NEW IN STEP 39b: the owner takes checkpoints, tampers as the careful editor would, and reads what
// the checker says against the checkpoints. Not a test file: checkpoint.db.test.ts starts it
// through ownerCheckpoint in test/db.ts. The owner's login stays in this child, and what it prints
// is redacted first (step 09's README, decision 18). Everything is rolled back but the file a take
// writes. The commands:
// - take <dir> <private key file>: a checkpoint of the log as it is, as pnpm checkpoint-audit takes
//   it, written to <dir>.
// - verify <dir> <public key file>: the log held against every checkpoint in <dir>.
// - rewrite <id> <dir> <public key file>: turn the record over, write every fingerprint from it to
//   the end of its chain again, and the chain's head; then verify (step 39b's README, P1).
// - rewrite-take <id> <dir> <private key file>: the same rewrite, then try to take a checkpoint
//   (the review, H1).
// - trim <chain> <dir> <public key file>: remove the chain's newest record, set its head back, and
//   verify.
// - edit-take <id> <dir> <private key file>: turn the record over, then try to take a checkpoint.
// - view <dir> <public key file>: put a view in place of the log, then read it (the review, H3).
// - clock: name a function public.now() that says 2099, put it first, then read the database's
//   clock as the scripts do (the review, H2).
// - chains: every chain the log holds, and each chain's head. first <chain>: its first record's id.
// Run by the tests as: node test/owner-checkpoint.ts <command> <words>
import { createPublicKey } from "node:crypto";
import pg from "pg";
import { checkpointHash, takeCheckpoint, writeCheckpoint } from "../src/checkpoint.ts";
import { checkAgainstCheckpoints } from "../src/checkpoint-check.ts";
import { NotAPlainLog, readLog } from "../src/checkpoint-db.ts";
import { readCheckpointFiles, readPrivateKey, readPublicKey } from "../src/checkpoint-files.ts";
import { mayTake, readLastSigned, writeLastSigned } from "../src/checkpoint-signer.ts";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, ...words] = process.argv.slice(2);
const FLIP = `UPDATE dsor.audit SET "authorization" = CASE "authorization" WHEN 'ALLOW' THEN 'DENY' ELSE 'ALLOW' END WHERE record_id = $1`;
// The careful editor knows the recipe: from the edited record to the end of its chain, each record
//   follows the new fingerprint before it and gets its own again, and the head the last one.
const REWRITE = `DO $$
DECLARE
  t record;
  r dsor.audit;
  previous text;
BEGIN
  SELECT chain, chain_position INTO t FROM dsor.audit WHERE record_id = current_setting('test.id');
  SELECT record_hash INTO previous FROM dsor.audit
   WHERE chain = t.chain AND chain_position = t.chain_position - 1;
  previous := coalesce(previous, 'sha256:' || repeat('0', 64));
  FOR r IN SELECT * FROM dsor.audit WHERE chain = t.chain AND chain_position >= t.chain_position
            ORDER BY chain_position LOOP
    r.previous_hash := previous;
    r.record_hash := dsor.audit_fingerprint(r);
    UPDATE dsor.audit SET previous_hash = r.previous_hash, record_hash = r.record_hash
     WHERE record_id = r.record_id;
    previous := r.record_hash;
  END LOOP;
  UPDATE dsor.audit_heads SET record_hash = previous WHERE chain = t.chain;
END $$`;
// The newest record of a chain removed, and its head set back to the record before it.
const TRIM = [
  `DELETE FROM dsor.audit WHERE chain = $1
     AND chain_position = (SELECT max(chain_position) FROM dsor.audit WHERE chain = $1)`,
  `UPDATE dsor.audit_heads h SET chain_position = a.chain_position, record_hash = a.record_hash
     FROM dsor.audit a WHERE h.chain = $1 AND a.chain = $1
      AND a.chain_position = (SELECT max(chain_position) FROM dsor.audit WHERE chain = $1)`,
];

/** The log held against every checkpoint in the folder, inside the open transaction. */
async function verify(client: pg.PoolClient, dir: string, keyFile: string): Promise<unknown> {
  const log = await readLog(client);
  const now = new Date().toISOString();
  return checkAgainstCheckpoints(log, readCheckpointFiles(dir), readPublicKey(keyFile), now);
}

/** A checkpoint taken as pnpm checkpoint-audit takes one, inside the open transaction. */
async function take(client: pg.PoolClient, dir: string, keyFile: string): Promise<unknown> {
  const key = readPrivateKey(keyFile);
  const log = await readLog(client);
  const now = new Date().toISOString();
  const checked = checkAgainstCheckpoints(log, readCheckpointFiles(dir), createPublicKey(key), now);
  const decision = mayTake(checked, readLastSigned(keyFile));
  if ("refused" in decision) return decision;
  const taken = takeCheckpoint(log, now, decision.previous);
  if ("refused" in taken) return taken;
  const name = writeCheckpoint(dir, taken.checkpoint, key);
  writeLastSigned(keyFile, { name, hash: checkpointHash(taken.checkpoint) });
  return { written: name };
}

/** The careful editor's rewrite, from this record on. */
async function rewrite(client: pg.PoolClient, id: string): Promise<void> {
  await client.query("SELECT set_config('test.id', $1, true)", [id]);
  await client.query(FLIP, [id]);
  await client.query(REWRITE);
}

const client = await pool.connect();
try {
  let result: unknown;
  await client.query("BEGIN");
  const [a, b, c] = words;
  if (command === "take") result = await take(client, a!, b!);
  else if (command === "verify") result = await verify(client, a!, b!);
  else if (command === "rewrite") {
    await rewrite(client, a!);
    result = await verify(client, b!, c!);
  } else if (command === "rewrite-take") {
    await rewrite(client, a!);
    result = await take(client, b!, c!);
  } else if (command === "edit-take") {
    await client.query(FLIP, [a]);
    result = await take(client, b!, c!);
  } else if (command === "trim") {
    for (const sql of TRIM) await client.query(sql, [a]);
    result = await verify(client, b!, c!);
  } else if (command === "view") {
    await client.query("ALTER TABLE dsor.audit RENAME TO audit_real");
    await client.query("CREATE VIEW dsor.audit AS SELECT * FROM dsor.audit_real");
    result = await verify(client, a!, b!).catch((error: unknown) =>
      error instanceof NotAPlainLog ? { refused: error.message } : Promise.reject(error),
    );
  } else if (command === "clock") {
    await client.query(
      "CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT timestamptz '2099-01-01 00:00:00+00' $$",
    );
    await client.query("SET LOCAL search_path TO public, pg_catalog");
    result = { databaseNow: (await readLog(client)).databaseNow };
  } else if (command === "chains") {
    const chains = await client.query<{ chain: string }>(
      "SELECT DISTINCT chain FROM dsor.audit ORDER BY chain",
    );
    const heads = await client.query(
      "SELECT chain, chain_position::text AS chain_position FROM dsor.audit_heads",
    );
    result = { chains: chains.rows.map((r) => r.chain), heads: heads.rows };
  } else if (command === "first") {
    const { rows } = await client.query(
      "SELECT record_id FROM dsor.audit WHERE chain = $1 AND chain_position = 1",
      [a],
    );
    result = rows[0];
  } else {
    throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
