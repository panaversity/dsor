// NEW IN STEP 43, the learner's R3: run with  pnpm invite <company> <person> <reason>
// Invites one person of a company, as the owner, DSOR_MIGRATION_URL, and prints the code once. The
// person sends it with their first call, and DSoR links their login (decision R1). Run it for the
// first administrator of a company: from then on, that administrator invites the others with
// login.invite. It replaces pnpm link-login: the owner never types a login's subject again.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { checkIssuers, readIssuers } from "./issuers.ts";
import { hashOf, newCode } from "./logins.ts";
import { logins } from "./principals.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** Stops with this message, and exit code 1. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const [company, person, reason, ...more] = process.argv.slice(2);
if (!company || !person || !reason || more.length > 0) {
  refuse("use: pnpm invite <company> <person> <reason>");
}
// The issuers file .env names, as pnpm serve reads it, so the two never check different files
//   (step 43's review, L5).
loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_ISSUERS_FILE"]);
const people = [...logins.values()];
const { issuers, problems } = checkIssuers(readIssuers(process.env["DSOR_ISSUERS_FILE"]), people);
if (problems.length > 0) refuse(`the issuers refused to start:\n  ${problems.join("\n  ")}`);
if (!issuers.has(company)) refuse(`${company} is no company in issuers.json`);

const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
const client = await owner.connect();
try {
  const code = newCode();
  await client.query("BEGIN");
  // The company's row: row-level security holds for the owner too (FORCE).
  await client.query("SELECT set_config('dsor.tenant_id', $1, true)", [company]);
  // A person of this company. Changed in step 43b: in DSoR's table of people, never in code, so a
  //   new hire can be invited once person.add has added them (step 43b's README, claim C3).
  const member = await client.query(
    "SELECT 1 FROM dsor.people WHERE tenant_id = $1 AND principal_id = $2 AND removed_at IS NULL",
    [company, person],
  );
  if (member.rowCount !== 1) {
    await client.query("ROLLBACK");
    refuse(`${person} is no person of ${company}`);
  }
  // One live login for each person (the review's finding 1): to change it, unlink it first.
  const live = await client.query(
    "SELECT 1 FROM dsor.logins WHERE principal_id = $1 AND unlinked_at IS NULL",
    [person],
  );
  if (live.rowCount !== 0) {
    await client.query("ROLLBACK");
    refuse(`${person} has a login already: unlink it first`);
  }
  const { rows } = await client.query<{ expires_at: Date }>(
    `INSERT INTO dsor.invitations (tenant_id, id, principal_id, code_hash, invited_by, reason)
     VALUES ($1, $2, $3, $4, 'owner', $5) RETURNING expires_at`,
    [company, `inv_${randomUUID()}`, person, hashOf(code), reason],
  );
  await client.query("COMMIT");
  console.log(`invited ${person} to ${company} until ${rows[0]?.expires_at.toISOString()}`);
  // The one time the code is shown; DSoR keeps only its hash (decision R1).
  console.log(`code: ${code}`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  // The database's message, never the owner's key.
  refuse(`the invitation could not be written: ${(error as Error).message}`);
} finally {
  client.release();
  await owner.end();
}
