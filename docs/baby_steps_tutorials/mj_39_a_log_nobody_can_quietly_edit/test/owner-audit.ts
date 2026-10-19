// Step 39: the owner, who owns dsor.audit and holds BYPASSRLS, edits the log the ways a tamperer
// would, and prints what the checker says. Not a test file: audit-chain.db.test.ts starts it
// through ownerAudit in test/db.ts. The key stays in this child, and what it prints is redacted
// first (step 09's README, decision 18). The commands:
// - verify: the checker's report on every chain, read only.
// - edit <id>: turn one record's authorization over (ALLOW and DENY), then check. Rolled back.
// - rehash <id>: the same, and that record's fingerprint written again too. Rolled back.
// - remove <id>: delete one record, then check. Rolled back.
// - flip <id>: turn one record's authorization over, and commit. Run twice, it puts it back.
// - fork <id>: give the record the predecessor of the record before it, so two records follow one.
//   Rolled back; the database's key refuses it (since break B7).
// - twin <id>: give the record the place of the record before it. Rolled back; refused too.
// Run by the tests as: node test/owner-audit.ts verify | edit <id> | rehash <id> | remove <id> | flip <id>
import pg from "pg";
import { readChains, verifyChains } from "../src/audit-chain.ts";
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
const TRIES: Record<string, string[]> = {
  edit: [FLIP],
  rehash: [FLIP, REHASH],
  remove: ["DELETE FROM dsor.audit WHERE record_id = $1"],
};

const client = await pool.connect();
try {
  let result: unknown;
  if (command === "verify") {
    result = verifyChains(await readChains(client));
  } else if (command === "fork" || command === "twin") {
    const column = command === "fork" ? "previous_hash" : "chain_position";
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE dsor.audit a SET ${column} = (SELECT b.${column} FROM dsor.audit b
            WHERE b.chain = a.chain AND b.chain_position = a.chain_position - 1)
          WHERE record_id = $1`,
        [id],
      );
      result = { changed: true };
    } catch (error) {
      result = { refused: (error as Error).message };
    } finally {
      await client.query("ROLLBACK");
    }
  } else if (command === "flip") {
    await client.query(FLIP, [id]);
    result = { flipped: id };
  } else if (command !== undefined && command in TRIES) {
    await client.query("BEGIN");
    try {
      for (const sql of TRIES[command]!) await client.query(sql, [id]);
      result = verifyChains(await readChains(client));
    } finally {
      await client.query("ROLLBACK");
    }
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
