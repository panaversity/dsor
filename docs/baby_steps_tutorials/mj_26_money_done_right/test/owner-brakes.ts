// The owner removes the tests' brakes, and asks DSoR's brakes store with no
// policy behind it. Not a test file: the database tests start it through ownerBrakes in
// test/db.ts.
// dsor_runtime may only lift a brake, and a lift stays in the history. So before each test the
// owner removes every brake: in the step's database, only the tests pull brakes, and the
// program brakes in memory (step 25b's README, decision D12). The records stay, as every record
// does. The owner holds BYPASSRLS, so no policy applies to it, and only DSoR's own WHERE can
// filter what the store returns (DSOR-TEN-01b).
// Run by the tests as:
//   node test/owner-brakes.ts clear                  removes every brake
//   node test/owner-brakes.ts filters <request id>   runs the brakes' statements for org_456,
//                                                    as the owner, beside a brake on intake-fte
//                                                    in org_789 and a freeze of org_789
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createDbBrakes, loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, ...args] = process.argv.slice(2);

try {
  // Without BYPASSRLS, the policies would filter too, and a test of DSoR's own WHERE would
  // prove nothing.
  const power = await pool.query("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user");
  if (power.rows[0]?.["rolbypassrls"] !== true) {
    throw new Error("the owner does not hold BYPASSRLS");
  }
  let result: unknown;
  if (command === "clear") {
    const { rowCount } = await pool.query("DELETE FROM dsor.brakes");
    result = { removed: rowCount };
  } else if (command === "filters") {
    // Two brakes of org_789: one on an agent named as org_456's is, and a freeze. DSoR's own
    // look, line ④'s question, and its lift, all for org_456, must see neither. And an old brake
    // of org_456, lifted long ago, which DSoR's lift must leave as it is: only DSoR's own WHERE
    // stops a second lift here. Found by step 25b's sweep.
    const [request_id = ""] = args;
    const twins = [`brk_${randomUUID()}`, `brk_${randomUUID()}`, `brk_${randomUUID()}`];
    try {
      await pool.query(
        `INSERT INTO dsor.brakes (tenant_id, id, agent, pulled_by, reason)
         VALUES ('org_789', $1, 'intake-fte', 'user_700', 'a twin of org_789'),
                ('org_789', $2, NULL, 'user_700', 'a freeze of org_789')`,
        twins.slice(0, 2),
      );
      await pool.query(
        `INSERT INTO dsor.brakes (tenant_id, id, agent, pulled_by, pulled_at, reason, lifted_by,
                                  lifted_at, lift_reason)
         VALUES ('org_456', $1, 'intake-fte', 'user_123', now() - interval '2 days',
                 'an old brake', 'user_123', now() - interval '1 day', 'lifted long ago')`,
        [twins[2]],
      );
      const brakes = createDbBrakes(pool);
      const by = {
        person: "user_123",
        as_of: new Date().toISOString(),
        words: "the owner's test of DSoR's own WHERE",
        correlation: { request_id },
      };
      const on = await brakes.on("org_456", "intake-fte");
      const found = await brakes.get("org_456", "intake-fte");
      const lifted = await brakes.lift("org_456", "intake-fte", by);
      const { rows } = await pool.query<{ id: string; on: boolean; lift_reason: string | null }>(
        "SELECT id, lifted_at IS NULL AS on, lift_reason FROM dsor.brakes WHERE id = ANY($1)",
        [twins],
      );
      const state = (id: string | undefined): string => {
        const row = rows.find((r) => r.id === id);
        return row === undefined ? "gone" : row.on ? "on" : `lifted: ${String(row.lift_reason)}`;
      };
      result = {
        on,
        found: found === undefined ? null : found.tenant,
        lifted: lifted !== undefined,
        twins: [state(twins[0]), state(twins[1])],
        old: state(twins[2]),
      };
    } finally {
      await pool.query("DELETE FROM dsor.brakes WHERE id = ANY($1)", [twins]);
    }
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
