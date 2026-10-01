// NEW IN STEP 15: only a successful query carries freshness, because a refusal holds no data.
// And a successful query whose code read nothing is refused: a label for it would be
// invented (step 15's README, C6 and decision 6).
import { describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { CFO, INV_1008_OF_456, UNEXPECTED, log, registry, registryRunning } from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

describe("C6: only a successful query carries freshness", () => {
  // Guards: a refusal is an error envelope, which never had a freshness field. They pass
  // with or without this step's code, so their titles name the decision (break Z3).
  it("decision 1: a refusal after the code read, RESOURCE_NOT_FOUND, carries no freshness", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(answer).not.toHaveProperty("freshness");
  });

  it("decision 1: a refusal before the code runs, TENANT_MISMATCH, carries no freshness", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ code: "TENANT_MISMATCH" });
    expect(answer).not.toHaveProperty("freshness");
  });

  it("decision 1: a refusal of the caller, AUTHORIZATION_DENIED, carries no freshness", async () => {
    const answer = await call(registry, log, { ...CFO, tenant: "org_789" }, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(answer).not.toHaveProperty("freshness");
  });

  // The code returns INV-1008 from its own memory, without asking the store. DSoR has no
  // read to label it with, so the answer would be a label made up. A bug in the code: the
  // code ran, so its record says ALLOW, with INTERNAL_ERROR as its result.
  it("decision 6: a query whose code returns data without reading is refused with INTERNAL_ERROR", async () => {
    const own = createLog();
    const answer = await call(
      registryRunning(() => structuredClone(INV_1008_OF_456)),
      own,
      CFO,
      "test.run",
      GET_1008,
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    expect(answer).not.toHaveProperty("freshness");
    expect(await own.records()).toMatchObject([
      { authorization: "ALLOW", result: "INTERNAL_ERROR" },
    ]);
  });
});
