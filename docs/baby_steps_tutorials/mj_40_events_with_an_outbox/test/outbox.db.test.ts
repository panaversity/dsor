// Step 40 on the database: an event commits in the transaction that keeps its change, or neither
// does; dsor_runtime may add an event and mark it sent once, and nothing else; each company sees
// its own events only; and the sender delivers them oldest first, one sender at a time, at least
// once, as a real SIGKILL shows (DSOR-EVT-01a, DSOR-EVT-01b, DSOR-EVT-01d, DSOR-EXE-04a; step 40's
// README, claims C1, C2, C4, C6, and C7). The tests' own invoice, INV-9001, 500.00 USD of VENDOR-44.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeBank } from "../src/bank.ts";
import type { Answer } from "../src/envelope.ts";
import type { DomainEvent } from "../src/events.ts";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import { firstOfEach, readChannel } from "../src/receiver.ts";
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
import { keyed, SUPERVISOR } from "./helpers.ts";

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

/** user_123 drafts a payment of INV-9001, with this request id. */
function draft(request: string): Promise<Answer> {
  return call(registry, log, { ...keyed(SUPERVISOR), request_id: request }, "payment.create", {
    invoice: INV_9001,
    expected_version: 1,
  });
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
      // An unsent event of org_456, so the run has one to send.
      const request = requestId("c6-script");
      await draft(request);
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
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
  );
});
