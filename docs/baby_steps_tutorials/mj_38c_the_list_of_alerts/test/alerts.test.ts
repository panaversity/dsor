// Step 38b: a proposal's move to OUTCOME_UNKNOWN raises an alert in the same moment, whatever way it
// got there; the move out of it closes the alert; an alert still open after the company's bound is
// escalated to its named person by dsor-scheduler's sweep, once (DSOR-UNK-04b, DSOR-UNK-04c; step
// 38b's README, claims C1 to C5).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { DecisionLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, DEL_100, keyed, shippedRoles, SUPERVISOR } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const INV_1002 = "dsor://org_456/invoice/INV-1002";
// dsor-scheduler, DSoR's own login for scheduled work (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const MINUTE = 60 * 1000;
/** What the escalation sweep answers. */
type Escalation = { data: { escalated: { proposal: string }[] } };
const HOUR = 60 * MINUTE;

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** user_123 drafts a payment of INV-1002 and sends it, on a day the bank behaves as given. */
async function sendOn(w: RuleWorld, day: "good" | "broken" | "silent" | "error" | "lost") {
  const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
    invoice: INV_1002,
    expected_version: 1,
  });
  const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
  const pay = w.bank.pay;
  if (day === "error") {
    // The bank was asked, and the line broke before its answer came back.
    w.bank.pay = async () => {
      throw new Error("the connection was reset");
    };
  } else if (day === "lost") {
    w.bank.pay = () => new Promise(() => {});
  } else {
    w.bank.mode = day;
  }
  const sent = await w.ask(keyed(SUPERVISOR), "payment.execute", {
    invoice: INV_1002,
    payment,
    expected_version: 1,
  });
  w.bank.pay = pay;
  w.bank.mode = "good";
  return { sent, id: idOf(sent) };
}

/** PAY-901 sent on a silent day: its proposal's id. */
async function unknownPayment(w: RuleWorld, day: "silent" | "lost" = "silent"): Promise<string> {
  const { sent, id } = await sendOn(w, day);
  expect(sent).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return id;
}

/** Someone runs the escalation sweep over a company. */
function escalate(w: RuleWorld, who: RequestEnvelope = SCHEDULER, company = "org_456") {
  return w.ask(keyed(who), "alert.escalate_due", {
    company: `dsor://${who.tenant}/tenant/${company}`,
  });
}

/** dsor-scheduler reconciles this proposal. */
function reconcile(w: RuleWorld, id: string) {
  return w.ask(keyed(SCHEDULER), "payment.reconcile", {
    proposal: `dsor://org_456/proposal/${id}`,
  });
}

describe("C1: the move to OUTCOME_UNKNOWN raises the alert, in the same moment", () => {
  it("DSOR-UNK-04b: PAY-901 goes unknown on a silent day: one open alert for its proposal, raised at the move's own time", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    const kept = (await w.proposals.get("org_456", id))!;
    const move = kept.transitions.at(-1)!;
    expect(move.to).toBe("OUTCOME_UNKNOWN");
    expect(await w.proposals.alerts("org_456")).toStrictEqual([
      { proposal: id, state: "open", raised_at: move.at },
    ]);
  });

  it("DSOR-UNK-04b: a payment the bank sends, and one it says it never sent, raise no alert", async () => {
    const sent = await ruleWorldOnTuesday();
    expect(heard((await sendOn(sent, "good")).sent)).toBe("COMMITTED");
    expect(await sent.proposals.alerts("org_456")).toStrictEqual([]);
    const refused = await ruleWorldOnTuesday();
    expect((await sendOn(refused, "broken")).sent).toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    expect(await refused.proposals.alerts("org_456")).toStrictEqual([]);
  });
});

describe("C2: every way into OUTCOME_UNKNOWN raises it", () => {
  it("DSOR-UNK-04b: the bank was asked, and its line broke before the answer: OUTCOME_UNKNOWN, and an open alert", async () => {
    const w = await ruleWorldOnTuesday();
    const { sent, id } = await sendOn(w, "error");
    expect(sent).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
  });

  // Found by step 38b's review, H1: the bank sent, then DSoR's record of the send could not be
  //   written. The caller heard OUTCOME_UNKNOWN, and the proposal stayed EXECUTING with no alert
  //   until the program restarted (step 38b's README, decision D8).
  it("DSOR-UNK-04b: the bank sent PAY-902, then the log refused the record of the send: OUTCOME_UNKNOWN, the proposal OUTCOME_UNKNOWN, and an open alert", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1002,
      expected_version: 1,
    });
    let refused = false;
    const log: DecisionLog = {
      add: async (decision, bundle) => {
        if (!refused && decision.operation === "payment.execute@1") {
          refused = true;
          throw new Error("the log's disk is full");
        }
        return w.log.add(decision, bundle);
      },
    };
    const sent = await call(w.registry, log, keyed(SUPERVISOR), "payment.execute", {
      invoice: INV_1002,
      payment: `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`,
      expected_version: 1,
    });
    expect(sent).toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(w.bank.transfers()).toHaveLength(1);
    const id = idOf(sent);
    expect((await w.proposals.get("org_456", id))?.state).toBe("OUTCOME_UNKNOWN");
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
  });
});

describe("C3: the settlement closes the alert, in the same moment", () => {
  it.each([
    { day: "silent", outcome: "COMMITTED" },
    { day: "lost", outcome: "FAILED" },
  ] as const)(
    "DSOR-UNK-04b: PAY-901 is reconciled $outcome: its alert is closed, naming the outcome",
    async ({ day, outcome }) => {
      const w = await ruleWorldOnTuesday();
      const id = await unknownPayment(w, day);
      expect(await reconcile(w, id)).toMatchObject({ data: { state: outcome } });
      const [alert] = await w.proposals.alerts("org_456");
      expect(alert).toMatchObject({ proposal: id, state: "closed", outcome });
      // The time it was raised stays the move to OUTCOME_UNKNOWN's, after the close. Found by
      //   step 38b's review: a raised_at read from the last move passed every test.
      const moves = (await w.proposals.get("org_456", id))!.transitions;
      expect(alert!.raised_at).toBe(moves.find((t) => t.to === "OUTCOME_UNKNOWN")!.at);
    },
  );

  it("DSOR-UNK-04b: the bank does not answer the reconcile: the alert stays open", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    w.bank.mode = "silent";
    expect(await reconcile(w, id)).toMatchObject({ data: { state: "OUTCOME_UNKNOWN" } });
    w.bank.mode = "good";
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
  });

  it("DSOR-UNK-04c: an escalated alert closes too when the payment is settled, and keeps who it went to", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    w.clock.now += HOUR;
    await escalate(w);
    await reconcile(w, id);
    expect(await w.proposals.alerts("org_456")).toMatchObject([
      { proposal: id, state: "closed", outcome: "COMMITTED", escalated_to: "cfo_100" },
    ]);
  });
});

describe("C4: an alert still open after the bound goes to the named person, once", () => {
  it("DSOR-UNK-04c: an hour after PAY-901 went unknown, dsor-scheduler's sweep escalates its alert to cfo_100; a second sweep escalates nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    w.clock.now += HOUR;
    const swept = await escalate(w);
    expect(swept).toMatchObject({
      outcome: "COMMITTED",
      data: { escalated: [{ proposal: `dsor://org_456/proposal/${id}` }], to: "cfo_100" },
    });
    const [alert] = await w.proposals.alerts("org_456");
    expect(alert).toMatchObject({ proposal: id, state: "escalated", escalated_to: "cfo_100" });
    expect(alert!.escalated_at).toBe(new Date(w.clock.now).toISOString());
    expect(await escalate(w)).toMatchObject({ data: { escalated: [] } });
  });

  // Found by step 38b's review, M4: each of three sweeps at once read the alert open, and each
  //   said it escalated it.
  it("DSOR-UNK-04c: three sweeps at once, an hour after: one escalates PAY-901's alert, and the others escalate nothing", async () => {
    const w = await ruleWorldOnTuesday();
    await unknownPayment(w);
    w.clock.now += HOUR;
    const swept = await Promise.all([escalate(w), escalate(w), escalate(w)]);
    const counts = swept.map((answer) => (answer as Escalation).data.escalated.length);
    expect(counts.sort()).toStrictEqual([0, 0, 1]);
  });

  // Changed in step 38b's review: org_456's bound is PT59M, so the hour is met with a sweep every
  //   minute (step 38b's README, decision D10).
  it("DSOR-UNK-04c: 58 minutes after, nothing is escalated, and the alert stays open", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    w.clock.now += 58 * MINUTE;
    expect(await escalate(w)).toMatchObject({ data: { escalated: [] } });
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
  });

  it("DSOR-UNK-04c: a payment settled before the hour is never escalated", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    await reconcile(w, id);
    w.clock.now += 2 * HOUR;
    expect(await escalate(w)).toMatchObject({ data: { escalated: [] } });
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "closed" }]);
  });

  it("DSOR-UNK-04c: a sweep of org_789 leaves org_456's overdue alert open", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await unknownPayment(w);
    w.clock.now += 2 * HOUR;
    const other = await escalate(w, { token: "tok_5c4e", tenant: "org_789" }, "org_789");
    expect(other).toMatchObject({ data: { escalated: [], to: "user_700" } });
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
  });
});

describe("C5: only DSoR's own scheduled login may escalate", () => {
  it.each([
    ["the agent", AGENT],
    ["user_123", SUPERVISOR],
    ["cfo_100", CFO],
  ] as const)(
    "DSOR-UNK-04c: %s calls the sweep: AUTHORIZATION_DENIED, and the overdue alert stays open",
    async (_, who) => {
      const w = await ruleWorldOnTuesday();
      const id = await unknownPayment(w);
      w.clock.now += 2 * HOUR;
      expect(await escalate(w, who)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
      expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
    },
  );

  // Found by break B5: no person's role holds alert:escalate, and an agent's slip needs a signer who
  //   holds it, so the system-only guard passed every test without it. Here the AP supervisor's
  //   role holds it too, and the guard alone refuses user_123 and user_123's agent.
  it("DSOR-UNK-04c: with alert:escalate in the AP supervisor's role, user_123 and the agent under a slip that lists it are still refused", async () => {
    const roles = JSON.parse(shippedRoles.text) as Record<string, string[]>;
    roles["ap_supervisor"] = [...roles["ap_supervisor"]!, "alert:escalate"];
    const table = { file: "roles.json", text: JSON.stringify(roles) };
    const listing = { ...DEL_100, permissions: [...DEL_100.permissions, "alert:escalate"] };
    const w = await ruleWorldOnTuesday(
      undefined,
      [listing],
      undefined,
      undefined,
      undefined,
      table,
    );
    const id = await unknownPayment(w);
    w.clock.now += 2 * HOUR;
    expect(await escalate(w, SUPERVISOR)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await escalate(w, AGENT)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ proposal: id, state: "open" }]);
  });

  it("DSOR-UNK-04c: dsor-scheduler in org_456 names org_789's company: refused, and nothing is escalated", async () => {
    const w = await ruleWorldOnTuesday();
    await unknownPayment(w);
    w.clock.now += 2 * HOUR;
    expect(await escalate(w, SCHEDULER, "org_789")).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect(await w.proposals.alerts("org_456")).toMatchObject([{ state: "open" }]);
  });
});
