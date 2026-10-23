// Step 36b: the owner makes dsor.audit refuse the next record of one operation, once, and then
// takes that away. Not a test file: sealed.db.test.ts starts it through ownerRecords in
// test/db.ts. The key stays in this child, and what it prints is redacted first (step 09's
// README, decision 18). The commands:
// - refuse <operation@version>: a trigger that refuses the first decision record of that
//   operation, and lets every later one in. Only kind 'decision': a proposal's moves leave rows
//   of kind 'proposal_transition' in dsor.audit too, inside the claim, and refusing one of those
//   proves nothing about the record. Found while building: the first version refused them, and
//   the tests passed on step 36's code for that wrong reason. It commits, so the program under
//   test meets it.
// - refuse-at-commit <operation@version> (since the review): the same, as a deferred trigger, so the
//   record is written, and the COMMIT that would keep it fails (step 36b's review, F2).
// - mend: the trigger, its function, and its counter removed, as migration 032 left the table.
// Run by the tests as:
//   node test/owner-records.ts refuse <operation@version> | refuse-at-commit <operation@version> |
//   mend
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command, operation] = process.argv.slice(2);
const MEND = [
  "DROP TRIGGER IF EXISTS test_refuse_record ON dsor.audit",
  "DROP TRIGGER IF EXISTS test_refuse_commit ON dsor.audit",
  "DROP FUNCTION IF EXISTS dsor.test_refuse_record()",
  "DROP SEQUENCE IF EXISTS dsor.test_refused_records",
];
try {
  await client.connect();
  if (command === "refuse" || command === "refuse-at-commit") {
    // The name goes into SQL text, so only an operation's own form is taken.
    if (!/^[a-z_]+\.[a-z_]+@[0-9]+$/.test(operation ?? "")) {
      throw new Error("refuse needs an operation such as payment.create@1");
    }
    for (const sql of MEND) await client.query(sql);
    await client.query("CREATE SEQUENCE dsor.test_refused_records");
    // The trigger runs as dsor_runtime, which needs the counter too.
    await client.query("GRANT USAGE ON SEQUENCE dsor.test_refused_records TO dsor_runtime");
    await client.query(`CREATE FUNCTION dsor.test_refuse_record() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('dsor.test_refused_records') = 1 THEN
          RAISE EXCEPTION 'the test refuses this record';
        END IF;
        RETURN NEW;
      END $$`);
    await client.query(
      command === "refuse"
        ? `CREATE TRIGGER test_refuse_record BEFORE INSERT ON dsor.audit
             FOR EACH ROW WHEN (NEW.kind = 'decision' AND NEW.operation = '${operation}')
             EXECUTE FUNCTION dsor.test_refuse_record()`
        : `CREATE CONSTRAINT TRIGGER test_refuse_commit AFTER INSERT ON dsor.audit
             DEFERRABLE INITIALLY DEFERRED
             FOR EACH ROW WHEN (NEW.kind = 'decision' AND NEW.operation = '${operation}')
             EXECUTE FUNCTION dsor.test_refuse_record()`,
    );
    process.stdout.write(JSON.stringify({ refusing: operation, at: command }));
  } else if (command === "mend") {
    for (const sql of MEND) await client.query(sql);
    process.stdout.write(JSON.stringify({ mended: true }));
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
