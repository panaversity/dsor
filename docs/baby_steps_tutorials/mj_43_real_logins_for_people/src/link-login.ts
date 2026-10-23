// NEW IN STEP 43: run with  pnpm link-login <issuer> <subject> <principal>
// Links one person's login to their principal, in DSoR's own table, as the owner,
// DSOR_MIGRATION_URL. Run it once for each person, after they first sign in: the subject is their
// user id at the issuer. The issuer must be one that issuers.json names (or the file that
// DSOR_ISSUERS_FILE names), and the principal a person DSoR knows. A login already linked to
// someone is never moved to someone else (step 43's README, claim C8, decision D5).
import pg from "pg";
import { checkIssuers, readIssuers } from "./issuers.ts";
import { logins } from "./principals.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";

/** Stops with this message, and exit code 1. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const [issuer, subject, principal, ...more] = process.argv.slice(2);
if (!issuer || !subject || !principal || more.length > 0) {
  refuse("use: pnpm link-login <issuer> <subject> <principal>");
}
// The issuers file .env names, as pnpm serve reads it, so the two never check different files
//   (step 43's review, L5).
loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_ISSUERS_FILE"]);
const people = [...logins.values()];
const { issuers, problems } = checkIssuers(readIssuers(process.env["DSOR_ISSUERS_FILE"]), people);
if (problems.length > 0) refuse(`the issuers refused to start:\n  ${problems.join("\n  ")}`);
if (![...issuers.values()].some((list) => list.some((i) => i.issuer === issuer))) {
  refuse(`${issuer} is no issuer in issuers.json`);
}
// Only a person: agents get real logins in step 44 (decision D1).
if (!people.some((p) => p.id === principal && p.type === "human")) {
  refuse(`${principal} is no person DSoR knows`);
}

const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
try {
  // Kept as it is when the login is linked already: a link never moves to another person.
  await owner.query(
    `INSERT INTO dsor.logins (issuer, subject, principal_id) VALUES ($1, $2, $3)
       ON CONFLICT (issuer, subject) DO NOTHING`,
    [issuer, subject, principal],
  );
  const { rows } = await owner.query<{ principal_id: string }>(
    "SELECT principal_id FROM dsor.logins WHERE issuer = $1 AND subject = $2",
    [issuer, subject],
  );
  const linked = rows[0]?.principal_id;
  if (linked !== principal) refuse(`${subject} of ${issuer} is linked to ${linked} already`);
  console.log(`linked ${subject} of ${issuer} to ${principal}`);
} catch (error) {
  // The database's message, never the owner's key.
  refuse(`the link could not be written: ${(error as Error).message}`);
} finally {
  await owner.end();
}
