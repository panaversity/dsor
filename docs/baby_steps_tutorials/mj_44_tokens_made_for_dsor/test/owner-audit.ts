// Step 39: the owner, who owns dsor.audit and holds BYPASSRLS, edits the log the ways a tamperer
// would, and prints what the checker says. Not a test file: audit-chain.db.test.ts starts it
// through ownerAudit in test/db.ts. The key stays in this child, and what it prints is redacted
// first (step 09's README, decision 18). Every command but verify and flip is rolled back. The
// commands:
// - verify: the checker's report on every chain, with the heads, read only.
// - edit <id>: turn one record's authorization over (ALLOW and DENY), then check.
// - rehash <id>: the same, and that record's fingerprint written again too.
// - relink <id>: the same, and the next record pointed at the new fingerprint (since the review, M2).
// - remove <id>: delete one record, then check.
// - each <id>: change each column the recipe covers in turn, and check after each (review, M3).
// - fork <id>, twin <id>: give the record the predecessor, or the place, of the record before it;
//   the database's keys refuse both (since break B7).
// - rehome <id>: move the record to org_789; the database's check refuses it (review, L8).
// - nochain: keep a record with the trigger off, then check (review, M4).
// - rechain: empty every chain, run the migration's chaining block again, and report whether each
//   chain's places follow the order the records were written (review, M7).
// - unchainable: the trigger's owner without BYPASSRLS; a record of dsor_runtime's, then commit's
//   chaining run at once: refused, not kept unchained (review, H1).
// - flip <id>: turn one record's authorization over, and commit. Run twice, it puts it back.
// Run by the tests as: node test/owner-audit.ts <command> [<id>]
import { readFileSync } from "node:fs";
import pg from "pg";
import { FIELD_NAMES, readChains, readHeads, verifyChains } from "../src/audit-chain.ts";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, id] = process.argv.slice(2);
const FLIP = `UPDATE dsor.audit SET "authorization" = CASE "authorization" WHEN 'ALLOW' THEN 'DENY' ELSE 'ALLOW' END WHERE record_id = $1`;
// The tamperer who knows the recipe writes that one record's fingerprint again, with the
//   database's own function, so the record matches itself and only the next one shows the break.
const REHASH =
  "UPDATE dsor.audit a SET record_hash = dsor.audit_fingerprint(a) WHERE record_id = $1";
// And points the next record at it, without writing that one's own fingerprint again.
const RELINK = `UPDATE dsor.audit n SET previous_hash = a.record_hash FROM dsor.audit a
  WHERE a.record_id = $1 AND n.chain = a.chain AND n.chain_position = a.chain_position + 1`;
const TRIES: Record<string, string[]> = {
  edit: [FLIP],
  rehash: [FLIP, REHASH],
  relink: [FLIP, REHASH, RELINK],
  remove: ["DELETE FROM dsor.audit WHERE record_id = $1"],
};
// One change for each column the recipe covers, that the table's own checks let through. The
//   company is moved by rehome instead, which the chain's check refuses.
const CHANGES: Record<string, string> = {
  sequence: "sequence = DEFAULT",
  record_id: "record_id = record_id || 'x'",
  at: "at = at + interval '1 microsecond'",
  kind: "kind = CASE kind WHEN 'decision' THEN 'proposal_transition' ELSE 'decision' END",
  operation: "operation = coalesce(operation, '') || 'x'",
  authorization: `"authorization" = CASE "authorization" WHEN 'ALLOW' THEN 'DENY' ELSE 'ALLOW' END`,
  result: "result = result || 'x'",
  reason: "reason = coalesce(reason, '') || 'x'",
  correlation: `correlation = correlation || '{"x": 1}'`,
  extensions: `extensions = coalesce(extensions, '{}') || '{"x": 1}'`,
  resources: "resources = array_append(coalesce(resources, '{}'), 'x')",
  row_count: "row_count = coalesce(row_count, 0) + 1",
  connector: "connector = coalesce(connector, '') || 'x'",
  identity: `identity = coalesce(identity, '{}') || '{"x": 1}'`,
  delegation: "delegation = coalesce(delegation, '') || 'x'",
  controls: `controls = coalesce(controls, '[]') || '["x"]'`,
  // A bundle the owner adds first, inside the same rolled-back transaction, so a record with none
  //   can be pointed at one.
  decision_bundle: `decision_bundle = CASE WHEN decision_bundle IS NULL
    THEN 'dec_00000000-0000-4000-8000-000000000039' ELSE NULL END`,
};

/** The checker's report, with the heads. */
async function report(client: pg.PoolClient): Promise<unknown> {
  return verifyChains(await readChains(client), await readHeads(client));
}

/** What the block does inside a transaction that is always rolled back; a refusal is a result. */
async function rolledBack(client: pg.PoolClient, block: () => Promise<unknown>): Promise<unknown> {
  await client.query("BEGIN");
  try {
    return await block();
  } catch (error) {
    return { refused: (error as Error).message };
  } finally {
    await client.query("ROLLBACK");
  }
}

const client = await pool.connect();
try {
  let result: unknown;
  if (command === "verify") {
    result = await report(client);
  } else if (command === "flip") {
    await client.query(FLIP, [id]);
    result = { flipped: id };
  } else if (command !== undefined && command in TRIES) {
    result = await rolledBack(client, async () => {
      for (const sql of TRIES[command]!) await client.query(sql, [id]);
      return report(client);
    });
  } else if (command === "each") {
    const found: Record<string, unknown> = {};
    for (const column of FIELD_NAMES.filter((name) => name !== "tenant")) {
      found[column] = await rolledBack(client, async () => {
        if (column === "decision_bundle") {
          await client.query(
            `INSERT INTO dsor.decision_bundles (decision_id, tenant_id, bundle)
             VALUES ('dec_00000000-0000-4000-8000-000000000039', 'org_456', '{"decision_id": "dec_00000000-0000-4000-8000-000000000039", "tenant": "org_456"}')`,
          );
        }
        const { rowCount } = await client.query(
          `UPDATE dsor.audit SET ${CHANGES[column]} WHERE record_id = $1`,
          [id],
        );
        if (rowCount !== 1) throw new Error(`${column}: no record changed`);
        return report(client);
      });
    }
    result = found;
  } else if (command === "fork" || command === "twin" || command === "rehome") {
    const set = {
      fork: `previous_hash = (SELECT b.previous_hash FROM dsor.audit b
        WHERE b.chain = a.chain AND b.chain_position = a.chain_position - 1)`,
      twin: `chain_position = a.chain_position - 1`,
      rehome: `tenant = 'org_789'`,
    }[command];
    result = await rolledBack(client, async () => {
      await client.query(`UPDATE dsor.audit a SET ${set} WHERE record_id = $1`, [id]);
      return { changed: true };
    });
  } else if (command === "nochain") {
    result = await rolledBack(client, async () => {
      await client.query("ALTER TABLE dsor.audit DISABLE TRIGGER audit_chain");
      await client.query(
        `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
         VALUES ('aud_nochain', 'decision', 'ALLOW', 'COMMITTED', '{}', 'org_456')`,
      );
      await client.query("ALTER TABLE dsor.audit ENABLE TRIGGER audit_chain");
      return report(client);
    });
  } else if (command === "rechain") {
    const migration = readFileSync(
      new URL("../migrations/035_audit_chain.sql", import.meta.url),
      "utf8",
    );
    const block = migration.split("-- The chaining begins.")[1]!.split("-- The chaining ends.")[0]!;
    result = await rolledBack(client, async () => {
      await client.query("ALTER TABLE dsor.audit DROP CONSTRAINT audit_extensions_size");
      await client.query(
        "UPDATE dsor.audit SET chain = NULL, chain_position = NULL, previous_hash = NULL, record_hash = NULL",
      );
      await client.query("DELETE FROM dsor.audit_heads");
      // The block's first line is the rest of the marker's comment.
      await client.query(block.slice(block.indexOf("\n") + 1));
      const { rows } = await client.query<{ out_of_order: string }>(
        `SELECT count(*)::text AS out_of_order FROM (
           SELECT chain_position, row_number() OVER (PARTITION BY chain ORDER BY sequence) AS n
             FROM dsor.audit) t WHERE chain_position <> n`,
      );
      return { out_of_order: Number(rows[0]!.out_of_order), chains: await report(client) };
    });
  } else if (command === "unchainable") {
    result = await rolledBack(client, async () => {
      await client.query("CREATE ROLE audit_chainer_test NOLOGIN NOBYPASSRLS");
      await client.query("GRANT USAGE ON SCHEMA dsor TO audit_chainer_test");
      await client.query(
        "GRANT SELECT, UPDATE ON dsor.audit, dsor.audit_heads TO audit_chainer_test",
      );
      await client.query("GRANT INSERT ON dsor.audit_heads TO audit_chainer_test");
      await client.query("ALTER FUNCTION dsor.audit_chains() OWNER TO audit_chainer_test");
      await client.query("SET LOCAL ROLE dsor_runtime");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query(
        `INSERT INTO dsor.audit (record_id, kind, "authorization", result, correlation, tenant)
         VALUES ('aud_unchainable', 'decision', 'ALLOW', 'COMMITTED', '{}', 'org_456')`,
      );
      // The commit's chaining, run now, inside this transaction, so it can be rolled back.
      await client.query("SET CONSTRAINTS dsor.audit_chain IMMEDIATE");
      return { kept: true };
    });
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
