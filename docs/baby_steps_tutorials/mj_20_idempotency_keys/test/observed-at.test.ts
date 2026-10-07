// Observed_at is the clock of the store that read. In memory there is no
// database, so it is the program's clock (DSOR-FRS-01a; step 15's README, C2 and decision 2).
// test/observed-at.db.test.ts holds the database's half.
import { describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { CFO, log, registry } from "./helpers.ts";
import { freshnessOf } from "./stores.ts";

describe("C2: observed_at is the clock of the store, at the read", () => {
  it("DSOR-FRS-01a: in memory, observed_at lies between two readings of the program's clock", async () => {
    const before = Date.now();
    const answer = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    const after = Date.now();
    const { observed_at } = freshnessOf(answer) as { observed_at: string };
    const observed = Date.parse(observed_at);
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  // Found by the mutation sweep, 2026-10-02: only get's time was checked, so a list labelled
  // once, when the store was made, passed.
  it("DSOR-FRS-01a: in memory, a page's observed_at lies between two readings of the program's clock", async () => {
    const before = Date.now();
    const answer = await call(registry, log, CFO, "invoice.list", { limit: 2 });
    const after = Date.now();
    const observed = Date.parse((freshnessOf(answer) as { observed_at: string }).observed_at);
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });
});
