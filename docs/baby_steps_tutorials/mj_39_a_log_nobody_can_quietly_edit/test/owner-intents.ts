// Step 36: the owner, who owns dsor.intents and holds BYPASSRLS, tries what dsor_runtime has no
// right to try, and prints what PostgreSQL said. Not a test file: intents.db.test.ts starts it
// through ownerIntents in test/db.ts. The key stays in this child, and what it prints is redacted
// first (step 09's README, decision 18). The commands:
// - rewrite <id>: change the connector of one note, which the trigger refuses. Rolled back.
// - end-again <id>: give an ended note a second outcome, which the trigger refuses. Rolled back.
// - unend <id>: take an ended note's outcome away, which the trigger refuses. Rolled back.
// - revoke: take dsor_runtime's INSERT on dsor.intents away, so the next note cannot be written.
//   It commits, and grant puts it back (step 36's README, claim C2).
// - grant: give dsor_runtime its INSERT on dsor.intents back, as migration 032 wrote it.
// - break-end / mend-end (since the review): a trigger that refuses to end a note committed, so
//   the work fails after the bank sent; then the trigger removed (the review's H1).
// - break-commit / mend-commit (since the review): a deferred trigger that fails every COMMIT
//   holding a new note, so the checkpoint's COMMIT rolls back; then removed (the review's M1).
// Run by the tests as:
//   node test/owner-intents.ts rewrite <id> | end-again <id> | unend <id> | revoke | grant |
//   break-end | mend-end | break-commit | mend-commit
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, id] = process.argv.slice(2);
const COLUMNS =
  "proposal_id, tenant_id, operation, payload_hash, principal, claim_operation, idempotency_key, connector, security_context";
const TRIES: Record<string, string> = {
  rewrite: "UPDATE dsor.intents SET connector = 'another-bank' WHERE proposal_id = $1",
  "end-again": "UPDATE dsor.intents SET outcome = 'committed' WHERE proposal_id = $1",
  unend: "UPDATE dsor.intents SET outcome = NULL WHERE proposal_id = $1",
};

// Each break and its mend, committed, so the program under test meets them. The test mends in a
// finally, so the next file meets the database as migration 032 left it.
const REFUSE = `CREATE FUNCTION dsor.test_refuses() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'the test refuses this'; END $$`;
const BREAKS: Record<string, string[]> = {
  "break-end": [
    REFUSE,
    `CREATE TRIGGER test_end BEFORE UPDATE ON dsor.intents FOR EACH ROW
       WHEN (NEW.outcome = 'committed') EXECUTE FUNCTION dsor.test_refuses()`,
  ],
  "mend-end": [
    "DROP TRIGGER IF EXISTS test_end ON dsor.intents",
    "DROP FUNCTION IF EXISTS dsor.test_refuses()",
  ],
  "break-commit": [
    REFUSE,
    `CREATE CONSTRAINT TRIGGER test_commit AFTER INSERT ON dsor.intents
       DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dsor.test_refuses()`,
  ],
  "mend-commit": [
    "DROP TRIGGER IF EXISTS test_commit ON dsor.intents",
    "DROP FUNCTION IF EXISTS dsor.test_refuses()",
  ],
};

const client = await pool.connect();
try {
  let result: unknown;
  const tried = TRIES[command ?? ""];
  if (tried !== undefined) {
    await client.query("BEGIN");
    try {
      const changed = await client.query(tried, [id]);
      result = { changed: changed.rowCount };
    } catch (error) {
      result = { refused: (error as Error).message };
    }
    await client.query("ROLLBACK");
  } else if (command === "revoke") {
    await client.query(`REVOKE INSERT (${COLUMNS}) ON dsor.intents FROM dsor_runtime`);
    result = { revoked: true };
  } else if (command === "grant") {
    await client.query(`GRANT INSERT (${COLUMNS}) ON dsor.intents TO dsor_runtime`);
    result = { granted: true };
  } else if (command !== undefined && command in BREAKS) {
    for (const sql of BREAKS[command]!) await client.query(sql);
    result = { [command]: true };
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
