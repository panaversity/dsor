// Step 40: the owner makes dsor.outbox refuse every new event, and then takes that away. Not a test
// file: outbox.db.test.ts starts it through ownerOutbox in test/db.ts. The key stays in this child,
// and what it prints is redacted first (step 09's README, decision 18). The commands:
// - refuse: a trigger that refuses every insert into dsor.outbox. It commits, so the program under
//   test meets it.
// - mend: the trigger and its function removed, as migration 036 left the table.
// - change <event_id> <column>: the owner, who holds every privilege, tries to change one column of
//   an event, event or written_at, in a transaction it rolls back, and prints what the database said.
//   Only the guard trigger can stop the owner (step 40's review, L4).
// Run by the tests as:  node test/owner-outbox.ts refuse | mend | change <event_id> <column>
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command, eventId, column] = process.argv.slice(2);
// The change each column gets: fixed here, so nothing from the command line reaches the SQL.
const CHANGES: Record<string, string> = {
  event: `event = event || '{"note": "changed by the owner"}'::jsonb`,
  written_at: "written_at = written_at - interval '1 day'",
};
const MEND = [
  "DROP TRIGGER IF EXISTS test_refuse_event ON dsor.outbox",
  "DROP FUNCTION IF EXISTS dsor.test_refuse_event()",
];
const REFUSE = [
  `CREATE FUNCTION dsor.test_refuse_event() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     RAISE EXCEPTION 'the test refuses this event';
   END $$`,
  `CREATE TRIGGER test_refuse_event BEFORE INSERT ON dsor.outbox
     FOR EACH ROW EXECUTE FUNCTION dsor.test_refuse_event()`,
];
try {
  await client.connect();
  if (command === "change") {
    const change = CHANGES[column ?? ""];
    if (change === undefined) throw new Error(`no change for the column ${column}`);
    await client.query("BEGIN");
    let said = "changed";
    try {
      const { rowCount } = await client.query(
        `UPDATE dsor.outbox SET ${change} WHERE event_id = $1`,
        [eventId],
      );
      if (rowCount !== 1) said = `changed ${rowCount ?? 0} rows`;
    } catch (error) {
      said = (error as Error).message;
    } finally {
      await client.query("ROLLBACK");
    }
    process.stdout.write(JSON.stringify({ said }));
  } else {
    if (command !== "refuse" && command !== "mend") throw new Error(`unknown command ${command}`);
    for (const sql of command === "refuse" ? [...MEND, ...REFUSE] : MEND) await client.query(sql);
    process.stdout.write(JSON.stringify({ done: command }));
  }
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
