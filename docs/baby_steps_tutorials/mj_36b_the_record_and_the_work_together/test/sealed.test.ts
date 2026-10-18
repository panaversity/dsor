// Step 36b: a command's decision record and its bundle are kept with what its claim keeps, or
// neither is. A log that refuses the record leaves no claim and no proposal, so the same key runs
// again once the log is back (DSOR-EXE-04a, DSOR-EXE-03b; step 36b's README, claims C1 to C3).
// Memory has no transaction: the draft a refused call wrote stays in memory's payments. The
// database tests show that it goes too.
import { describe, expect, it } from "vitest";
import type { DecisionLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { AGENT, keyed, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";

/** A log that refuses the next record of this operation, once, and keeps every other in the world's log. */
function refusingOnce(w: RuleWorld, operation: string): DecisionLog {
  let refused = false;
  return {
    add: async (decision, bundle) => {
      if (!refused && decision.operation === operation) {
        refused = true;
        throw new Error("the log's disk is full");
      }
      return w.log.add(decision, bundle);
    },
  };
}

/** The proposals made under this key. */
async function madeWith(w: RuleWorld, key: string): Promise<unknown[]> {
  return (await w.proposals.all()).filter((p) => p.idempotency_key === key);
}

describe("C1: no record, no claim: the work's claim and proposal go with the record", () => {
  it("DSOR-EXE-04a: a log that refuses the record of user_123's draft: EVIDENCE_STORE_UNAVAILABLE, no claim and no proposal kept, and the same key later drafts it, with its record", async () => {
    const w = await ruleWorldOnTuesday();
    const log = refusingOnce(w, "payment.create@1");
    const envelope = keyed(SUPERVISOR);
    const input = { invoice: INV_1002, expected_version: 1 };
    const refused = await call(w.registry, log, envelope, "payment.create", input);
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE", retry: "safe_same_key" });
    expect(await madeWith(w, envelope.idempotency_key)).toStrictEqual([]);
    const again = await call(w.registry, log, envelope, "payment.create", input);
    expect(heard(again)).toBe("COMMITTED");
    expect(await madeWith(w, envelope.idempotency_key)).toHaveLength(1);
    const record = (await w.log.records()).at(-1)!;
    expect(record).toMatchObject({ operation: "payment.create@1", authorization: "ALLOW" });
    expect(record.correlation.request_id).toBe(again.correlation.request_id);
  });

  it("DSOR-EXE-04a: a log that refuses the record of the agent's INV-1008, which waits for the CFO: no waiting proposal is kept", async () => {
    const w = await ruleWorldOnTuesday();
    const log = refusingOnce(w, "payment.create@1");
    const envelope = keyed(AGENT);
    const input = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    const refused = await call(w.registry, log, envelope, "payment.create", input);
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(await madeWith(w, envelope.idempotency_key)).toStrictEqual([]);
    expect(heard(await call(w.registry, log, envelope, "payment.create", input))).toBe(
      "PENDING_APPROVAL",
    );
  });
});

describe("C3: after the bank was asked, a refused record cannot undo the money", () => {
  it("DSOR-EXE-04b: a log that refuses the record of PAY-902's send, once: OUTCOME_UNKNOWN, the bank sent once, and the record that follows says so", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
    const log = refusingOnce(w, "payment.execute@1");
    const unknown = await call(w.registry, log, keyed(SUPERVISOR), "payment.execute", {
      invoice: INV_1002,
      payment,
      expected_version: 1,
    });
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    expect(w.bank.transfers()).toHaveLength(1);
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "payment.execute@1",
      result: "OUTCOME_UNKNOWN",
    });
  });
});
