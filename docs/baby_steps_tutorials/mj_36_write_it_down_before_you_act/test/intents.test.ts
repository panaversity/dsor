// Step 36: before a command calls a bank, DSoR writes its intent record, the note "I am about to
// pay": the proposal, the operation, the fingerprint, the key, the connector, and who asked. The
// note ends with the work's outcome. If the note cannot be written, the bank is never called
// (step 36's README, claims C1 to C3).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { memoryIntents } from "../src/intents.ts";
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

describe("C1: the note is written before the bank is called", () => {
  it("DSOR-EXE-03a: when the bank is asked, the note is already there, naming the proposal, the operation, the fingerprint, the key, the connector, and who asked", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const seen: unknown[] = [];
    const pay = w.bank.pay;
    w.bank.pay = async (key, order) => {
      seen.push(...w.intents.all());
      return pay(key, order);
    };
    const envelope = keyed(SUPERVISOR);
    const sent = await execute(w, payment, envelope);
    expect(heard(sent)).toBe("COMMITTED");
    const kept = (await w.proposals.get("org_456", idOf(sent)))!;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      proposal_id: idOf(sent),
      tenant_id: "org_456",
      operation: "payment.execute@1",
      payload_hash: kept.payload_hash,
      principal: "user_123",
      idempotency_key: envelope.idempotency_key,
      connector: "fake-bank",
      security_context: { subject: "user_123" },
    });
    expect(seen[0]).not.toHaveProperty("outcome");
  });

  it("DSOR-EXE-03a: a command that reaches no bank writes no note: payment.create keeps its one transaction", async () => {
    const w = await ruleWorldOnTuesday();
    await draft(w);
    expect(w.intents.all()).toStrictEqual([]);
  });
});

describe("C2: no note, no payment", () => {
  it("DSOR-EXE-03b: a note that cannot be written: EVIDENCE_STORE_UNAVAILABLE, and the bank is never called", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    w.intents.write = async () => {
      throw new Error("the store of intent records is full");
    };
    const refused = await execute(w, payment);
    expect(refused).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE", retry: "safe_same_key" });
    expect(w.bank.transfers()).toStrictEqual([]);
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["draft"]);
  });
});

describe("C3: the note ends with the work's outcome", () => {
  it("DSOR-EXE-03a: a good day ends the note committed", async () => {
    const w = await ruleWorldOnTuesday();
    const sent = await execute(w, await draft(w));
    expect(await w.intents.get("org_456", idOf(sent))).toMatchObject({ outcome: "committed" });
  });

  it("DSOR-EXE-04b: a silent bank ends the note outcome_unknown, as its proposal", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    w.bank.mode = "silent";
    const unknown = await execute(w, payment);
    expect(heard(unknown)).toBe("OUTCOME_UNKNOWN");
    expect(await w.intents.get("org_456", idOf(unknown))).toMatchObject({
      outcome: "outcome_unknown",
    });
  });

  it("DSOR-EXE-03a: a bank that says it sent nothing, after the note: the note ends failed, the proposal FAILED, and the same key gives the same answer without asking the bank; a new key pays once", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    let calls = 0;
    const pay = w.bank.pay;
    w.bank.pay = async (key, order) => {
      calls += 1;
      return pay(key, order);
    };
    const envelope = keyed(SUPERVISOR);
    w.bank.mode = "broken";
    const refused = await execute(w, payment, envelope);
    expect(refused).toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    expect((await w.proposals.get("org_456", idOf(refused)))?.state).toBe("FAILED");
    expect(await w.intents.get("org_456", idOf(refused))).toMatchObject({ outcome: "failed" });
    w.bank.mode = "good";
    expect(heard(await execute(w, payment, envelope))).toBe("CONNECTOR_UNAVAILABLE");
    expect(calls).toBe(1);
    expect(heard(await execute(w, payment))).toBe("COMMITTED");
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-EXE-04b: an accident after the note, in memory, ends OUTCOME_UNKNOWN, as a crash would after the sweep", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const row = w.drafted[0]!;
    let status = row.status;
    Object.defineProperty(row, "status", {
      enumerable: true,
      get: () => status,
      set: (to: typeof status) => {
        if (to === "paid") throw new Error("the process lost its connection");
        status = to;
      },
    });
    const unknown = await execute(w, payment);
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(await w.intents.get("org_456", idOf(unknown))).toMatchObject({
      outcome: "outcome_unknown",
    });
  });

  it("DSOR-EXE-03a: the memory store refuses a second note for one proposal, and ends a note once", async () => {
    const store = memoryIntents();
    const note = {
      proposal_id: "prop_1",
      tenant_id: "org_456",
      operation: "payment.execute@1",
      payload_hash: "h",
      principal: "user_123",
      idempotency_key: "k",
      connector: "fake-bank",
      security_context: {},
    };
    await store.write("org_456", note);
    await expect(store.write("org_456", note)).rejects.toThrow("has a note already");
    await store.end("org_456", "prop_1", "committed");
    await expect(store.end("org_456", "prop_1", "failed")).rejects.toThrow("ends once");
  });
});
