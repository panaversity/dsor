// NEW IN STEP 40c: on the database, an event the receiver refuses holds back only its payment's
// events; every failed try is kept; the third raises one alert, and the run that delivers the event
// closes it (DSOR-EVT-01a, DSOR-EVT-01b; step 40c's README, claims C1 to C6). The tests' own invoice,
// INV-9001, 500.00 USD of VENDOR-44. The refused payment stands for one to VENDOR-31, whom the
// accounts system does not know yet.
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEvent, type DomainEvent, type EventDraft, type EventType } from "../src/events.ts";
import { checkClassifications } from "../src/labels.ts";
import { outboxIn } from "../src/outbox.ts";
import { inCompany } from "../src/postgres.ts";
import { createDbOutbox } from "../src/sender.ts";
import { newPool, ownerEventTries, ownerInvoices, requestId, tryThenRollBack } from "./db.ts";
import { shippedLabels } from "./helpers.ts";

const pool = newPool();
const outbox = createDbOutbox(pool);
const kinds = checkClassifications(shippedLabels).kinds;
const REFUSED = "the accounts system answers 422: no vendor VENDOR-31";

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerInvoices("remove");
  await pool.end();
});

/** An event of org_456 about one payment of INV-9001, as DSoR builds it. */
function about(type: EventType, id: string, status: "draft" | "paid"): EventDraft {
  const data = {
    tenant_id: "org_456",
    id,
    invoice_id: "INV-9001",
    vendor_id: "VENDOR-44",
    amount: { value: "500.00", currency: "USD" },
    status,
    version: 1,
  };
  const resource = `dsor://org_456/payment/${id}`;
  const correlation = { request_id: requestId("40c"), principal_id: "user_123" };
  return buildEvent(
    { type, tenant: "org_456", resource, kind: "Payment", data, correlation },
    kinds,
  );
}

/** Work in one transaction of org_456, as dsor_runtime. */
function inOrg<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inCompany(pool, "org_456", work);
}

/** A draft of INV-9001 and its payment.created, committed: its id. */
function drafted(): Promise<string> {
  return inOrg(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.payments
         (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
       VALUES ('org_456', 'INV-9001', 'VENDOR-44', 500.00, 'USD', 'draft') RETURNING id`,
    );
    const id = rows[0]!.id;
    await outboxIn(client).add("org_456", about("payment.created", id, "draft"));
    return id;
  });
}

/** A draft, then paid with its payment.executed: its id. */
async function paid(): Promise<string> {
  const id = await drafted();
  await inOrg(async (client) => {
    await client.query("UPDATE app.payments SET status = 'paid' WHERE id = $1", [id]);
    await outboxIn(client).add("org_456", about("payment.executed", id, "paid"));
  });
  return id;
}

/** A payment's events, oldest first: id, type, and whether sent. */
async function eventsOf(id: string): Promise<{ event_id: string; type: string; sent: boolean }[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT event_id, type, sent_at IS NOT NULL AS sent FROM dsor.outbox
      WHERE resource = $1 ORDER BY written`,
    "org_456",
    [`dsor://org_456/payment/${id}`],
  );
  return rows as { event_id: string; type: string; sent: boolean }[];
}

/** The reasons of an event's failed tries, oldest first. */
async function triesOf(eventId: string): Promise<string[]> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT reason FROM dsor.outbox_tries WHERE event_id = $1 ORDER BY try",
    "org_456",
    [eventId],
  );
  return rows.map((row) => String(row["reason"]));
}

/** An event's alerts: state, and whether closed_at is set. */
async function alertsOf(eventId: string): Promise<{ state: string; closed: boolean }[]> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT state, closed_at IS NOT NULL AS closed FROM dsor.event_alerts WHERE event_id = $1",
    "org_456",
    [eventId],
  );
  return rows as { state: string; closed: boolean }[];
}

/** A receiver that refuses every event about this payment, and keeps the rest. */
function refusing(id: string): { got: DomainEvent[]; deliver: (e: DomainEvent) => Promise<void> } {
  const got: DomainEvent[] = [];
  return {
    got,
    deliver: async (event) => {
      if (event.resource === `dsor://org_456/payment/${id}`) throw new Error(REFUSED);
      got.push(event);
    },
  };
}

/** Every unsent event of org_456 delivered, so a test starts from an empty line. */
async function flush(): Promise<void> {
  await outbox.send("org_456", async () => {}, 1000);
}

describe("C1 and C2: only the refused payment's events wait", () => {
  it("DSOR-EVT-01b: C1: on the database, one payment's events are refused: another payment's are delivered and marked in the same run, and the refused one's stay unsent", async () => {
    await flush();
    const [bad, good] = [await drafted(), await drafted()];
    const { got, deliver } = refusing(bad);
    const run = await outbox.send("org_456", deliver, 1000);
    expect(got.map((e) => e.resource)).toStrictEqual([`dsor://org_456/payment/${good}`]);
    expect(run.failed).toStrictEqual([
      {
        event_id: (await eventsOf(bad))[0]!.event_id,
        resource: `dsor://org_456/payment/${bad}`,
        why: REFUSED,
      },
    ]);
    expect((await eventsOf(good)).map((e) => e.sent)).toStrictEqual([true]);
    expect((await eventsOf(bad)).map((e) => e.sent)).toStrictEqual([false]);
  });

  it("DSOR-EVT-01b: C2: a paid payment's payment.created is refused: its payment.executed is not tried and has no try, and the run that delivers the first delivers the second after it", async () => {
    await flush();
    const bad = await paid();
    const tried: string[] = [];
    await outbox.send(
      "org_456",
      async (event) => {
        tried.push(event.type);
        throw new Error(REFUSED);
      },
      1000,
    );
    expect(tried).toStrictEqual(["payment.created"]);
    const [created, executed] = await eventsOf(bad);
    expect(await triesOf(executed!.event_id)).toStrictEqual([]);
    const got: DomainEvent[] = [];
    await outbox.send("org_456", async (event) => void got.push(event), 1000);
    expect(got.map((e) => e.event_id)).toStrictEqual([created!.event_id, executed!.event_id]);
  });
});

describe("C3: every failed try is kept", () => {
  it("DSOR-EVT-01a: C3: each failed run writes one try for the payment's first event, with the receiver's reason", async () => {
    await flush();
    const bad = await paid();
    for (const _ of [1, 2]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    const [created, executed] = await eventsOf(bad);
    expect(await triesOf(created!.event_id)).toStrictEqual([REFUSED, REFUSED]);
    expect(await triesOf(executed!.event_id)).toStrictEqual([]);
  });

  it("DSOR-EVT-01a: C3: the owner cannot change or remove a try, or empty the log", async () => {
    await flush();
    const bad = await drafted();
    await outbox.send("org_456", refusing(bad).deliver, 1000);
    const [event] = await eventsOf(bad);
    const changed = ownerEventTries("try-change", event!.event_id) as { said: string[] };
    expect(changed.said).toStrictEqual([
      expect.stringMatching(/a try is never changed or removed/),
    ]);
    const removed = ownerEventTries("try-remove", event!.event_id) as { said: string[] };
    expect(removed.said).toStrictEqual([
      expect.stringMatching(/a try is never changed or removed/),
    ]);
    const emptied = ownerEventTries("empty") as { said: string[] };
    expect(emptied.said[0]).toMatch(/a try is never changed or removed/);
  });
});

describe("C4 and C5: the alert", () => {
  it("DSOR-EVT-01a: C4: the third failed try raises one open alert for that event, and a fourth leaves one", async () => {
    await flush();
    const bad = await drafted();
    const [event] = await eventsOf(bad);
    for (const _ of [1, 2]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    expect(await alertsOf(event!.event_id)).toStrictEqual([]);
    await outbox.send("org_456", refusing(bad).deliver, 1000);
    expect(await alertsOf(event!.event_id)).toStrictEqual([{ state: "open", closed: false }]);
    await outbox.send("org_456", refusing(bad).deliver, 1000);
    expect(await alertsOf(event!.event_id)).toStrictEqual([{ state: "open", closed: false }]);
    expect(await triesOf(event!.event_id)).toHaveLength(4);
  });

  it("DSOR-EVT-01a: C5: the run that delivers the event closes its alert, and marks the event sent", async () => {
    await flush();
    const bad = await drafted();
    const [event] = await eventsOf(bad);
    for (const _ of [1, 2, 3]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    await outbox.send("org_456", async () => {}, 1000);
    expect(await alertsOf(event!.event_id)).toStrictEqual([{ state: "closed", closed: true }]);
    expect((await eventsOf(bad))[0]!.sent).toBe(true);
  });

  it("DSOR-EVT-01a: C4: only the database raises an alert: the owner's alert for an event with one failed try is refused", async () => {
    await flush();
    const bad = await drafted();
    await outbox.send("org_456", refusing(bad).deliver, 1000);
    const [event] = await eventsOf(bad);
    const raised = ownerEventTries("alert-raise", event!.event_id) as { said: string[] };
    expect(raised.said).toStrictEqual([expect.stringMatching(/after its third failed try/)]);
  });

  it("DSOR-EVT-01a: C5: the owner cannot close an alert whose event is unsent, remove an alert, or empty the alerts", async () => {
    await flush();
    const bad = await drafted();
    const [event] = await eventsOf(bad);
    for (const _ of [1, 2, 3]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    const closed = ownerEventTries("alert-close", event!.event_id) as { said: string[] };
    expect(closed.said).toStrictEqual([
      expect.stringMatching(/closes only when its event is sent/),
    ]);
    const removed = ownerEventTries("alert-remove", event!.event_id) as { said: string[] };
    expect(removed.said).toStrictEqual([expect.stringMatching(/an alert is never removed/)]);
    const emptied = ownerEventTries("empty") as { said: string[] };
    expect(emptied.said[1]).toMatch(/an alert is never removed/);
  });
});

describe("C6: what dsor_runtime may do", () => {
  it("DSOR-EVT-01a: C6: dsor_runtime cannot raise, close, change, or remove an alert, nor change or remove a try", async () => {
    await flush();
    const bad = await drafted();
    for (const _ of [1, 2, 3]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    const [event] = await eventsOf(bad);
    const id = [event!.event_id];
    for (const sql of [
      `INSERT INTO dsor.event_alerts (tenant_id, event_id, resource, raised_at, state)
       VALUES ('org_456', $1, 'dsor://org_456/payment/PAY-000', now(), 'open')`,
      "UPDATE dsor.event_alerts SET state = 'closed', closed_at = now() WHERE event_id = $1",
      "DELETE FROM dsor.event_alerts WHERE event_id = $1",
      "UPDATE dsor.outbox_tries SET reason = 'changed' WHERE event_id = $1",
      "DELETE FROM dsor.outbox_tries WHERE event_id = $1",
    ]) {
      await expect(tryThenRollBack(pool, sql, "org_456", id)).rejects.toThrow(/permission denied/);
    }
  });
});
