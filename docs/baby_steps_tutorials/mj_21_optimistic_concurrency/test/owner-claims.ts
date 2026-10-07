// The owner's window on the claims. Not a test file: the database tests start it
// through ownerClaims in test/db.ts. The key stays in this child, and what it prints is redacted
// first (step 09's README, decision 18). Two commands:
// - age: dsor_runtime cannot change claimed_at, which the database fills, so a test of
//   DSOR-IDM-02 asks the owner to move a claim back in time, as a clock that many minutes
//   later would see it.
// - store: DSoR's claim store, run as the owner, whom no policy stops, so the company in its own
//   statements is the only lock: DSoR's lock alone (DSOR-TEN-01b), as owner-slips.ts does for
//   slips. Found by the review: with row-level security on, a store that left the company out
//   of its statements passed every test.
// Run by the tests as:
//   node test/owner-claims.ts age <tenant> <principal> <operation> <key> <minutes>
//   node test/owner-claims.ts store <key>
import pg from "pg";
import { createDbClaims, loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, ...args] = process.argv.slice(2);

try {
  let result: unknown;
  if (command === "age") {
    const [tenant, principal, operation, key, minutes] = args;
    const { rowCount } = await pool.query(
      `UPDATE dsor.idempotency SET claimed_at = claimed_at - make_interval(mins => $5::int)
        WHERE tenant_id = $1 AND principal = $2 AND operation = $3 AND idempotency_key = $4`,
      [tenant, principal, operation, key, minutes],
    );
    result = { aged: rowCount };
  } else if (command === "store") {
    // firm-ap-fte works in both companies, so one key text is claimed in each. Then org_789's
    // claim is sent again. Only the company in DSoR's own statements keeps the two apart.
    const [key] = args;
    const claims = createDbClaims(pool);
    const scope = (tenant: string) => ({
      tenant,
      principal: "firm-ap-fte",
      operation: "payment.create",
      key: key!,
    });
    const in456 = `sha256:${"a".repeat(64)}`;
    const in789 = `sha256:${"b".repeat(64)}`;
    const first = await claims.run(scope("org_456"), in456, "req_owner_456", async () => ({
      made_in: "org_456",
    }));
    const second = await claims.run(scope("org_789"), in789, "req_owner_789", async () => ({
      made_in: "org_789",
    }));
    const again = await claims.run(scope("org_789"), in789, "req_owner_789b", async () => ({
      made_in: "org_789, a second time",
    }));
    result = { first, second, again };
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
