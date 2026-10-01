// NEW IN STEP 14: a read that returns confidential data is recorded with who, what, and how
// many (DSOR-CLS-05; step 14's README, C5). The record uses the audit record's own fields,
// resources and row_count, and keeps the answer's label under extensions (decision 7).
// test/read-record.db.test.ts asks the same of dsor.audit.
import { describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import {
  AGENT,
  CFO,
  OUR_EXTENSIONS,
  SUPERVISOR,
  UNEXPECTED,
  registry,
  registryWith,
} from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The label a record keeps under this tutorial's extensions. */
function labelled(classification: string): object {
  return { [OUR_EXTENSIONS]: { classification } };
}

describe("C5: a read that returns data is recorded with who, what, and how many", () => {
  it("DSOR-CLS-05: cfo_100's read of INV-1008 is recorded with its URI, one row, and confidential", async () => {
    const log = createLog();
    await call(registry, log, CFO, "invoice.get", GET_1008);
    expect(await log.records()).toMatchObject([
      {
        operation: "invoice.get@1",
        authorization: "ALLOW",
        result: "ok",
        correlation: { principal_id: "cfo_100" },
        resources: ["dsor://org_456/invoice/INV-1008"],
        row_count: 1,
        extensions: labelled("confidential"),
      },
    ]);
  });

  it("DSOR-CLS-05: a page is recorded with the URI of each invoice it returned, and how many", async () => {
    const log = createLog();
    await call(registry, log, CFO, "invoice.list", { limit: 3 });
    expect(await log.records()).toMatchObject([
      {
        operation: "invoice.list@1",
        resources: [
          "dsor://org_456/invoice/INV-1001",
          "dsor://org_456/invoice/INV-1002",
          "dsor://org_456/invoice/INV-1003",
        ],
        row_count: 3,
        extensions: labelled("confidential"),
      },
    ]);
  });

  // Every read that returns data is recorded, and its label says how sensitive the answer
  // was (step 14's README, decision 7).
  it("DSOR-CLS-05: the agent's read is recorded too, with the label of what it got: internal", async () => {
    const log = createLog();
    await call(registry, log, AGENT, "invoice.get", GET_1008);
    expect(await log.records()).toMatchObject([
      {
        correlation: { agent_id: "accounts-payable-fte" },
        resources: ["dsor://org_456/invoice/INV-1008"],
        row_count: 1,
        extensions: labelled("internal"),
      },
    ]);
  });

  it("DSOR-CLS-05: an empty page is recorded with no URI and zero rows", async () => {
    const log = createLog();
    await call(registry, log, CFO, "invoice.list", { cursor: "INV-9999" });
    expect(await log.records()).toMatchObject([
      { resources: [], row_count: 0, extensions: labelled("public") },
    ]);
  });

  // URIs, a count, and a label. Never the values read (DSOR-AUD-05a). A guard, like the
  // next: it passes with or without step 14's code, so its title names the decision.
  // test/refusal-labels.test.ts holds DSOR-AUD-05a's test that can fail. Found by the review.
  it("decision 7: the record holds no value that was read", async () => {
    const log = createLog();
    await call(registry, log, CFO, "invoice.get", GET_1008);
    const text = JSON.stringify(await log.records());
    for (const value of ["31400.00", "VENDOR-44", "issued"]) expect(text).not.toContain(value);
  });

  it("decision 7: a refused read records no resources, no row count, and no label", async () => {
    const log = createLog();
    await call(registry, log, CFO, "invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" });
    const [record] = await log.records();
    expect(record).toMatchObject({ result: "RESOURCE_NOT_FOUND" });
    expect(record).not.toHaveProperty("resources");
    expect(record).not.toHaveProperty("row_count");
    expect(record).not.toHaveProperty("extensions");
  });
});

describe("C5: what DSoR cannot record, it does not send", () => {
  // A row with no id has no URI, so DSoR could not say what was read. The answer is
  // refused, for a person too (step 14's README, decision 7).
  it("DSOR-CLS-05: an invoice with no id cannot be named in the record, so the answer is refused, for a person too", async () => {
    const log = createLog();
    const noId = registryWith(async () => ({ tenant_id: "org_456", status: "issued" }));
    const answer = await call(noId, log, SUPERVISOR, "test.run", GET_1008);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    expect(await log.records()).toMatchObject([
      { authorization: "ALLOW", result: "INTERNAL_ERROR" },
    ]);
  });
});
