// Step 35: a fake bank, DSoR's second connector, and payment.execute, the first command that cannot
// be undone. It goes only to a bank that refuses a repeated key or answers whether a payment went
// through (DSOR-UNK-03a), with a key derived from the proposal (DSOR-IDM-03), and a silent bank is
// an unknown outcome, never a success or a failure (step 35's README, claims C1 to C5).
import { describe, expect, it } from "vitest";
import { bankKeyOf, createFakeBank } from "../src/bank.ts";
import { checkConnectors, readConnectors, type ConnectorsSource } from "../src/connectors.ts";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed, shipped, SUPERVISOR, USER_700 } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const none = undefined;
const INV_1002 = "dsor://org_456/invoice/INV-1002";
const INV_1008 = "dsor://org_456/invoice/INV-1008";

type File = { connectors: Record<string, unknown>[]; companies: Record<string, unknown> };

/** The shipped connectors file, as a plain object a test may change. */
function shippedFile(): File {
  return JSON.parse(readConnectors().text) as File;
}

/** The shipped file with the fake bank's capabilities changed, for every company or for one. */
function bankSays(changes: Record<string, unknown>, onlyFor?: string): ConnectorsSource {
  const file = shippedFile();
  const bank = file.connectors[1]!;
  const changed = {
    ...bank,
    id: onlyFor === undefined ? "fake-bank" : "own-bank",
    capabilities: { ...(bank["capabilities"] as object), ...changes },
  };
  if (onlyFor === undefined) file.connectors[1] = changed;
  else {
    file.connectors.push(changed);
    file.companies[onlyFor] = { records: "accounting", bank: "own-bank" };
  }
  return { file: "connectors.json", text: JSON.stringify(file) };
}

/** Start-up's refusal for this connectors file, or "" when it starts. */
async function startUp(connectors: ConnectorsSource): Promise<string> {
  try {
    await ruleWorldOnTuesday(none, none, none, none, none, none, none, connectors);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

/** user_123 drafts a payment of INV-1002, 8,900.50 USD, under the CFO's line: its address. */
async function draft1002(w: RuleWorld): Promise<string> {
  const answer = await w.ask(keyed(SUPERVISOR), "payment.create", {
    invoice: INV_1002,
    expected_version: 1,
  });
  const data = (answer as { data: { id: string } }).data;
  return `dsor://org_456/payment/${data.id}`;
}

/** Someone sends this payment of this invoice through the bank. */
function execute(
  w: RuleWorld,
  payment: string,
  who: RequestEnvelope = keyed(SUPERVISOR),
  invoice: string = INV_1002,
  version = 1,
): Promise<Answer> {
  return w.ask(who, "payment.execute", { invoice, payment, expected_version: version });
}

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

describe("C1: what cannot be undone goes only to a bank that refuses a repeat or answers a lookup", () => {
  it("DSOR-UNK-03a: payment.execute, and the release that may run it, need of the bank one of the two", async () => {
    const w = await ruleWorldOnTuesday();
    const either = [["downstream_idempotency", "outcome_lookup"]];
    expect(w.registry.plugs.bankNeeds.get("payment.execute")).toStrictEqual(either);
    expect(w.registry.plugs.bankNeeds.get("proposal.execute")).toStrictEqual(either);
    expect(w.registry.plugs.bankNeeds.has("payment.create")).toBe(false);
  });

  it("DSOR-UNK-03a: a default bank that neither refuses a repeat nor answers a lookup stops start-up, naming payment.execute", async () => {
    const message = await startUp(
      bankSays({ downstream_idempotency: false, outcome_lookup: false }),
    );
    expect(message).toContain(
      'the default bank connector is broken: connector "fake-bank" cannot serve as the bank: payment.execute needs downstream_idempotency or outcome_lookup',
    );
  });

  it.each([
    ["only refuses a repeat", { outcome_lookup: false }],
    ["only answers a lookup", { downstream_idempotency: false }],
  ])("DSOR-UNK-03a: a bank that %s is enough", async (_how, changes) => {
    expect(await startUp(bankSays(changes))).toBe("");
  });

  it("DSOR-CNR-01b: each connector is asked only for its own part: the bank cannot undo a job, and the records cannot refuse a repeat, and both serve", async () => {
    const w = await ruleWorldOnTuesday();
    expect(w.registry.plugs.outOfService("org_456", "payment.execute")).toBeUndefined();
    expect(w.registry.plugs.outOfService("org_456", "invoice.get")).toBeUndefined();
  });

  it("DSOR-CNR-01a: a company's bank must be a bank DSoR can call", () => {
    const contracts = shipped.map((s) => JSON.parse(s.text) as { id: string });
    const { problems } = checkConnectors(readConnectors(), contracts, () => true, new Map());
    expect(problems.join("\n")).toContain('connector "fake-bank" has no bank that DSoR can call');
  });

  it("DSOR-UNK-03a: org_789's own bank answers neither: org_789's payments are refused at line ④, its invoices are still read, and org_456 still pays", async () => {
    const own = bankSays({ downstream_idempotency: false, outcome_lookup: false }, "org_789");
    const w = await ruleWorldOnTuesday(none, none, none, none, none, none, none, own);
    const refused = await w.ask(keyed(USER_700), "payment.execute", {
      invoice: "dsor://org_789/invoice/INV-2002",
      payment: "dsor://org_789/payment/PAY-901",
      expected_version: 1,
    });
    expect(refused).toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
      message: "payment.execute: org_789's connector is out of service",
    });
    const read = await w.ask(USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-2002",
    });
    expect(read).toHaveProperty("data");
    expect(heard(await execute(w, await draft1002(w)))).toBe("COMMITTED");
  });
});

describe("C2: on a good day, PAY-901 is paid through the fake bank", () => {
  it("DSOR-UNK-03a: the agent drafts INV-1008, cfo_100 approves, the agent releases PAY-901, and user_123 sends it: COMMITTED, paid, one transfer of 31,400.00 USD to VENDOR-44", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.draft("INV-1008");
    expect(heard(drafted)).toBe("PENDING_APPROVAL");
    const kept = (await w.proposals.get("org_456", idOf(drafted)))!;
    const yes = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: kept.uri,
      payload_hash: kept.payload_hash,
    });
    expect(heard(yes)).toBe("COMMITTED");
    expect(heard(await w.ask(keyed(AGENT), "proposal.execute", { proposal: kept.uri }))).toBe(
      "COMMITTED",
    );
    expect(w.drafted.map((p) => [p.id, p.status])).toStrictEqual([["PAY-901", "draft"]]);
    const sent = await execute(w, "dsor://org_456/payment/PAY-901", keyed(SUPERVISOR), INV_1008);
    expect(sent).toMatchObject({
      outcome: "COMMITTED",
      data: { id: "PAY-901", status: "paid", version: 2 },
    });
    expect(w.drafted.map((p) => [p.id, p.status])).toStrictEqual([["PAY-901", "paid"]]);
    expect(w.bank.transfers()).toMatchObject([
      { payment: "PAY-901", vendor: "VENDOR-44", amount: { value: "31400.00", currency: "USD" } },
    ]);
  });
});

describe("C3: the bank gets a key derived from the proposal, never the caller's", () => {
  it("DSOR-IDM-03: the key the bank got is the company's and the proposal's, and holds nothing of the caller's key", async () => {
    const w = await ruleWorldOnTuesday();
    const envelope = keyed(SUPERVISOR);
    const sent = await execute(w, await draft1002(w), envelope);
    const [transfer] = w.bank.transfers();
    expect(transfer?.key).toBe(bankKeyOf("org_456", idOf(sent)));
    expect(transfer?.key).not.toContain(String(envelope.idempotency_key));
  });

  it("DSOR-IDM-03: a replay with the same key gives back the answer, and the bank sends nothing again", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    const envelope = keyed(SUPERVISOR);
    const first = await execute(w, payment, envelope);
    const again = await execute(w, payment, envelope);
    expect(heard(again)).toBe("COMMITTED");
    expect(idOf(again)).toBe(idOf(first));
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-IDM-03: the fake bank sends once for a key it has seen, and gives the first receipt back", async () => {
    const bank = createFakeBank();
    const order = {
      payment: "PAY-901",
      vendor: "VENDOR-44",
      amount: { value: "31400.00", currency: "USD" },
    };
    const one = await bank.pay("k1", order);
    const two = await bank.pay("k1", order);
    expect(two).toStrictEqual(one);
    expect(bank.transfers()).toHaveLength(1);
    expect(await bank.lookup("k1")).toStrictEqual(one);
    expect(await bank.lookup("k2")).toBeUndefined();
  });
});

describe("C4: a slow bank is a success, a broken one a safe retry, a silent one unknown", () => {
  it("DSOR-UNK-03a: a slow bank that answers within DSoR's wait is a success", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    w.bank.mode = "slow";
    w.bank.slowMs = 10;
    expect(heard(await execute(w, payment))).toBe("COMMITTED");
  });

  it("DSOR-ERR-02: a broken bank says it sent nothing: CONNECTOR_UNAVAILABLE, safe with the same key, the payment still a draft; the same key later is paid once", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    const envelope = keyed(SUPERVISOR);
    w.bank.mode = "broken";
    const refused = await execute(w, payment, envelope);
    expect(refused).toMatchObject({ code: "CONNECTOR_UNAVAILABLE", retry: "safe_same_key" });
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["draft"]);
    expect(w.bank.transfers()).toStrictEqual([]);
    w.bank.mode = "good";
    expect(heard(await execute(w, payment, envelope))).toBe("COMMITTED");
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-UNK-01b: a silent bank gives OUTCOME_UNKNOWN, retried only after reconciliation; the proposal is OUTCOME_UNKNOWN, the payment still a draft, and the money left", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    w.bank.mode = "silent";
    const unknown = await execute(w, payment);
    expect(unknown).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    expect((await w.proposals.get("org_456", idOf(unknown)))?.state).toBe("OUTCOME_UNKNOWN");
    expect(w.drafted.map((p) => p.status)).toStrictEqual(["draft"]);
    expect(w.bank.transfers()).toHaveLength(1);
    const record = (await w.log.records()).at(-1)!;
    expect(record).toMatchObject({ operation: "payment.execute@1", result: "OUTCOME_UNKNOWN" });
    const bundle = (await w.log.bundles()).find((b) => b.decision_id === record.decision_bundle);
    expect(bundle?.execution.result).toBe("outcome_unknown");
  });

  it("DSOR-UNK-02: after a silent bank, a replay gives back OUTCOME_UNKNOWN, and a new attempt with a new key is refused while the first is in flight; the bank sent once", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    const envelope = keyed(SUPERVISOR);
    w.bank.mode = "silent";
    const first = await execute(w, payment, envelope);
    w.bank.mode = "good";
    expect(heard(await execute(w, payment, envelope))).toBe("OUTCOME_UNKNOWN");
    const second = await execute(w, payment);
    expect(second).toMatchObject({ code: "CONFLICT" });
    expect(JSON.stringify(second)).toContain(idOf(first));
    expect(w.bank.transfers()).toHaveLength(1);
  });
});

describe("C5: what payment.execute refuses before the bank is called", () => {
  it("DSOR-AUT-01b: the agent cannot send a payment: its slip does not list payment:execute, and the bank sends nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    const refused = await execute(w, payment, keyed(AGENT));
    expect(heard(refused)).not.toBe("COMMITTED");
    expect(refused).toHaveProperty("code");
    expect(w.bank.transfers()).toStrictEqual([]);
  });

  it("step 35's decision D7: a payment of another invoice is refused, and the bank sends nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    const refused = await execute(w, payment, keyed(SUPERVISOR), INV_1008);
    expect(refused).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(w.bank.transfers()).toStrictEqual([]);
  });

  it("step 35's decision D7: a payment already paid is refused with CONFLICT, and the bank sends nothing again", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    expect(heard(await execute(w, payment))).toBe("COMMITTED");
    const again = await execute(w, payment);
    expect(again).toMatchObject({ code: "CONFLICT" });
    expect(JSON.stringify(again)).toContain("is paid, not a draft");
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-CON-01b: an invoice at another version than the caller decided on is STALE_STATE, and the bank sends nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft1002(w);
    const refused = await execute(w, payment, keyed(SUPERVISOR), INV_1002, 7);
    expect(refused).toMatchObject({ code: "STALE_STATE" });
    expect(w.bank.transfers()).toStrictEqual([]);
  });
});
