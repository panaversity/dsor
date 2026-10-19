// The owner resets the tests' rules, and asks DSoR's store of rules with no policy behind it. Not
// a test file: the database tests start it through ownerRules in test/db.ts.
// dsor_runtime never deletes a version, and a retired version stays in the store. So before and
// after its tests, the owner removes every version but migration 023's, and puts that one back to
// active: in the step's database, only the tests change rules, and the program's story changes
// them in memory (step 28's README, decision D18). The records stay, as every record does. The
// owner holds BYPASSRLS, so no policy applies to it, and only DSoR's own WHERE can filter what the
// store returns (DSOR-TEN-01b).
// Run by the tests as:
//   node test/owner-rules.ts clear                  every version but the migration's, which
//                                                   goes back to active
//   node test/owner-rules.ts filters <request id>   runs the store's statements for org_456, as
//                                                   the owner, beside a twin of org_456's rule in
//                                                   org_789
//   node test/owner-rules.ts back                   tries to bring a retired version back, as
//                                                   the owner, and says what the database said
//   node test/owner-rules.ts plant                  adds an active rule that never passed a
//                                                   switch-on, as a hand edit of the database
//                                                   would
//   node test/owner-rules.ts retime                 tries to move the time of a stale version's
//                                                   first mark, as the owner, and says what the
//                                                   database said (step 28b)
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createDbControls, loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, ...args] = process.argv.slice(2);

// Migration 023's version: the story's rule.
const SEED = "tenant_id = 'org_456' AND id = 'high-value-payment' AND version = 8";

try {
  // Without BYPASSRLS, the policies would filter too, and a test of DSoR's own WHERE would
  // prove nothing.
  const power = await pool.query("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user");
  if (power.rows[0]?.["rolbypassrls"] !== true) {
    throw new Error("the owner does not hold BYPASSRLS");
  }
  let result: unknown;
  if (command === "clear") {
    const { rowCount } = await pool.query(`DELETE FROM dsor.controls WHERE NOT (${SEED})`);
    // The trigger keeps a retired version retired, for the owner too, so version 8 comes back as a
    // row of its own, active again, with its text and its history.
    await pool.query(
      `WITH gone AS (DELETE FROM dsor.controls WHERE ${SEED} AND status <> 'active' RETURNING *)
       INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by, drafted_at,
                                  reviewed_by, effective_from)
       SELECT tenant_id, id, version, 'active', rule, compiled_by, drafted_at, reviewed_by,
              effective_from
         FROM gone`,
    );
    result = { removed: rowCount };
  } else if (command === "filters") {
    // A twin of org_456's rule in org_789: the same id, the same version 8, active, and a
    // version 9 draft. DSoR's reads and its moves, all for org_456, must see neither.
    const [request_id = ""] = args;
    try {
      await pool.query(
        `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by,
                                    drafted_at, reviewed_by, effective_from)
         SELECT 'org_789', id, version, status, rule, compiled_by, drafted_at, reviewed_by,
                effective_from
           FROM dsor.controls WHERE ${SEED}`,
      );
      await pool.query(
        `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by)
         SELECT 'org_789', id, 9, 'draft', rule, 'user_700' FROM dsor.controls WHERE ${SEED}`,
      );
      const rules = createDbControls(pool);
      const by = {
        person: "cfo_100",
        as_of: new Date().toISOString(),
        words: "the owner's test of DSoR's own WHERE",
        correlation: { request_id, principal_id: "cfo_100" },
      };
      const inForce = await rules.inForce("org_456", "payment.create");
      const versions = await rules.versions("org_456");
      const held = await rules.hold("org_456", "high-value-payment");
      // org_456 has no version 9: a move of it must find nothing, and leave org_789's alone.
      const moved = await rules.move("org_456", "high-value-payment", 9, "draft", "retired", by);
      const twin = await pool.query(
        `SELECT version, status FROM dsor.controls
          WHERE tenant_id = 'org_789' AND id = 'high-value-payment' ORDER BY version`,
      );
      const tenantsOf = (list: { id: string }[], label: string) =>
        list.map((c) => `${label} ${c.id}`);
      result = {
        inForce: inForce.map((c) => c.version),
        versions: versions.map((c) => c.version),
        held: held.map((c) => c.version),
        moved,
        twin: twin.rows,
        names: [...tenantsOf(inForce, "in force"), ...tenantsOf(versions, "version")],
      };
    } finally {
      await pool.query("DELETE FROM dsor.controls WHERE tenant_id = 'org_789'");
    }
  } else if (command === "back") {
    // The trigger runs for every role, the owner's too: a retired version never comes back.
    const id = `test-${randomUUID()}`;
    await pool.query(
      `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by, drafted_at,
                                  reviewed_by, effective_from)
       SELECT tenant_id, $1, 1, 'retired', rule, compiled_by, drafted_at, reviewed_by,
              effective_from
         FROM dsor.controls WHERE ${SEED}`,
      [id],
    );
    let refused = "";
    try {
      await pool.query(
        "UPDATE dsor.controls SET status = 'active' WHERE tenant_id = 'org_456' AND id = $1",
        [id],
      );
    } catch (error) {
      refused = (error as Error).message;
    } finally {
      await pool.query("DELETE FROM dsor.controls WHERE tenant_id = 'org_456' AND id = $1", [id]);
    }
    result = { refused };
  } else if (command === "retime") {
    // The trigger keeps the time of a version's first mark, for the owner too, who holds every
    // privilege: an earlier time would end the grace at once, and a later one lengthen it (step
    // 28b's README, decision D9).
    const id = `test-${randomUUID()}`;
    await pool.query(
      `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by, drafted_at,
                                  reviewed_by, effective_from, stale_since, in_force)
       SELECT tenant_id, $1, 1, 'stale_authority', rule, compiled_by, drafted_at, reviewed_by,
              effective_from, clock_timestamp(), '{"version": 5, "content_hash": "sha256:aa"}'
         FROM dsor.controls WHERE ${SEED}`,
      [id],
    );
    let refused = "";
    try {
      await pool.query(
        `UPDATE dsor.controls SET stale_since = '2020-01-01T00:00:00Z',
                in_force = '{"version": 6, "content_hash": "sha256:bb"}'
          WHERE tenant_id = 'org_456' AND id = $1`,
        [id],
      );
    } catch (error) {
      refused = (error as Error).message;
    } finally {
      await pool.query("DELETE FROM dsor.controls WHERE tenant_id = 'org_456' AND id = $1", [id]);
    }
    result = { refused };
  } else if (command === "plant") {
    // A hand edit of the database, behind DSoR's back: an active rule that never passed a
    // switch-on. Version 8's text with the condition true, so its own test 1, 25,000.00 USD
    // expected ALLOW, fails.
    const { rowCount } = await pool.query(
      `INSERT INTO dsor.controls (tenant_id, id, version, status, rule, compiled_by, drafted_at,
                                  reviewed_by, effective_from)
       SELECT tenant_id, 'planted-rule', 1, 'active',
              rule - 'condition' || '{"condition": "true"}'::jsonb, 'owner',
              drafted_at, reviewed_by, effective_from
         FROM dsor.controls WHERE ${SEED}`,
    );
    result = { planted: rowCount };
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
