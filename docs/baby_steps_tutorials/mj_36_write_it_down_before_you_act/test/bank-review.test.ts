// What step 35's review found, each fix with its test, and a test for each break that left every
// test green (step 35's README, "Think it through", F1 to F9).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { bankKeyOf, type BankOrder, type BankReceipt } from "../src/bank.ts";
import { companyOf, type Company } from "../src/company.ts";
import { handlersFor } from "../src/operations.ts";
import { readConnectors } from "../src/connectors.ts";
import { Refusal, type Answer } from "../src/envelope.ts";
import { newReads } from "../src/freshness.ts";
import { memoryInvoices } from "../src/invoice.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, contract, keyed, shippedWith, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorld, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const none = undefined;
const INV_1002 = "dsor://org_456/invoice/INV-1002";

/** user_123 drafts a payment of this invoice: its address. */
async function draft(w: RuleWorld, invoice = INV_1002): Promise<string> {
  const answer = await w.ask(keyed(SUPERVISOR), "payment.create", { invoice, expected_version: 1 });
  return `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
}

/** Someone sends this payment of this invoice. */
function execute(
  w: RuleWorld,
  payment: string,
  who: RequestEnvelope = keyed(SUPERVISOR),
  invoice = INV_1002,
): Promise<Answer> {
  return w.ask(who, "payment.execute", { invoice, payment, expected_version: 1 });
}

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** Counts every call to the world's bank, a repeated key too, which the bank itself sends once. */
function counted(w: RuleWorld): { calls: () => number } {
  let calls = 0;
  const pay = w.bank.pay;
  w.bank.pay = async (key: string, order: BankOrder): Promise<BankReceipt> => {
    calls += 1;
    return pay(key, order);
  };
  return { calls: () => calls };
}

describe("F1: once the bank may have sent, the work ends COMMITTED or OUTCOME_UNKNOWN", () => {
  it("DSOR-UNK-01b: the bank sends, then the payment store fails: OUTCOME_UNKNOWN, the proposal in flight, and a retry with the same key sends nothing again", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    // The store fails after the bank has answered: the row reads as a draft, and refuses to be
    //   marked paid, as a lost connection would (step 35's review, F1).
    const row = w.drafted[0]!;
    let broken = true;
    let status = row.status;
    Object.defineProperty(row, "status", {
      enumerable: true,
      get: () => status,
      set: (to: typeof status) => {
        if (broken) throw new Error("the connection to the database was lost");
        status = to;
      },
    });
    const envelope = keyed(SUPERVISOR);
    const first = await execute(w, payment, envelope);
    expect(first).toMatchObject({ code: "OUTCOME_UNKNOWN", retry: "after_reconciliation" });
    expect((await w.proposals.get("org_456", idOf(first)))?.state).toBe("OUTCOME_UNKNOWN");
    broken = false;
    expect(heard(await execute(w, payment, envelope))).toBe("OUTCOME_UNKNOWN");
    expect(heard(await execute(w, payment))).toBe("CONFLICT");
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-UNK-01b: the payment is cancelled while the bank sends it: the send ends OUTCOME_UNKNOWN, never COMMITTED", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    // The cancel lands after the bank has taken the payment, before its answer: in memory nothing
    //   holds the row, which the database's lock does (step 35's review, F5).
    const pay = w.bank.pay;
    let cancel: Answer | undefined;
    w.bank.pay = async (key, order) => {
      const receipt = await pay(key, order);
      cancel = await w.ask(keyed(SUPERVISOR), "payment.cancel", { payment, expected_version: 1 });
      return receipt;
    };
    expect(await execute(w, payment)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(heard(cancel!)).toBe("COMMITTED");
    expect(w.bank.transfers()).toHaveLength(1);
  });
});

describe("F2: an invoice is paid once", () => {
  it("DSOR-EXC-01: two drafts of INV-1002, both sent: the second is refused with CONFLICT, and the bank sends once", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await draft(w);
    const second = await draft(w);
    expect(heard(await execute(w, first))).toBe("COMMITTED");
    const again = await execute(w, second);
    expect(again).toMatchObject({ code: "CONFLICT" });
    expect(JSON.stringify(again)).toContain("is paid already, by PAY-901");
    expect(w.bank.transfers()).toHaveLength(1);
  });
});

describe("F3: only a bank that says it sent nothing is safe to try again", () => {
  it.each([
    ["CONNECTOR_UNAVAILABLE", new Refusal("CONNECTOR_UNAVAILABLE", "down", "internal")],
    ["CONFLICT", new Refusal("CONFLICT", "no", "internal")],
    ["a plain error", new Error("the bank's adapter failed")],
  ])(
    "DSOR-ERR-02: a bank that sends, then throws %s, gives OUTCOME_UNKNOWN, and a second attempt sends nothing",
    async (_what, thrown) => {
      const w = await ruleWorldOnTuesday();
      const payment = await draft(w);
      const pay = w.bank.pay;
      w.bank.pay = async (key, order) => {
        await pay(key, order);
        throw thrown;
      };
      const envelope = keyed(SUPERVISOR);
      expect(await execute(w, payment, envelope)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
      w.bank.pay = pay;
      expect(heard(await execute(w, payment, envelope))).toBe("OUTCOME_UNKNOWN");
      expect(heard(await execute(w, payment))).toBe("CONFLICT");
      expect(w.bank.transfers()).toHaveLength(1);
    },
  );
});

describe("F4: a command that cannot be undone must reach a bank", () => {
  it("DSOR-UNK-03a: payment.create changed to non_compensatable stops start-up: it goes to no bank", async () => {
    const changed = {
      ...contract("payment.create"),
      execution: { semantics: "non_compensatable" },
    };
    let message = "";
    try {
      await ruleWorldOnTuesday(none, none, none, shippedWith(changed));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(
      "payment.create: it cannot be undone, and no connector it is routed to is a bank (DSOR-UNK-03a)",
    );
  });
});

describe("F5: the payment stores keep a draft's rules", () => {
  it("step 35's decision D7: memory's pay changes only a draft, at its version", async () => {
    const rows: Payment[] = [];
    const store = memoryPayments(rows);
    const made = await store.create(
      "org_456",
      {
        invoice_id: "INV-1002",
        vendor_id: "VENDOR-44",
        amount: { value: "1.00", currency: "USD" },
      },
      1,
    );
    const id = "payment" in made ? made.payment.id : "";
    expect(await store.pay("org_456", id, 2)).toMatchObject({ changed: false });
    expect(await store.pay("org_456", id, 1)).toMatchObject({
      changed: true,
      payment: { status: "paid", version: 2 },
    });
    expect(await store.pay("org_456", id, 2)).toMatchObject({
      changed: false,
      payment: { status: "paid" },
    });
  });
});

describe("F6, F7, F9: the bank is DSoR's, not the code's", () => {
  it("DSOR-IDM-03: the code's send answers nothing, so no receipt and no key reach it", async () => {
    const w = await ruleWorldOnTuesday();
    const answer = await execute(w, await draft(w));
    expect(JSON.stringify(answer)).not.toContain("dsor_");
    expect(JSON.stringify(answer)).not.toContain("TRF-");
  });

  it("DSOR-UNK-03a: only an operation that sends money gets a bank: payment.create's own code finds none", async () => {
    const seen: string[] = [];
    const code = {
      ...handlersFor(),
      "payment.create": async (_input: unknown, company: Company) => {
        const order = { payment: "PAY-1", vendor: "V", amount: { value: "1.00", currency: "USD" } };
        await company.bank.send(order).catch((error: Error) => seen.push(error.message));
        throw new Refusal("CONFLICT", "the test's code stops here", "internal");
      },
    };
    const w = ruleWorld(none, none, none, none, none, none, none, none, none, code);
    await w.ask(keyed(SUPERVISOR), "payment.create", { invoice: INV_1002, expected_version: 1 });
    expect(seen).toStrictEqual(["this call has no bank"]);
    expect(w.bank.transfers()).toStrictEqual([]);
  });

  it("step 15's decision 5: a Company kept after its call sends nothing", async () => {
    const reads = newReads();
    const bank = { send: async () => {} };
    const company = companyOf(memoryInvoices([]), "org_456", reads, memoryPayments([]), bank);
    reads.closed = true;
    await expect(
      company.bank.send({
        payment: "PAY-1",
        vendor: "V",
        amount: { value: "1.00", currency: "USD" },
      }),
    ).rejects.toThrow("this call has ended");
  });
});

describe("Breaks that survived the review, each with a test now", () => {
  it("DSOR-UNK-01b: a bank slower than DSoR's wait is OUTCOME_UNKNOWN, and a replay asks the bank nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    const calls = counted(w);
    w.bank.mode = "slow";
    w.bank.slowMs = 200;
    const envelope = keyed(SUPERVISOR);
    expect(heard(await execute(w, payment, envelope))).toBe("OUTCOME_UNKNOWN");
    expect(heard(await execute(w, payment, envelope))).toBe("OUTCOME_UNKNOWN");
    expect(calls.calls()).toBe(1);
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-IDM-03: the key is the SHA-256 of the company and the proposal id, so two companies get two keys", () => {
    const sha = createHash("sha256").update("org_456/prop_1").digest("hex");
    expect(bankKeyOf("org_456", "prop_1")).toBe(`dsor_${sha}`);
    expect(bankKeyOf("org_456", "prop_1")).not.toBe(bankKeyOf("org_789", "prop_1"));
  });

  it("step 35's decision D7: the bank is told the payment's own vendor: VENDOR-31 for INV-1006", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w, "dsor://org_456/invoice/INV-1006");
    expect(
      heard(await execute(w, payment, keyed(SUPERVISOR), "dsor://org_456/invoice/INV-1006")),
    ).toBe("COMMITTED");
    expect(w.bank.transfers()).toMatchObject([
      { vendor: "VENDOR-31", amount: { value: "640.00", currency: "USD" } },
    ]);
  });

  it("DSOR-IDM-04: a payment.execute prepared in propose_only mode, released on a silent day: OUTCOME_UNKNOWN, with the prepared proposal's key; a second release is refused", async () => {
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
    const uri = String("proposal" in prepared ? prepared.proposal : "");
    w.bank.mode = "silent";
    const released = await w.ask(keyed(SUPERVISOR), "proposal.execute", { proposal: uri });
    expect(released).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(w.bank.transfers()[0]?.key).toBe(bankKeyOf("org_456", idOf(prepared)));
    w.bank.mode = "good";
    expect(heard(await w.ask(keyed(SUPERVISOR), "proposal.execute", { proposal: uri }))).not.toBe(
      "COMMITTED",
    );
    expect(w.bank.transfers()).toHaveLength(1);
  });

  it("DSOR-AUT-01b: the agent is refused at line ⑤: its slip does not list payment:execute", async () => {
    const w = await ruleWorldOnTuesday();
    const refused = await execute(w, await draft(w), keyed(AGENT));
    expect(refused).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-CNR-01b: each connector serves only its own role: the bank as a company's records is out of service", async () => {
    const file = JSON.parse(readConnectors().text) as { companies: Record<string, unknown> };
    file.companies["org_789"] = { records: "fake-bank", bank: "fake-bank" };
    const w = await ruleWorldOnTuesday(none, none, none, none, none, none, none, {
      file: "connectors.json",
      text: JSON.stringify(file),
    });
    expect(w.registry.plugs.outOfService("org_789", "invoice.get")).toContain(
      "cannot serve as the records",
    );
    expect(w.registry.plugs.outOfService("org_456", "invoice.get")).toBeUndefined();
  });

  it("DSOR-UNK-03a: a silent bank's proposal names why its outcome is unknown", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    w.bank.mode = "silent";
    const unknown = await execute(w, payment);
    const moves = (await w.proposals.transitions()).filter((m) => m.result === "OUTCOME_UNKNOWN");
    expect(JSON.stringify(moves)).toContain("did not answer within 50 ms");
    expect(idOf(unknown)).not.toBe("");
  });
});
