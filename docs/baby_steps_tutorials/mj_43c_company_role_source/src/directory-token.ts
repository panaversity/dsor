// NEW IN STEP 43c: run with  pnpm directory-token <company>
// Makes a company's directory credential, as the owner, DSOR_MIGRATION_URL: a random token, shown
// once, to paste into the company's directory as its SCIM provider's token. DSoR keeps its SHA-256
// only, and the company it names; the company's earlier token ends in the same transaction, so a
// new token is how an old one is replaced. Only a company on scim gets one (step 43c's README,
// claims C2 and C8, decision D3).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { checkRoleSettings, readRoleSettings } from "./authority.ts";
import { tokenHash } from "./directory-clients.ts";
import { loadDotEnv, requireEnv } from "./postgres.ts";
import { logins } from "./principals.ts";

/** Stops with this message, and exit code 1. */
function refuse(message: string): never {
  console.error(message);
  process.exit(1);
}

const [company, ...more] = process.argv.slice(2);
if (!company || more.length > 0) refuse("use: pnpm directory-token <company>");
loadDotEnv(["DSOR_MIGRATION_URL", "DSOR_ROLE_SOURCES_FILE"]);
const sources = readRoleSettings(process.env["DSOR_ROLE_SOURCES_FILE"] || undefined);
const kind = checkRoleSettings(sources, logins.values()).settings.get(company)?.kind;
if (kind !== "scim") {
  refuse(`${company}'s role source is ${kind ?? "none"}, not scim: its people are DSoR's table's`);
}

// 24 random bytes, 48 hex letters: what authentik's SCIM provider sends as its bearer token.
const token = randomBytes(24).toString("hex");
const owner = new pg.Pool({ connectionString: requireEnv("DSOR_MIGRATION_URL"), max: 1 });
try {
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE dsor.directory_clients SET ended_at = now() WHERE company = $1 AND ended_at IS NULL",
      [company],
    );
    await client.query("INSERT INTO dsor.directory_clients (token_hash, company) VALUES ($1, $2)", [
      tokenHash(token),
      company,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // The database's message, never the owner's key.
    refuse(`the credential could not be written: ${(error as Error).message}`);
  } finally {
    client.release();
  }
} finally {
  await owner.end();
}
// Shown once, on its own last line, and kept nowhere but in its hash.
console.log(`${company}'s directory token, shown once: paste it into its SCIM provider`);
console.log(token);
