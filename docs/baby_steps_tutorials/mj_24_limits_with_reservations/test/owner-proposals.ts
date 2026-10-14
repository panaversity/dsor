// The owner, who owns dsor.proposals and holds BYPASSRLS, tries what dsor_runtime
// has no right to try, inside a transaction that is always rolled back, and prints what
// PostgreSQL said. Not a test file: the database tests start it through ownerProposals in
// test/db.ts. The key stays in this child, and what it prints is redacted first (step 09's README,
// decision 18). The commands:
// - rewrite <column>: change one column of a new proposal, which the trigger refuses (step 22's
//   README, decision 3). The columns: payload, requester, created_at.
// - skip: move a new proposal from PROPOSED straight to COMMITTED, which the trigger refuses too.
// - unreachable: the trigger switched off for one moment, so a proposal can sit in each of the
//   three states nothing reaches yet, COMPENSATING, COMPENSATED, and COMPENSATION_FAILED; then,
//   with the trigger on again, every move out of each, as "from to code" lines. Found by the
//   review: those states were in the table and never tried on the database.
// - guard: migration 015's guard of an upgrade, on a database with no answered claim, then with
//   one (step 22's README, decision 15). Found by the review.
// Run by the tests as:
//   node test/owner-proposals.ts rewrite <column> | skip | unreachable | guard
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { STATES } from "../src/proposals.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, column] = process.argv.slice(2);

// A new proposal, as the owner writes it by hand, in the state it names.
const ADD = `INSERT INTO dsor.proposals (tenant_id, id, operation, mode, state, payload, payload_hash,
                                      resources, requester, idempotency_key)
             VALUES ('org_456', $1, 'payment.create@1', 'execute', $2,
                     '{"invoice": "dsor://org_456/invoice/INV-1008", "expected_version": 1}',
                     'sha256:' || repeat('a', 64), ARRAY['dsor://org_456/invoice/INV-1008'], '{}',
                     'k-owner')`;
const CHANGES: Record<string, string> = {
  payload: `UPDATE dsor.proposals SET payload = '{"invoice": "dsor://org_456/invoice/INV-1009"}' WHERE id = $1`,
  requester: `UPDATE dsor.proposals SET requester = '{"subject": "cfo_100"}' WHERE id = $1`,
  created_at: "UPDATE dsor.proposals SET created_at = created_at - interval '1 day' WHERE id = $1",
};

const client = await pool.connect();
/** What PostgreSQL said to one statement: "none", or its code and message. Undone either way. */
async function tried(sql: string, values: unknown[]): Promise<{ code: string; message?: string }> {
  await client.query("SAVEPOINT try");
  try {
    await client.query(sql, values);
    return { code: "none" };
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code: String(code), message };
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT try");
  }
}

let result: unknown;
try {
  await client.query("BEGIN");
  if (command === "rewrite" || command === "skip") {
    const id = `prop_${randomUUID()}`;
    await client.query(ADD, [id, "PROPOSED"]);
    const change =
      command === "skip"
        ? "UPDATE dsor.proposals SET state = 'COMMITTED' WHERE id = $1"
        : CHANGES[column ?? ""];
    if (change === undefined) throw new Error(`unknown column ${String(column)}`);
    result = await tried(change, [id]);
  } else if (command === "unreachable") {
    const lines: string[] = [];
    for (const from of ["COMPENSATING", "COMPENSATED", "COMPENSATION_FAILED"]) {
      const id = `prop_${randomUUID()}`;
      await client.query("ALTER TABLE dsor.proposals DISABLE TRIGGER proposals_move");
      await client.query(ADD, [id, from]);
      await client.query("ALTER TABLE dsor.proposals ENABLE TRIGGER proposals_move");
      for (const to of STATES) {
        const { code } = await tried("UPDATE dsor.proposals SET state = $2 WHERE id = $1", [
          id,
          to,
        ]);
        lines.push(`${from} ${to} ${code}`);
      }
    }
    result = lines;
  } else if (command === "guard") {
    // The guard, as migration 015 runs it: the first DO block of the file.
    const migration = readFileSync(
      new URL("../migrations/015_proposals.sql", import.meta.url),
      "utf8",
    );
    const guard = /DO \$\$\nBEGIN\n[\s\S]*?\nEND\n\$\$;/.exec(migration)?.[0];
    if (guard === undefined) throw new Error("migration 015 has no guard");
    await client.query("DELETE FROM dsor.idempotency");
    const empty = await tried(guard, []);
    await client.query(
      // With a mode, which migration 016 added after this guard (step 23's README, decision 13).
      `INSERT INTO dsor.idempotency (tenant_id, principal, operation, idempotency_key, payload_hash,
                                     request_id, answer, mode)
       VALUES ('org_456', 'user_123', 'payment.create', 'k-before', 'sha256:' || repeat('f', 64),
               'req_before', '{"value": {}}', 'execute')`,
    );
    const answered = await tried(guard, []);
    result = { empty, answered };
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}
