// Step 38c: alert.list, DSoR's first query over its own store. The company's receivers role sees
// every unsettled alert, the named person the ones escalated to them, and anyone else, an agent
// too, is refused. Each alert names its payment and invoice; the list comes in pages, with its
// labels (DSOR-UNK-04b, DSOR-UNK-04c, DSOR-QRY-01, DSOR-CLS-03, DSOR-FRS-01a; step 38c's README,
// claims C1 to C7).
import { describe, expect, it } from "vitest";
import type { OwnReadLook } from "../src/alert-list.ts";
import type { Answer } from "../src/envelope.ts";
import { memoryClaims } from "../src/claims.ts";
import { memoryInvoices } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import { memoryPayments } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { dsorMover } from "../src/proposals.ts";
import { handlersFor } from "../src/operations.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { ownWorkFor } from "../src/revocation.ts";
import {
  ADMIN,
  AGENT,
  CFO,
  DEL_100,
  keyed,
  shipped,
  shippedRoles,
  storyDirectories,
  SUPERVISOR,
  USER_700,
} from "./helpers.ts";
import { ruleWorld, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

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

describe("C9: start-up checks DSoR's own reads", () => {
  // Found while building: the check had no test. A read changes nothing, so it must be a query,
  //   must have a contract, and must not share a name with other code.
  const read = { check: async () => {}, read: async () => ({ items: [] }) };
  it("DSOR-OPR-01: a read with no contract, a read of DSoR's own command, and a read of the company's own query each stop start-up, named", () => {
    const refused = (reads: Record<string, typeof read>): string => {
      try {
        // buildRegistry's places: 0 the contracts, 1 the code, 2 the roles, 11 DSoR's own work, and
        //   20 its own reads; every other place takes its default.
        const args = Array.from({ length: 21 }) as unknown as Parameters<typeof buildRegistry>;
        args[0] = shipped;
        args[1] = handlersFor();
        args[2] = shippedRoles;
        args[11] = ownWorkFor();
        args[20] = reads;
        buildRegistry(...args);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(refused({ "alert.show": read })).toContain(
      "alert.show has DSoR's own read but no contract",
    );
    expect(refused({ "payment.reconcile": read })).toContain(
      "payment.reconcile has DSoR's own read and other code",
    );
    expect(refused({ "invoice.get": read })).toContain(
      "invoice.get has DSoR's own read and other code",
    );
  });
});

// Found by step 38c's review: each test below is one a small break passed.
describe("the review", () => {
  /** Plants a payment of this company, gone unknown, with this id, straight in the store. */
  async function plant(w: RuleWorld, tenant: string, id: string): Promise<void> {
    const requester = {
      identity_mode: "direct" as const,
      subject: "user_123",
      subject_type: "human",
      actor_chain: [],
      active_tenant: tenant,
      subject_authority: { source: "token" as const, as_of: new Date(w.clock.now).toISOString() },
    };
    const by = {
      mover: dsorMover(requester),
      cause: "the test plants it",
      correlation: { request_id: `req_${id}` },
    };
    const invoice = `dsor://${tenant}/invoice/INV-PLANTED`;
    const draft = {
      operation: "payment.execute@1",
      mode: "execute" as const,
      payload: { invoice, payment: `dsor://${tenant}/payment/PAY-PLANTED`, expected_version: 1 },
      payload_hash: `sha256:${"b".repeat(64)}`,
      resources: [invoice],
      requester,
      idempotency_key: `plant-${id}`,
    };
    await w.proposals.create(tenant, id, draft, by, "P7D");
    await w.proposals.move(tenant, id, "PROPOSED", "READY", by);
    await w.proposals.move(tenant, id, "READY", "EXECUTING", by);
    await w.proposals.move(tenant, id, "EXECUTING", "OUTCOME_UNKNOWN", by);
  }
  const ID = (last: string) => `prop_00000000-0000-4000-8000-00000000000${last}`;

  it("DSOR-EXE-02: H2: admin_100, who holds alert:read but is not named in alerts.json, is refused, and the record says DENY", async () => {
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
    expect(await list(w, ADMIN)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "alert.list@1",
      authorization: "DENY",
    });
  });

  it("DSOR-UNK-04c: M2: an alert escalated to another person, before alerts.json named cfo_100, is seen by cfo_100, the person named now", async () => {
    const w = await ruleWorldOnTuesday();
    await plant(w, "org_456", ID("a"));
    await w.proposals.escalateDue("org_456", 0, "cfo_099");
    expect(proposalsIn(await list(w, CFO))).toStrictEqual(["dsor://org_456/proposal/" + ID("a")]);
  });

  it("DSOR-QRY-01: three alerts, raised in the order c, a, b, come back in the order of their ids, a page of one at a time, each once, in three pages", async () => {
    const w = await ruleWorldOnTuesday();
    for (const last of ["c", "a", "b"]) {
      await plant(w, "org_456", ID(last));
      w.clock.now += MINUTE;
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = (await list(
        w,
        SUPERVISOR,
        cursor ? { limit: 1, cursor } : { limit: 1 },
      )) as unknown as AlertPage;
      seen.push(...page.data.items.map((item) => String(item["id"])));
      cursor = page.data.next_cursor;
      pages += 1;
    } while (cursor !== undefined && pages < 5);
    expect(seen).toStrictEqual([ID("a"), ID("b"), ID("c")]);
    expect(pages).toBe(3);
  });

  it("DSOR-FRS-01a: the label's observed_at is the time of the call, not before it and not after", async () => {
    const w = await ruleWorldOnTuesday();
    await twoAlerts(w);
    const before = Date.now();
    const answer = (await list(w, SUPERVISOR)) as unknown as AlertPage;
    const after = Date.now();
    const observed = Date.parse(String(answer.freshness["observed_at"]));
    expect(observed).toBeGreaterThanOrEqual(before);
    expect(observed).toBeLessThanOrEqual(after);
  });

  it("DSOR-UNK-04d: the agent hears that alert.list is never for an agent: the contract refuses it at line ⑤", async () => {
    const w = await ruleWorldOnTuesday();
    const refused = await list(w, AGENT);
    expect((refused as { message: string }).message).toContain("is never for an agent");
  });

  it("DSOR-TEN-01a: org_789 names another receivers role: admin_700, its tenant administrator, sees org_789's open alert; user_700, its named person, sees no open one; org_456's file still decides org_456's", async () => {
    const roles = JSON.parse(shippedRoles.text) as Record<string, string[]>;
    roles["tenant_admin"] = [...roles["tenant_admin"]!, "alert:read"];
    const table = { file: "roles.json", text: JSON.stringify(roles) };
    const line = { alert_within: "PT0S", escalate_after: "PT59M", sweep_every: "PT1M" };
    const alerts = {
      file: "alerts.json",
      text: JSON.stringify({
        org_456: { ...line, receivers: "ap_supervisor", escalate_to: "cfo_100" },
        org_789: { ...line, receivers: "tenant_admin", escalate_to: "user_700" },
      }),
    };
    const args = Array.from({ length: 11 }) as unknown as Parameters<typeof ruleWorld>;
    args[5] = table;
    args[10] = alerts;
    const w = ruleWorld(...args);
    await plant(w, "org_789", ID("d"));
    const ADMIN_700 = { token: "tok_a700", tenant: "org_789" };
    expect(proposalsIn(await list(w, ADMIN_700))).toStrictEqual([
      "dsor://org_789/proposal/" + ID("d"),
    ]);
    expect(proposalsIn(await list(w, USER_700))).toStrictEqual([]);
    expect(await list(w, ADMIN)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-FRS-01a: a look kept after the call reads nothing more", async () => {
    let kept: OwnReadLook | undefined;
    const keeping = {
      "alert.list": {
        check: async () => {},
        read: async (_input: unknown, look: OwnReadLook) => {
          kept = look;
          await look.unsettled(["open"], undefined, 1);
          return { items: [] };
        },
      },
    };
    const args = Array.from({ length: 21 }) as unknown as Parameters<typeof buildRegistry>;
    args[0] = shipped;
    args[1] = handlersFor();
    args[2] = shippedRoles;
    args[11] = ownWorkFor();
    // Changed in step 45: and the story's directories, so user_123's line ② finds her company (C2).
    args[8] = storyDirectories();
    args[20] = keeping;
    const registry = buildRegistry(...args);
    await call(registry, createLog(), SUPERVISOR, "alert.list", {});
    await expect(kept!.unsettled(["open"], undefined, 1)).rejects.toThrow("this call has ended");
    await expect(kept!.proposal(ID("a"))).rejects.toThrow("this call has ended");
  });

  // Found by step 38c's review, M1: nothing tested a store that leaks. Here org_456's look is
  //   handed org_789's alert and proposal. Each row now carries the alert's own company, and its
  //   addresses are org_789's, so the pipeline's company check refuses the answer.
  it("DSOR-TEN-01a: M1: a store that hands org_456's list org_789's alert is refused, and user_123 sees nothing of it", async () => {
    const w = await ruleWorldOnTuesday();
    await plant(w, "org_789", ID("e"));
    const store = w.proposals;
    const leaky = {
      ...store,
      unsettled: (
        _t: string,
        ...rest: Parameters<typeof store.unsettled> extends [string, ...infer R] ? R : never
      ) => store.unsettled("org_789", ...rest),
      get: (_t: string, id: string) => store.get("org_789", id),
    };
    const args = Array.from({ length: 21 }) as unknown as Parameters<typeof buildRegistry>;
    args[0] = shipped;
    args[1] = handlersFor();
    args[2] = shippedRoles;
    args[10] = memoryClaims(memoryInvoices(), memoryPayments(), leaky);
    args[11] = ownWorkFor();
    const answer = await call(buildRegistry(...args), createLog(), SUPERVISOR, "alert.list", {});
    expect(answer).not.toHaveProperty("data");
    expect(JSON.stringify(answer)).not.toContain(ID("e"));
  });

  it("DSOR-OPR-01: a read of a command that has no other code stops start-up: a read changes nothing, so it is a query", () => {
    const { "payment.reconcile": _left, ...own } = ownWorkFor();
    const args = Array.from({ length: 21 }) as unknown as Parameters<typeof buildRegistry>;
    args[0] = shipped;
    args[1] = handlersFor();
    args[2] = shippedRoles;
    args[11] = own;
    args[20] = { "payment.reconcile": { check: async () => {}, read: async () => ({}) } };
    expect(() => buildRegistry(...args)).toThrow(
      "payment.reconcile: DSoR's own read changes nothing, so it is a query",
    );
  });
});
