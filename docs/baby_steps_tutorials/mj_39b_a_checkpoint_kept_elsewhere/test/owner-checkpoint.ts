// NEW IN STEP 39b: the owner takes checkpoints, tampers as the careful editor would, and reads what
// the checker says against the checkpoints. Not a test file: checkpoint.db.test.ts starts it
// through ownerCheckpoint in test/db.ts. The owner's login stays in this child, and what it prints
// is redacted first (step 09's README, decision 18). Every tamper is rolled back. The commands:
// - take <dir> <private key file>: a checkpoint of the log as it is, written to <dir>.
// - verify <dir> <public key file>: the log held against every checkpoint in <dir>, read only.
// - rewrite <id> <dir> <public key file>: turn the record over, write every fingerprint from it to
//   the end of its chain again, and the chain's head; then verify (step 39b's README, P1).
// - trim <chain> <dir> <public key file>: remove the chain's newest record and set its head back;
//   then verify.
// - edit-take <id> <dir> <private key file>: turn the record over, then try to take a checkpoint.
// - chains: every chain the log holds, and each chain's head. first <chain>: its first record's id.
// Run by the tests as: node test/owner-checkpoint.ts <command> <words>
import pg from "pg";
import {
  readCheckpointFiles,
  readLog,
  readPrivateKey,
  readPublicKey,
} from "../src/checkpoint-files.ts";
import { checkAgainstCheckpoints } from "../src/checkpoint-check.ts";
import { takeCheckpoint, writeCheckpoint } from "../src/checkpoint.ts";
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
  const { rows, heads, now } = await readLog(client);
  return checkAgainstCheckpoints(
    rows,
    heads,
    readCheckpointFiles(dir),
    readPublicKey(keyFile),
    now,
  );
}

const client = await pool.connect();
try {
  let result: unknown;
  await client.query("BEGIN");
  if (command === "take" || command === "edit-take") {
    const [id, dir, keyFile] = command === "take" ? [undefined, ...words] : words;
    if (id !== undefined) await client.query(FLIP, [id]);
    const { rows, heads, now } = await readLog(client);
    const taken = takeCheckpoint(rows, heads, now);
    result =
      "checkpoint" in taken
        ? { written: writeCheckpoint(dir!, taken.checkpoint, readPrivateKey(keyFile!)) }
        : taken;
  } else if (command === "verify") {
    result = await verify(client, words[0]!, words[1]!);
  } else if (command === "rewrite") {
    const [id, dir, keyFile] = words;
    await client.query("SELECT set_config('test.id', $1, true)", [id]);
    await client.query(FLIP, [id]);
    await client.query(REWRITE);
    result = await verify(client, dir!, keyFile!);
  } else if (command === "trim") {
    const [chain, dir, keyFile] = words;
    for (const sql of TRIM) await client.query(sql, [chain]);
    result = await verify(client, dir!, keyFile!);
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
      [words[0]],
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
