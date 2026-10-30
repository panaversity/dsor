// Step 37's review: each finding, with its test (step 37's README, "What the review found").
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { holdProblems } from "../src/holds.ts";
import { keyed, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";
const HELD = { code: "RESOURCE_HELD", retry: "after_reconciliation" };

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** user_123 drafts a payment of INV-1002: its address. */
async function draft(w: RuleWorld): Promise<string> {
  const answer = await w.ask(keyed(SUPERVISOR), "payment.create", {
    invoice: INV_1002,
    expected_version: 1,
  });
  return `dsor://org_456/payment/${(answer as { data: { id: string } }).data.id}`;
}

/** user_123 sends this payment of INV-1002, in this mode. */
function send(w: RuleWorld, payment: string, mode?: "validate_only") {
  const who = mode === undefined ? keyed(SUPERVISOR) : { ...SUPERVISOR, mode };
  return w.ask(who, "payment.execute", { invoice: INV_1002, payment, expected_version: 1 });
}

describe("F1: while the first send is running, a second one hears CONFLICT, as one attempt at a time says", () => {
  it("DSOR-EXC-01: PAY-902 of INV-1002 sent while the bank is still sending PAY-901: CONFLICT, naming PAY-901's proposal, not RESOURCE_HELD", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await draft(w);
    const second = await draft(w);
    let during: Answer | undefined;
    const pay = w.bank.pay;
    w.bank.pay = async (key, order) => {
      w.bank.pay = pay;
      during = await send(w, second);
      return pay(key, order);
    };
    const sent = await send(w, first);
    expect(heard(sent)).toBe("COMMITTED");
    expect(during).toMatchObject({ code: "CONFLICT" });
    expect(JSON.stringify(during)).toContain(idOf(sent));
  });
});

describe("F2: a hold_on_unknown alias that line ⑨ gives no address is refused at start-up", () => {
  it("DSOR-UNK-03b: hold_on_unknown naming the vendor, which line ⑨ binds without an address a hold can match, stops start-up", async () => {
    const { contracts } = (await ruleWorldOnTuesday()).registry;
    const execute = contracts.get("payment.execute")!;
    const broken = {
      ...execute,
      in_flight: { ...(execute["in_flight"] as object), hold_on_unknown: ["payment", "vendor"] },
    };
    expect(holdProblems([broken])).toStrictEqual([
      'payment.execute: in_flight.hold_on_unknown names "vendor", which line ⑨ gives no address a hold can match: only input.<field>, or state.<alias>.invoice_id, can be held (DSOR-UNK-03b)',
    ]);
  });
});

describe("T1: a dry run hears the hold, and places none", () => {
  it("DSOR-OPR-06: while PAY-901 is unknown, a dry run of its cancel and of a new draft of INV-1002 hear RESOURCE_HELD, as the real calls would", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    w.bank.mode = "silent";
    expect(await send(w, payment)).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    w.bank.mode = "good";
    const dry = { ...SUPERVISOR, mode: "validate_only" as const };
    expect(await w.ask(dry, "payment.cancel", { payment, expected_version: 1 })).toMatchObject(
      HELD,
    );
    expect(
      await w.ask(dry, "payment.create", { invoice: INV_1002, expected_version: 1 }),
    ).toMatchObject(HELD);
  });

  it("DSOR-OPR-06: a dry run of a send places no hold", async () => {
    const w = await ruleWorldOnTuesday();
    expect(heard(await send(w, await draft(w), "validate_only"))).toBe("VALIDATED");
    expect(w.holds.all()).toStrictEqual([]);
  });
});

describe("L2: the refusal names a record the caller named", () => {
  it("DSOR-ERR-01b: a cancel of PAY-901 while it is held names PAY-901, the payment the caller named, not its invoice", async () => {
    const w = await ruleWorldOnTuesday();
    const payment = await draft(w);
    w.bank.mode = "silent";
    await send(w, payment);
    w.bank.mode = "good";
    const cancel = await w.ask(keyed(SUPERVISOR), "payment.cancel", {
      payment,
      expected_version: 1,
    });
    expect(cancel).toMatchObject(HELD);
    expect((cancel as { message: string }).message).toMatch(/^payment /);
  });
});
