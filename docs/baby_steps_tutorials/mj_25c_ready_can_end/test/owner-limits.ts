// The owner, who holds BYPASSRLS, keeps the tests' own limited slip: del_190 for
// intake-fte in org_456, signed by user_123, with the limits of §13's example, 50,000 USD in one
// payment and 200,000 USD in one day. The story's del_100 keeps no limits in the shared database,
// because a day's spending carries from run to run (step 24's README, decision 12). Not a test
// file: the database tests start it through ownerLimits in test/db.ts. The key stays in this
// child, and what it prints is redacted first (step 09's README, decision 18). The commands:
// - add: the slip, with no total and no reservation left from an earlier run.
// - reset: del_190's totals and reservations gone, so a test starts with the whole day's room.
// - yesterday: del_190's totals and reservations moved back one day, as a clock a day later
//   would see them.
// - remove: the slip, its totals, and its reservations.
// - daily-only <value>: del_190's limits become one limit for one day, of this many USD, and no
//   limit for one payment. Found by step 24's sweep: the day's first amount was never compared
//   with the limit, because the limit for one payment always came first.
// Since step 25:
// - past: del_190's date moves to yesterday, by the database's clock.
// - suspend: del_190 is suspended, as step 19b's directory would leave it.
// Run by the tests as:
//   node test/owner-limits.ts add | reset | yesterday | remove | daily-only <value> | past | suspend
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, value] = process.argv.slice(2);

const LIMITS = JSON.stringify({
  per_transaction_limit: { value: "50000", currency: "USD" },
  cumulative_limits: [{ window: "P1D", amount: { value: "200000", currency: "USD" } }],
});
const OF_THE_SLIP = "tenant_id = 'org_456' AND delegation = 'del_190'";

/** Removes del_190's totals and reservations. */
async function reset(): Promise<number> {
  const reservations = await pool.query(`DELETE FROM dsor.reservations WHERE ${OF_THE_SLIP}`);
  const totals = await pool.query(`DELETE FROM dsor.limit_counters WHERE ${OF_THE_SLIP}`);
  return (reservations.rowCount ?? 0) + (totals.rowCount ?? 0);
}

try {
  let result: unknown;
  if (command === "add" || command === "remove") {
    await reset();
    await pool.query("DELETE FROM dsor.delegations WHERE tenant_id = 'org_456' AND id = 'del_190'");
    if (command === "add") {
      const { rowCount } = await pool.query(
        `INSERT INTO dsor.delegations
           (tenant_id, id, delegator, delegate, modes, permissions, constraints, subdelegation,
            status, expires_at)
         VALUES ('org_456', 'del_190', 'user_123', 'intake-fte', '{unattended}',
                 '{invoice:read,payment:create}', $1::jsonb, '{"allowed": false}', 'active',
                 '2099-12-31T23:59:59Z')`,
        [LIMITS],
      );
      result = { added: rowCount };
    } else {
      result = { removed: true };
    }
  } else if (command === "daily-only") {
    const only = JSON.stringify({
      cumulative_limits: [{ window: "P1D", amount: { value: value ?? "", currency: "USD" } }],
    });
    const { rowCount } = await pool.query(
      "UPDATE dsor.delegations SET constraints = $1::jsonb WHERE tenant_id = 'org_456' AND id = 'del_190'",
      [only],
    );
    result = { changed: rowCount };
  } else if (command === "past" || command === "suspend") {
    const change =
      command === "past" ? "expires_at = now() - interval '1 day'" : "status = 'suspended'";
    const { rowCount } = await pool.query(
      `UPDATE dsor.delegations SET ${change} WHERE tenant_id = 'org_456' AND id = 'del_190'`,
    );
    result = { changed: rowCount };
  } else if (command === "reset") {
    result = { removed: await reset() };
  } else if (command === "yesterday") {
    // Only today's rows are left after reset, so moving them back meets no row of yesterday's.
    const today = "(now() AT TIME ZONE 'UTC')::date";
    await pool.query(`DELETE FROM dsor.limit_counters WHERE ${OF_THE_SLIP} AND day < ${today}`);
    const totals = await pool.query(
      `UPDATE dsor.limit_counters SET day = day - 1 WHERE ${OF_THE_SLIP}`,
    );
    await pool.query(`UPDATE dsor.reservations SET day = day - 1 WHERE ${OF_THE_SLIP}`);
    result = { moved: totals.rowCount };
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
