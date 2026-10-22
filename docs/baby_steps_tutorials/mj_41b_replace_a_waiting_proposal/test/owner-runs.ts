// The owner, who owns dsor.proposals and holds BYPASSRLS, tries to change what a
// run's proposals keep for good, inside a transaction that is always rolled back, and prints what
// PostgreSQL said. Not a test file: run.db.test.ts starts it through ownerRuns in test/db.ts. The
// key stays in this child, and what it prints is redacted first (step 09's README, decision 18).
// dsor_runtime holds no UPDATE on these columns, so only the owner reaches the trigger's rule
// (found by step 41's own breaks, B12). The commands:
// - unlink <line id>: the line's run set to none.
// - refingerprint <run id>: the run's fingerprint changed.
// - born-with-totals <run id>: a copy of the run added under a new id with its totals already
//   written, which dsor_runtime holds no right to insert (found by step 41's review, L4).
// Run by the tests as:  node test/owner-runs.ts unlink <id> | refingerprint <id>
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command, id] = process.argv.slice(2);

// The statement each command runs: fixed here, so nothing from the command line reaches the SQL but
//   the proposal's id, as a parameter.
const STATEMENTS: Record<string, string> = {
  unlink: "UPDATE dsor.proposals SET run = NULL WHERE id = $1",
  refingerprint: `UPDATE dsor.proposals
                     SET manifest_hash = 'sha256:' || repeat('0', 64) WHERE id = $1`,
  "born-with-totals": `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload,
                         payload_hash, resources, requester, idempotency_key, expires_at,
                         manifest_hash, totals, vendor_totals)
                       SELECT tenant_id, 'prop_' || gen_random_uuid(), operation, mode, 'PROPOSED',
                              payload, payload_hash, resources, requester, 'born-with-totals',
                              expires_at, manifest_hash, totals, vendor_totals
                         FROM dsor.proposals WHERE id = $1`,
};

try {
  const sql = STATEMENTS[command ?? ""];
  if (sql === undefined) throw new Error(`unknown command ${command}`);
  await client.connect();
  await client.query("BEGIN");
  let said: string;
  try {
    const { rowCount } = await client.query(sql, [id]);
    said = `done, ${rowCount ?? 0} rows`;
  } catch (error) {
    said = (error as Error).message;
  } finally {
    await client.query("ROLLBACK");
  }
  process.stdout.write(JSON.stringify({ said }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
