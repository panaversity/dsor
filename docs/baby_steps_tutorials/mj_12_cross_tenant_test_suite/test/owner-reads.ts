// The owner reads the records of one request. Not a test file: the
// database tests start it through ownerRowsFor in test/db.ts.
// A record with no company is written by dsor_runtime and never readable by it (step 11's
// README, decision 4). The owner reads it because it holds BYPASSRLS, the power
// dsor_runtime must never hold. The key stays in this child, and what it prints is
// redacted first (step 09's README, decision 18).
// Run by the tests as:  node test/owner-reads.ts <request id>
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
try {
  await client.connect();
  // Without BYPASSRLS, the owner would read no record with no company, and a test that
  // expects none would pass for the wrong reason. Found by the review.
  const power = await client.query(
    "SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user",
  );
  if (power.rows[0]?.["rolbypassrls"] !== true) {
    throw new Error("the owner does not hold BYPASSRLS, so it cannot read every record");
  }
  // And each whole record's size in bytes, for the test of a flood (step 10's README,
  // decision 12). Found by the Stage 2 review, and fixed from step 10 on.
  const { rows } = await client.query(
    `SELECT tenant, extensions, "authorization", result, octet_length(a::text) AS bytes
       FROM dsor.audit a WHERE correlation->>'request_id' = $1 ORDER BY sequence`,
    [process.argv[2]],
  );
  process.stdout.write(redact(JSON.stringify(rows), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
