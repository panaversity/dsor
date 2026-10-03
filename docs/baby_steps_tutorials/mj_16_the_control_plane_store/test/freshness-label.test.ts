// NEW IN STEP 15: every successful query's answer says how fresh its data is: the mode
// delivered, when it was read, and by which connector (DSOR-FRS-01a; step 15's README, C1).
// The unit tests read the invoices in memory, so the connector is memory (decision 2).
// test/freshness-label.db.test.ts asks the same of the database.
import { describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { AGENT, CFO, log, registry } from "./helpers.ts";
import { freshnessOf } from "./stores.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// Exactly three fields: a fourth would be something the specification does not ask for.
const CURRENT_FROM_MEMORY = {
  mode: "current",
  observed_at: expect.any(String),
  connector: "memory",
};

describe("C1: every successful query answer states the mode, observed_at, and the connector", () => {
  it("DSOR-FRS-01a: the agent's INV-1008 carries freshness: current, a time, and memory", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", GET_1008);
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(freshnessOf(answer)).toStrictEqual(CURRENT_FROM_MEMORY);
  });

  it("DSOR-FRS-01a: cfo_100's INV-1008 carries the same three fields", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", GET_1008);
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    expect(freshnessOf(answer)).toStrictEqual(CURRENT_FROM_MEMORY);
  });

  it("DSOR-FRS-01a: the agent's page of invoices carries freshness too", async () => {
    const answer = await call(registry, log, AGENT, "invoice.list", {});
    expect(answer).toMatchObject({ data: { items: expect.any(Array) } });
    expect(freshnessOf(answer)).toStrictEqual(CURRENT_FROM_MEMORY);
  });

  it("DSOR-FRS-01a: cfo_100's page of invoices carries freshness too", async () => {
    const answer = await call(registry, log, CFO, "invoice.list", { limit: 2 });
    expect(answer).toMatchObject({ data: { items: expect.any(Array) } });
    expect(freshnessOf(answer)).toStrictEqual(CURRENT_FROM_MEMORY);
  });

  // An empty page read the store too, so it has a label like any other.
  it("DSOR-FRS-01a: an empty page past the end carries freshness", async () => {
    const answer = await call(registry, log, CFO, "invoice.list", { cursor: "INV-9999" });
    expect(answer).toMatchObject({ data: { items: [] } });
    expect(freshnessOf(answer)).toStrictEqual(CURRENT_FROM_MEMORY);
  });

  // The time is a date-time as the specification's timestamp writes it (RFC 3339), and
  // one that names a real moment.
  it("DSOR-FRS-01a: observed_at is a date and a time, in UTC", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", GET_1008);
    const { observed_at } = freshnessOf(answer) as { observed_at: string };
    expect(new Date(observed_at).toISOString()).toBe(observed_at);
  });
});
