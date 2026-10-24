// The owner as org_456's accounts system, which adds and removes the bills of the
// tests' payment runs, so the story's invoices stay as they are (step 41's README, claims C2 to C8).
// Not a test file: run.db.test.ts starts it through ownerRunBills in test/db.ts. The key stays in
// this child, and what it prints is redacted first (step 09's README, decision 18). The commands:
// - add: the bills, issued, at version 1, after the ones an earlier run left are removed:
//   INV-9411, 8,900.50 USD, and INV-9412, 31,400.00 USD, above the CFO's 25,000, of VENDOR-44;
//   INV-9413, 640.00 USD of VENDOR-31; and INV-9414 to INV-9418, 45,000.00 USD each of VENDOR-12,
//   225,000.00 USD in all, more than one day's limit.
// - remove: the bills and the payments drafted for them, which the key to the invoices needs first.
// Run by the tests as:
//   node test/owner-run-bills.ts add | remove
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command] = process.argv.slice(2);

const BILLS: [string, string, string][] = [
  ["INV-9411", "VENDOR-44", "8900.50"],
  ["INV-9412", "VENDOR-44", "31400.00"],
  ["INV-9413", "VENDOR-31", "640.00"],
  ["INV-9414", "VENDOR-12", "45000.00"],
  ["INV-9415", "VENDOR-12", "45000.00"],
  ["INV-9416", "VENDOR-12", "45000.00"],
  ["INV-9417", "VENDOR-12", "45000.00"],
  ["INV-9418", "VENDOR-12", "45000.00"],
];
const IDS = BILLS.map(([id]) => id);

// The owner holds BYPASSRLS, so no policy filters these statements.
async function removeAll(): Promise<{ payments: number; invoices: number }> {
  const payments = await pool.query(
    "DELETE FROM app.payments WHERE tenant_id = 'org_456' AND invoice_id = ANY ($1::text[])",
    [IDS],
  );
  const invoices = await pool.query(
    "DELETE FROM app.invoices WHERE tenant_id = 'org_456' AND id = ANY ($1::text[])",
    [IDS],
  );
  return { payments: payments.rowCount ?? 0, invoices: invoices.rowCount ?? 0 };
}

try {
  let result: unknown;
  if (command === "add") {
    await removeAll();
    for (const [id, vendor, value] of BILLS) {
      await pool.query(
        `INSERT INTO app.invoices (tenant_id, id, vendor_id, amount_value, amount_currency,
                                   open_amount_value, open_amount_currency, status)
         VALUES ('org_456', $1, $2, $3::numeric, 'USD', $3::numeric, 'USD', 'issued')`,
        [id, vendor, value],
      );
    }
    result = { added: IDS.length };
  } else if (command === "remove") {
    result = await removeAll();
  } else {
    throw new Error(`unknown command ${String(command)}`);
  }
  process.stdout.write(redact(JSON.stringify(result), { "<owner URL>": owner }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
