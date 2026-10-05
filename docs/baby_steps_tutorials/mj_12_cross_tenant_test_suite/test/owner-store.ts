// The owner runs DSoR's own store. Not a test file: rls.db.test.ts starts
// it through ownerStore in test/db.ts.
// The owner holds BYPASSRLS, so no policy applies to it, and only DSoR's own WHERE can
// filter what the store returns. That tests the first lock alone (DSOR-TEN-01b; step 11's
// README, "What the specification asks", point 1). The key stays in this child, and what
// it prints is redacted first (step 09's README, decision 18).
// Run by the tests as:  node test/owner-store.ts
import {
  createDbInvoices,
  createDbLog,
  loadDotEnv,
  openPool,
  requireEnv,
} from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = openPool(owner);
try {
  // Without BYPASSRLS, the policies would filter too, and the test would prove nothing.
  const { rows } = await pool.query(
    "SELECT rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user",
  );
  const invoices = createDbInvoices(pool);
  const records = await createDbLog(pool).records("org_456");
  const result = {
    bypassrls: rows[0]?.["bypassrls"] === true,
    // org_789's only invoice by that name.
    inv2001: (await invoices.get("org_456", "INV-2001")) ?? null,
    inv1008: (await invoices.get("org_456", "INV-1008"))?.tenant_id ?? null,
    recordTenants: [...new Set(records.map((record) => record.tenant ?? null))],
  };
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
