// On the database, an event the receiver refuses holds back only its payment's
// events; every failed try is kept; the third raises one alert, and the run that delivers the event
// closes it (DSOR-EVT-01a, DSOR-EVT-01b; step 40c's README, claims C1 to C6). The tests' own invoice,
// INV-9001, 500.00 USD of VENDOR-44. The refused payment stands for one to VENDOR-31, whom the
// accounts system does not know yet.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
const DIE = fileURLToPath(new URL("refuse-and-die.ts", import.meta.url));

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
  it("step 40c's decision D1: C1: on the database, one payment's events are refused: another payment's are delivered and marked in the same run, and the refused one's stay unsent", async () => {
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

  it("step 40c's decision D1: C2: a paid payment's payment.created is refused: its payment.executed is not tried and has no try, and the run that delivers the first delivers the second after it", async () => {
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

// Found by step 40c's review, H1: a refusal whose reason the database could not keep aborted the
//   run, so every other payment's delivery was undone, and no try or alert was ever written.
describe("step 40c's review, H1: any refusal is kept, and the run goes on", () => {
  for (const [what, thrown, kept] of [
    ["with no words", new Error(""), "the receiver gave no reason"],
    [
      "with a NUL byte and a newline",
      new Error("no\u0000vendor\nVENDOR-31"),
      "no vendor VENDOR-31",
    ],
    ["of 150 two-byte characters", new Error("é".repeat(150)), "é".repeat(100)],
  ] as const) {
    it(`DSOR-EVT-01a: H1: a refusal ${what}: the other payment is delivered, and the try is kept, cleaned`, async () => {
      await flush();
      const [bad, good] = [await drafted(), await drafted()];
      const run = await outbox.send(
        "org_456",
        async (event) => {
          if (event.resource.endsWith(`/${bad}`)) throw thrown;
        },
        1000,
      );
      expect(run.sent).toContain((await eventsOf(good))[0]!.event_id);
      expect((await eventsOf(good))[0]!.sent).toBe(true);
      expect(await triesOf((await eventsOf(bad))[0]!.event_id)).toStrictEqual([kept]);
    });
  }
});

// Found by step 40c's review, M1: held-back events filled the run's window of unsent events.
describe("step 40c's review, M1: a run counts only the events it tries, on the database", () => {
  it("step 40c's decision D1: M1: two paid payments are refused; a run that may try 3 still delivers a third payment's event", async () => {
    await flush();
    const [one, two] = [await paid(), await paid()];
    const good = await drafted();
    const run = await outbox.send(
      "org_456",
      async (event) => {
        if (!event.resource.endsWith(`/${good}`)) throw new Error(REFUSED);
      },
      3,
    );
    expect(run.sent).toStrictEqual([(await eventsOf(good))[0]!.event_id]);
    expect(run.failed?.map((f) => f.resource.split("/").at(-1))).toStrictEqual([one, two]);
  });
});

/** Tries written straight into the log by dsor_runtime, in one statement, as raw SQL can. */
function writeTries(eventId: string, count: number): Promise<unknown> {
  const values = Array.from({ length: count }, (_, i) => `('org_456', $1, 'raw try ${i}')`);
  return inOrg((client) =>
    client.query(
      `INSERT INTO dsor.outbox_tries (tenant_id, event_id, reason) VALUES ${values.join(", ")}`,
      [eventId],
    ),
  );
}

// Found by step 40c's review, L1, L2, and L3: the alert counted to exactly three, a try and a mark
//   of one event could pass each other, and a try could be written for an event held back.
describe("step 40c's review, L1 to L3: the rules of a try, kept by the database", () => {
  it("DSOR-EVT-01a: L1: tries written two at a time, from two to four, still raise the event's one alert", async () => {
    await flush();
    const bad = await drafted();
    for (const _ of [1, 2]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    const [event] = await eventsOf(bad);
    await writeTries(event!.event_id, 2);
    expect(await alertsOf(event!.event_id)).toStrictEqual([{ state: "open", closed: false }]);
  });

  it("DSOR-EVT-01a: L1: three tries written at once raise one alert, not an error", async () => {
    await flush();
    const bad = await drafted();
    const [event] = await eventsOf(bad);
    await writeTries(event!.event_id, 3);
    expect(await alertsOf(event!.event_id)).toStrictEqual([{ state: "open", closed: false }]);
  });

  it("DSOR-EVT-01a: L2: the third try and the mark that sends the event cannot pass each other: the alert ends closed", async () => {
    await flush();
    const bad = await drafted();
    for (const _ of [1, 2]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    const [event] = await eventsOf(bad);
    const two = newPool();
    const [trier, marker] = [await two.connect(), await two.connect()];
    try {
      for (const client of [trier, marker]) {
        await client.query("BEGIN");
        await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      }
      await trier.query(
        "INSERT INTO dsor.outbox_tries (tenant_id, event_id, reason) VALUES ('org_456', $1, 'third')",
        [event!.event_id],
      );
      const marking = marker.query("UPDATE dsor.outbox SET sent_at = now() WHERE event_id = $1", [
        event!.event_id,
      ]);
      await new Promise((done) => setTimeout(done, 300));
      await trier.query("COMMIT");
      await marking;
      await marker.query("COMMIT");
    } finally {
      for (const client of [trier, marker]) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
      await two.end();
    }
    expect((await eventsOf(bad))[0]!.sent).toBe(true);
    expect(await alertsOf(event!.event_id)).toStrictEqual([{ state: "closed", closed: true }]);
  });

  it("DSOR-EVT-01a: L3: a try for an event held back behind its payment's earlier unsent event is refused", async () => {
    await flush();
    const bad = await paid();
    const [, executed] = await eventsOf(bad);
    await expect(writeTries(executed!.event_id, 1)).rejects.toThrow(
      /a try is written only for its payment's oldest unsent event/,
    );
  });
});

// Found by step 40c's review, L4, from step 40: the sender orders a payment's events by when they
//   were written, and nothing made that agree with their ordering keys. The learner chose to fix it.
describe("step 40c's review, L4: an event's number is the next one for its payment", () => {
  it("DSOR-EVT-01b: L4: a payment's first event numbered 2 is refused", async () => {
    await expect(
      inOrg(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.payments
             (tenant_id, invoice_id, vendor_id, amount_value, amount_currency, status)
           VALUES ('org_456', 'INV-9001', 'VENDOR-44', 500.00, 'USD', 'draft') RETURNING id`,
        );
        const event = { ...about("payment.created", rows[0]!.id, "draft"), ordering_key: 2 };
        await client.query(
          `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event)
           VALUES ($1, 'org_456', $2, $3, 2, $4)`,
          [event.event_id, event.type, event.resource, event],
        );
      }),
    ).rejects.toThrow(/is not the next number/);
  });
});

/** An alert's times, as the database wrote them. */
async function alertTimesOf(eventId: string): Promise<{ raised: Date; closed: Date | null }> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT raised_at AS raised, closed_at AS closed FROM dsor.event_alerts WHERE event_id = $1",
    "org_456",
    [eventId],
  );
  return rows[0] as { raised: Date; closed: Date | null };
}

// Found by step 40c's review, M2 to M4: clauses that a break could remove with every test green.
//   Each test below fails when its clause is removed (step 40c's README, the breaks).
describe("step 40c's review, M2 to M4: each clause has a test that needs it", () => {
  it("step 40c's decision D1: M2: a paid payment refused, written before a good draft: the good one is delivered", async () => {
    await flush();
    const bad = await paid();
    const good = await drafted();
    const run = await outbox.send("org_456", refusing(bad).deliver, 1000);
    expect(run.sent).toStrictEqual([(await eventsOf(good))[0]!.event_id]);
  });

  it("step 40c's decision D1: M2: oldest first across payments: a paid payment's two events come before a later draft's", async () => {
    await flush();
    const first = await paid();
    const later = await drafted();
    const got: string[] = [];
    await outbox.send("org_456", async (event) => void got.push(event.event_id), 1000);
    const [created, executed] = await eventsOf(first);
    expect(got).toStrictEqual([
      created!.event_id,
      executed!.event_id,
      (await eventsOf(later))[0]!.event_id,
    ]);
  });

  it("DSOR-EVT-01a: M3: two payments refused in one run: each gets its own try", async () => {
    await flush();
    const [one, two] = [await drafted(), await drafted()];
    await outbox.send(
      "org_456",
      async () => {
        throw new Error(REFUSED);
      },
      1000,
    );
    for (const id of [one, two]) {
      expect(await triesOf((await eventsOf(id))[0]!.event_id)).toStrictEqual([REFUSED]);
    }
  });

  it("DSOR-EVT-01a: M3: a sender killed after a refused try, before its commit, leaves no try", async () => {
    await flush();
    const bad = await drafted();
    await drafted();
    const died = spawnSync(process.execPath, [DIE, bad], { encoding: "utf8" });
    expect(died.signal).toBe("SIGKILL");
    expect(died.stdout).toBe("");
    expect(await triesOf((await eventsOf(bad))[0]!.event_id)).toStrictEqual([]);
  });

  it("DSOR-EVT-01a: M4: two payments with open alerts; the run that delivers one closes only its alert, and commits", async () => {
    await flush();
    const [one, two] = [await drafted(), await drafted()];
    for (const _ of [1, 2, 3]) {
      await outbox.send(
        "org_456",
        async () => {
          throw new Error(REFUSED);
        },
        1000,
      );
    }
    const run = await outbox.send("org_456", refusing(two).deliver, 1000);
    expect(run.sent).toStrictEqual([(await eventsOf(one))[0]!.event_id]);
    expect(await alertsOf((await eventsOf(one))[0]!.event_id)).toStrictEqual([
      { state: "closed", closed: true },
    ]);
    expect(await alertsOf((await eventsOf(two))[0]!.event_id)).toStrictEqual([
      { state: "open", closed: false },
    ]);
  });

  it("DSOR-EVT-01a: M4: an alert's times are the database's: raised now, and closed later, when its event is sent", async () => {
    await flush();
    const bad = await drafted();
    const [event] = await eventsOf(bad);
    const before = Date.now();
    for (const _ of [1, 2, 3]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    await outbox.send("org_456", async () => {}, 1000);
    const { raised, closed } = await alertTimesOf(event!.event_id);
    expect(raised.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(closed!.getTime()).toBeGreaterThan(raised.getTime());
  });

  it("DSOR-EVT-01a: M4: the owner cannot change an alert's payment", async () => {
    await flush();
    const bad = await drafted();
    const [event] = await eventsOf(bad);
    for (const _ of [1, 2, 3]) await outbox.send("org_456", refusing(bad).deliver, 1000);
    const changed = ownerEventTries("alert-change", event!.event_id) as { said: string[] };
    expect(changed.said).toStrictEqual([expect.stringMatching(/never change/)]);
  });

  it("DSOR-EVT-01a: M4: a try's time is the database's, whatever the owner gives", async () => {
    await flush();
    const bad = await drafted();
    const stamped = ownerEventTries("try-stamp", (await eventsOf(bad))[0]!.event_id) as {
      said: string[];
    };
    expect(stamped.said).toStrictEqual([`done, stored in ${new Date().getUTCFullYear()}`]);
  });
});

// Found by step 40c's review, G2 and G3: no test needed a try to be refused for an event already
//   sent, or for another company. dsor_runtime meets the second rule through its company's lock
//   too; the owner, who passes that lock, meets only the database's own check.
describe("step 40c's review, G2 and G3: a try is only for an unsent event of its own company", () => {
  it("DSOR-EVT-01a: G2: a try for an event already sent is refused", async () => {
    await flush();
    const good = await drafted();
    await flush();
    const [event] = await eventsOf(good);
    expect(event!.sent).toBe(true);
    await expect(writeTries(event!.event_id, 1)).rejects.toThrow(
      /a try is written only for an unsent event of its own company/,
    );
  });

  it("DSOR-EVT-01a: G3: the owner's try of org_456's event, written for org_789, is refused", async () => {
    await flush();
    const bad = await drafted();
    const elsewhere = ownerEventTries("try-elsewhere", (await eventsOf(bad))[0]!.event_id) as {
      said: string[];
    };
    expect(elsewhere.said).toStrictEqual([
      expect.stringMatching(/a try is written only for an unsent event of its own company/),
    ]);
  });
});
