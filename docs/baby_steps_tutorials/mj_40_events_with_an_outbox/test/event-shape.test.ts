// Step 40: the shape of an event. Each validates against event.schema.json, copied from the
// specification; its id is its own; its ordering key is its number among its resource's events;
// its data passes the classification, so no RESTRICTED value leaves; and the outbox refuses an event
// that fails the schema (DSOR-EVT-01b, DSOR-EVT-01c, DSOR-COR-01a; step 40's README, claim C5,
// decisions D3 to D7).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { buildEvent, eventProblems, type DomainEvent } from "../src/events.ts";
import { checkClassifications } from "../src/labels.ts";
import { memoryOutbox } from "../src/outbox.ts";
import { CFO, keyed, labelsWith, shippedLabels, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const KINDS = checkClassifications(shippedLabels).kinds;
const PAY_901 = {
  tenant_id: "org_456",
  id: "PAY-901",
  invoice_id: "INV-1008",
  vendor_id: "VENDOR-44",
  amount: { value: "31400.00", currency: "USD" },
  status: "paid",
  version: 2,
};
const ON_PAY_901 = {
  type: "payment.executed" as const,
  tenant: "org_456",
  resource: "dsor://org_456/payment/PAY-901",
  kind: "Payment",
  data: PAY_901,
  correlation: { request_id: "req_1", principal_id: "user_123" },
};

/** A story in memory: two drafts, a send, and an approval with its release. Every event it left. */
async function aStory(): Promise<DomainEvent[]> {
  const w: RuleWorld = await ruleWorldOnTuesday();
  const draft = (invoice: string) =>
    w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: `dsor://org_456/invoice/${invoice}`,
      expected_version: 1,
    });
  const payment = (answer: Answer) =>
    `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
  const first = await draft("INV-1002");
  await draft("INV-1009");
  await w.ask(keyed(SUPERVISOR), "payment.execute", {
    invoice: "dsor://org_456/invoice/INV-1002",
    payment: payment(first),
    expected_version: 1,
  });
  const waiting = await w.draft("INV-1008");
  const proposal = String("proposal" in waiting ? waiting.proposal : "");
  const kept = await w.proposals.get("org_456", proposal.split("/").at(-1)!);
  await w.ask(keyed(CFO), "proposal.approve", { proposal, payload_hash: kept!.payload_hash });
  expect(heard(await w.ask(keyed(SUPERVISOR), "proposal.execute", { proposal }))).toBe("COMMITTED");
  return (await w.outbox.events("org_456")).map((row) => row.event);
}

describe("C5: every event of a story", () => {
  it("DSOR-EVT-01b: every event the story leaves validates against event.schema.json", async () => {
    const events = await aStory();
    expect(events.map((e) => e.type).sort()).toStrictEqual([
      "payment.created",
      "payment.created",
      "payment.created",
      "payment.executed",
      "proposal.approved",
    ]);
    for (const event of events) expect(eventProblems(event)).toStrictEqual([]);
  });

  it("DSOR-EVT-01b: no two events share an id", async () => {
    const ids = (await aStory()).map((e) => e.event_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DSOR-EVT-01b: each resource's events are numbered 1, 2, 3, in the order they were written", async () => {
    const byResource = new Map<string, number[]>();
    for (const e of await aStory()) {
      byResource.set(e.resource, [...(byResource.get(e.resource) ?? []), e.ordering_key]);
    }
    for (const keys of byResource.values()) {
      expect(keys).toStrictEqual(keys.map((_, i) => i + 1));
    }
    expect([...byResource.values()].some((keys) => keys.length === 2)).toBe(true);
  });
});

describe("D5: an event's data, through the classification", () => {
  it("DSOR-EVT-01b: a payment's event holds the payment, labelled confidential, the highest label of its fields, for its amount", () => {
    const draft = buildEvent(ON_PAY_901, KINDS);
    expect(draft).toMatchObject({ data: PAY_901, classification: "confidential", origin: "dsor" });
    expect(draft).not.toHaveProperty("ordering_key");
  });

  it("DSOR-EVT-01c: a field labelled RESTRICTED never leaves: with the vendor's id planted restricted, the event has no vendor_id", () => {
    const kinds = checkClassifications(labelsWith({ Payment: { vendor_id: "restricted" } })).kinds;
    const draft = buildEvent(ON_PAY_901, kinds);
    expect(draft.data).not.toHaveProperty("vendor_id");
    expect(JSON.stringify(draft)).not.toContain("VENDOR-44");
    expect(draft.classification).toBe("confidential");
  });

  it("DSOR-EVT-01c: with the amount planted restricted, the amount never leaves, and the event is labelled internal, the highest label left", () => {
    const kinds = checkClassifications(
      labelsWith({ Payment: { amount: "restricted Money" } }),
    ).kinds;
    const draft = buildEvent(ON_PAY_901, kinds);
    expect(draft.data).not.toHaveProperty("amount");
    expect(JSON.stringify(draft)).not.toContain("31400.00");
    expect(draft.classification).toBe("internal");
  });

  it("DSOR-COR-01a: the event's correlation is the call's ids and the company's", () => {
    expect(buildEvent(ON_PAY_901, KINDS).correlation).toStrictEqual({
      request_id: "req_1",
      principal_id: "user_123",
      tenant_id: "org_456",
    });
  });

  it("DSOR-EVT-01b: two events built from one change have different ids", () => {
    expect(buildEvent(ON_PAY_901, KINDS).event_id).not.toBe(buildEvent(ON_PAY_901, KINDS).event_id);
  });
});

describe("D7: the schema, and the outbox that checks it", () => {
  const good = (): DomainEvent => ({ ...buildEvent(ON_PAY_901, KINDS), ordering_key: 1 });

  it.each([
    [
      "no request id",
      (e: Record<string, unknown>) => (e["correlation"] = { tenant_id: "org_456" }),
    ],
    ["no ordering key", (e: Record<string, unknown>) => delete e["ordering_key"]],
    ["an origin of agent", (e: Record<string, unknown>) => (e["origin"] = "agent")],
    ["a resource that is no URI", (e: Record<string, unknown>) => (e["resource"] = "PAY-901")],
    ["a field the schema has not", (e: Record<string, unknown>) => (e["note"] = "trust me")],
    ["a type with no dot", (e: Record<string, unknown>) => (e["type"] = "paid")],
  ])("DSOR-EVT-01b: an event with %s fails event.schema.json", (_, edit) => {
    const event = good() as unknown as Record<string, unknown>;
    expect(eventProblems(event)).toStrictEqual([]);
    edit(event);
    expect(eventProblems(event).length).toBeGreaterThan(0);
  });

  it("DSOR-EVT-01b: the outbox numbers each resource's events, 1, 2, and another resource's from 1", async () => {
    const outbox = memoryOutbox();
    const one = await outbox.add("org_456", buildEvent(ON_PAY_901, KINDS));
    const two = await outbox.add("org_456", buildEvent(ON_PAY_901, KINDS));
    const other = { ...ON_PAY_901, resource: "dsor://org_456/payment/PAY-902" };
    const three = await outbox.add("org_456", buildEvent(other, KINDS));
    expect([one.ordering_key, two.ordering_key, three.ordering_key]).toStrictEqual([1, 2, 1]);
  });

  it("DSOR-EVT-01b: the outbox refuses an event that fails the schema, and keeps nothing", async () => {
    const outbox = memoryOutbox();
    const bad = { ...buildEvent(ON_PAY_901, KINDS), resource: "PAY-901" };
    await expect(outbox.add("org_456", bad)).rejects.toThrow(/event\.schema\.json/);
    expect(await outbox.events("org_456")).toStrictEqual([]);
  });

  it("DSOR-EVT-01d: the outbox refuses an event of another company than the one it is written in", async () => {
    const outbox = memoryOutbox();
    await expect(outbox.add("org_789", buildEvent(ON_PAY_901, KINDS))).rejects.toThrow(/company/);
    expect(await outbox.events("org_789")).toStrictEqual([]);
  });
});
