// Step 40: the owner makes dsor.outbox refuse every new event, and then takes that away. Not a test
// file: outbox.db.test.ts starts it through ownerOutbox in test/db.ts. The key stays in this child,
// and what it prints is redacted first (step 09's README, decision 18). The commands:
// - refuse: a trigger that refuses every insert into dsor.outbox. It commits, so the program under
//   test meets it.
// - mend: the trigger and its function removed, as migration 036 left the table.
// Run by the tests as:  node test/owner-outbox.ts refuse | mend
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command] = process.argv.slice(2);
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
  if (command !== "refuse" && command !== "mend") throw new Error(`unknown command ${command}`);
  for (const sql of command === "refuse" ? [...MEND, ...REFUSE] : MEND) await client.query(sql);
  process.stdout.write(JSON.stringify({ done: command }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
