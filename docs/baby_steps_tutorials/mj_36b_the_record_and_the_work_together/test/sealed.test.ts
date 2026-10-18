// Step 36b: a command's decision record and its bundle are kept with what its claim keeps, or
// neither is. A log that refuses the record leaves no claim and no proposal, so the same key runs
// again once the log is back (DSOR-EXE-04a, DSOR-EXE-03b; step 36b's README, claims C1 to C3).
// Memory has no transaction: the draft a refused call wrote stays in memory's payments. The
// database tests show that it goes too.
import { describe, expect, it } from "vitest";
import type { DecisionLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { AGENT, CFO, keyed, SUPERVISOR } from "./helpers.ts";
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

/** A log that refuses every record of this operation, and keeps every other in the world's log. */
function refusingAll(w: RuleWorld, operation: string): DecisionLog {
  return {
    add: async (decision, bundle) => {
      if (decision.operation === operation) throw new Error("the log's disk is full");
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
    // As on the database: the proposal still EXECUTING, and its note open. Found by step 36b's
    //   review, F3: memory had moved it COMMITTED and ended the note.
    const proposal = String("proposal" in unknown ? unknown.proposal : "")
      .split("/")
      .at(-1)!;
    expect((await w.proposals.get("org_456", proposal))?.state).toBe("EXECUTING");
    expect(await w.intents.get("org_456", proposal)).not.toHaveProperty("outcome");
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "payment.execute@1",
      result: "OUTCOME_UNKNOWN",
    });
  });
});

// Step 36b's review: each finding, with its test (step 36b's README, "What the review found").
describe("the review", () => {
  it("DSOR-UNK-01b: F1: every record of PAY-902's send is refused: never the words that nothing was kept, since the bank sent; the same key hears OUTCOME_UNKNOWN once the log is back", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
    const input = { invoice: INV_1002, payment, expected_version: 1 };
    const envelope = keyed(SUPERVISOR);
    const refused = await call(
      w.registry,
      refusingAll(w, "payment.execute@1"),
      envelope,
      "payment.execute",
      input,
    );
    expect(refused).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message:
        "DSoR could not record its decision after the command ran, and a retry with the same idempotency_key cannot run it twice",
    });
    expect(w.bank.transfers()).toHaveLength(1);
    expect(await call(w.registry, w.log, envelope, "payment.execute", input)).toMatchObject({
      code: "OUTCOME_UNKNOWN",
    });
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-EXE-04a: N1: the record of a call DENIED at line ⑨, a stale version, is refused: no DENIED proposal is kept", async () => {
    const w = await ruleWorldOnTuesday();
    const envelope = keyed(SUPERVISOR);
    const input = { invoice: INV_1002, expected_version: 2 };
    const refused = await call(
      w.registry,
      refusingOnce(w, "payment.create@1"),
      envelope,
      "payment.create",
      input,
    );
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect(await madeWith(w, envelope.idempotency_key)).toStrictEqual([]);
    expect(await w.ask(envelope, "payment.create", input)).toMatchObject({ code: "STALE_STATE" });
    expect(await madeWith(w, envelope.idempotency_key)).toMatchObject([{ state: "DENIED" }]);
  });

  it("DSOR-EXE-03b: N2: the record of the agent's release of INV-1008, approved by cfo_100, is refused: the proposal is APPROVED again, nothing is drafted, and the same key releases it once", async () => {
    const w = await ruleWorldOnTuesday();
    const waiting = await w.draft("INV-1008");
    const id = String("proposal" in waiting ? waiting.proposal : "")
      .split("/")
      .at(-1)!;
    const kept = (await w.proposals.get("org_456", id))!;
    const approval = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: kept.uri,
      payload_hash: kept.payload_hash,
    });
    expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
    const envelope = keyed(AGENT);
    const refused = await call(
      w.registry,
      refusingOnce(w, "proposal.execute@1"),
      envelope,
      "proposal.execute",
      { proposal: kept.uri },
    );
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE" });
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
    const released = await w.ask(envelope, "proposal.execute", { proposal: kept.uri });
    expect(heard(released)).toBe("COMMITTED");
    expect((await w.proposals.get("org_456", id))?.state).toBe("COMMITTED");
  });
});
