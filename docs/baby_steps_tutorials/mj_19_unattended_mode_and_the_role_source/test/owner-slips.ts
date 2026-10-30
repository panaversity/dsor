// The owner writes and reads permission slips. Not a test file: the database
// tests start it through ownerSlips in test/db.ts.
// dsor_runtime may only read slips, so a test that needs a slip of its own asks the owner,
// who wrote the story's slips in migration 010. The owner holds BYPASSRLS, so no policy
// applies to it, and only DSoR's own WHERE can filter what the store returns (DSOR-TEN-01b).
// The key stays in this child, and what it prints is redacted first (step 09's README,
// decision 18).
// Run by the tests as:
//   node test/owner-slips.ts add '<slip as JSON>'     writes one slip
//   node test/owner-slips.ts remove <tenant> <id>     removes it again
//   node test/owner-slips.ts second                   tries a second slip for the agent, rolled back
//   node test/owner-slips.ts store <tenant> <agent>   asks DSoR's slip store, as the owner
import pg from "pg";
import { createDbSlips, loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, ...args] = process.argv.slice(2);

// The columns of dsor.delegations, from a slip in the specification's shape.
const INSERT = `INSERT INTO dsor.delegations
                  (tenant_id, id, delegator, delegate, modes, permissions, constraints,
                   subdelegation, parent, status, expires_at, extensions)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
function valuesOf(slip: Record<string, unknown>): unknown[] {
  return [
    slip["tenant"],
    slip["id"],
    slip["delegator"],
    slip["delegate"],
    slip["modes"],
    slip["permissions"],
    JSON.stringify(slip["constraints"]),
    JSON.stringify(slip["subdelegation"]),
    slip["parent"] ?? null,
    slip["status"],
    slip["expires_at"],
    slip["extensions"] === undefined ? null : JSON.stringify(slip["extensions"]),
  ];
}

try {
  // Without BYPASSRLS, the policies would filter too, and a test of DSoR's own WHERE would
  // prove nothing.
  const power = await pool.query("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user");
  if (power.rows[0]?.["rolbypassrls"] !== true) {
    throw new Error("the owner does not hold BYPASSRLS");
  }
  let result: unknown;
  if (command === "add") {
    const slip = JSON.parse(args[0] ?? "null") as Record<string, unknown>;
    await pool.query(INSERT, valuesOf(slip));
    result = { added: slip["id"] };
  } else if (command === "remove") {
    const { rowCount } = await pool.query(
      "DELETE FROM dsor.delegations WHERE tenant_id = $1 AND id = $2",
      [args[0], args[1]],
    );
    result = { removed: rowCount };
  } else if (command === "second") {
    // A second slip for accounts-payable-fte in org_456, torn up, so only the unique key can
    // refuse it. Rolled back whatever happens.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const second = {
        tenant: "org_456",
        id: "del_197",
        delegator: "user_123",
        delegate: "accounts-payable-fte",
        modes: ["unattended"],
        permissions: ["invoice:read"],
        constraints: {},
        subdelegation: { allowed: false },
        status: "revoked",
        expires_at: "2099-12-31T23:59:59Z",
      };
      await client.query(INSERT, valuesOf(second));
      result = { refused: false };
    } catch (error) {
      result = { refused: true, code: (error as { code?: string }).code };
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  } else if (command === "store") {
    const found = await createDbSlips(pool).find(args[0] ?? "", args[1] ?? "");
    const slip = found?.slip as { id?: string; tenant?: string } | undefined;
    result = found === undefined ? null : { id: slip?.id, tenant: slip?.tenant };
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
