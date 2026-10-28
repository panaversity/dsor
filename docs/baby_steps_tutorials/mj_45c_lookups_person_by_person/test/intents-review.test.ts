// Step 36's review: each finding, with its test (step 36's README, "What the review found").
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";

/** user_123 drafts a payment of INV-1002: its address. */
async function draft(w: RuleWorld): Promise<string> {
  const answer = await w.ask(keyed(SUPERVISOR), "payment.create", {
    invoice: INV_1002,
    expected_version: 1,
  });
  return `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
}

/** user_123 sends this payment of INV-1002. */
function execute(w: RuleWorld, payment: string, who: RequestEnvelope = keyed(SUPERVISOR)) {
  return w.ask(who, "payment.execute", { invoice: INV_1002, payment, expected_version: 1 });
}

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

describe("R1: an accident after the checkpoint is OUTCOME_UNKNOWN, never INTERNAL_ERROR", () => {
  it("DSOR-EXE-04b: the bank sent, then the note cannot be ended: OUTCOME_UNKNOWN, the bundle says outcome_unknown, the same key hears it again, a new key CONFLICT, and the bank sent once", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const end = w.intents.end;
    w.intents.end = async (tenant, id, outcome) => {
      if (outcome === "committed") throw new Error("the connection dropped");
      return end(tenant, id, outcome);
    };
    const envelope = keyed(SUPERVISOR);
    const unknown = await execute(w, payment, envelope);
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    const record = (await w.log.records()).at(-1)!;
    const bundle = (await w.log.bundles()).find((b) => b.decision_id === record.decision_bundle);
    expect(bundle?.execution.result).toBe("outcome_unknown");
    w.intents.end = end;
    // Changed in step 38: memory has no transaction, so its proposal moved to COMMITTED before the
    //   note failed, and a same-key retry now answers what the proposal says (step 38's README,
    //   decision D4). On the database the proposal stays EXECUTING, and the retry hears
    //   OUTCOME_UNKNOWN (test/intents.db.test.ts).
    expect(await execute(w, payment, envelope)).toMatchObject({
      outcome: "COMMITTED",
      proposal: `dsor://org_456/proposal/${idOf(unknown)}`,
    });
    expect(await execute(w, payment)).toMatchObject({ code: "CONFLICT" });
    expect(w.bank.transfers()).toHaveLength(1);
  });
});

describe("R4: a release writes its note for its own claim", () => {
  it("DSOR-EXE-03a: user_123 releases a prepared payment.execute: the note names payment.execute@1 and the prepared request's fingerprint, and the release's own claim, proposal.execute, its key, and its principal", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const prepared = await w.ask(
      { ...keyed(SUPERVISOR), mode: "propose_only" },
      "payment.execute",
      {
        invoice: INV_1002,
        payment,
        expected_version: 1,
      },
    );
    expect(heard(prepared)).toBe("READY");
    const kept = (await w.proposals.get("org_456", idOf(prepared)))!;
    const release = keyed(SUPERVISOR);
    const sent = await w.ask(release, "proposal.execute", { proposal: kept.uri });
    expect(heard(sent)).toBe("COMMITTED");
    expect(w.intents.all()).toMatchObject([
      {
        proposal_id: idOf(prepared),
        operation: "payment.execute@1",
        payload_hash: kept.payload_hash,
        principal: "user_123",
        claim_operation: "proposal.execute",
        idempotency_key: release.idempotency_key,
        outcome: "committed",
      },
    ]);
  });
});
