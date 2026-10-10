// A cached value is never labelled current (DSOR-FRS-01b; step 15's README,
// C3). DSoR has no cache, so the tests plant one under the bound store (decision 8). Its
// answer must say observational, with the time of the read it copied.
// test/cached-reads.db.test.ts plants the same cache over the database.
import { describe, expect, it } from "vitest";
import { memoryInvoices } from "../src/invoice.ts";
import { call } from "../src/pipeline.ts";
import { CFO, USER_700, log } from "./helpers.ts";
import { aMomentLater, cacheOver, freshnessOf, registryOver } from "./stores.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

describe("C3: a cached value is never labelled current", () => {
  it("DSOR-FRS-01b: the first read is current, and the same invoice from the cache is observational", async () => {
    const registry = registryOver(cacheOver(memoryInvoices()));
    const first = await call(registry, log, CFO, "invoice.get", GET_1008);
    const second = await call(registry, log, CFO, "invoice.get", GET_1008);
    expect(freshnessOf(first)).toMatchObject({ mode: "current", connector: "memory" });
    expect(freshnessOf(second)).toMatchObject({ mode: "observational", connector: "memory" });
    expect(second).toMatchObject({ data: { id: "INV-1008", vendor_id: "VENDOR-44" } });
  });

  // The clock moves on between the two reads, so a cache that said "now" would show (break
  // Z5).
  it("DSOR-FRS-01b: the cached answer keeps the time of the read it copied, never now", async () => {
    const registry = registryOver(cacheOver(memoryInvoices()));
    const first = await call(registry, log, CFO, "invoice.get", GET_1008);
    await aMomentLater();
    const second = await call(registry, log, CFO, "invoice.get", GET_1008);
    const { observed_at } = freshnessOf(first) as { observed_at: string };
    // The copy keeps the version it copied too (step 21's README, decision 9).
    expect(freshnessOf(second)).toStrictEqual({
      mode: "observational",
      observed_at,
      connector: "memory",
      resource_version: "1",
    });
  });

  // The test's cache follows the rule a real one must follow: keyed by company. So
  // org_789's first INV-1008 is a read of its own, not org_456's copy. This tests the
  // planted cache, which DSoR does not have, so its title names the decision.
  it("decision 8: the planted cache is keyed by company: org_789's first INV-1008 is current, and org_789's", async () => {
    const registry = registryOver(cacheOver(memoryInvoices()));
    await call(registry, log, CFO, "invoice.get", GET_1008);
    const theirs = await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(theirs).toMatchObject({ data: { tenant_id: "org_789", vendor_id: "VENDOR-77" } });
    expect(freshnessOf(theirs)).toMatchObject({ mode: "current" });
  });
});
