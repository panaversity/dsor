// NEW IN STEP 35: a pretend bank, DSoR's second connector, and the one way DSoR calls a bank. A bank
// cannot undo a payment, so DSoR sends one only to a bank that refuses a repeated key or answers
// whether a payment went through (DSOR-UNK-03a), and gives it a key derived from the proposal, so
// every attempt at one payment carries the same key (DSOR-IDM-03, DSOR-IDM-04). The fake has four
// switches: good, slow, broken, and silent (step 35's README, decisions D1 to D5).
import { createHash } from "node:crypto";
import { Refusal } from "./envelope.ts";
import type { Money } from "./money.ts";

/** What DSoR asks a bank to send: which payment, to which vendor, how much. */
export type BankOrder = { payment: string; vendor: string; amount: Money };

/** What a bank answers once it has sent a payment: its own reference, and what it sent. */
export type BankReceipt = BankOrder & { reference: string; key: string };

/** What DSoR needs of a bank: send under a key, and say later what was sent under a key. */
export type Bank = {
  pay: (key: string, order: BankOrder) => Promise<BankReceipt>;
  lookup: (key: string) => Promise<BankReceipt | undefined>;
};

/** A bank, with how long DSoR waits for its answer. The wait is DSoR's, not the bank's. */
export type BankLine = { bank: Bank; waitMs: number };

/** The fake's switches. */
export type BankMode = "good" | "slow" | "broken" | "silent";

/** The fake bank, with its switch, how slow "slow" is, and every transfer it made. */
export type FakeBank = Bank & {
  mode: BankMode;
  slowMs: number;
  transfers: () => BankReceipt[];
};

/** A bank that says, before sending anything, that it sent nothing: down, or declined. */
export class BankDown extends Error {}

/**
 * A pretend bank, in memory. Good: it sends and answers. Slow: it sends and answers after slowMs.
 * Broken: it sends nothing and says so. Silent: it sends, and never answers. A key it has seen
 * gets the first receipt back, and nothing is sent again (downstream idempotency).
 */
export function createFakeBank(): FakeBank {
  const sent: BankReceipt[] = [];
  const byKey = new Map<string, BankReceipt>();
  const bank: FakeBank = {
    mode: "good",
    slowMs: 20,
    transfers: () => structuredClone(sent),
    pay: async (key, order) => {
      if (bank.mode === "broken") throw new BankDown("the bank is down, and sent nothing");
      let receipt = byKey.get(key);
      if (receipt === undefined) {
        receipt = { ...structuredClone(order), key, reference: `TRF-${sent.length + 1}` };
        byKey.set(key, receipt);
        sent.push(receipt);
      }
      // The money has left. A silent bank never says so.
      if (bank.mode === "silent") return new Promise<never>(() => {});
      if (bank.mode === "slow") await new Promise((done) => setTimeout(done, bank.slowMs));
      return structuredClone(receipt);
    },
    lookup: async (key) => {
      const receipt = byKey.get(key);
      return receipt === undefined ? undefined : structuredClone(receipt);
    },
  };
  return bank;
}

/**
 * The key DSoR gives the bank for one proposal: derived from the company and the proposal's id, so
 * every attempt at the same payment carries the same key, whatever key the caller sent
 * (DSOR-IDM-03; step 35's README, decision D3).
 */
export function bankKeyOf(tenant: string, proposalId: string): string {
  return `dsor_${createHash("sha256").update(`${tenant}/${proposalId}`).digest("hex")}`;
}

/**
 * Sends one order through a bank, and waits at most the line's wait. A bank that says it sent
 * nothing gives CONNECTOR_UNAVAILABLE, which is safe to retry with the same key. Anything else,
 * silence or an error the bank did not explain, gives OUTCOME_UNKNOWN: the money may have left
 * (DSOR-UNK-01b; step 35's README, decision D5).
 */
export async function sendThrough(
  line: BankLine,
  key: string,
  order: BankOrder,
): Promise<BankReceipt> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<"silent">((done) => {
    timer = setTimeout(() => done("silent"), line.waitMs);
  });
  const unknown = (why: string) =>
    new Refusal(
      "OUTCOME_UNKNOWN",
      `payment ${JSON.stringify(order.payment)}: ${why}, so it may or may not have been sent`,
      "internal",
    );
  let answer: BankReceipt | "silent";
  try {
    answer = await Promise.race([line.bank.pay(key, order), silence]);
  } catch (thrown) {
    // Only a bank that says it sent nothing is safe to try again. Anything else it throws, a
    //   refusal of its own words too, may come after the money left. Found by step 35's review,
    //   F3: a bank that sent and then threw CONNECTOR_UNAVAILABLE was sent again.
    if (thrown instanceof BankDown) {
      const why = `payment ${JSON.stringify(order.payment)}: the bank is down, and sent nothing`;
      throw new Refusal("CONNECTOR_UNAVAILABLE", why, "internal");
    }
    throw unknown("the bank failed without saying whether it sent it");
  } finally {
    clearTimeout(timer);
  }
  if (answer === "silent") throw unknown(`the bank did not answer within ${line.waitMs} ms`);
  return answer;
}
