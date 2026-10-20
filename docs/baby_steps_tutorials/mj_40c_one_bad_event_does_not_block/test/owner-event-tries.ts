// NEW IN STEP 40c: the owner tries to change the log of failed tries, or an alert, in ways the
// database must refuse, and prints what the database said. Not a test file: event-tries.db.test.ts
// starts it through ownerEventTries in test/db.ts. The key stays in this child, and what it prints
// is redacted first (step 09's README, decision 18). Each command runs in a transaction the program
// rolls back, so the test's database keeps what it had (step 40c's README, claims C3 to C5).
// - try-change <event_id>, try-remove <event_id>: a failed try of this event changed, or removed.
// - alert-raise <event_id>: an alert written by hand for an event with fewer than three tries.
// - alert-close <event_id>: the event's open alert closed by hand while the event is unsent.
// - alert-remove <event_id>: the event's alert removed.
// - empty: both tables truncated.
// Run by the tests as:  node test/owner-event-tries.ts <command> [event_id]
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command, eventId] = process.argv.slice(2);

// The statement each command runs: fixed here, so nothing from the command line reaches the SQL but
//   the event's id, as a parameter.
const STATEMENTS: Record<string, string[]> = {
  "try-change": [
    "UPDATE dsor.outbox_tries SET reason = 'changed by the owner' WHERE event_id = $1",
  ],
  "try-remove": ["DELETE FROM dsor.outbox_tries WHERE event_id = $1"],
  "alert-raise": [
    `INSERT INTO dsor.event_alerts (tenant_id, event_id, resource, raised_at, state)
     SELECT tenant_id, event_id, resource, now(), 'open' FROM dsor.outbox WHERE event_id = $1`,
  ],
  "alert-close": [
    "UPDATE dsor.event_alerts SET state = 'closed', closed_at = now() WHERE event_id = $1",
  ],
  "alert-remove": ["DELETE FROM dsor.event_alerts WHERE event_id = $1"],
  empty: ["TRUNCATE dsor.outbox_tries", "TRUNCATE dsor.event_alerts"],
};

try {
  const statements = STATEMENTS[command ?? ""];
  if (statements === undefined) throw new Error(`unknown command ${command}`);
  await client.connect();
  const said: string[] = [];
  for (const sql of statements) {
    await client.query("BEGIN");
    try {
      const { rowCount } = await client.query(sql, sql.includes("$1") ? [eventId] : []);
      said.push(`done, ${rowCount ?? 0} rows`);
    } catch (error) {
      said.push((error as Error).message);
    } finally {
      await client.query("ROLLBACK");
    }
  }
  process.stdout.write(JSON.stringify({ said }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
