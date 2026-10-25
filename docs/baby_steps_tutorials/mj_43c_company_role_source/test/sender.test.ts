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
import { memoryOutbox, reasonOf, type MemoryOutbox, type Outbox } from "../src/outbox.ts";
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

  // Changed in step 40c: a failure holds back only its payment's events, so PAY-902's
  //   payment.created is delivered in the same run (step 40c's README, decision D1).
  it("step 40c's decision D1: C1: the receiver fails on PAY-901's payment.executed: PAY-902's payment.created is delivered in the same run, and the next run delivers PAY-901's", async () => {
    const outbox = await filled();
    const { got, deliver } = keeper();
    let down = true;
    const flaky = async (event: DomainEvent) => {
      if (down && event.type === "payment.executed") throw new Error("the receiver is down");
      await deliver(event);
    };
    const first = await outbox.send("org_456", flaky);
    expect(first).toStrictEqual({
      sent: got.map((e) => e.event_id),
      failed: [
        {
          event_id: expect.any(String),
          resource: "dsor://org_456/payment/PAY-901",
          why: "the receiver is down",
        },
      ],
    });
    expect(got.map((e) => [e.resource.split("/").at(-1), e.type])).toStrictEqual([
      ["PAY-901", "payment.created"],
      ["PAY-902", "payment.created"],
    ]);
    down = false;
    await outbox.send("org_456", flaky);
    expect(got.map((e) => [e.resource.split("/").at(-1), e.type])).toStrictEqual([
      ["PAY-901", "payment.created"],
      ["PAY-902", "payment.created"],
      ["PAY-901", "payment.executed"],
    ]);
  });

  // Inside one payment the order holds. An event behind a failure of its payment
  //   is not tried (step 40c's README, claims C1 and C2).
  it("step 40c's decision D1: C2: the receiver refuses PAY-901's payment.created: its payment.executed is not tried, PAY-902's is delivered, and the next run delivers PAY-901's two in order", async () => {
    const outbox = await filled();
    const { got, deliver } = keeper();
    const tried: string[] = [];
    let down = true;
    const refusing = async (event: DomainEvent) => {
      tried.push(`${event.resource.split("/").at(-1)} ${event.type}`);
      if (down && event.resource.endsWith("/PAY-901")) throw new Error("no vendor VENDOR-31");
      await deliver(event);
    };
    const first = await outbox.send("org_456", refusing);
    expect(tried).toStrictEqual(["PAY-901 payment.created", "PAY-902 payment.created"]);
    expect(first.failed).toStrictEqual([
      {
        event_id: expect.any(String),
        resource: "dsor://org_456/payment/PAY-901",
        why: "no vendor VENDOR-31",
      },
    ]);
    expect(
      (await outbox.events("org_456")).map(({ event, sent }) => [event.type, sent]),
    ).toStrictEqual([
      ["payment.created", false],
      ["payment.executed", false],
      ["payment.created", true],
    ]);
    down = false;
    await outbox.send("org_456", refusing);
    expect(got.map((e) => [e.resource.split("/").at(-1), e.ordering_key])).toStrictEqual([
      ["PAY-902", 1],
      ["PAY-901", 1],
      ["PAY-901", 2],
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

// Pnpm send-events names the payment it held back, and why, and ends 1 (step
//   40c's README, claim C7).
describe("step 40c, C7: what pnpm send-events says about a payment it held back", () => {
  it("step 40c's decision D1: C7: PAY-901's events are refused: the run delivers PAY-902's, names PAY-901 as held back with the reason, and ends 1", async () => {
    const outbox = await filled();
    const refusing: Outbox = {
      ...outbox,
      send: (tenant, deliver, limit) =>
        outbox.send(
          tenant,
          async (event) => {
            if (event.resource.endsWith("/PAY-901")) throw new Error("no vendor VENDOR-31");
            await deliver(event);
          },
          limit,
        ),
    };
    const out = mkdtempSync(join(tmpdir(), "dsor-40c-each-"));
    try {
      const lines: string[] = [];
      const channels = new Map([
        ["org_456", "org_456.jsonl"],
        ["org_789", "org_789.jsonl"],
      ]);
      expect(await sendEach(refusing, channels, out, (line) => lines.push(line))).toBe(1);
      expect(lines).toStrictEqual([
        "org_456: sent 1 event",
        expect.stringMatching(
          /^org_456: held back PAY-901's events, from evt_[0-9a-f-]{36}: no vendor VENDOR-31$/,
        ),
        "org_789: sent 1 event",
      ]);
      expect(readChannel(join(out, "org_456.jsonl")).map((e) => e.resource)).toStrictEqual([
        "dsor://org_456/payment/PAY-902",
      ]);
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
    //   Changed in step 40c: a thrown error no longer stops the run, only its payment's events, so
    //   after the first delivery nothing more reaches the receiver, as nothing would after a kill.
    let dead = false;
    const dying = async (event: DomainEvent) => {
      if (!dead) await deliver(event);
      dead = true;
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

// Found by step 40c's review, H1 and L5: a receiver's reason with no words, a NUL byte, or more
//   than 200 bytes could not be kept, and aborted the whole run; one with a newline could forge a
//   line of pnpm send-events. The reason is now cleaned before it is kept or shown.
describe("step 40c's review, H1 and L5: a receiver's reason, cleaned", () => {
  it("DSOR-EVT-01a: H1: a refusal with no words is kept as the receiver gave no reason", () => {
    expect(reasonOf(new Error(""))).toBe("the receiver gave no reason");
    expect(reasonOf("")).toBe("the receiver gave no reason");
    expect(reasonOf(new Error(" \n\t "))).toBe("the receiver gave no reason");
  });

  it("DSOR-EVT-01a: H1: control characters, a NUL byte and newlines included, become single spaces", () => {
    expect(reasonOf(new Error("no\u0000vendor\nVENDOR-31\r\n"))).toBe("no vendor VENDOR-31");
  });

  it("DSOR-EVT-01a: H1: a long reason is cut to 200 bytes, never inside a character", () => {
    const cut = reasonOf(new Error("é".repeat(150)));
    expect(cut).toBe("é".repeat(100));
    expect(Buffer.byteLength(cut, "utf8")).toBe(200);
  });

  // Found by step 40c's review, S6: no test needed the cut to be at 200 bytes exactly, and the
  //   database refuses a reason of 201.
  it("DSOR-EVT-01a: S6: a reason of 250 one-byte characters is cut to 200, not one more", () => {
    expect(reasonOf(new Error("a".repeat(250)))).toBe("a".repeat(200));
  });

  it("DSOR-EVT-01a: L5: a reason with newlines cannot forge a line of pnpm send-events", async () => {
    const outbox = await filled();
    const lying: Outbox = {
      ...outbox,
      send: (tenant, deliver, limit) =>
        outbox.send(
          tenant,
          async (event) => {
            if (event.resource.endsWith("/PAY-901")) throw new Error("no\norg_456: sent 9 events");
            await deliver(event);
          },
          limit,
        ),
    };
    const out = mkdtempSync(join(tmpdir(), "dsor-40c-lying-"));
    try {
      const lines: string[] = [];
      await sendEach(lying, new Map([["org_456", "org_456.jsonl"]]), out, (l) => lines.push(l));
      expect(lines).toHaveLength(2);
      expect(lines.every((line) => !line.includes("\n"))).toBe(true);
      expect(lines[1]).toMatch(/: no org_456: sent 9 events$/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

// Found by step 40c's review, M1: a run read its oldest `limit` unsent events, and a held-back
//   payment's later events took places among them, so enough held payments kept every other
//   payment out of every run. The learner chose: a run counts only the events it tries.
describe("step 40c's review, M1: a run counts only the events it tries", () => {
  it("step 40c's decision D1: M1: PAY-901 and PAY-902 are paid and refused; a run that may try 3 still reaches PAY-903", async () => {
    const outbox = memoryOutbox();
    for (const id of ["PAY-901", "PAY-902"]) {
      await outbox.add("org_456", about("org_456", id));
      await outbox.add("org_456", about("org_456", id, "payment.executed"));
    }
    await outbox.add("org_456", about("org_456", "PAY-903"));
    const { got, deliver } = keeper();
    const run = await outbox.send(
      "org_456",
      async (event) => {
        if (!event.resource.endsWith("/PAY-903")) throw new Error("no vendor VENDOR-31");
        await deliver(event);
      },
      3,
    );
    expect(got.map((e) => e.resource.split("/").at(-1))).toStrictEqual(["PAY-903"]);
    expect(run.failed?.map((f) => f.resource.split("/").at(-1))).toStrictEqual([
      "PAY-901",
      "PAY-902",
    ]);
  });
});

// Found by step 40c's review, S5: pnpm send-events could name only the first payment held back.
describe("step 40c's review: every payment held back is named", () => {
  it("step 40c's decision D1: C7: PAY-901 and PAY-902 are refused: both are named, each on its own line", async () => {
    const outbox = await filled();
    const refusing: Outbox = {
      ...outbox,
      send: (tenant, _deliver, limit) =>
        outbox.send(
          tenant,
          async () => {
            throw new Error("no vendor VENDOR-31");
          },
          limit,
        ),
    };
    const out = mkdtempSync(join(tmpdir(), "dsor-40c-both-"));
    try {
      const lines: string[] = [];
      await sendEach(refusing, new Map([["org_456", "org_456.jsonl"]]), out, (l) => lines.push(l));
      expect(lines.slice(1).map((l) => l.split("'s events")[0])).toStrictEqual([
        "org_456: held back PAY-901",
        "org_456: held back PAY-902",
      ]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
