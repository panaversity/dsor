// NEW IN STEP 43b, the learner's L3: run with  pnpm grant <company> <person> tenant_admin <reason>
// Gives tenant_admin to a person of a company, as the owner, DSOR_MIGRATION_URL, and only while the
// company has fewer than two active administrators. So org_789, with admin_700 alone, can get the
// second administrator that role.confirm needs. Every other grant is role.grant's, by the company's
// own administrators (step 43b's README, claim C7, decision L3).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** Stops with this message, and exit code 1. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const [company, person, role, reason, ...more] = process.argv.slice(2);
if (!company || !person || !role || !reason || more.length > 0) {
  refuse("use: pnpm grant <company> <person> tenant_admin <reason>");
}
if (role !== "tenant_admin") {
  refuse("pnpm grant gives tenant_admin only: every other role is role.grant's");
}
loadDotEnv(["DSOR_MIGRATION_URL"]);

const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
const client = await owner.connect();
let outcome = "";
try {
  await client.query("BEGIN");
  // The company's rows: row-level security holds for the owner too (FORCE).
  await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [company]);
  // One grant at a time, so two owners' runs cannot each find one administrator and make two.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dsor.grant/' || $1, 0))", [
    company,
  ]);
  const member = await client.query(
    "SELECT 1 FROM dsor.people WHERE tenant_id = $1 AND principal_id = $2 AND removed_at IS NULL",
    [company, person],
  );
  // Changed by the code review of step 43b, finding 7: an administrator already is said so, not met
  //   with the database's duplicate-key error.
  const already = await client.query(
    `SELECT 1 FROM dsor.role_grants
      WHERE tenant_id = $1 AND principal_id = $2 AND role = 'tenant_admin' AND ended_at IS NULL`,
    [company, person],
  );
  if (member.rowCount !== 1) {
    outcome = `${person} is no person of ${company}`;
  } else if (already.rowCount !== 0) {
    outcome = `${person} is an administrator of ${company} already`;
  } else {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(DISTINCT p.principal_id)::int AS n FROM dsor.people p
         JOIN dsor.role_grants g ON g.tenant_id = p.tenant_id AND g.principal_id = p.principal_id
        WHERE p.tenant_id = $1 AND p.removed_at IS NULL AND g.role = 'tenant_admin'
          AND g.ended_at IS NULL AND (NOT g.needs_confirm OR g.confirmed_at IS NOT NULL)`,
      [company],
    );
    if ((rows[0]?.n ?? 0) >= 2) {
      outcome = `${company} has two administrators already: ask them, with role.grant and role.confirm`;
    } else {
      // Counts at once: the owner is the second key here, and the record names "owner".
      await client.query(
        `INSERT INTO dsor.role_grants (id, tenant_id, principal_id, role, asked_by, reason, needs_confirm)
         VALUES ($1, $2, $3, 'tenant_admin', 'owner', $4, false)`,
        [`grt_${randomUUID()}`, company, person, reason],
      );
    }
  }
  await client.query(outcome === "" ? "COMMIT" : "ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  // The database's message, never the owner's key.
  outcome = `the grant could not be written: ${(error as Error).message}`;
} finally {
  client.release();
  await owner.end();
}
if (outcome !== "") refuse(outcome);
console.log(`granted tenant_admin to ${person} in ${company}`);
