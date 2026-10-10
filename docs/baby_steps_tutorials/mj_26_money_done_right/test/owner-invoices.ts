// The owner as org_456's accounts system, which changes invoices outside DSoR
// (§10.2, T14). Not a test file: the database tests start it through ownerInvoices in
// test/db.ts. The key stays in this child, and what it prints is redacted first (step 09's
// README, decision 18). The tests change INV-9001 only, an invoice of their own, so the story's
// invoices stay at version 1 (step 21's README, decision 12). Three commands:
// - add: INV-9001 of org_456, issued, 500.00 USD from VENDOR-44, at version 1. An INV-9001 left
//   by a run that stopped halfway is removed first. NEW IN STEP 26: add <value> <currency> makes it
//   a bill of that amount, in another currency too (step 26's README, decision D14).
// - credit <open> [version]: a credit note on INV-9001: its open amount changes, and the
//   database's trigger raises its version. With a version, the owner also tries to set it,
//   and the trigger wins.
// - amend <payment>: a change to a draft payment of INV-9001 outside DSoR: its amount changes,
//   it stays a draft, and the database's trigger raises its version.
// - remove: INV-9001 and the payments drafted for it, which the key to the invoice needs first.
// Run by the tests as:
//   node test/owner-invoices.ts add [value currency] | credit <open> [version] | amend <payment> |
//   remove
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const pool = new pg.Pool({ connectionString: owner, max: 1 });
const [command, ...args] = process.argv.slice(2);

// The owner holds BYPASSRLS, so no policy filters these statements.
const REMOVE_PAYMENTS =
  "DELETE FROM app.payments WHERE tenant_id = 'org_456' AND invoice_id = 'INV-9001'";
const REMOVE_INVOICE = "DELETE FROM app.invoices WHERE tenant_id = 'org_456' AND id = 'INV-9001'";

try {
  let result: unknown;
  if (command === "add") {
    await pool.query(REMOVE_PAYMENTS);
    await pool.query(REMOVE_INVOICE);
    const [value = "500.00", currency = "USD"] = args;
    const { rows } = await pool.query(
      `INSERT INTO app.invoices (tenant_id, id, vendor_id, amount_value, amount_currency,
                                 open_amount_value, open_amount_currency, status)
       VALUES ('org_456', 'INV-9001', 'VENDOR-44', $1::numeric, $2, $1::numeric, $2, 'issued')
       RETURNING version`,
      [value, currency],
    );
    result = { version: rows[0]?.["version"] };
  } else if (command === "credit") {
    const [open, version] = args;
    const { rows } = await pool.query(
      `UPDATE app.invoices SET open_amount_value = $1::numeric,
                               version = coalesce($2::int, version)
        WHERE tenant_id = 'org_456' AND id = 'INV-9001' RETURNING version`,
      [open, version ?? null],
    );
    result = { version: rows[0]?.["version"] };
  } else if (command === "amend") {
    const [payment] = args;
    const { rows } = await pool.query(
      `UPDATE app.payments SET amount_value = amount_value - 1
        WHERE tenant_id = 'org_456' AND id = $1 AND invoice_id = 'INV-9001' RETURNING version`,
      [payment],
    );
    result = { version: rows[0]?.["version"] };
  } else if (command === "remove") {
    const payments = await pool.query(REMOVE_PAYMENTS);
    const invoices = await pool.query(REMOVE_INVOICE);
    result = { payments: payments.rowCount, invoices: invoices.rowCount };
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
