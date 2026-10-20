// The owner changes a payment of INV-9001, or an event, in ways the database must
// refuse, and prints what the database said. Not a test file: payment-events.db.test.ts starts it
// through ownerPaymentEvents in test/db.ts. The key stays in this child, and what it prints is
// redacted first (step 09's README, decision 18). The owner holds every privilege, so only the
// database's own checks can stop it (step 40b's README, decisions D5, D8, and D9). The commands:
// - bare: a draft of INV-9001, 500.00 USD to VENDOR-44, and no event.
// - again <payment>: the payment removed, and a draft written again under its old id, with no new
//   event. Its old payment.created is from an earlier transaction (decision D6).
// - remove <payment>: the payment removed. A removal has no event type, so it needs none (C3).
// - ghost: a payment.created about PAY-000, which was never drafted (C4).
// - unpay <payment>: a paid payment set back to draft (found by step 40b's review, H1).
// - renumber <payment>: the payment given a new number, and so a new id (the review, M1).
// Each of these runs in a transaction of its own, which commits if the database lets it. Three more
// always roll back, so the test's database keeps its events:
// - stamp: a draft and its payment.created, written with written_xact 42; prints what was stored
//   and this transaction's id (the review, M1).
// - forget <payment>: the payment's events deleted (the review, M1).
// - empty: dsor.outbox truncated (the review, M1). Changed in step 40c: with CASCADE, so the tries
//   and alerts that point at events do not stop it first, and the outbox's own guard answers.
// Run by the tests as:  node test/owner-payment-events.ts <command> [payment]
import pg from "pg";
import { buildEvent, type EventType } from "../src/events.ts";
import { checkClassifications, readClassifications } from "../src/labels.ts";
import { loadDotEnv, requireEnv } from "../src/postgres.ts";
import { redact } from "./db.ts";

loadDotEnv(["DSOR_MIGRATION_URL"]);
const owner = requireEnv("DSOR_MIGRATION_URL");
const client = new pg.Client({ connectionString: owner });
const [command, payment] = process.argv.slice(2);
const kinds = checkClassifications(readClassifications()).kinds;

const DRAFT = `INSERT INTO app.payments
                 (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
               VALUES ('org_456', 'INV-9001', 'VENDOR-44', 500.00, 'USD', 'draft')
               RETURNING id`;
const KEPT = ["bare", "again", "remove", "ghost", "unpay", "renumber"];
const ROLLED_BACK = ["stamp", "forget", "empty"];

/** One event of org_456 about one payment, as DSoR builds it, written with a written_xact. */
async function writeEvent(type: EventType, id: string, xact?: string): Promise<unknown> {
  const resource = `dsor://org_456/payment/${id}`;
  const data = { tenant_id: "org_456", id, invoice_id: "INV-9001", status: "draft", version: 1 };
  const correlation = { request_id: "req_owner_events", principal_id: "user_123" };
  const draft = buildEvent(
    { type, tenant: "org_456", resource, kind: "Payment", data, correlation },
    kinds,
  );
  const event = { ...draft, ordering_key: 1 };
  const { rows } = await client.query(
    `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event, written_xact)
     VALUES ($1, 'org_456', $2, $3, 1, $4, coalesce($5::xid8, pg_current_xact_id()))
     RETURNING written_xact::text AS stored, pg_current_xact_id()::text AS current`,
    [event.event_id, type, resource, event, xact ?? null],
  );
  return rows[0];
}

try {
  if (![...KEPT, ...ROLLED_BACK].includes(command ?? "")) {
    throw new Error(`unknown command ${command}`);
  }
  await client.connect();
  await client.query("BEGIN");
  let id: string | undefined;
  let said = ROLLED_BACK.includes(command!) ? "done" : "committed";
  let stamp: unknown;
  try {
    if (command === "bare") {
      id = (await client.query<{ id: string }>(DRAFT)).rows[0]?.id;
    } else if (command === "again") {
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
    } else if (command === "remove") {
      await client.query("DELETE FROM app.payments WHERE tenant_id = 'org_456' AND id = $1", [
        payment,
      ]);
    } else if (command === "ghost") {
      await writeEvent("payment.created", "PAY-000");
    } else if (command === "unpay") {
      await client.query(
        "UPDATE app.payments SET status = 'draft' WHERE tenant_id = 'org_456' AND id = $1",
        [payment],
      );
    } else if (command === "renumber") {
      const { rows } = await client.query<{ id: string }>(
        "UPDATE app.payments SET number = DEFAULT WHERE tenant_id = 'org_456' AND id = $1 RETURNING id",
        [payment],
      );
      id = rows[0]?.id;
    } else if (command === "stamp") {
      id = (await client.query<{ id: string }>(DRAFT)).rows[0]?.id;
      stamp = await writeEvent("payment.created", id!, "42");
    } else if (command === "forget") {
      await client.query("DELETE FROM dsor.outbox WHERE resource = $1", [
        `dsor://org_456/payment/${payment}`,
      ]);
    } else {
      await client.query("TRUNCATE dsor.outbox CASCADE");
    }
    await client.query(ROLLED_BACK.includes(command!) ? "ROLLBACK" : "COMMIT");
  } catch (error) {
    said = (error as Error).message;
    await client.query("ROLLBACK").catch(() => {});
  }
  process.stdout.write(JSON.stringify({ said, id, stamp }));
} catch (error) {
  process.stderr.write(redact(String(error), { "<owner URL>": owner }));
  process.exitCode = 1;
} finally {
  await client.end();
}
