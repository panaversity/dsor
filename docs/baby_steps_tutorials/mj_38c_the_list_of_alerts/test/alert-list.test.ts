// Step 38c: alert.list, DSoR's first query over its own store. The company's receivers role sees
// every unsettled alert, the named person the ones escalated to them, and anyone else, an agent
// too, is refused. Each alert names its payment and invoice; the list comes in pages, with its
// labels (DSOR-UNK-04b, DSOR-UNK-04c, DSOR-QRY-01, DSOR-CLS-03, DSOR-FRS-01a; step 38c's README,
// claims C1 to C7).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  DEL_100,
  keyed,
  shippedRoles,
  SUPERVISOR,
  USER_700,
} from "./helpers.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

// dsor-scheduler, DSoR's own login for scheduled work (step 25c's README, decision D1).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };
const MINUTE = 60 * 1000;

/** What alert.list answers. */
type AlertPage = {
  data: { items: Record<string, unknown>[]; next_cursor?: string; capped?: unknown };
  classification: string;
  freshness: Record<string, unknown>;
};

/** The proposal's id an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** user_123 drafts a payment of this invoice and sends it on a silent day: its addresses. */
async function unknownPayment(w: RuleWorld, invoice = "INV-1002") {
  const bill = `dsor://org_456/invoice/${invoice}`;
  const drafted = await w.ask(keyed(SUPERVISOR), "payment.create", {
    invoice: bill,
    expected_version: 1,
  });
  const payment = `dsor://org_456/payment/${(drafted as { data: { id: string } }).data.id}`;
  w.bank.mode = "silent";
  const sent = await w.ask(keyed(SUPERVISOR), "payment.execute", {
    invoice: bill,
    payment,
    expected_version: 1,
  });
  w.bank.mode = "good";
  expect(sent).toMatchObject({ code: "OUTCOME_UNKNOWN" });
  return {
    id: idOf(sent),
    proposal: `dsor://org_456/proposal/${idOf(sent)}`,
    payment,
    invoice: bill,
  };
}

/** dsor-scheduler's escalation sweep over org_456. */
function escalate(w: RuleWorld) {
  return w.ask(keyed(SCHEDULER), "alert.escalate_due", {
    company: "dsor://org_456/tenant/org_456",
  });
}

/** Someone lists their alerts. A query carries no key. */
async function list(w: RuleWorld, who: RequestEnvelope, input: unknown = {}): Promise<Answer> {
  return w.ask(who, "alert.list", input);
}

/** The proposals of a list's alerts, sorted. */
function proposalsIn(answer: Answer): string[] {
  return (answer as unknown as AlertPage).data.items.map((item) => String(item["proposal"])).sort();
}

/**
 * PAY-901 of INV-1002 unknown at 15:05 and escalated to cfo_100 at 16:04; PAY-902 of INV-1009
 * unknown at 16:04, still open.
 */
async function twoAlerts(w: RuleWorld) {
  const first = await unknownPayment(w, "INV-1002");
  w.clock.now += 59 * MINUTE;
  await escalate(w);
  const second = await unknownPayment(w, "INV-1009");
  return { first, second };
}

describe("C1 and C2: each person sees the alerts meant for them", () => {
  it("DSOR-UNK-04b: user_123, of org_456's receivers role, sees every unsettled alert: the escalated one and the open one", async () => {
    const w = await ruleWorldOnTuesday();
    const { first, second } = await twoAlerts(w);
    expect(proposalsIn(await list(w, SUPERVISOR))).toStrictEqual(
      [first.proposal, second.proposal].sort(),
    );
  });

  it("DSOR-UNK-04c: cfo_100, the named person, sees only the alert escalated to them", async () => {
    const w = await ruleWorldOnTuesday();
    const { first } = await twoAlerts(w);
    expect(proposalsIn(await list(w, CFO))).toStrictEqual([first.proposal]);
  });
});

describe("C3: anyone else is refused", () => {
  it("DSOR-UNK-04b: admin_100, whose role holds no alert:read, is refused", async () => {
    const w = await ruleWorldOnTuesday();
    await twoAlerts(w);
    expect(await list(w, ADMIN)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-UNK-04b: with alert:read in the tenant administrator's role, admin_100 is still refused: alerts.json names neither its role nor admin_100", async () => {
    const roles = JSON.parse(shippedRoles.text) as Record<string, string[]>;
    roles["tenant_admin"] = [...roles["tenant_admin"]!, "alert:read"];
    const table = { file: "roles.json", text: JSON.stringify(roles) };
    const w = await ruleWorldOnTuesday(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      table,
    );
    await twoAlerts(w);
    const refused = await list(w, ADMIN);
    expect(refused).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect((refused as { message: string }).message).toContain("alerts.json");
  });

  it("DSOR-UNK-04b: the agent, under a slip that lists alert:read, is refused", async () => {
    const listing = { ...DEL_100, permissions: [...DEL_100.permissions, "alert:read"] };
    const w = await ruleWorldOnTuesday(undefined, [listing]);
    await twoAlerts(w);
    expect(await list(w, AGENT)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

describe("C4: a settled payment's alert drops off", () => {
  it("DSOR-UNK-04b: PAY-901 is reconciled: user_123 and cfo_100 no longer see its alert", async () => {
    const w = await ruleWorldOnTuesday();
    const { first, second } = await twoAlerts(w);
    await w.ask(keyed(SCHEDULER), "payment.reconcile", { proposal: first.proposal });
    expect(proposalsIn(await list(w, SUPERVISOR))).toStrictEqual([second.proposal]);
    expect(proposalsIn(await list(w, CFO))).toStrictEqual([]);
  });
});

describe("C5: each alert names what it is about", () => {
  it("DSOR-UNK-04c: the escalated alert names its proposal, state, times, person, payment, and invoice; the open one has no person", async () => {
    const w = await ruleWorldOnTuesday();
    const { first, second } = await twoAlerts(w);
    const kept = await w.proposals.alerts("org_456");
    const raised = (id: string) => kept.find((alert) => alert.proposal === id)!;
    const items = ((await list(w, SUPERVISOR)) as unknown as AlertPage).data.items;
    expect(items.find((item) => item["proposal"] === first.proposal)).toStrictEqual({
      tenant_id: "org_456",
      id: first.id,
      proposal: first.proposal,
      state: "escalated",
      raised_at: raised(first.id).raised_at,
      escalated_to: "cfo_100",
      escalated_at: raised(first.id).escalated_at,
      payment: first.payment,
      invoice: first.invoice,
    });
    expect(items.find((item) => item["proposal"] === second.proposal)).toStrictEqual({
      tenant_id: "org_456",
      id: second.id,
      proposal: second.proposal,
      state: "open",
      raised_at: raised(second.id).raised_at,
      payment: second.payment,
      invoice: second.invoice,
    });
  });
});

describe("C6: pages, and one company only", () => {
  it("DSOR-QRY-01: a page of one, then the next by its cursor; a limit of 1000 is cut to 10, and the answer says so", async () => {
    const w = await ruleWorldOnTuesday();
    const { first, second } = await twoAlerts(w);
    const page1 = (await list(w, SUPERVISOR, { limit: 1 })) as unknown as AlertPage;
    expect(page1.data.items).toHaveLength(1);
    expect(page1.data.next_cursor).toBe(page1.data.items[0]!["id"]);
    const page2 = await list(w, SUPERVISOR, { limit: 1, cursor: page1.data.next_cursor });
    expect(
      [...proposalsIn(page1 as unknown as Answer), ...proposalsIn(page2)].sort(),
    ).toStrictEqual([first.proposal, second.proposal].sort());
    expect((page2 as unknown as AlertPage).data).not.toHaveProperty("next_cursor");
    const wide = (await list(w, SUPERVISOR, { limit: 1000 })) as unknown as AlertPage;
    expect(wide.data.capped).toStrictEqual({ asked: 1000, max: 10 });
  });

  it("DSOR-TEN-01a: user_700, of org_789's receivers role, sees none of org_456's alerts", async () => {
    const w = await ruleWorldOnTuesday();
    await twoAlerts(w);
    expect(proposalsIn(await list(w, USER_700))).toStrictEqual([]);
  });

  it("DSOR-QRY-01: a cursor that is not an id is refused before anything is read", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await list(w, SUPERVISOR, { cursor: "dsor://org_789/alert/x" })).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("C7: the answer's labels", () => {
  it("DSOR-FRS-01a: the list is internal, read now from DSoR's own store, and its record names each alert it read", async () => {
    const w = await ruleWorldOnTuesday();
    const { first, second } = await twoAlerts(w);
    const answer = (await list(w, SUPERVISOR)) as unknown as AlertPage;
    expect(answer.classification).toBe("internal");
    expect(answer.freshness).toMatchObject({ mode: "current", connector: "dsor" });
    expect(Date.parse(String(answer.freshness["observed_at"]))).not.toBeNaN();
    const record = (await w.log.records()).at(-1)!;
    expect(record).toMatchObject({ operation: "alert.list@1", authorization: "ALLOW" });
    expect([...(record.resources ?? [])].sort()).toStrictEqual(
      [`dsor://org_456/alert/${first.id}`, `dsor://org_456/alert/${second.id}`].sort(),
    );
  });
});
