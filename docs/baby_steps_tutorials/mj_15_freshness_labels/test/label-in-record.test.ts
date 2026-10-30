// NEW IN STEP 15: the record of a read keeps the answer's label, so the log can answer "what
// did DSoR know when it answered?" (step 15's README, C7 and decision 7). The connector goes
// in the audit record's own field. The mode and observed_at have no field there, so they go
// under this tutorial's extensions, beside step 14's classification (DSOR-SCH-02).
// test/label-in-record.db.test.ts asks the same of dsor.audit.
import { describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import type { Company } from "../src/company.ts";
import { AGENT, CFO, OUR_EXTENSIONS, registry, registryRunning, shippedLabels } from "./helpers.ts";
import { freshnessOf, registryOver, relabelled } from "./stores.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

describe("C7: the record of a read keeps its label", () => {
  it("decision 7: cfo_100's read of INV-1008 is recorded with the answer's connector, mode, and time", async () => {
    const log = createLog();
    const answer = await call(registry, log, CFO, "invoice.get", GET_1008);
    const { observed_at } = freshnessOf(answer) as { observed_at: string };
    const [record] = await log.records();
    expect(record).toMatchObject({ result: "ok", connector: "memory" });
    expect(record?.extensions).toStrictEqual({
      [OUR_EXTENSIONS]: {
        classification: "confidential",
        freshness: { mode: "current", observed_at },
      },
    });
  });

  it("decision 7: the agent's page is recorded with its label too", async () => {
    const log = createLog();
    const answer = await call(registry, log, AGENT, "invoice.list", { limit: 2 });
    const { observed_at } = freshnessOf(answer) as { observed_at: string };
    expect(await log.records()).toMatchObject([
      {
        connector: "memory",
        extensions: { [OUR_EXTENSIONS]: { freshness: { mode: "current", observed_at } } },
      },
    ]);
  });

  // The record copies the label the answer got, whatever the store said. A record that wrote
  // "current" of its own would show here.
  it("decision 7: a read a slower store served is recorded as that store labelled it", async () => {
    const log = createLog();
    const bounded = {
      mode: "bounded_staleness",
      observed_at: "2026-10-01T08:59:30.000Z",
      connector: "warehouse",
    };
    await call(registryOver(relabelled([bounded])), log, CFO, "invoice.get", GET_1008);
    expect(await log.records()).toMatchObject([
      {
        connector: "warehouse",
        extensions: {
          [OUR_EXTENSIONS]: {
            freshness: { mode: "bounded_staleness", observed_at: "2026-10-01T08:59:30.000Z" },
          },
        },
      },
    ]);
  });

  // Found by the mutation sweep, 2026-10-02: no record test made two reads, so a record that
  // kept the first or the last read's label passed. Each order is tried once.
  it("decision 7: a call with two reads is recorded with the stalest label, in either order", async () => {
    const current = {
      mode: "current",
      observed_at: "2026-10-01T09:00:00.000Z",
      connector: "memory",
    };
    const cached = {
      mode: "observational",
      observed_at: "2026-10-01T08:00:00.000Z",
      connector: "cache",
    };
    const twice = async (_input: unknown, company: Company): Promise<unknown> => {
      const first = await company.invoices.get("INV-1008");
      await company.invoices.get("INV-1008");
      return first;
    };
    for (const labels of [
      [current, cached],
      [cached, current],
    ]) {
      const log = createLog();
      await call(
        registryRunning(twice, "Invoice", shippedLabels, relabelled(labels)),
        log,
        CFO,
        "test.run",
        GET_1008,
      );
      expect(await log.records()).toMatchObject([
        {
          connector: "cache",
          extensions: {
            [OUR_EXTENSIONS]: {
              freshness: { mode: "observational", observed_at: "2026-10-01T08:00:00.000Z" },
            },
          },
        },
      ]);
    }
  });

  // And no record test made code write its own label, so a record that took it from the
  // answer's data passed.
  it("decision 7: code that writes freshness into its data leaves the store's label in the record", async () => {
    const log = createLog();
    const cached = {
      mode: "observational",
      observed_at: "2026-10-01T08:00:00.000Z",
      connector: "cache",
    };
    const claims = async (_input: unknown, company: Company): Promise<unknown> => ({
      ...(await company.invoices.get("INV-1008")),
      freshness: "current",
    });
    await call(
      registryRunning(claims, "Invoice", shippedLabels, relabelled([cached])),
      log,
      CFO,
      "test.run",
      GET_1008,
    );
    expect(await log.records()).toMatchObject([
      {
        connector: "cache",
        extensions: {
          [OUR_EXTENSIONS]: {
            freshness: { mode: "observational", observed_at: "2026-10-01T08:00:00.000Z" },
          },
        },
      },
    ]);
  });

  // A refusal returned no data, so its record has no label. A guard: it passes with or
  // without this step's code.
  it("decision 7: a refused read is recorded with no connector and no freshness", async () => {
    const log = createLog();
    await call(registry, log, CFO, "invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" });
    const [record] = await log.records();
    expect(record).toMatchObject({ result: "RESOURCE_NOT_FOUND" });
    expect(record).not.toHaveProperty("connector");
    expect(record).not.toHaveProperty("extensions");
  });
});
