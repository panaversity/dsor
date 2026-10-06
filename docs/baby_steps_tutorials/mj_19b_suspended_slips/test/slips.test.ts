// Delegations, the permission slip. An agent calls only under a slip that a
// person signed and DSoR holds, and never with more power than that person holds now
// (DSOR-DEL-01a, DSOR-DEL-01b, DSOR-DEL-02, DSOR-DEL-07, and DSOR-DEL-08 in
// specs/dsor/02-security.md, section 13; step 18's README, C1 to C10).
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { effectivePermissions } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { createDbSlips } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { memorySlips, NO_SLIPS, type SlipStore } from "../src/slips.ts";
import {
  AGENT,
  CFO,
  DEL_100,
  DEL_101,
  DEL_102,
  FIRM_IN_456,
  FIRM_IN_789,
  MASKED_1008_OF_456,
  PAY_901_DRAFT,
  STARTING_ROLES,
  STORY_SLIPS,
  SUPERVISOR,
  UNDER_DEL_100,
  UNEXPECTED,
  handlers,
  refusal,
  rolesFile,
  shipped,
  shippedRoles,
  slipRegistry,
  withPlanted,
  storyDirectories,
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
    const answer = await call(
      slipRegistry(undefined, undefined, rows),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({
      data: { id: "PAY-901", status: "draft" },
      semantics: "compensatable",
    });
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  it("DSOR-DEL-01a: with no slip, the agent's draft gets DELEGATION_REQUIRED, recorded, and no draft", async () => {
    const rows: Payment[] = [];
    const log = createLog();
    const answer = await call(
      slipRegistry(NONE_FOR_THE_AGENT, undefined, rows),
      log,
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message:
        '"payment.create" needs a slip: accounts-payable-fte holds no person\'s slip in org_456',
      retry: "never",
    });
    expect(await log.records()).toMatchObject([
      { operation: "payment.create@1", authorization: "DENY", result: "DELEGATION_REQUIRED" },
    ]);
    expect(rows).toStrictEqual([]);
  });

  it.each([
    ["torn up", { status: "revoked" }, "DELEGATION_REVOKED", "slip del_100 was torn up"],
    [
      "expired by its status",
      { status: "expired" },
      "DELEGATION_EXPIRED",
      "slip del_100 is past its date",
    ],
    [
      "past its date",
      { expires_at: "2001-01-01T00:00:00Z" },
      "DELEGATION_EXPIRED",
      "slip del_100 is past its date",
    ],
    [
      "suspended",
      { status: "suspended" },
      "DELEGATION_REQUIRED",
      "slip del_100 is suspended, not active",
    ],
  ])(
    "DSOR-DEL-01a: a slip that is %s is refused at line ③, recorded, with no draft",
    async (_, changed, code, why) => {
      const rows: Payment[] = [];
      const log = createLog();
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(with100(changed), undefined, rows),
        log,
        AGENT,
        "payment.create",
        CREATE,
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({ code, message: `"payment.create": ${why}`, retry: "never" });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
      expect(await log.records()).toMatchObject([{ authorization: "DENY", result: code }]);
      expect(rows).toStrictEqual([]);
    },
  );

  it("DSOR-DEL-01a: a slip for another agent covers nothing", async () => {
    const other = memorySlips([{ ...DEL_100, delegate: "other-fte" }]);
    const rows: Payment[] = [];
    const log = createLog();
    const answer = await call(
      slipRegistry(other, undefined, rows),
      log,
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ code: "DELEGATION_REQUIRED" });
    // Found by step 18's review: the record and the rows were not checked.
    expect(await log.records()).toMatchObject([
      { authorization: "DENY", result: "DELEGATION_REQUIRED" },
    ]);
    expect(rows).toStrictEqual([]);
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
    const elsewhere = memorySlips([
      { ...DEL_100, id: "del_199", tenant: "org_789", delegator: "both_100" },
    ]);
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
    const leaky: SlipStore = {
      find: async () => ({ slip: structuredClone(DEL_102), past: false }),
      // NEW IN STEP 19b: it suspends nothing.
      suspend: async () => [],
    };
    const rows: Payment[] = [];
    const answer = await call(
      slipRegistry(leaky, undefined, rows),
      createLog(),
      FIRM_IN_456,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "the store answered with a slip of someone else",
    });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-01a: line ③ refuses before line ⑤, and the code never runs", async () => {
    const spy = vi.fn<Handler>(() => ({}));
    const on = buildRegistry(
      shipped,
      { ...handlers, "payment.create": spy },
      shippedRoles,
      undefined,
      undefined,
      undefined,
      undefined,
      NONE_FOR_THE_AGENT,
      // And the story's directories (step 19's README, decision 2).
      storyDirectories(),
    );
    const lines: number[] = [];
    await call(on, createLog(), AGENT, "payment.create", CREATE, (n) => lines.push(n));
    expect(lines).toStrictEqual([1, 2, 3, 11]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-DEL-01a: a person needs no slip: user_123 drafts with no slip in the store", async () => {
    const answer = await call(
      slipRegistry(NO_SLIPS),
      createLog(),
      SUPERVISOR,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ data: { id: "PAY-901" } });
  });
});

describe("C2: nothing the agent sends, and no role in its login, widens its slip", () => {
  // Passes before step 18's code: the closed envelope of step 10 already refuses it.
  it("DSOR-DEL-01b: an envelope that adds scopes is refused, and nothing is drafted", async () => {
    const rows: Payment[] = [];
    const widened = { ...AGENT, scopes: ["payment:cancel"] } as RequestEnvelope;
    const answer = await call(
      slipRegistry(undefined, undefined, rows),
      createLog(),
      widened,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(rows).toStrictEqual([]);
  });

  it("step 18's decision 11: an agent login that holds a role stops start-up, named", async () => {
    const roleful: Principal = {
      id: "roleful-fte",
      type: "agent",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    };
    const message = await withPlanted("tok_roleful", roleful, () =>
      refusal(() => buildRegistry(shipped, handlers, shippedRoles)),
    );
    expect(message).toBe(
      "the registry refused to start:\n  roleful-fte is an agent, and holds the role \"ap_supervisor\" in org_456: an agent's power comes only from a person's slip",
    );
  });

  it("step 18's decision 11: the shipped logins give no agent a role", () => {
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles))).toBe("");
  });
});

describe("C3: the agent may use only what its slip lists and its signer holds now", () => {
  // The map's "Done when": the same request, before and after user_123 loses the right. DSoR
  // built again, from the changed role table, stands in for the restart (step 18's README,
  // decision 4).
  it("DSOR-DEL-02: user_123 loses payment:create, and after a restart the agent's draft is refused, though del_100 still lists it", async () => {
    const before: Payment[] = [];
    expect(
      await call(
        slipRegistry(undefined, undefined, before),
        createLog(),
        AGENT,
        "payment.create",
        CREATE,
      ),
    ).toMatchObject({ data: { id: "PAY-901" } });
    const cut = rolesFile({
      ...STARTING_ROLES,
      ap_supervisor: ["invoice:read", "invoice:issue", "payment:cancel"],
    });
    const after: Payment[] = [];
    const log = createLog();
    const lines: number[] = [];
    const answer = await call(
      slipRegistry(undefined, cut, after),
      log,
      AGENT,
      "payment.create",
      CREATE,
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message:
        '"payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now',
    });
    expect(lines).toStrictEqual([1, 2, 3, 5, 11]);
    expect(after).toStrictEqual([]);
    expect(await log.records()).toMatchObject([
      { authorization: "DENY", result: "AUTHORIZATION_DENIED" },
    ]);
  });

  it("DSOR-DEL-02: del_100 lists no payment:cancel, so the agent's cancel is denied, though user_123 holds it", async () => {
    const rows: Payment[] = [{ ...PAY_901_DRAFT } as Payment];
    const answer = await call(
      slipRegistry(undefined, undefined, rows),
      createLog(),
      AGENT,
      "payment.cancel",
      CANCEL,
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: '"payment.cancel" needs payment:cancel, which slip del_100 does not list',
    });
    expect(rows[0]?.status).toBe("draft");
  });

  // Since step 18 the subject is the slip's signer, so the company must be one where the
  // signer holds a membership (DSOR-IDN-03a). Found by step 18's review: line ⑤ refused these
  // calls, but its record named user_700 as the subject in org_456 (step 18's README,
  // decision 18).
  it.each([
    ["invoice.get", READ],
    ["invoice.list", {}],
    ["invoice.issue", READ],
    ["payment.create", CREATE],
    ["payment.cancel", CANCEL],
  ])(
    "DSOR-IDN-03a: a slip in org_456 signed by user_700, who works only in org_789, refuses %s at line ③",
    async (name, input) => {
      const log = createLog();
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(with100({ delegator: "user_700" })),
        log,
        AGENT,
        name,
        input,
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `"${name}": slip del_100 is signed by user_700, who is not a person in org_456`,
        retry: "never",
      });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
      const [record] = await log.records();
      expect(record).toMatchObject({ authorization: "DENY", result: "AUTHORIZATION_DENIED" });
      expect(record).not.toHaveProperty("identity");
    },
  );

  // Only a person signs a slip (§13: "a permission slip from a human to an agent"). Since
  // step 18's review, line ③ refuses it (step 18's README, decisions 15 and 18). Since step
  // 19's review, from DSoR's own table, before the directory is asked (step 19's README,
  // decision 13).
  it.each([
    ["an agent", "firm-ap-fte"],
    ["nobody DSoR knows", "user_999"],
  ])("step 18's decision 15: a slip signed by %s is refused at line ③", async (_, delegator) => {
    const lines: number[] = [];
    const answer = await call(
      slipRegistry(with100({ delegator })),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `"invoice.get": slip del_100 is signed by ${delegator}, who is not a person in org_456`,
    });
    expect(lines).toStrictEqual([1, 2, 3, 11]);
  });

  it("step 18's decision 15: a slip signed by an application is refused at line ③, though the application's role holds the permission", async () => {
    const app = person("ap-batch", ["ap_supervisor"], "application");
    const on = slipRegistry(with100({ delegator: "ap-batch" }));
    const lines: number[] = [];
    const answer = await withPlanted("tok_app", app, () =>
      call(on, createLog(), AGENT, "invoice.get", READ, (n) => lines.push(n)),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(lines).toStrictEqual([1, 2, 3, 11]);
  });

  // Start-up refuses an agent with a role, so only a planted one can hold one. Line ⑤ still
  // never reads it.
  it("DSOR-DEL-02: an agent's own role never counts, only its slip", async () => {
    const roleful: Principal = {
      id: "roleful-fte",
      type: "agent",
      clearance: "internal",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    };
    const slips = memorySlips([
      { ...DEL_100, id: "del_198", delegate: "roleful-fte", permissions: ["invoice:read"] },
    ]);
    const rows: Payment[] = [];
    const on = slipRegistry(slips, undefined, rows);
    const answer = await withPlanted("tok_roleful", roleful, () =>
      call(on, createLog(), { token: "tok_roleful", tenant: "org_456" }, "payment.create", CREATE),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-02: firm-ap-fte may cancel in org_789, where del_102 and user_700 allow it, and not in org_456", async () => {
    const theirs: Payment = {
      ...PAY_901_DRAFT,
      tenant_id: "org_789",
      id: "PAY-950",
      invoice_id: "INV-2001",
      vendor_id: "VENDOR-77",
    } as Payment;
    const ours: Payment = { ...PAY_901_DRAFT } as Payment;
    const rows = [theirs, ours];
    const on = slipRegistry(undefined, undefined, rows);
    const in789 = await call(on, createLog(), FIRM_IN_789, "payment.cancel", {
      payment: "dsor://org_789/payment/PAY-950",
    });
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
  ])(
    "DSOR-DEL-02: a slip with %s gets DELEGATION_REQUIRED, naming it",
    async (field, constraints) => {
      const rows: Payment[] = [];
      const answer = await call(
        slipRegistry(with100({ constraints }), undefined, rows),
        createLog(),
        AGENT,
        "payment.create",
        CREATE,
      );
      expect(answer).toMatchObject({
        code: "DELEGATION_REQUIRED",
        message: `"payment.create": slip del_100 carries ${field}, which DSoR cannot check yet`,
      });
      expect(rows).toStrictEqual([]);
    },
  );

  it("DSOR-DEL-02: a sub-slip, which names a parent, gets DELEGATION_REQUIRED", async () => {
    const answer = await call(
      slipRegistry(with100({ parent: "del_099" })),
      createLog(),
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message:
        '"payment.create": slip del_100 is a sub-slip of del_099, which DSoR cannot check yet',
    });
  });
});

describe("C5: every call from the agent, read or command, needs a slip that allows unattended", () => {
  it("DSOR-DEL-07: the agent reads INV-1008 under del_100, with the amounts left out", async () => {
    const answer = await call(slipRegistry(), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ data: MASKED_1008_OF_456 });
  });

  it("DSOR-DEL-07: with no slip, the agent's read gets DELEGATION_REQUIRED", async () => {
    const answer = await call(
      slipRegistry(NONE_FOR_THE_AGENT),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message:
        '"invoice.get" needs a slip: accounts-payable-fte holds no person\'s slip in org_456',
    });
  });

  it.each([
    ["invoice.get", READ],
    ["payment.create", CREATE],
  ])("DSOR-DEL-07: a slip whose only mode is on_behalf_of refuses %s", async (name, input) => {
    const answer = await call(
      slipRegistry(with100({ modes: ["on_behalf_of"] })),
      createLog(),
      AGENT,
      name,
      input,
    );
    expect(answer).toMatchObject({
      code: "DELEGATION_REQUIRED",
      message: `"${name}": slip del_100 does not allow unattended calls`,
    });
  });
});

describe("C6: the subject comes from the slip, never from the request", () => {
  it("DSOR-DEL-08: an input that names cfo_100 as subject is refused at line ①, and no slip is looked up", async () => {
    const find = vi.fn(async (_tenant: string, _delegate: string) => undefined);
    // NEW IN STEP 19b: a store also suspends slips. This one suspends nothing.
    const suspend = async (): Promise<string[]> => [];
    const lines: number[] = [];
    const answer = await call(
      slipRegistry({ find, suspend }),
      createLog(),
      AGENT,
      "invoice.get",
      { ...READ, subject: "cfo_100" },
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(lines).toStrictEqual([1, 11]);
    expect(find).not.toHaveBeenCalled();
  });

  it("DSOR-DEL-08: the store is asked for the caller's own slip, in the active company", async () => {
    const find = vi.fn(async (_tenant: string, _delegate: string) => undefined);
    // NEW IN STEP 19b: a store also suspends slips. This one suspends nothing.
    const suspend = async (): Promise<string[]> => [];
    await call(slipRegistry({ find, suspend }), createLog(), FIRM_IN_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-2001",
    });
    expect(find.mock.calls).toStrictEqual([["org_789", "firm-ap-fte"]]);
  });
});

describe("C7: an agent's record names its slip and its person", () => {
  it("DSOR-DEL-08: the record of the agent's draft names del_100, unattended, user_123, and the agent", async () => {
    const log = createLog();
    await call(slipRegistry(), log, AGENT, "payment.create", CREATE);
    expect(await log.records()).toMatchObject([{ result: "ok", ...UNDER_DEL_100 }]);
  });

  it("step 18's decision 8: a refusal at line ⑤ names the slip it was decided under", async () => {
    const log = createLog();
    await call(slipRegistry(), log, AGENT, "payment.cancel", CANCEL);
    expect(await log.records()).toMatchObject([
      { result: "AUTHORIZATION_DENIED", ...UNDER_DEL_100 },
    ]);
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
    // Found by step 18's review: the schema allows both, and an empty id let the draft
    // through with a record that named no slip (step 18's README, decision 13).
    ["an empty id", { id: "" }],
    ["an empty signer", { delegator: "" }],
    // Found by step 18's sweep: a checker that deleted unknown fields, or turned text into
    // true and false, passed every test. A constraint the schema does not know would vanish,
    // and the agent would draft with no limit.
    [
      "a constraint the schema does not know",
      { constraints: { max_amount: { value: "100.00", currency: "USD" } } },
    ],
    ["a field the schema does not know", { scopes: ["payment:cancel"] }],
    ["a subdelegation whose allowed is text", { subdelegation: { allowed: "false" } }],
  ])(
    "DSOR-DEL-01a: a slip with %s gets INTERNAL_ERROR, recorded, with no draft",
    async (_, changed) => {
      const rows: Payment[] = [];
      const log = createLog();
      const answer = await call(
        slipRegistry(with100(changed), undefined, rows),
        log,
        AGENT,
        "payment.create",
        CREATE,
      );
      expect(answer).toMatchObject({
        code: "INTERNAL_ERROR",
        message: "the slip DSoR holds for this agent is not a valid slip",
      });
      expect(await log.records()).toMatchObject([
        { authorization: "DENY", result: "INTERNAL_ERROR" },
      ]);
      expect(rows).toStrictEqual([]);
    },
  );
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
    const answer = await call(
      slipRegistry(with100({ expires_at: "soon" })),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });

  // Found by step 18's review: a store that did not say whether the slip was past its date
  // let the draft through. When the answer is missing, the answer is no.
  it("step 18's decision 12: a store that does not say whether the slip is past its date counts it as past", async () => {
    const unsure: SlipStore = {
      find: async () => ({ slip: structuredClone(DEL_100), past: undefined as unknown as boolean }),
      // NEW IN STEP 19b: it suspends nothing.
      suspend: async () => [],
    };
    const answer = await call(slipRegistry(unsure), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });
});

describe("found by step 18's sweep, which broke the code one change at a time", () => {
  // Both are true of this slip. The person's act, tearing it up, decides the code.
  it("DSOR-DEL-01a: a slip both torn up and past its date is refused as torn up", async () => {
    const answer = await call(
      slipRegistry(with100({ status: "revoked", expires_at: "2001-01-01T00:00:00Z" })),
      createLog(),
      AGENT,
      "invoice.get",
      READ,
    );
    expect(answer).toMatchObject({ code: "DELEGATION_REVOKED" });
  });

  // Line ③ refuses first, so only a direct call reaches this. With no slip, nothing.
  it("DSOR-DEL-02: an agent with no slip may do nothing, whatever roles it holds", () => {
    const roleful: Principal = {
      id: "roleful-fte",
      type: "agent",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    };
    const roles = new Map([["ap_supervisor", new Set(["invoice:read", "payment:create"])]]);
    expect([...effectivePermissions(roleful, roles, "org_456")]).toStrictEqual([]);
  });

  it("step 18's decision 11: an agent with a role in its second company stops start-up, named", async () => {
    const two: Principal = {
      id: "two-fte",
      type: "agent",
      clearance: "internal",
      memberships: [
        { tenant_id: "org_456", roles: [] },
        { tenant_id: "org_789", roles: ["ap_supervisor"] },
      ],
    };
    const message = await withPlanted("tok_two", two, () =>
      refusal(() => buildRegistry(shipped, handlers, shippedRoles)),
    );
    expect(message).toContain('two-fte is an agent, and holds the role "ap_supervisor" in org_789');
  });

  // The database counts a slip as past from the very instant of its expires_at (<=), and the
  // memory store must agree.
  it("step 18's decision 12: at the very instant of expires_at, the memory store counts the slip as past", async () => {
    const atExpiry = memorySlips(STORY_SLIPS, () => Date.parse(DEL_100.expires_at));
    const answer = await call(slipRegistry(atExpiry), createLog(), AGENT, "invoice.get", READ);
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });

  // The unique key keeps one slip per agent and company. The store checks again, so a key
  // that someone narrows later still never lets the order of rows choose (decision 7). A pool
  // that answers the slip query with two rows, and every other statement with none.
  it("step 18's decision 7: the database's store refuses to choose between two slips", async () => {
    const row = {
      tenant_id: "org_456",
      id: "del_100",
      delegator: "user_123",
      delegate: "accounts-payable-fte",
      modes: ["unattended"],
      permissions: ["invoice:read", "payment:create"],
      constraints: {},
      subdelegation: { allowed: false },
      parent: null,
      status: "active",
      expires_at: new Date("2099-12-31T23:59:59Z"),
      extensions: null,
      past: false,
    };
    const rows = [{ ...row, id: "del_197", status: "revoked" }, row];
    // inCompany checks that COMMIT committed, so the stub says it did.
    const client = {
      query: async (sql: string) =>
        sql === "COMMIT"
          ? { command: "COMMIT", rows: [] }
          : { rows: sql.includes("dsor.delegations") ? rows : [] },
      release: () => {},
    };
    const pool = { connect: async () => client } as unknown as pg.Pool;
    await expect(createDbSlips(pool).find("org_456", "accounts-payable-fte")).rejects.toThrow(
      "dsor.delegations holds 2 slips for one agent in one company",
    );
  });
});

describe("found by step 18's review", () => {
  // A slip id in the arguments must be the slip line ③ found. A person calls under none
  // (DSOR-SRC-02b; step 18's README, decision 17). Before, line ⑥ refused them as unknown
  // fields, with VALIDATION_FAILED, after lines ③ and ⑤ had run.
  it.each([
    ["delegation", { delegation: "del_102" }],
    ["delegation_id", { delegation_id: "del_102" }],
    ["delegationId", { delegationId: "del_102" }],
    ["correlation.delegation_id", { correlation: { delegation_id: "del_102" } }],
  ])(
    "DSOR-SRC-02b: the agent naming del_102 in %s is refused at line ③, recorded, with no draft",
    async (place, named) => {
      const rows: Payment[] = [];
      const log = createLog();
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(undefined, undefined, rows),
        log,
        AGENT,
        "payment.create",
        { ...CREATE, ...named },
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `the arguments name a slip the caller does not call under, in ${place}`,
        retry: "never",
      });
      expect(lines).toStrictEqual([1, 2, 3, 11]);
      expect(await log.records()).toMatchObject([
        { authorization: "DENY", result: "AUTHORIZATION_DENIED" },
      ]);
      expect(rows).toStrictEqual([]);
    },
  );

  it("DSOR-SRC-02b: the agent naming its own slip, del_100, passes line ③, and line ⑥ refuses the field", async () => {
    const lines: number[] = [];
    const answer = await call(
      slipRegistry(),
      createLog(),
      AGENT,
      "payment.create",
      { ...CREATE, delegation: "del_100" },
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 11]);
  });

  it("DSOR-SRC-02b: a person, who calls under no slip, naming del_100 is refused at line ③", async () => {
    const lines: number[] = [];
    const answer = await call(
      slipRegistry(),
      createLog(),
      SUPERVISOR,
      "payment.create",
      { ...CREATE, delegation: "del_100" },
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "the arguments name a slip the caller does not call under, in delegation",
    });
    expect(lines).toStrictEqual([1, 2, 3, 11]);
  });

  // The slip's own word for its person, and §13.2's mode, join step 05's list (step 18's
  // README, decision 17).
  it.each(["delegator", "on_behalf_of"])(
    "DSOR-SRC-02b: an input that names cfo_100 in %s is refused at line ①",
    async (field) => {
      const lines: number[] = [];
      const answer = await call(
        slipRegistry(),
        createLog(),
        AGENT,
        "invoice.get",
        { ...READ, [field]: "cfo_100" },
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "AUTHORIZATION_DENIED",
        message: `the arguments name someone other than the caller, in ${field}`,
      });
      expect(lines).toStrictEqual([1, 11]);
    },
  );

  // The record's person must come from the slip found, not from a constant: a second slip
  // proves it (DSOR-DEL-08). Found by step 18's review, which hard-coded user_123 and saw
  // every test pass.
  it("DSOR-DEL-08: firm-ap-fte's record in org_789 names del_102, user_700, and firm-ap-fte", async () => {
    const log = createLog();
    await call(slipRegistry(), log, FIRM_IN_789, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(await log.records()).toMatchObject([
      {
        result: "ok",
        delegation: "del_102",
        identity: { mode: "unattended", subject: "user_700", actor_chain: ["firm-ap-fte"] },
      },
    ]);
  });

  // The other half of decision 14: right company, wrong agent. Found by step 18's review,
  // which deleted the agent's half of the check and saw every test pass.
  it("DSOR-TEN-01b: another agent's slip, from a store that should not give it, is never used", async () => {
    const leaky: SlipStore = {
      find: async () => ({ slip: structuredClone(DEL_101), past: false }),
      // NEW IN STEP 19b: it suspends nothing.
      suspend: async () => [],
    };
    const rows: Payment[] = [];
    const log = createLog();
    const answer = await call(
      slipRegistry(leaky, undefined, rows),
      log,
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "the store answered with a slip of someone else",
    });
    expect(await log.records()).toMatchObject([
      { authorization: "DENY", result: "INTERNAL_ERROR" },
    ]);
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-EXE-02: a slip store that fails gives INTERNAL_ERROR, recorded, with no draft, and its message goes nowhere", async () => {
    const down: SlipStore = {
      find: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.9:5432, password hunter2");
      },
      // NEW IN STEP 19b: it suspends nothing.
      suspend: async () => [],
    };
    const rows: Payment[] = [];
    const log = createLog();
    const answer = await call(
      slipRegistry(down, undefined, rows),
      log,
      AGENT,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    const records = await log.records();
    expect(records).toMatchObject([{ authorization: "DENY", result: "INTERNAL_ERROR" }]);
    expect(JSON.stringify([answer, records])).not.toMatch(/10\.0\.0\.9|hunter2/);
    expect(rows).toStrictEqual([]);
  });

  // Line ③ finds a slip's signer by name, so one name must be one principal (step 18's
  // README, decision 19). Found by step 18's review: with two, the order of the logins
  // decided the signer's power.
  it("step 18's decision 19: two logins that name one principal stop start-up, named", async () => {
    const twin = person("user_123", ["CFO"]);
    const message = await withPlanted("tok_twin", twin, () =>
      refusal(() => buildRegistry(shipped, handlers, shippedRoles)),
    );
    expect(message).toBe(
      "the registry refused to start:\n  two logins name user_123, so DSoR could not tell which of them signed a slip",
    );
  });
});
