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
// - plant: a claim of user_123's payment.create, with a kept answer whose proposal
//   is the JSON text given, as a bug or a change by hand would leave it. A replay must not name it.
//   Found by step 22's sweep. The kind of answer may be a waiting proposal too,
//   ready, as a propose_only claim keeps it, or ready-yes, whose ready is not true. Those are
//   planted in propose_only mode, the others in execute mode, unless a mode is named after the
//   kind, to plant an answer that does not fit its claim's mode.
// - before016: Migration 016 on a claim made before it, inside a transaction that
//   is always rolled back: the claim's table goes back to how 015 left it, with no mode, gets one
//   answered claim, and then 016 runs. Prints the claim's mode and the new column's default.
// Run by the tests as:
//   node test/owner-claims.ts age <tenant> <principal> <operation> <key> <minutes>
//   node test/owner-claims.ts store <key>
//   node test/owner-claims.ts plant <key> <payload_hash> <proposal as JSON text, or none> [kind] [mode]
//   node test/owner-claims.ts before016
import { readFileSync } from "node:fs";
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
  } else if (command === "plant") {
    const [key, hash, proposal, kind = "value", named] = args;
    const OUTCOMES: Record<string, string> = {
      value: `"value": {"tenant_id": "org_456", "id": "PAY-0"}`,
      refused: `"refused": {"code": "CONFLICT", "message": "planted", "label": "public"}`,
      ready: `"ready": true`,
      "ready-yes": `"ready": "yes"`,
    };
    const outcome = OUTCOMES[kind];
    if (outcome === undefined) throw new Error(`unknown kind of answer ${kind}`);
    const mode = named ?? (kind.startsWith("ready") ? "propose_only" : "execute");
    const answer = proposal === "none" ? `{${outcome}}` : `{${outcome}, "proposal": ${proposal}}`;
    const { rowCount } = await pool.query(
      `INSERT INTO dsor.idempotency (tenant_id, principal, operation, idempotency_key, payload_hash,
                                     mode, request_id, answer)
       VALUES ('org_456', 'user_123', 'payment.create', $1, $2, $4, 'req_planted', $3::json)`,
      [key, hash, answer, mode],
    );
    result = { planted: rowCount };
  } else if (command === "before016") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE dsor.idempotency DROP COLUMN mode");
      await client.query(
        `INSERT INTO dsor.idempotency (tenant_id, principal, operation, idempotency_key,
                                       payload_hash, request_id, answer)
         VALUES ('org_456', 'user_123', 'payment.create', 'k-before-016',
                 'sha256:' || repeat('d', 64), 'req_before_016', '{"value": {}}')`,
      );
      const migration = new URL("../migrations/016_modes.sql", import.meta.url);
      await client.query(readFileSync(migration, "utf8"));
      const { rows } = await client.query<{ mode: string }>(
        "SELECT mode FROM dsor.idempotency WHERE idempotency_key = 'k-before-016'",
      );
      const column = await client.query(
        `SELECT column_default, is_nullable FROM information_schema.columns
          WHERE table_schema = 'dsor' AND table_name = 'idempotency' AND column_name = 'mode'`,
      );
      result = { modes: rows.map((row) => row.mode), column: column.rows[0] };
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
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
    const first = await claims.run(
      scope("org_456"),
      in456,
      "execute",
      "req_owner_456",
      async () => ({
        made_in: "org_456",
      }),
    );
    const second = await claims.run(
      scope("org_789"),
      in789,
      "execute",
      "req_owner_789",
      async () => ({
        made_in: "org_789",
      }),
    );
    const again = await claims.run(
      scope("org_789"),
      in789,
      "execute",
      "req_owner_789b",
      async () => ({
        made_in: "org_789, a second time",
      }),
    );
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
