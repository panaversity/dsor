// Step 40 on the database: an event commits in the transaction that keeps its change, or neither
// does; dsor_runtime may add an event and mark it sent once, and nothing else; each company sees
// its own events only; and the sender delivers them oldest first, one sender at a time, at least
// once, as a real SIGKILL shows (DSOR-EVT-01a, DSOR-EVT-01b, DSOR-EVT-01d, DSOR-EXE-04a; step 40's
// README, claims C1, C2, C4, C6, and C7). The tests' own invoice, INV-9001, 500.00 USD of VENDOR-44.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import { buildEvent, type DomainEvent } from "../src/events.ts";
import { checkClassifications } from "../src/labels.ts";
import { handlersFor } from "../src/operations.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { firstOfEach, readChannel } from "../src/receiver.ts";
import type { Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { outboxIn } from "../src/outbox.ts";
import { createDbOutbox } from "../src/sender.ts";
import {
  dbRegistry,
  newPool,
  ownerAttempts,
  ownerInvoices,
  ownerOutbox,
  ownerRecords,
  requestId,
  tryThenRollBack,
} from "./db.ts";
import { keyed, shippedLabels, SUPERVISOR, USER_700 } from "./helpers.ts";

const pool = newPool();
const log = createDbLog(pool);
const bank = createFakeBank();
const none = undefined;
const registry = dbRegistry(
  pool,
  none,
  none,
  none,
  none,
  none,
  none,
  none,
  new Map([["fake-bank", { bank, waitMs: 50 }]]),
);
const outbox = createDbOutbox(pool);
const INV_9001 = "dsor://org_456/invoice/INV-9001";
// dsor-scheduler, DSoR's own login for scheduled work (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const CRASH = fileURLToPath(new URL("crash-at-the-record.ts", import.meta.url));
const DIE = fileURLToPath(new URL("send-and-die.ts", import.meta.url));
const SEND = fileURLToPath(new URL("../src/send-events.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "dsor-40-db-"));

beforeAll(() => {
  ownerInvoices("add");
});
afterAll(async () => {
  ownerOutbox("mend");
  ownerRecords("mend");
  ownerAttempts();
  ownerInvoices("remove");
  rmSync(dir, { recursive: true, force: true });
  await pool.end();
});

/** org_456's events written by the call with this request id, as dsor_runtime reads them. */
async function eventsOfRequest(request: string): Promise<Record<string, unknown>[]> {
  const { rows } = await tryThenRollBack(
    pool,
    `SELECT event_id, type, resource, ordering_key, event, sent_at FROM dsor.outbox
      WHERE event->'correlation'->>'request_id' = $1 ORDER BY written`,
    "org_456",
    [request],
  );
  return rows;
}

/** How many payments of INV-9001 org_456 keeps. */
async function draftsOf9001(): Promise<number> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT count(*)::int AS n FROM app.payments WHERE invoice_id = 'INV-9001'",
    "org_456",
  );
  return rows[0]!["n"] as number;
}

/** The type and number of each of org_456's events about this resource, as dsor_runtime reads them. */
async function storyOf(resource: string): Promise<[string, number][]> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT type, ordering_key FROM dsor.outbox WHERE resource = $1 ORDER BY written",
    "org_456",
    [resource],
  );
  return rows.map((row) => [row["type"] as string, row["ordering_key"] as number]);
}

/** The status org_456 keeps for this payment. */
async function statusOf(id: string): Promise<unknown> {
  const { rows } = await tryThenRollBack(
    pool,
    "SELECT status FROM app.payments WHERE id = $1",
    "org_456",
    [id],
  );
  return rows[0]?.["status"];
}

/** user_123 drafts a payment of INV-9001, with this request id, through this registry. */
function draft(request: string, through = registry): Promise<Answer> {
  return call(through, log, { ...keyed(SUPERVISOR), request_id: request }, "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
}

/** The payment an answer drafted: its address. */
function paymentOf(answer: Answer): string {
  return `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
}

describe("C1, C2, and C5: the events of a draft and a send, on the database", () => {
  it("DSOR-EVT-01a: on the database, user_123 drafts INV-9001: one payment.created in dsor.outbox, numbered 1, its columns equal to its JSON, not yet sent", async () => {
    const request = requestId("c1-draft");
    const drafted = await draft(request);
    expect(drafted).toMatchObject({ outcome: "COMMITTED" });
    const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
    const rows = await eventsOfRequest(request);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ type: "payment.created", resource: payment, ordering_key: 1 });
    expect(row!["sent_at"]).toBeNull();
    const event = row!["event"] as DomainEvent;
    expect([event.event_id, event.type, event.resource, event.ordering_key]).toStrictEqual([
      row!["event_id"],
      row!["type"],
      row!["resource"],
      row!["ordering_key"],
    ]);
    expect(event).toMatchObject({
      tenant: "org_456",
      origin: "dsor",
      classification: "confidential",
      data: { id: payment.split("/").at(-1), status: "draft", amount: { value: "500.00" } },
      correlation: { request_id: request, principal_id: "user_123", tenant_id: "org_456" },
    });
  });

  it("DSOR-EVT-01a: on the database, user_123 sends the draft: payment.executed, numbered 2, in the transaction that marks it paid", async () => {
    const drafted = await draft(requestId("c2-draft"));
    const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
    const request = requestId("c2-send");
    const sent = await call(
      registry,
      log,
      { ...keyed(SUPERVISOR), request_id: request },
      "payment.execute",
      { invoice: INV_9001, payment, expected_version: 1 },
    );
    expect(sent).toMatchObject({ outcome: "COMMITTED", data: { status: "paid" } });
    expect(await eventsOfRequest(request)).toMatchObject([
      { type: "payment.executed", resource: payment, ordering_key: 2 },
    ]);
  });
});

describe("C4: the event and its change commit together, or neither does", () => {
  it(
    "DSOR-EXE-04a: killed with SIGKILL at the COMMIT that keeps the draft and its record: no draft, and no event",
    { timeout: 120_000 },
    async () => {
      const before = await draftsOf9001();
      const { idempotency_key: key } = keyed(SUPERVISOR);
      const request = requestId("c4-crash");
      const child = spawnSync(process.execPath, [CRASH, key, request], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      expect(await draftsOf9001()).toBe(before);
      expect(await eventsOfRequest(request)).toStrictEqual([]);
    },
  );

  it("DSOR-EVT-01a: the database refuses the draft's decision record: EVIDENCE_STORE_UNAVAILABLE, no draft, and no event", async () => {
    const before = await draftsOf9001();
    const request = requestId("c4-record");
    ownerRecords("refuse", "payment.create@1");
    let answer: Answer;
    try {
      answer = await draft(request);
    } finally {
      ownerRecords("mend");
    }
    expect(answer).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(await draftsOf9001()).toBe(before);
    expect(await eventsOfRequest(request)).toStrictEqual([]);
  });

  it("DSOR-EVT-01a: the database refuses the event: the draft is not kept either, and the caller does not hear COMMITTED", async () => {
    const before = await draftsOf9001();
    const request = requestId("c4-event");
    ownerOutbox("refuse");
    let answer: Answer;
    try {
      answer = await draft(request);
    } finally {
      ownerOutbox("mend");
    }
    expect(answer).not.toMatchObject({ outcome: "COMMITTED" });
    expect(await draftsOf9001()).toBe(before);
    expect(await eventsOfRequest(request)).toStrictEqual([]);
  });
});

describe("D2: what dsor_runtime may do to an event", () => {
  /** One statement as dsor_runtime inside org_456, rolled back: its error, or "allowed". */
  async function tries(sql: string, values: unknown[] = []): Promise<string> {
    try {
      await tryThenRollBack(pool, sql, "org_456", values);
      return "allowed";
    } catch (error) {
      return (error as Error).message;
    }
  }

  it.each([
    ["change an event's JSON", "UPDATE dsor.outbox SET event = '{}'::jsonb", /permission denied/],
    [
      "change an event's type",
      "UPDATE dsor.outbox SET type = 'payment.voided'",
      /permission denied/,
    ],
    ["remove an event", "DELETE FROM dsor.outbox", /permission denied/],
  ])("DSOR-EVT-01a: dsor_runtime cannot %s", async (_, sql, said) => {
    await draft(requestId("d2"));
    expect(await tries(sql)).toMatch(said);
  });

  it("DSOR-EVT-01a: an event is marked sent once: a second mark is refused", async () => {
    const request = requestId("d2-twice");
    await draft(request);
    const [row] = await eventsOfRequest(request);
    // Mark it, then mark it again, in one transaction that is rolled back.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await client.query("UPDATE dsor.outbox SET sent_at = now() WHERE event_id = $1", [
        row!["event_id"],
      ]);
      await expect(
        client.query("UPDATE dsor.outbox SET sent_at = now() WHERE event_id = $1", [
          row!["event_id"],
        ]),
      ).rejects.toThrow(/sent once/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("DSOR-EVT-01b: an event whose columns do not match its JSON is refused", async () => {
    const said = await tries(
      `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event)
       VALUES ('evt_x', 'org_456', 'payment.created', 'dsor://org_456/payment/PAY-1', 1,
               '{"event_id": "evt_y", "tenant": "org_456", "type": "payment.created",
                 "resource": "dsor://org_456/payment/PAY-1", "ordering_key": 1}'::jsonb)`,
    );
    expect(said).toMatch(/violates check constraint/);
  });

  it("DSOR-EVT-01d: inside org_456, dsor_runtime cannot write an event of org_789", async () => {
    const said = await tries(
      `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event)
       VALUES ('evt_z', 'org_789', 'payment.created', 'dsor://org_789/payment/PAY-1', 1,
               '{"event_id": "evt_z", "tenant": "org_789", "type": "payment.created",
                 "resource": "dsor://org_789/payment/PAY-1", "ordering_key": 1}'::jsonb)`,
    );
    expect(said).toMatch(/row-level security/);
  });

  it("DSOR-EVT-01d: inside org_789, none of org_456's events can be seen", async () => {
    const request = requestId("d2-rls");
    await draft(request);
    const { rows } = await tryThenRollBack(
      pool,
      "SELECT event_id FROM dsor.outbox WHERE event->'correlation'->>'request_id' = $1",
      "org_789",
      [request],
    );
    expect(rows).toStrictEqual([]);
  });
});

describe("the review, L4: what else the database holds true of an event", () => {
  /** An insert of this event as dsor_runtime inside org_456, rolled back: its error, or "allowed". */
  async function adds(event: Record<string, unknown>): Promise<string> {
    try {
      await tryThenRollBack(
        pool,
        `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event)
         VALUES ($1, 'org_456', $2, $3, $4, $5)`,
        "org_456",
        [event["event_id"], event["type"], event["resource"], event["ordering_key"], event],
      );
      return "allowed";
    } catch (error) {
      return (error as Error).message;
    }
  }

  /** org_456's event of this draft, as a new event at number 99, which its resource has not used. */
  async function fresh(request: string): Promise<Record<string, unknown>> {
    await draft(request);
    const [row] = await eventsOfRequest(request);
    return {
      ...(row!["event"] as Record<string, unknown>),
      event_id: `evt_${randomUUID()}`,
      ordering_key: 99,
    };
  }

  it("DSOR-EVT-01d: L4: an event of org_456 about org_789's payment is refused", async () => {
    const event = await fresh(requestId("l4-resource"));
    const said = await adds({ ...event, resource: "dsor://org_789/payment/PAY-901" });
    expect(said).toMatch(/outbox_of_its_company/);
  });

  it("DSOR-EVT-01d: L4: an event of org_456 whose correlation names org_789 is refused", async () => {
    const event = await fresh(requestId("l4-correlation"));
    const correlation = { ...(event["correlation"] as object), tenant_id: "org_789" };
    expect(await adds({ ...event, correlation })).toMatch(/outbox_of_its_company/);
  });

  it("DSOR-EVT-01c: L4: an event labelled restricted is refused", async () => {
    const event = await fresh(requestId("l4-restricted"));
    expect(await adds({ ...event, classification: "restricted" })).toMatch(
      /outbox_never_restricted/,
    );
  });

  // Changed in step 40b: a payment has one payment.created, so the copy is refused, but only by
  //   step 40b's once-each index, which PostgreSQL checks after a row's CHECK constraints. So
  //   migration 037's checks let it through (step 40b's README, decision D4).
  it("DSOR-EVT-01a: L4: the same event, as written, passes migration 037's checks: only step 40b's once-each refuses the copy", async () => {
    expect(await adds(await fresh(requestId("l4-allowed")))).toMatch(/outbox_once_each/);
  });

  it("DSOR-EVT-01a: L4: a mark is the database's clock when it is written, never the time the sender gives", async () => {
    const request = requestId("l4-clock");
    await draft(request);
    const [row] = await eventsOfRequest(request);
    const { rows } = await tryThenRollBack(
      pool,
      `UPDATE dsor.outbox SET sent_at = '2000-01-01T00:00:00Z' WHERE event_id = $1
       RETURNING sent_at, now() AS began`,
      "org_456",
      [row!["event_id"]],
    );
    const { sent_at, began } = rows[0] as { sent_at: Date; began: Date };
    expect(sent_at.getTime()).toBeGreaterThanOrEqual(began.getTime());
  });

  it("DSOR-EVT-01a: L4: a mark with no time is refused", async () => {
    const request = requestId("l4-null");
    await draft(request);
    const [row] = await eventsOfRequest(request);
    await expect(
      tryThenRollBack(
        pool,
        "UPDATE dsor.outbox SET sent_at = NULL WHERE event_id = $1",
        "org_456",
        [row!["event_id"]],
      ),
    ).rejects.toThrow(/marked with the time it was sent/);
  });

  it.each(["event", "written_at"])(
    "DSOR-EVT-01a: L4: the owner, who holds every privilege, cannot change an event's %s: the guard refuses it",
    async (column) => {
      const request = requestId("l4-owner");
      await draft(request);
      const [row] = await eventsOfRequest(request);
      expect(ownerOutbox("change", row!["event_id"] as string, column)).toStrictEqual({
        said: "an event is never changed",
      });
    },
  );
});

describe("C6 and C7: the sender, on the database", () => {
  it("DSOR-EVT-01a: the sender delivers org_456's unsent events, oldest first, marks them sent, and the next run delivers none of them again", async () => {
    const request = requestId("c6-send");
    await draft(request);
    const got: DomainEvent[] = [];
    const first = await outbox.send("org_456", async (event) => void got.push(event), 1000);
    expect(first.failed).toBeUndefined();
    expect(got.every((e) => e.tenant === "org_456")).toBe(true);
    const ours = got.find((e) => e.correlation.request_id === request);
    expect(ours?.type).toBe("payment.created");
    const [row] = await eventsOfRequest(request);
    expect(row!["sent_at"]).not.toBeNull();
    const again: DomainEvent[] = [];
    await outbox.send("org_456", async (event) => void again.push(event), 1000);
    expect(again.map((e) => e.event_id)).not.toContain(ours!.event_id);
  });

  it("DSOR-EVT-01a: a delivery that fails stops the run there: the event stays unsent, and the next run delivers it", async () => {
    await outbox.send("org_456", async () => {}, 1000);
    const request = requestId("c6-fail");
    await draft(request);
    const failed = await outbox.send(
      "org_456",
      async () => {
        throw new Error("the receiver is down");
      },
      1000,
    );
    expect(failed).toMatchObject({ sent: [], failed: { why: "the receiver is down" } });
    expect((await eventsOfRequest(request))[0]!["sent_at"]).toBeNull();
    const got: DomainEvent[] = [];
    await outbox.send("org_456", async (event) => void got.push(event), 1000);
    expect(got.map((e) => e.correlation.request_id)).toContain(request);
  });

  // Found by break B3: the database's sender could go on after a failure, and only the memory
  //   sender's tests failed.
  it("DSOR-EVT-01a: the first of two unsent events fails: the run stops there, and the second is neither delivered nor marked", async () => {
    await outbox.send("org_456", async () => {}, 1000);
    const first = requestId("c6-first");
    const second = requestId("c6-second");
    await draft(first);
    await draft(second);
    const got: DomainEvent[] = [];
    const run = await outbox.send(
      "org_456",
      async (event) => {
        if (event.correlation.request_id === first) throw new Error("the receiver is down");
        got.push(event);
      },
      1000,
    );
    expect(run).toMatchObject({ sent: [], failed: { why: "the receiver is down" } });
    expect(got).toStrictEqual([]);
    expect((await eventsOfRequest(second))[0]!["sent_at"]).toBeNull();
  });

  // Found by step 40's review, M2: no test said that what was delivered before the failure is
  //   marked, and only that.
  it("DSOR-EVT-01a: M2: three unsent events, and the second fails: the first is delivered and marked sent, and the second and third are neither", async () => {
    await outbox.send("org_456", async () => {}, 1000);
    const [a, b, c] = [requestId("m2-a"), requestId("m2-b"), requestId("m2-c")];
    for (const request of [a, b, c]) await draft(request);
    const got: string[] = [];
    const run = await outbox.send(
      "org_456",
      async (event) => {
        if (event.correlation.request_id === b) throw new Error("the receiver is down");
        got.push(event.correlation.request_id);
      },
      1000,
    );
    expect(got).toStrictEqual([a]);
    const [first] = await eventsOfRequest(a);
    const [second] = await eventsOfRequest(b);
    const [third] = await eventsOfRequest(c);
    expect(run).toStrictEqual({
      sent: [first!["event_id"]],
      failed: { event_id: second!["event_id"], why: "the receiver is down" },
    });
    expect(first!["sent_at"]).not.toBeNull();
    expect(second!["sent_at"]).toBeNull();
    expect(third!["sent_at"]).toBeNull();
  });

  // Found by step 40's review, L5: no test on the database said that a run takes at most its limit.
  it("DSOR-EVT-01a: L5: a run with a limit of 1 delivers the oldest unsent event only, and the next run the one after it", async () => {
    await outbox.send("org_456", async () => {}, 1000);
    const [a, b] = [requestId("l5-a"), requestId("l5-b")];
    await draft(a);
    await draft(b);
    const got: string[] = [];
    const run = await outbox.send(
      "org_456",
      async (event) => void got.push(event.correlation.request_id),
      1,
    );
    expect(got).toStrictEqual([a]);
    expect(run.sent).toHaveLength(1);
    expect((await eventsOfRequest(b))[0]!["sent_at"]).toBeNull();
    await outbox.send("org_456", async (event) => void got.push(event.correlation.request_id), 1);
    expect(got).toStrictEqual([a, b]);
  });

  it("DSOR-EVT-01a: two senders of org_456 at once: the second finds the first at work and sends nothing", async () => {
    await outbox.send("org_456", async () => {}, 1000);
    await draft(requestId("c6-two"));
    let open!: () => void;
    const gate = new Promise<void>((done) => (open = done));
    let started!: () => void;
    const working = new Promise<void>((done) => (started = done));
    const first = outbox.send(
      "org_456",
      async () => {
        started();
        await gate;
      },
      1000,
    );
    await working;
    const second = await outbox.send("org_456", async () => {}, 1000);
    open();
    expect(second).toStrictEqual({ sent: [], busy: true });
    expect((await first).sent.length).toBeGreaterThan(0);
  });

  it(
    "DSOR-EVT-01a: the sender is killed with SIGKILL after its first delivery and before it marks it sent: the next run delivers that event again, and the receiver keeps one copy",
    { timeout: 120_000 },
    async () => {
      await outbox.send("org_456", async () => {}, 1000);
      const request = requestId("c7-die");
      await draft(request);
      // The child and the script write to the same channel file, as two runs of one sender would.
      const channel = join(dir, "org_456.jsonl");
      const child = spawnSync(process.execPath, [DIE, dir], {
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(child.signal).toBe("SIGKILL");
      expect(readChannel(channel).map((e) => e.correlation.request_id)).toStrictEqual([request]);
      expect((await eventsOfRequest(request))[0]!["sent_at"]).toBeNull();
      const again = spawnSync(process.execPath, [SEND], {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, DSOR_EVENTS_DIR: dir },
      });
      expect(again.status).toBe(0);
      const heard = readChannel(channel);
      const ours = heard.filter((e) => e.correlation.request_id === request);
      expect(ours).toHaveLength(2);
      expect(firstOfEach(heard).dropped).toStrictEqual([ours[0]!.event_id]);
    },
  );

  it(
    "DSOR-EVT-01d: pnpm send-events writes each company's events to its own channel, and says how many it sent",
    { timeout: 60_000 },
    async () => {
      // An unsent event of each company, so each channel has one to hold. Found by step 40's
      //   review, M3: with none of org_789's, its channel's check passed on an empty file.
      const request = requestId("c6-script");
      await draft(request);
      const theirs = requestId("c6-script-789");
      const drafted = await call(
        registry,
        log,
        { ...keyed(USER_700), request_id: theirs },
        "payment.create",
        { invoice: "dsor://org_789/invoice/INV-2002", expected_version: 1 },
      );
      expect(drafted).toMatchObject({ outcome: "COMMITTED" });
      const out = mkdtempSync(join(tmpdir(), "dsor-40-send-"));
      try {
        const run = spawnSync(process.execPath, [SEND], {
          encoding: "utf8",
          timeout: 60_000,
          env: { ...process.env, DSOR_EVENTS_DIR: out },
        });
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/^org_456: sent \d+ events?$/m);
        expect(run.stdout).toMatch(/^org_789: sent \d+ events?$/m);
        for (const company of ["org_456", "org_789"]) {
          const events = readChannel(join(out, `${company}.jsonl`));
          expect(events.every((e) => e.tenant === company)).toBe(true);
        }
        const in456 = readChannel(join(out, "org_456.jsonl"));
        expect(in456.map((e) => e.correlation.request_id)).toContain(request);
        expect(readFileSync(join(out, "org_456.jsonl"), "utf8")).not.toContain('"org_789"');
        const in789 = readChannel(join(out, "org_789.jsonl"));
        expect(in789.map((e) => e.correlation.request_id)).toContain(theirs);
        expect(readFileSync(join(out, "org_789.jsonl"), "utf8")).not.toContain('"org_456"');
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
  );
});

// Step 40's review, on the database (step 40's README, "What the review found").
describe("the review, on the database", () => {
  it("DSOR-EVT-01a: H1: on the database, the code drafts a payment and returns one drafted before: payment.created is about the draft this call wrote, and the earlier one gets no second", async () => {
    const earlier = paymentOf(await draft(requestId("h1-earlier")));
    const shipped = handlersFor();
    const pointing: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        return company.payments.get(earlier.split("/").at(-1)!);
      },
    };
    const request = requestId("h1-pointing");
    const answer = await draft(request, dbRegistry(pool, none, pointing));
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect(paymentOf(answer)).toBe(earlier);
    const [event, ...more] = await eventsOfRequest(request);
    expect(more).toStrictEqual([]);
    expect(event).toMatchObject({ type: "payment.created", ordering_key: 1 });
    const written = event!["resource"] as string;
    expect(written).not.toBe(earlier);
    expect(await statusOf(written.split("/").at(-1)!)).toBe("draft");
    expect(await storyOf(earlier)).toStrictEqual([["payment.created", 1]]);
  });

  // Found while fixing H1: the first build's event read the code's answer, so an answer that was
  //   no payment rolled the draft back. Such an answer fails as it is shaped for the caller,
  //   INTERNAL_ERROR, after the work is kept with its record. The event now goes with that work.
  it("DSOR-EVT-01a: on the database, the code drafts and returns no payment: the caller hears INTERNAL_ERROR, and the draft it wrote is kept with its payment.created, which follows the change, never the answer", async () => {
    const shipped = handlersFor();
    const silent: Record<string, Handler> = {
      ...shipped,
      "payment.create": async (input, company) => {
        await shipped["payment.create"]!(input, company);
        return { done: true };
      },
    };
    const before = await draftsOf9001();
    const request = requestId("h1-silent");
    const answer = await draft(request, dbRegistry(pool, none, silent));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(await draftsOf9001()).toBe(before + 1);
    const [event, ...more] = await eventsOfRequest(request);
    expect(more).toStrictEqual([]);
    expect(event).toMatchObject({ type: "payment.created", ordering_key: 1 });
    expect(await statusOf((event!["resource"] as string).split("/").at(-1)!)).toBe("draft");
  });

  it("DSOR-EVT-01a: M1: on the database, dsor.outbox refuses the payment.executed of a send the bank took: OUTCOME_UNKNOWN, and the payment stays a draft with no such event; dsor-scheduler reconciles it: paid, and payment.executed, numbered 2", async () => {
    // A fresh INV-9001, unpaid: the send of C2 paid the first.
    ownerAttempts();
    ownerInvoices("add");
    const payment = paymentOf(await draft(requestId("m1-draft")));
    const id = payment.split("/").at(-1)!;
    const sends = bank.transfers().length;
    ownerOutbox("refuse");
    let unknown: Answer;
    try {
      unknown = await call(registry, log, keyed(SUPERVISOR), "payment.execute", {
        invoice: INV_9001,
        payment,
        expected_version: 1,
      });
    } finally {
      ownerOutbox("mend");
    }
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(bank.transfers()).toHaveLength(sends + 1);
    expect(await statusOf(id)).toBe("draft");
    expect(await storyOf(payment)).toStrictEqual([["payment.created", 1]]);
    const settled = await call(registry, log, keyed(SCHEDULER), "payment.reconcile", {
      proposal: (unknown as { proposal: string }).proposal,
    });
    expect(settled).toMatchObject({ data: { state: "COMMITTED" } });
    expect(await statusOf(id)).toBe("paid");
    expect(await storyOf(payment)).toStrictEqual([
      ["payment.created", 1],
      ["payment.executed", 2],
    ]);
  });
});

describe("the review, L2: two events of one resource at once", () => {
  // Changed in step 40b: about a proposal, not a payment. The database now refuses an event about
  //   a payment that was never drafted, and a payment's second payment.created (step 40b's README,
  //   decision D4); proposal.approved is not checked (claim C6).
  /** A proposal.approved event of org_456 about this proposal, which no call approved. */
  function about(id: string): ReturnType<typeof buildEvent> {
    const kinds = checkClassifications(shippedLabels).kinds;
    const resource = `dsor://org_456/proposal/${id}`;
    const data = { tenant_id: "org_456", id, proposal: resource, state: "APPROVED" };
    const correlation = { request_id: requestId("l2"), principal_id: "cfo_100" };
    return buildEvent(
      {
        type: "proposal.approved",
        tenant: "org_456",
        resource,
        kind: "Approval",
        data,
        correlation,
      },
      kinds,
    );
  }

  it("DSOR-EVT-01a: L2: two transactions add an event about one proposal at once: the second waits for the first, and they are numbered 1 and 2", async () => {
    const id = `prop_${randomUUID()}`;
    const two = newPool();
    const [first, second] = [await two.connect(), await two.connect()];
    try {
      for (const client of [first, second]) {
        await client.query("BEGIN");
        await client.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      }
      const one = await outboxIn(first).add("org_456", about(id));
      // The second add starts while the first is not committed, and must wait for it.
      const waiting = outboxIn(second).add("org_456", about(id));
      await new Promise((done) => setTimeout(done, 300));
      await first.query("COMMIT");
      const other = await waiting;
      await second.query("COMMIT");
      expect([one.ordering_key, other.ordering_key]).toStrictEqual([1, 2]);
    } finally {
      for (const client of [first, second]) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
      await two.end();
    }
    expect(await storyOf(`dsor://org_456/proposal/${id}`)).toStrictEqual([
      ["proposal.approved", 1],
      ["proposal.approved", 2],
    ]);
  });

  it("DSOR-EVT-01a: L2: an event with a number its resource has used is refused by the unique key", async () => {
    const request = requestId("l2-unique");
    await draft(request);
    const [row] = await eventsOfRequest(request);
    const copy = { ...(row!["event"] as DomainEvent), event_id: `evt_${randomUUID()}` };
    await expect(
      tryThenRollBack(
        pool,
        `INSERT INTO dsor.outbox (event_id, tenant_id, type, resource, ordering_key, event)
         VALUES ($1, 'org_456', $2, $3, $4, $5)`,
        "org_456",
        [copy.event_id, copy.type, copy.resource, copy.ordering_key, copy],
      ),
    ).rejects.toThrow(/outbox_one_number/);
  });
});
