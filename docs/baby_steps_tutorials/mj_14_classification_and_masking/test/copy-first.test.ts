// NEW IN STEP 14, from the review: DSoR walks its own deep copy of what the operation's
// code returned. So nothing can change after DSoR has looked, and the record and the answer
// come from the same copy (step 14's README, decision 3).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { AGENT, CFO, INV_1008_OF_456, UNEXPECTED, registryWith, runAs } from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The data of an answer, or the whole answer when it was refused. */
function dataOf(answer: Answer): unknown {
  return "data" in answer ? answer.data : answer;
}

describe("decision 3: DSoR walks its own copy of the answer", () => {
  // Found by the sweep: the URI was read from the code's object, and the answer copied from
  // it again. A getter gave INV-1008 to the record and INV-1009 to the agent.
  it("DSOR-CLS-05: the record names the id the answer carries, even when the code's object gives a different id each time it is read", async () => {
    let reads = 0;
    const shifting = { tenant_id: "org_456", status: "issued" };
    Object.defineProperty(shifting, "id", {
      get: () => (reads++ === 0 ? "INV-1008" : "INV-1009"),
      enumerable: true,
    });
    const log = createLog();
    const answer = await call(
      registryWith(async () => shifting),
      log,
      AGENT,
      "test.run",
      GET_1008,
    );
    const { id } = dataOf(answer) as { id: string };
    const [record] = await log.records();
    expect(record?.resources).toStrictEqual([`dsor://org_456/invoice/${id}`]);
  });

  // The person's answer keeps amount, an object. Without a copy, it is the code's own object.
  it("decision 3: a change the code makes after it returned does not reach the answer", async () => {
    const live = structuredClone(INV_1008_OF_456);
    const answer = await runAs(CFO, async () => live);
    live.amount.value = "0.00";
    expect((dataOf(answer) as typeof live).amount.value).toBe("31400.00");
  });

  // structuredClone refuses a function and a Proxy, so the code's own logic never runs
  // again once DSoR has looked.
  it.each([
    ["a function, toJSON, that could print anything", { toJSON: () => "31400.00 USD" }],
    ["a Proxy", new Proxy({ tenant_id: "org_456", id: "INV-1008" }, {})],
  ])("decision 3: an answer holding %s is refused, never sent", async (_what, value) => {
    const answer = await runAs(AGENT, async () => ({
      tenant_id: "org_456",
      id: "INV-1008",
      status: value,
    }));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
  });
});
