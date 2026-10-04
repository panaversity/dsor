// NEW IN STEP 18: delegations, the permission slip. An agent calls only under a slip that a
// person signed and DSoR holds, and never with more power than that person holds now
// (DSOR-DEL-01a, DSOR-DEL-01b, DSOR-DEL-02, DSOR-DEL-07, and DSOR-DEL-08 in
// specs/dsor/02-security.md, section 13; step 18's README, C1 to C10).
import { describe, expect, it, vi } from "vitest";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Principal } from "../src/principals.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { memorySlips, NO_SLIPS, type SlipStore } from "../src/slips.ts";
import {
  AGENT,
  CFO,
  DEL_100,
  DEL_102,
  FIRM_IN_456,
  FIRM_IN_789,
  MASKED_1008_OF_456,
  PAY_901_DRAFT,
  STARTING_ROLES,
  STORY_SLIPS,
  SUPERVISOR,
  handlers,
  refusal,
  rolesFile,
  shipped,
  shippedRoles,
  slipRegistry,
  withPlanted,
} from "./helpers.ts";

const CREATE = { invoice: "dsor://org_456/invoice/INV-1008" };
const CANCEL = { payment: "dsor://org_456/payment/PAY-901" };
const READ = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The slips of the story, with del_100 changed as the test says. */
function with100(changed: Record<string, unknown>): SlipStore {
  return memorySlips(STORY_SLIPS.map((s) => (s.id === "del_100" ? { ...s, ...changed } : s)));
}

/** The story's slips, but none for accounts-payable-fte. */
const NONE_FOR_THE_AGENT = memorySlips(STORY_SLIPS.filter((s) => s.id !== "del_100"));

/** A planted principal of org_456 with these roles. */
function person(id: string, roles: string[], type: Principal["type"] = "human"): Principal {
  return { id, type, memberships: [{ tenant_id: "org_456", roles }] };
}

describe("C1: an agent's command runs only under an active slip in DSoR's store", () => {
  it("DSOR-DEL-01a: the agent drafts PAY-901 under del_100", async () => {
    const rows: Payment[] = [];
    const answer = await call(slipRegistry(undefined, undefined, rows), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({ data: { id: "PAY-901", status: "draft" }, semantics: "compensatable" });
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  it("DSOR-DEL-01a: with no slip, the agent's draft gets DELEGATION_REQUIRED, recorded, and no draft", async () => {
    const rows: Payment[] = [];
    const log = createLog();
    const answer = await call(slipRegistry(NONE_FOR_THE_AGENT, undefined, rows), log, AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: '"payment.create" needs a slip: accounts-payable-fte holds no person\'s slip in org_456',
      retry: "never",
    });
    expect(await log.records()).toMatchObject([
      { operation: "payment.create@1", authorization: "DENY", result: "DELEGATION_REQUIRED" },
    ]);
    expect(rows).toStrictEqual([]);
  });

  it.each([
    ["torn up", { status: "revoked" }, "DELEGATION_REVOKED", "slip del_100 was torn up"],
    ["expired by its status", { status: "expired" }, "DELEGATION_EXPIRED", "slip del_100 is past its date"],
    ["past its date", { expires_at: "2001-01-01T00:00:00Z" }, "DELEGATION_EXPIRED", "slip del_100 is past its date"],
    ["suspended", { status: "suspended" }, "DELEGATION_REQUIRED", "slip del_100 is suspended, not active"],
  ])("DSOR-DEL-01a: a slip that is %s is refused at line ③, recorded, with no draft", async (_, changed, code, why) => {
    const rows: Payment[] = [];
    const log = createLog();
    const lines: number[] = [];
    const answer = await call(slipRegistry(with100(changed), undefined, rows), log, AGENT, "payment.create", CREATE, (n) => lines.push(n));
    expect(answer).toMatchObject({ code, message: `"payment.create": ${why}`, retry: "never" });
    expect(lines).toStrictEqual([1, 2, 3, 11]);
    expect(await log.records()).toMatchObject([{ authorization: "DENY", result: code }]);
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-01a: a slip for another agent covers nothing", async () => {
    const other = memorySlips([{ ...DEL_100, delegate: "other-fte" }]);
    const answer = await call(slipRegistry(other), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({ code: "DELEGATION_REQUIRED" });
  });

  // A person who works in both companies signs a slip in org_789. If DSoR found slips by
  // the agent alone, that person's rights in org_456 would let the draft through.
  it("DSOR-DEL-01a: a slip in org_789 covers nothing in org_456, even when its signer works in both", async () => {
    const both: Principal = {
      id: "both_100",
      type: "human",
      memberships: [
        { tenant_id: "org_456", roles: ["ap_supervisor"] },
        { tenant_id: "org_789", roles: ["ap_supervisor"] },
      ],
    };
    const elsewhere = memorySlips([{ ...DEL_100, id: "del_199", tenant: "org_789", delegator: "both_100" }]);
    const rows: Payment[] = [];
    const on = slipRegistry(elsewhere, undefined, rows);
    const answer = await withPlanted("tok_both", both, () =>
      call(on, createLog(), AGENT, "payment.create", CREATE),
    );
    expect(answer).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(rows).toStrictEqual([]);
  });

  // Two locks keep a company (DSOR-TEN-01b). The store filters by company, and line ③
  // checks that the slip it got is this agent's, in this company.
  it("DSOR-TEN-01b: a slip of another company, from a store that should not give it, is never used", async () => {
    const leaky: SlipStore = { find: async () => ({ slip: structuredClone(DEL_102), past: false }) };
    const rows: Payment[] = [];
    const answer = await call(slipRegistry(leaky, undefined, rows), createLog(), FIRM_IN_456, "payment.create", CREATE);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: "the store answered with a slip of someone else" });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-01a: line ③ refuses before line ⑤, and the code never runs", async () => {
    const spy = vi.fn<Handler>(() => ({}));
    const on = buildRegistry(shipped, { ...handlers, "payment.create": spy }, shippedRoles, undefined, undefined, undefined, undefined, NONE_FOR_THE_AGENT);
    const lines: number[] = [];
    await call(on, createLog(), AGENT, "payment.create", CREATE, (n) => lines.push(n));
    expect(lines).toStrictEqual([1, 2, 3, 11]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-DEL-01a: a person needs no slip: user_123 drafts with no slip in the store", async () => {
    const answer = await call(slipRegistry(NO_SLIPS), createLog(), SUPERVISOR, "payment.create", CREATE);
    expect(answer).toMatchObject({ data: { id: "PAY-901" } });
  });
});

describe("C2: nothing the agent sends, and no role in its login, widens its slip", () => {
  // Passes before step 18's code: the closed envelope of step 10 already refuses it.
  it("DSOR-DEL-01b: an envelope that adds scopes is refused, and nothing is drafted", async () => {
    const rows: Payment[] = [];
    const widened = { ...AGENT, scopes: ["payment:cancel"] } as RequestEnvelope;
    const answer = await call(slipRegistry(undefined, undefined, rows), createLog(), widened, "payment.create", CREATE);
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rows).toStrictEqual([]);
  });

  it("step 18's decision 11: an agent login that holds a role stops start-up, named", async () => {
    const roleful: Principal = { id: "roleful-fte", type: "agent", memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }] };
    const message = await withPlanted("tok_roleful", roleful, () => refusal(() => buildRegistry(shipped, handlers, shippedRoles)));
    expect(message).toBe(
      'the registry refused to start:\n  roleful-fte is an agent, and holds the role "ap_supervisor" in org_456: an agent\'s power comes only from a person\'s slip',
    );
  });

  it("step 18's decision 11: the shipped logins give no agent a role", () => {
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles))).toBe("");
  });
});

describe("C3: the agent may use only what its slip lists and its signer holds now", () => {
  // The map's "Done when": the same request, before and after user_123 loses the right.
  it("DSOR-DEL-02: user_123 loses payment:create, and the agent's next draft is refused, though del_100 still lists it", async () => {
    const before: Payment[] = [];
    expect(await call(slipRegistry(undefined, undefined, before), createLog(), AGENT, "payment.create", CREATE)).toMatchObject({ data: { id: "PAY-901" } });
    const cut = rolesFile({ ...STARTING_ROLES, ap_supervisor: ["invoice:read", "invoice:issue", "payment:cancel"] });
    const after: Payment[] = [];
    const log = createLog();
    const lines: number[] = [];
    const answer = await call(slipRegistry(undefined, cut, after), log, AGENT, "payment.create", CREATE, (n) => lines.push(n));
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now',
    });
    expect(lines).toStrictEqual([1, 2, 3, 5, 11]);
    expect(after).toStrictEqual([]);
    expect(await log.records()).toMatchObject([{ authorization: "DENY", result: "AUTHORIZATION_DENIED" }]);
  });

  it("DSOR-DEL-02: del_100 lists no payment:cancel, so the agent's cancel is denied, though user_123 holds it", async () => {
    const rows: Payment[] = [{ ...PAY_901_DRAFT } as Payment];
    const answer = await call(slipRegistry(undefined, undefined, rows), createLog(), AGENT, "payment.cancel", CANCEL);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"payment.cancel" needs payment:cancel, which slip del_100 does not list',
    });
    expect(rows[0]?.status).toBe("draft");
  });

  it("DSOR-DEL-02: a slip signed by someone who is not a member of the company grants nothing", async () => {
    const answer = await call(slipRegistry(with100({ delegator: "user_700" })), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  // Only a person signs a slip (§13: "a permission slip from a human to an agent").
  it.each([
    ["an agent", "firm-ap-fte"],
    ["nobody DSoR knows", "user_999"],
  ])("DSOR-DEL-02: a slip signed by %s grants nothing", async (_, delegator) => {
    const answer = await call(slipRegistry(with100({ delegator })), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-DEL-02: a slip signed by an application grants nothing, though the application's role holds the permission", async () => {
    const app = person("ap-batch", ["ap_supervisor"], "application");
    const on = slipRegistry(with100({ delegator: "ap-batch" }));
    const answer = await withPlanted("tok_app", app, () => call(on, createLog(), AGENT, "invoice.get", READ));
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  // Start-up refuses an agent with a role, so only a planted one can hold one. Line ⑤ still
  // never reads it.
  it("DSOR-DEL-02: an agent's own role never counts, only its slip", async () => {
    const roleful: Principal = { id: "roleful-fte", type: "agent", clearance: "internal", memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }] };
    const slips = memorySlips([{ ...DEL_100, id: "del_198", delegate: "roleful-fte", permissions: ["invoice:read"] }]);
    const rows: Payment[] = [];
    const on = slipRegistry(slips, undefined, rows);
    const answer = await withPlanted("tok_roleful", roleful, () =>
      call(on, createLog(), { token: "tok_roleful", tenant: "org_456" }, "payment.create", CREATE),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-02: firm-ap-fte may cancel in org_789, where del_102 and user_700 allow it, and not in org_456", async () => {
    const theirs: Payment = { ...PAY_901_DRAFT, tenant_id: "org_789", id: "PAY-950", invoice_id: "INV-2001", vendor_id: "VENDOR-77" } as Payment;
    const ours: Payment = { ...PAY_901_DRAFT } as Payment;
    const rows = [theirs, ours];
    const on = slipRegistry(undefined, undefined, rows);
    const in789 = await call(on, createLog(), FIRM_IN_789, "payment.cancel", { payment: "dsor://org_789/payment/PAY-950" });
    expect(in789).toMatchObject({ data: { id: "PAY-950", status: "cancelled" } });
    const in456 = await call(on, createLog(), FIRM_IN_456, "payment.cancel", CANCEL);
    expect(in456).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(ours.status).toBe("draft");
  });
});

describe("C4: a slip that carries a constraint, or names a parent, is not usable", () => {
  const amount = { value: "50000.00", currency: "USD" };
  it.each([
    ["per_transaction_limit", { per_transaction_limit: amount }],
    ["cumulative_limits", { cumulative_limits: [{ window: "P1D", amount }] }],
    ["counterparties", { counterparties: "approved_vendors_only" }],
    ["resources", { resources: ["dsor://org_456/vendor/VENDOR-44"] }],
    ["time_window", { time_window: { days: ["mon"], hours: "08:00-18:00", tz: "Asia/Karachi" } }],
  ])("DSOR-DEL-02: a slip with %s gets DELEGATION_REQUIRED, naming it", async (field, constraints) => {
    const rows: Payment[] = [];
    const answer = await call(slipRegistry(with100({ constraints }), undefined, rows), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: `"payment.create": slip del_100 carries ${field}, which DSoR cannot check yet`,
    });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-02: a sub-slip, which names a parent, gets DELEGATION_REQUIRED", async () => {
    const answer = await call(slipRegistry(with100({ parent: "del_099" })), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: '"payment.create": slip del_100 is a sub-slip of del_099, which DSoR cannot check yet',
    });
  });
});

describe("C5: every call from the agent, read or command, needs a slip that allows unattended", () => {
  it("DSOR-DEL-07: the agent reads INV-1008 under del_100, with the amounts left out", async () => {
    const answer = await call(slipRegistry(), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ data: MASKED_1008_OF_456 });
  });

  it("DSOR-DEL-07: with no slip, the agent's read gets DELEGATION_REQUIRED", async () => {
    const answer = await call(slipRegistry(NONE_FOR_THE_AGENT), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: '"invoice.get" needs a slip: accounts-payable-fte holds no person\'s slip in org_456',
    });
  });

  it.each([
    ["invoice.get", READ],
    ["payment.create", CREATE],
  ])("DSOR-DEL-07: a slip whose only mode is on_behalf_of refuses %s", async (name, input) => {
    const answer = await call(slipRegistry(with100({ modes: ["on_behalf_of"] })), createLog(), AGENT, name, input);
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: `"${name}": slip del_100 does not allow unattended calls`,
    });
  });
});

describe("C6: the subject comes from the slip, never from the request", () => {
  it("DSOR-DEL-08: an input that names cfo_100 as subject is refused at line ①, and no slip is looked up", async () => {
    const find = vi.fn(async (_tenant: string, _delegate: string) => undefined);
    const lines: number[] = [];
    const answer = await call(slipRegistry({ find }), createLog(), AGENT, "invoice.get", { ...READ, subject: "cfo_100" }, (n) => lines.push(n));
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(lines).toStrictEqual([1, 11]);
    expect(find).not.toHaveBeenCalled();
  });

  it("DSOR-DEL-08: the store is asked for the caller's own slip, in the active company", async () => {
    const find = vi.fn(async (_tenant: string, _delegate: string) => undefined);
    await call(slipRegistry({ find }), createLog(), FIRM_IN_789, "invoice.get", { invoice: "dsor://org_789/invoice/INV-2001" });
    expect(find.mock.calls).toStrictEqual([["org_789", "firm-ap-fte"]]);
  });
});

describe("C7: an agent's record names its slip and its person", () => {
  const UNDER_100 = {
    delegation: "del_100",
    identity: { mode: "unattended", subject: "user_123", actor_chain: ["accounts-payable-fte"] },
  };

  it("DSOR-DEL-08: the record of the agent's draft names del_100, unattended, user_123, and the agent", async () => {
    const log = createLog();
    await call(slipRegistry(), log, AGENT, "payment.create", CREATE);
    expect(await log.records()).toMatchObject([{ result: "ok", ...UNDER_100 }]);
  });

  it("step 18's decision 8: a refusal at line ⑤ names the slip it was decided under", async () => {
    const log = createLog();
    await call(slipRegistry(), log, AGENT, "payment.cancel", CANCEL);
    expect(await log.records()).toMatchObject([{ result: "AUTHORIZATION_DENIED", ...UNDER_100 }]);
  });

  it("step 18's decision 8: a refusal at line ③ names no slip and no subject", async () => {
    const log = createLog();
    await call(slipRegistry(NONE_FOR_THE_AGENT), log, AGENT, "payment.create", CREATE);
    const [record] = await log.records();
    expect(record).not.toHaveProperty("delegation");
    expect(record).not.toHaveProperty("identity");
  });

  it("step 18's decision 8: user_123's own draft names neither", async () => {
    const log = createLog();
    await call(slipRegistry(), log, SUPERVISOR, "payment.create", CREATE);
    const [record] = await log.records();
    expect(record).not.toHaveProperty("delegation");
    expect(record).not.toHaveProperty("identity");
  });
});

describe("C9: an agent's command answer is masked, as its reads are", () => {
  it("DSOR-CLS-02a: the agent's PAY-901 answer leaves out the amount, and names it in redactions", async () => {
    const answer = await call(slipRegistry(), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({
      data: { id: "PAY-901", invoice_id: "INV-1008", vendor_id: "VENDOR-44", status: "draft" },
      classification: "internal",
      redactions: [{ field: "amount", reason: "clearance", treatment: "omitted" }],
    });
    expect(answer).not.toHaveProperty("data.amount");
  });

  it("DSOR-CLS-02a: cfo_100, a person, still reads INV-1008 with its amounts", async () => {
    const answer = await call(slipRegistry(), createLog(), CFO, "invoice.get", READ);
    expect(answer).toHaveProperty("data.amount");
  });
});

describe("C10: a slip that breaks the specification's schema is a fault in DSoR's own store", () => {
  it.each([
    ["no modes", { modes: [] }],
    ["the permission payment:*", { permissions: ["payment:*"] }],
    ["a status the schema does not know", { status: "paused" }],
    ["no expires_at", { expires_at: undefined }],
  ])("DSOR-DEL-01a: a slip with %s gets INTERNAL_ERROR, recorded, with no draft", async (_, changed) => {
    const rows: Payment[] = [];
    const log = createLog();
    const answer = await call(slipRegistry(with100(changed), undefined, rows), log, AGENT, "payment.create", CREATE);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: "the slip DSoR holds for this agent is not a valid slip" });
    expect(await log.records()).toMatchObject([{ authorization: "DENY", result: "INTERNAL_ERROR" }]);
    expect(rows).toStrictEqual([]);
  });
});

describe("the memory store: one slip per agent and company, and a clock of its own", () => {
  it("step 18's decision 7: the memory store refuses two slips for one agent in one company, as the database does", () => {
    expect(() => memorySlips([DEL_100, { ...DEL_100, id: "del_199", status: "revoked" }])).toThrow(
      'two slips for one agent in one company: ["org_456","accounts-payable-fte"]',
    );
  });

  it("step 18's decision 12: the memory store reads the clock it is given", async () => {
    const in2100 = memorySlips(STORY_SLIPS, () => Date.parse("2100-01-01T00:00:00Z"));
    const answer = await call(slipRegistry(in2100), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });

  it("step 18's decision 12: an expires_at that cannot be read counts as passed", async () => {
    const answer = await call(slipRegistry(with100({ expires_at: "soon" })), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });
});
