// The owner runs DSoR's own store. Not a test file: rls.db.test.ts starts
// it through ownerStore in test/db.ts.
// The owner holds BYPASSRLS, so no policy applies to it, and only DSoR's own WHERE can
// filter what the store returns. That tests the first lock alone (DSOR-TEN-01b; step 11's
// README, "What the specification asks", point 1). The key stays in this child, and what
// it prints is redacted first (step 09's README, decision 18).
// Run by the tests as:  node test/owner-store.ts
// Or as  node test/owner-store.ts list,  which lists org_456's invoices
// through the store instead (step 13's README, C7).
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
  const bypassrls = rows[0]?.["bypassrls"] === true;
  let result: unknown;
  if (process.argv[2] === "list") {
    // Page after page, five rows at a time, so the SQL after a cursor runs too. Found by the
    // review: one read of every row never ran it (step 13's README, C7). Both companies, so
    // a lister that kept only org_456's rows would be seen. Found by the sweep.
    const listed: Record<string, string[]> = {};
    for (const company of ["org_456", "org_789"]) {
      const ids: string[] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const rows = await invoices.list(company, after, 5);
        ids.push(...rows.map(({ tenant_id, id }) => `${tenant_id}/${id}`));
        if (rows.length < 5) break;
        after = rows[rows.length - 1]!.id;
      }
      listed[company] = ids;
    }
    result = { bypassrls, listed };
  } else {
    const records = await createDbLog(pool).records("org_456");
    result = {
      bypassrls,
      // org_789's only invoice by that name.
      inv2001: (await invoices.get("org_456", "INV-2001")) ?? null,
      inv1008: (await invoices.get("org_456", "INV-1008"))?.tenant_id ?? null,
      recordTenants: [...new Set(records.map((record) => record.tenant ?? null))],
    };
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
