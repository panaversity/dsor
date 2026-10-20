// NEW IN STEP 40b: the owner changes a payment of INV-9001 with no event, and prints what the
// database said. Not a test file: payment-events.db.test.ts starts it through ownerPaymentEvents in
// test/db.ts. The key stays in this child, and what it prints is redacted first (step 09's README,
// decision 18). The owner holds every privilege, so only the database's own check can stop it
// (step 40b's README, decision D5). The commands:
// - bare: a draft of INV-9001, 500.00 USD to VENDOR-44, and no event.
// - again <payment>: the payment removed, and a draft written again under its old id, with no new
//   event. Its old payment.created is from an earlier transaction (step 40b's README, decision D6).
// Each runs in a transaction of its own, which commits if the database lets it.
// Run by the tests as:  node test/owner-payment-events.ts bare | again <payment>
import pg from "pg";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command, payment] = process.argv.slice(2);

const DRAFT = `INSERT INTO app.payments
                 (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
               VALUES ('org_456', 'INV-9001', 'VENDOR-44', 500.00, 'USD', 'draft')
               RETURNING id`;

try {
  if (command !== "bare" && command !== "again") throw new Error(`unknown command ${command}`);
  await client.connect();
  await client.query("BEGIN");
  let id: string | undefined;
  let said = "committed";
  try {
    if (command === "bare") {
      id = (await client.query<{ id: string }>(DRAFT)).rows[0]?.id;
    } else {
      // The same number gives the same id, which the database writes from it.
      const gone = await client.query<{ number: string }>(
        "DELETE FROM app.payments WHERE tenant_id = 'org_456' AND id = $1 RETURNING number",
        [payment],
      );
      const number = gone.rows[0]?.number;
      if (number === undefined) throw new Error(`no payment ${payment}`);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.payments
           (number, tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
         OVERRIDING SYSTEM VALUE
         VALUES ($1::bigint, 'org_456', 'INV-9001', 'VENDOR-44', 500.00, 'USD', 'draft')
         RETURNING id`,
        [number],
      );
      id = rows[0]?.id;
    }
    await client.query("COMMIT");
  } catch (error) {
    said = (error as Error).message;
    await client.query("ROLLBACK").catch(() => {});
  }
  process.stdout.write(JSON.stringify({ said, id }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
