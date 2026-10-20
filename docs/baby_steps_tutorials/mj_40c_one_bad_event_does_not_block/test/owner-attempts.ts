// The owner, who starts each database test file with no attempt open on any invoice (step 32's
// README, decision D15). Not a test file: test/db-setup.ts starts it before each database test file.
// Since step 32, only one proposal may be in flight for one operation over one invoice, and one in
// flight leaves nothing of the invoice to pay. Runs before this step left proposals in flight in the
// tests' database, so each file would find INV-1008 already spoken for. The owner ends each
// proposal in flight along a move the picture of §26.2 draws: CANCELLED, or FAILED for one that
// was running. It deletes nothing. The key stays in this child, and what it
// prints is redacted first (step 09's README, decision 18).
// Run as:
//   node test/owner-attempts.ts clear
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command] = process.argv.slice(2);

try {
  if (command !== "clear") throw new Error(`unknown command ${String(command)}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The owner holds BYPASSRLS, so no policy filters these statements. The proposals' trigger
    // still checks each move.
    const proposals = await client.query(
      `UPDATE dsor.proposals
          SET state = CASE WHEN state IN ('EXECUTING', 'OUTCOME_UNKNOWN') THEN 'FAILED'
                           ELSE 'CANCELLED' END
        WHERE state IN ('READY', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'OUTCOME_UNKNOWN')`,
    );
    await client.query("COMMIT");
    const result = { proposals: proposals.rowCount };
    process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
