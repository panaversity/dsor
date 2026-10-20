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
import { memoryOutbox, type MemoryOutbox } from "../src/outbox.ts";
import { firstOfEach, readChannel } from "../src/receiver.ts";
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

  it("DSOR-EVT-01d: two companies that share a channel are refused", () => {
    const { problems } = checkChannels(source({ org_456: "all.jsonl", org_789: "all.jsonl" }));
    expect(problems).toStrictEqual([
      "channels.json: org_456 and org_789 share the channel all.jsonl; each company needs its own",
    ]);
  });

  it.each([
    ["a company that is no tenant id", { acme: "acme.jsonl" }, "acme is not a tenant id"],
    ["a channel outside the events folder", { org_456: "../org_456.jsonl" }, "org_456's channel"],
    ["a channel that is not a .jsonl file", { org_456: "org_456.txt" }, "org_456's channel"],
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
