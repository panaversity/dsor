// NEW IN STEP 11: a demonstration, not a test. Neon's pooled address hands a server
// connection to another program after each transaction (step 11's README, decision 8).
// Separate programs connect one after another, as dsor_runtime. First the right way, the
// company set with true inside BEGIN ... COMMIT. Then the break: set with false, for the
// connection. It reads only, and at the end clears the company it left behind.
// Run by hand, against a branch you may break:  node test/pooler-demo.ts
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";

loadDotEnv(["DSOR_DB_URL"]);
const direct = new URL(requireEnv("DSOR_DB_URL"));
// Neon's pooled address is the same host with -pooler after the endpoint id.
if (!/^ep-[a-z0-9-]+\./.test(direct.hostname)) {
  console.error("DSOR_DB_URL is not a Neon address, so there is no pooled address to show.");
  process.exit(1);
}
const pooled = new URL(direct.toString());
pooled.hostname = pooled.hostname.replace(/^(ep-[a-z0-9-]+?)(-pooler)?\./, "$1-pooler.");

// What a program sees: the server connection it was given, its company, and the invoices.
const READ = `SELECT pg_backend_pid() AS server_connection,
                     nullif(current_setting('dsor.tenant_id', true), '') AS company,
                     (SELECT string_agg(tenant_id || '/' || id, ' ' ORDER BY id)
                        FROM app.invoices) AS invoices_seen`;

/** One program: connects through the pooler, runs its statements, and leaves. */
async function program(statements: string[]): Promise<unknown> {
  const client = new pg.Client({ connectionString: pooled.toString() });
  await client.connect();
  try {
    let seen: unknown;
    for (const sql of statements) {
      const result = await client.query(sql);
      if (sql === READ) seen = result.rows[0];
    }
    return seen;
  } finally {
    await client.end();
  }
}
const CLEAR = "SELECT set_config('dsor.tenant_id', '', false)";
const show = (label: string, seen: unknown): void => console.log(label, JSON.stringify(seen));

// An earlier run that stopped halfway may have left a company on a pooled connection.
await program([CLEAR]);

console.log("the right way: the company set with true, inside BEGIN ... COMMIT");
const inside = ["BEGIN", "SELECT set_config('dsor.tenant_id', 'org_456', true)", READ];
show("  program 1 (org_456), inside its transaction:", await program([...inside, "COMMIT"]));
show("  program 2 (sets no company):", await program([READ]));

console.log("the break: the company set with false, for the connection");
show(
  "  program 3 (org_456):",
  await program(["SELECT set_config('dsor.tenant_id', 'org_456', false)", READ]),
);
for (const n of [4, 5]) show(`  program ${n} (sets no company):`, await program([READ]));

console.log("clean-up: the company set back to none, for the connection");
await program([CLEAR]);
show("  program 6 (sets no company):", await program([READ]));
