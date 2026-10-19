// Step 38b: the owner, who owns dsor.alerts and holds BYPASSRLS, tries what the trigger refuses
// even to the owner, and prints what PostgreSQL said. Each try is rolled back. Not a test file:
// alerts.db.test.ts starts it through ownerAlerts in test/db.ts. The key stays in this child, and
// what it prints is redacted first (step 09's README, decision 18). The commands:
// - reopen <id>: open a closed alert again.
// - backdate <id>: move an alert's raised_at an hour back, so a sweep would escalate it early.
// - redirect <id>: give an escalated alert another person.
// - remove <id>: delete an alert.
// Run by the tests as: node test/owner-alerts.ts reopen <id> | backdate <id> | redirect <id> | remove <id>
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, id] = process.argv.slice(2);
const TRIES: Record<string, string> = {
  reopen:
    "UPDATE dsor.alerts SET state = 'open', outcome = NULL, closed_at = NULL WHERE proposal_id = $1",
  backdate:
    "UPDATE dsor.alerts SET raised_at = raised_at - interval '1 hour' WHERE proposal_id = $1",
  redirect: "UPDATE dsor.alerts SET escalated_to = 'user_123' WHERE proposal_id = $1",
  remove: "DELETE FROM dsor.alerts WHERE proposal_id = $1",
};

const client = await pool.connect();
try {
  const tried = TRIES[command ?? ""];
  if (tried === undefined) throw new Error(`unknown command ${String(command)}`);
  let result: unknown;
  await client.query("BEGIN");
  try {
    const changed = await client.query(tried, [id]);
    result = { changed: changed.rowCount };
  } catch (error) {
    result = { refused: (error as Error).message };
  }
  await client.query("ROLLBACK");
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
