// Step 40: the sender and the receiver, in memory. The sender delivers a company's unsent events,
// oldest first, to that company's channel, and marks each one sent; a delivery that fails stops the
// company's run, and the rest wait for the next. A sender that dies after a delivery delivers that
// event again, and the receiver keeps the first copy of each event (DSOR-EVT-01a, DSOR-EVT-01d;
// step 40's README, claims C6 and C7, decisions D8 to D10).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkChannels, fileChannel, readChannels } from "../src/channels.ts";
import { buildEvent, type DomainEvent } from "../src/events.ts";
import { checkClassifications } from "../src/labels.ts";
import { memoryOutbox, type MemoryOutbox, type Outbox } from "../src/outbox.ts";
import { firstOfEach, readChannel } from "../src/receiver.ts";
import { sendEach } from "../src/sender.ts";
import { shippedLabels } from "./helpers.ts";

const KINDS = checkClassifications(shippedLabels).kinds;
const dir = mkdtempSync(join(tmpdir(), "dsor-40-channels-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A payment event of this company, about this payment. */
function about(tenant: string, id: string, type: DomainEvent["type"] = "payment.created") {
  const data = {
    tenant_id: tenant,
    id,
    invoice_id: "INV-1008",
    vendor_id: "VENDOR-44",
    amount: { value: "31400.00", currency: "USD" },
    status: type === "payment.created" ? "draft" : "paid",
    version: type === "payment.created" ? 1 : 2,
  };
  const resource = `dsor://${tenant}/payment/${id}`;
  const correlation = { request_id: `req_${id}`, principal_id: "user_123" };
  return buildEvent({ type, tenant, resource, kind: "Payment", data, correlation }, KINDS);
}

/** An outbox with PAY-901 drafted and paid, and PAY-902 drafted, in org_456; PAY-7 in org_789. */
async function filled(): Promise<MemoryOutbox> {
  const outbox = memoryOutbox();
  await outbox.add("org_456", about("org_456", "PAY-901"));
  await outbox.add("org_456", about("org_456", "PAY-901", "payment.executed"));
  await outbox.add("org_456", about("org_456", "PAY-902"));
  await outbox.add("org_789", about("org_789", "PAY-7"));
  return outbox;
}

/** A receiver that keeps what it is given. */
function keeper(): { got: DomainEvent[]; deliver: (event: DomainEvent) => Promise<void> } {
  const got: DomainEvent[] = [];
  return { got, deliver: async (event) => void got.push(event) };
}

describe("C6: the sender", () => {
  it("DSOR-EVT-01a: org_456's three events go to its channel oldest first, each is marked sent, and the next run sends nothing", async () => {
    const outbox = await filled();
    const { got, deliver } = keeper();
    const first = await outbox.send("org_456", deliver);
    expect(got.map((e) => [e.resource.split("/").at(-1), e.ordering_key])).toStrictEqual([
      ["PAY-901", 1],
      ["PAY-901", 2],
      ["PAY-902", 1],
    ]);
    expect(first).toStrictEqual({ sent: got.map((e) => e.event_id) });
    expect((await outbox.events("org_456")).every((row) => row.sent)).toBe(true);
    expect(await outbox.send("org_456", deliver)).toStrictEqual({ sent: [] });
    expect(got).toHaveLength(3);
  });

  it("DSOR-EVT-01d: org_456's run delivers none of org_789's events, and org_789's none of org_456's", async () => {
    const outbox = await filled();
    const in456 = keeper();
    const in789 = keeper();
    await outbox.send("org_456", in456.deliver);
    await outbox.send("org_789", in789.deliver);
    expect(in456.got.every((e) => e.tenant === "org_456")).toBe(true);
    expect(in789.got.map((e) => e.resource)).toStrictEqual(["dsor://org_789/payment/PAY-7"]);
  });

  it("DSOR-EVT-01a: the receiver fails on PAY-901's payment.executed: the run stops there, PAY-902 is not delivered before it, and the next run starts again from it", async () => {
    const outbox = await filled();
    const { got, deliver } = keeper();
    let down = true;
    const flaky = async (event: DomainEvent) => {
      if (down && event.type === "payment.executed") throw new Error("the receiver is down");
      await deliver(event);
    };
    const first = await outbox.send("org_456", flaky);
    expect(first).toStrictEqual({
      sent: [got[0]!.event_id],
      failed: { event_id: expect.any(String), why: "the receiver is down" },
    });
    expect(got.map((e) => e.type)).toStrictEqual(["payment.created"]);
    down = false;
    await outbox.send("org_456", flaky);
    expect(got.map((e) => [e.resource.split("/").at(-1), e.type])).toStrictEqual([
      ["PAY-901", "payment.created"],
      ["PAY-901", "payment.executed"],
      ["PAY-902", "payment.created"],
    ]);
  });

  it("DSOR-EVT-01a: a run takes at most its limit, oldest first, and the next run takes the rest", async () => {
    const outbox = await filled();
    const { got, deliver } = keeper();
    expect((await outbox.send("org_456", deliver, 2)).sent).toHaveLength(2);
    expect((await outbox.send("org_456", deliver, 2)).sent).toHaveLength(1);
    expect(got.map((e) => e.ordering_key)).toStrictEqual([1, 2, 1]);
  });
});

// Step 40's review, L5: what the memory sender and the script did with no test to say so.
describe("the review, L5: the sender's lock, its copies, and one company's failure", () => {
  it("DSOR-EVT-01a: L5: two runs of org_456's sender at once: the second finds the first at work and sends nothing, and org_789's run is not held", async () => {
    const outbox = await filled();
    let open!: () => void;
    const gate = new Promise<void>((done) => (open = done));
    const first = outbox.send("org_456", async () => {
      await gate;
    });
    const second = await outbox.send("org_456", async () => {});
    const theirs = await outbox.send("org_789", async () => {});
    open();
    expect(second).toStrictEqual({ sent: [], busy: true });
    expect(theirs.sent).toHaveLength(1);
    expect((await first).sent).toHaveLength(3);
  });

  it("DSOR-EVT-01a: L5: a receiver that changes the event it is given changes nothing in the outbox", async () => {
    const outbox = await filled();
    await outbox.send("org_456", async (event) => {
      event.resource = "dsor://org_456/payment/PAY-666";
      (event.data as { amount: { value: string } }).amount.value = "1.00";
    });
    const kept = (await outbox.events("org_456")).map((row) => row.event);
    expect(kept.map((e) => e.resource.split("/").at(-1))).toStrictEqual([
      "PAY-901",
      "PAY-901",
      "PAY-902",
    ]);
    expect(kept.map((e) => (e.data as { amount: { value: string } }).amount.value)).toStrictEqual([
      "31400.00",
      "31400.00",
      "31400.00",
    ]);
  });

  it("DSOR-EVT-01a: L5: org_456's run throws: org_789's events are still sent, each company says what it did, and the run ends 1", async () => {
    const outbox = await filled();
    const broken: Outbox = {
      ...outbox,
      send: async (tenant, deliver, limit) => {
        if (tenant === "org_456") {
          throw Object.assign(new Error("lost the connection to postgres://dsor_runtime:pw@db"), {
            code: "57P01",
          });
        }
        return outbox.send(tenant, deliver, limit);
      },
    };
    const out = mkdtempSync(join(tmpdir(), "dsor-40-each-"));
    try {
      const lines: string[] = [];
      const channels = new Map([
        ["org_456", "org_456.jsonl"],
        ["org_789", "org_789.jsonl"],
      ]);
      expect(await sendEach(broken, channels, out, (line) => lines.push(line))).toBe(1);
      expect(lines).toStrictEqual([
        "org_456: not sent: the outbox could not be read (57P01)",
        "org_789: sent 1 event",
      ]);
      expect(readChannel(join(out, "org_789.jsonl")).map((e) => e.resource)).toStrictEqual([
        "dsor://org_789/payment/PAY-7",
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("DSOR-EVT-01a: L5: every company sends all it took: the run ends 0", async () => {
    const outbox = await filled();
    const out = mkdtempSync(join(tmpdir(), "dsor-40-each-"));
    try {
      const lines: string[] = [];
      const channels = new Map([
        ["org_456", "org_456.jsonl"],
        ["org_789", "org_789.jsonl"],
      ]);
      expect(await sendEach(outbox, channels, out, (line) => lines.push(line))).toBe(0);
      expect(lines).toStrictEqual(["org_456: sent 3 events", "org_789: sent 1 event"]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("C7: at least once, and the receiver's dedupe", () => {
  it("DSOR-EVT-01a: the sender dies after PAY-901's first event reached the receiver and before it was marked sent: the next run delivers it again, and the receiver keeps one copy", async () => {
    const outbox = await filled();
    const { got, deliver } = keeper();
    // Delivered, then the sender stops before it notes the delivery, as a killed process does.
    const dying = async (event: DomainEvent) => {
      await deliver(event);
      throw new Error("killed after the delivery");
    };
    await outbox.send("org_456", dying);
    await outbox.send("org_456", deliver);
    expect(got).toHaveLength(4);
    const { kept, dropped } = firstOfEach(got);
    expect(kept).toHaveLength(3);
    expect(dropped).toStrictEqual([got[0]!.event_id]);
  });

  it("DSOR-EVT-01a: the receiver keeps the first copy of each event id, in the order it came", async () => {
    const a = about("org_456", "PAY-901");
    const b = about("org_456", "PAY-902");
    const events = [a, b, a, a].map((e, i) => ({ ...e, ordering_key: 1, at: `x${i}` }));
    const { kept, dropped } = firstOfEach(events as DomainEvent[]);
    expect(kept.map((e) => e.event_id)).toStrictEqual([a.event_id, b.event_id]);
    expect(kept[0]!.at).toBe("x0");
    expect(dropped).toStrictEqual([a.event_id, a.event_id]);
  });
});

describe("D9: channels.json, one channel per company", () => {
  const source = (data: unknown) => ({ file: "channels.json", text: JSON.stringify(data) });

  it("DSOR-EVT-01d: the shipped file gives org_456 and org_789 a channel each, and they differ", () => {
    const { channels, problems } = checkChannels(readChannels());
    expect(problems).toStrictEqual([]);
    expect(Object.fromEntries(channels)).toStrictEqual({
      org_456: "org_456.jsonl",
      org_789: "org_789.jsonl",
    });
  });

  // Changed by step 40's review, M4: a channel is named after its company, so two can never share
  //   one, on a disk that tells a.jsonl from A.jsonl or on one that does not (decision D12).
  it("DSOR-EVT-01d: two companies that share a channel are refused", () => {
    const { channels, problems } = checkChannels(
      source({ org_456: "all.jsonl", org_789: "all.jsonl" }),
    );
    expect(problems).toStrictEqual([
      "channels.json: org_456's channel must be org_456.jsonl",
      "channels.json: org_789's channel must be org_789.jsonl",
    ]);
    expect(channels.size).toBe(0);
  });

  it("DSOR-EVT-01d: M4: a.jsonl and A.jsonl are refused, since a disk that does not tell them apart would give two companies one file", () => {
    const { problems } = checkChannels(source({ org_456: "a.jsonl", org_789: "A.jsonl" }));
    expect(problems).toStrictEqual([
      "channels.json: org_456's channel must be org_456.jsonl",
      "channels.json: org_789's channel must be org_789.jsonl",
    ]);
  });

  it("DSOR-EVT-01d: M4: org_456 given org_789's channel is refused, even when org_789 has none", () => {
    const { problems } = checkChannels(source({ org_456: "org_789.jsonl" }));
    expect(problems).toStrictEqual(["channels.json: org_456's channel must be org_456.jsonl"]);
  });

  it.each([
    ["a company that is no tenant id", { acme: "acme.jsonl" }, "acme is not a tenant id"],
    ["a channel outside the events folder", { org_456: "../org_456.jsonl" }, "org_456's channel"],
    ["a channel that is not a .jsonl file", { org_456: "org_456.txt" }, "org_456's channel"],
    ["a channel in capitals", { org_456: "ORG_456.jsonl" }, "org_456's channel"],
    ["a file that is not an object", ["org_456.jsonl"], "must be an object"],
  ])("DSOR-EVT-01d: %s is refused", (_, data, said) => {
    const { problems } = checkChannels(source(data));
    expect(problems.join("; ")).toContain(said);
  });

  it("DSOR-EVT-01d: a file channel appends each event as one line, and the receiver reads them back", async () => {
    const deliver = fileChannel(dir, "org_456.jsonl");
    const a = { ...about("org_456", "PAY-901"), ordering_key: 1 };
    await deliver(a);
    await deliver(a);
    const lines = readFileSync(join(dir, "org_456.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(readChannel(join(dir, "org_456.jsonl"))).toStrictEqual([a, a]);
    expect(readChannel(join(dir, "none.jsonl"))).toStrictEqual([]);
  });
});
