// Idempotency keys. A command carries a key that its caller chose, and DSoR claims the key
// before the command's work runs. The same key and the same request get the recorded answer,
// and nothing runs again. The same key and a different request are refused (DSOR-IDM-01a to
// DSOR-IDM-01d in specs/dsor/03-execution.md, section 22; step 20's README, C1 to C10). Here
// the claims are in memory. test/idempotency.db.test.ts proves them on the database.
import { describe, expect, it } from "vitest";
import { canonicalJson, payloadHash } from "../src/canonical.ts";
import { Refusal, type Answer } from "../src/envelope.ts";
import { readRoleSettings } from "../src/authority.ts";
import { memoryClaims } from "../src/claims.ts";
import { memoryInvoices } from "../src/invoice.ts";
import { createLog, type Decision, type DecisionLog } from "../src/log.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import {
  AGENT,
  FIRM_IN_456,
  FIRM_IN_789,
  OUR_EXTENSIONS,
  SUPERVISOR,
  contract,
  handlers,
  keyed,
  paymentRegistry,
  refusal,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  shippedWith,
  storyDirectories,
  testSlips,
} from "./helpers.ts";

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
const INV_1009 = { invoice: "dsor://org_456/invoice/INV-1009" };
const PAY_901 = { payment: "dsor://org_456/payment/PAY-901" };

// The refusals, typed out rather than imported.
/** The refusal of a command that carries no key. */
function needsKey(name: string): string {
  return `"${name}" needs an idempotency_key in the request envelope`;
}
/** The refusal of a query that carries a key. */
function queryTakesNone(name: string): string {
  return `"${name}" is a query, which takes no idempotency_key`;
}
/** The refusal of a key used for a different request. */
function usedForAnother(name: string): string {
  return `the idempotency_key was used for a different request to "${name}"`;
}
const BAD_KEY = "an idempotency_key must be 1 to 128 characters: letters, digits, and . _ : -";
// Step 14's message for a refusal whose reason is above the caller's clearance, typed out.
const WITHHELD = "the operation refused the call, and its reason is above the caller's clearance";

/** The data of an answer, or its code when it was refused. */
function heard(answer: Answer): unknown {
  return "code" in answer ? answer.code : answer.data;
}

/** The record's own part of the tutorial's extensions. */
function ours(record: { extensions?: Decision["extensions"] }): unknown {
  return record.extensions?.[OUR_EXTENSIONS]?.idempotency;
}

/**
 * The shipped operations, with payment.create's code counted each time it runs. The first
 * time, it may do something else first: throw, or answer with a row of its own.
 */
function countedRegistry(rows: Payment[], firstTime?: () => unknown) {
  const runs = { count: 0 };
  const counted: Handler = async (input, company) => {
    runs.count += 1;
    if (runs.count === 1 && firstTime !== undefined) return firstTime();
    return handlers["payment.create"]!(input, company);
  };
  const registry = paymentRegistry(rows, shipped, { ...handlers, "payment.create": counted });
  return { registry, runs };
}

describe("C1: a command must carry a key", () => {
  it.each([
    ["payment.create", INV_1008],
    ["payment.cancel", PAY_901],
  ])(
    "DSOR-IDM-01a: user_123's %s with no idempotency key is refused at line ⑦, its code does not run, and the record says DENY",
    async (name, input) => {
      const rows: Payment[] = [];
      const log = createLog();
      const lines: number[] = [];
      const answer = await call(paymentRegistry(rows), log, SUPERVISOR, name, input, (n) =>
        lines.push(n),
      );
      expect(answer).toMatchObject({ code: "VALIDATION_FAILED", message: needsKey(name) });
      expect(lines).toStrictEqual([1, 2, 3, 5, 6, 7, 11]);
      expect(rows).toStrictEqual([]);
      expect(await log.records()).toMatchObject([
        { authorization: "DENY", result: "VALIDATION_FAILED" },
      ]);
    },
  );

  // The contract's flag is a promise, and DSOR-IDM-01a makes it one that every command keeps.
  it("DSOR-IDM-01a: start-up refuses a command whose contract does not require a key", () => {
    const loose = { ...contract("payment.create"), idempotency: { required: false } };
    expect(refusal(() => buildRegistry(shippedWith(loose), handlers, shippedRoles))).toContain(
      "payment.create: a command must require an idempotency key (DSOR-IDM-01a)",
    );
  });

  it("step 20's decision 3: start-up refuses a query whose contract requires a key", () => {
    const keyedQuery = { ...contract("invoice.get"), idempotency: { required: true } };
    expect(refusal(() => buildRegistry(shippedWith(keyedQuery), handlers, shippedRoles))).toContain(
      "invoice.get: a query takes no idempotency key (step 20's README, decision 3)",
    );
  });
});

describe("C3: the same key and the same request get the recorded answer", () => {
  it("DSOR-IDM-01c: the agent sends payment.create for INV-1008 twice with one key: one draft, and both answers are PAY-901", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    const first = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    const second = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(first)).toMatchObject({ id: "PAY-901", status: "draft" });
    expect(rows).toHaveLength(1);
    // The same answer, with the retry's own correlation.
    const { correlation: c1, ...rest1 } = first;
    const { correlation: c2, ...rest2 } = second;
    expect(rest2).toStrictEqual(rest1);
    expect(c2.request_id).not.toBe(c1.request_id);
  });

  it("DSOR-IDM-01c: the replay does not run the code again", async () => {
    const rows: Payment[] = [];
    const { registry, runs } = countedRegistry(rows);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    expect(runs.count).toBe(1);
  });

  // C10: the replay's record names the first call, so a reader can find the work.
  it("step 20's decision 8: each record names the key, and the replay's record names the first call", async () => {
    const log = createLog();
    const registry = paymentRegistry([]);
    const first = keyed({ ...AGENT, request_id: "req_fri_0205" }, "pay-INV-1008-a");
    const retry = keyed({ ...AGENT, request_id: "req_fri_0206" }, "pay-INV-1008-a");
    await call(registry, log, first, "payment.create", INV_1008);
    await call(registry, log, retry, "payment.create", INV_1008);
    const records = await log.records();
    expect(records).toMatchObject([
      { authorization: "ALLOW", result: "ok" },
      { authorization: "ALLOW", result: "ok" },
    ]);
    expect(records.map(ours)).toStrictEqual([
      { key: "pay-INV-1008-a" },
      { key: "pay-INV-1008-a", replay_of: "req_fri_0205" },
    ]);
  });

  // The claim keeps the answer it gave, so a replay does not read the payment again.
  it("DSOR-IDM-01c: user_123 cancels PAY-901, and the replay of her draft still says draft: the recorded answer, not the payment now", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    await call(
      registry,
      createLog(),
      keyed(SUPERVISOR, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    await call(
      registry,
      createLog(),
      keyed(SUPERVISOR, "cancel-PAY-901"),
      "payment.cancel",
      PAY_901,
    );
    const replay = await call(
      registry,
      createLog(),
      keyed(SUPERVISOR, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(replay)).toMatchObject({ id: "PAY-901", status: "draft" });
    expect(rows.map((row) => row.status)).toStrictEqual(["cancelled"]);
  });

  // §22: "A replay that now fails steps 3–5 because authority changed after the original
  // execution returns that error." Every line before ⑦ runs for a replay too.
  it("DSOR-IDM-01c: after user_123's slips are suspended, the agent's replay is refused at line ③, not answered", async () => {
    const rows: Payment[] = [];
    const slips = testSlips();
    const registry = paymentRegistry(rows, shipped, handlers, slips);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    const why = {
      word: "suspended",
      as_of: "2026-10-07T09:00:00.000Z",
      correlation: { request_id: "req_x" },
    };
    await slips.suspend("org_456", "user_123", why);
    const lines: number[] = [];
    const replay = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
      (n) => lines.push(n),
    );
    expect(replay).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(lines).toStrictEqual([1, 2, 3, 11]);
    expect(rows).toHaveLength(1);
  });

  // Decision 4: the operation's version is not part of the scope. Found by the review: no test
  // retried across a new version of a contract.
  it("step 20's decision 4: a retry that meets version 2 of payment.create's contract hears the answer of version 1", async () => {
    const rows: Payment[] = [];
    const invoices = memoryInvoices();
    const payments = memoryPayments(rows);
    const claims = memoryClaims(invoices, payments);
    const on = (sources: typeof shipped) =>
      buildRegistry(
        sources,
        handlers,
        shippedRoles,
        shippedInputs,
        shippedLabels,
        invoices,
        payments,
        testSlips(),
        storyDirectories(),
        readRoleSettings(),
        claims,
      );
    const version2 = shippedWith({ ...contract("payment.create"), version: 2 });
    await call(
      on(shipped),
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    const log = createLog();
    const retry = await call(
      on(version2),
      log,
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(retry)).toMatchObject({ id: "PAY-901" });
    expect(rows).toHaveLength(1);
    expect(await log.records()).toMatchObject([{ operation: "payment.create@2" }]);
  });

  it("DSOR-IDM-01c: two calls with one key at the same moment, in memory, make one draft, and both hear PAY-901", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    const answers = await Promise.all([
      call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008),
      call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008),
    ]);
    expect(answers.map(heard)).toMatchObject([{ id: "PAY-901" }, { id: "PAY-901" }]);
    expect(rows).toHaveLength(1);
  });
});

describe("C4: the same key and a different request are refused", () => {
  it("DSOR-IDM-01d: the agent sends the key of its INV-1008 draft again, for INV-1009: IDEMPOTENCY_CONFLICT, and nothing more is drafted", async () => {
    const rows: Payment[] = [];
    const log = createLog();
    const registry = paymentRegistry(rows);
    await call(registry, log, keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    const answer = await call(
      registry,
      log,
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1009,
    );
    expect(answer).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message: usedForAnother("payment.create"),
      retry: "never",
    });
    expect(rows.map((row) => row.invoice_id)).toStrictEqual(["INV-1008"]);
    expect((await log.records()).at(-1)).toMatchObject({
      authorization: "DENY",
      result: "IDEMPOTENCY_CONFLICT",
    });
  });
});

describe("C5: one key text in another scope is another claim", () => {
  it("DSOR-IDM-01b: firm-ap-fte in org_789 sends the key text that accounts-payable-fte used in org_456, and drafts its own payment", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    const answer = await call(
      registry,
      createLog(),
      keyed(FIRM_IN_789, "pay-INV-1008-a"),
      "payment.create",
      {
        invoice: "dsor://org_789/invoice/INV-1008",
      },
    );
    expect(heard(answer)).toMatchObject({
      tenant_id: "org_789",
      invoice_id: "INV-1008",
      status: "draft",
    });
    expect(rows.map((row) => row.tenant_id)).toStrictEqual(["org_456", "org_789"]);
  });

  // One caller in two companies: the company is a part of the scope of its own.
  it("DSOR-IDM-01b: firm-ap-fte sends one key in org_456 and in org_789, and drafts in each", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    await call(
      registry,
      createLog(),
      keyed(FIRM_IN_456, "pay-INV-1008-f"),
      "payment.create",
      INV_1008,
    );
    const answer = await call(
      registry,
      createLog(),
      keyed(FIRM_IN_789, "pay-INV-1008-f"),
      "payment.create",
      { invoice: "dsor://org_789/invoice/INV-1008" },
    );
    expect(heard(answer)).toMatchObject({ tenant_id: "org_789", status: "draft" });
    expect(rows.map((row) => row.tenant_id)).toStrictEqual(["org_456", "org_789"]);
  });

  it("DSOR-IDM-01b: user_123's own draft with the agent's key text is her own claim", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    const answer = await call(
      registry,
      createLog(),
      keyed(SUPERVISOR, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(answer)).toMatchObject({ id: "PAY-902", status: "draft" });
    expect(rows).toHaveLength(2);
  });

  it("DSOR-IDM-01b: user_123 cancels PAY-901 with the key she drafted it with, and the cancel runs", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    await call(
      registry,
      createLog(),
      keyed(SUPERVISOR, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    const answer = await call(
      registry,
      createLog(),
      keyed(SUPERVISOR, "pay-INV-1008-a"),
      "payment.cancel",
      PAY_901,
    );
    expect(heard(answer)).toMatchObject({ id: "PAY-901", status: "cancelled" });
  });
});

describe("C7: a key must be well formed, and a query takes none", () => {
  it.each([
    ["an empty key", ""],
    ["a key of 129 characters", "k".repeat(129)],
    ["a key with a space", "pay INV-1008"],
    ["a key with a slash", "pay/INV-1008"],
    ["a key with a letter outside ASCII", "pay-ÏNV-1008"],
    // Found by the review: each of these passes a pattern with the m, i, or u flag.
    ["a key that ends in a new line", "pay-INV-1008\n"],
    ["a key with a new line inside", "pay\nINV-1008"],
    ["a key with the Kelvin sign, which looks like K", "\u212Aey-INV-1008"],
    ["a key with a long s, which looks like s", "pa\u017F-INV-1008"],
    ["a number", 1008],
    ["null", null],
  ])("step 20's decision 2: %s is refused at line ①", async (_, key) => {
    const rows: Payment[] = [];
    const lines: number[] = [];
    const answer = await call(
      paymentRegistry(rows),
      createLog(),
      { ...AGENT, idempotency_key: key },
      "payment.create",
      INV_1008,
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED", message: BAD_KEY });
    expect(lines).toStrictEqual([1, 11]);
    expect(rows).toStrictEqual([]);
  });

  it("step 20's decision 2: a key of 128 characters, with each mark, is a key", async () => {
    const rows: Payment[] = [];
    const key = `Ab9._:-${"k".repeat(121)}`;
    const answer = await call(
      paymentRegistry(rows),
      createLog(),
      keyed(AGENT, key),
      "payment.create",
      INV_1008,
    );
    expect(heard(answer)).toMatchObject({ id: "PAY-901" });
  });

  it("step 20's decision 3: invoice.get with a key is refused at line ⑦, and reads nothing", async () => {
    const lines: number[] = [];
    const answer = await call(
      paymentRegistry([]),
      createLog(),
      keyed(AGENT),
      "invoice.get",
      INV_1008,
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: queryTakesNone("invoice.get"),
    });
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 7, 11]);
  });
});

describe("C9: a retry after a lost record is safe with the same key", () => {
  // Found by the review: a conflict's record that fails is refused before the code ran, so the
  // answer must not say that the command ran.
  it("DSOR-EXE-03b: the key sent again for INV-1009, with a failed record: the answer says only that DSoR refuses the call", async () => {
    const registry = paymentRegistry([]);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", INV_1008);
    const broken: DecisionLog = {
      add: async () => {
        throw new Error("disk full");
      },
    };
    const answer = await call(
      registry,
      broken,
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1009,
    );
    expect(answer).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message: "DSoR could not record its decision, so it refuses the call",
    });
  });

  it("step 20's decision 10: the log fails after the agent's keyed draft: EVIDENCE_STORE_UNAVAILABLE with safe_same_key, and the retry with the key gets PAY-901, with one draft", async () => {
    const rows: Payment[] = [];
    const registry = paymentRegistry(rows);
    const kept = createLog();
    let broken = true;
    const flaky: DecisionLog = {
      add: async (decision) => {
        if (broken) {
          broken = false;
          throw new Error("disk full");
        }
        return kept.add(decision);
      },
    };
    const lost = await call(
      registry,
      flaky,
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(lost).toMatchObject({ code: "EVIDENCE_STORE_UNAVAILABLE", retry: "safe_same_key" });
    const retry = await call(
      registry,
      flaky,
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(retry)).toMatchObject({ id: "PAY-901" });
    expect(rows).toHaveLength(1);
  });
});

// The claim keeps what the code said. Masking happens as each answer leaves, so a kept refusal
// is masked for the caller now, as a replay's value is (step 20's README, decision 7).
describe("decision 7: a kept refusal is masked as it leaves", () => {
  it("DSOR-CLS-02a: the agent's draft is refused with a confidential reason: withheld on the first call and on the replay", async () => {
    const { registry, runs } = countedRegistry([], () => {
      throw new Refusal("CONFLICT", "INV-1008 is held for 31,400.00 USD", "confidential");
    });
    const answers = [];
    for (let at = 0; at < 2; at += 1) {
      answers.push(
        await call(
          registry,
          createLog(),
          keyed(AGENT, "pay-INV-1008-a"),
          "payment.create",
          INV_1008,
        ),
      );
    }
    expect(answers).toMatchObject([
      { code: "CONFLICT", message: WITHHELD },
      { code: "CONFLICT", message: WITHHELD },
    ]);
    expect(runs.count).toBe(1);
  });

  it("DSOR-CLS-02a: user_123, a person, hears the same reason in full, on both calls", async () => {
    const { registry } = countedRegistry([], () => {
      throw new Refusal("CONFLICT", "INV-1008 is held for 31,400.00 USD", "confidential");
    });
    for (let at = 0; at < 2; at += 1) {
      const answer = await call(
        registry,
        createLog(),
        keyed(SUPERVISOR, "pay-INV-1008-a"),
        "payment.create",
        INV_1008,
      );
      expect(answer).toMatchObject({ message: "INV-1008 is held for 31,400.00 USD" });
    }
  });
});

// §22: "A recorded DENY is replayed like any other result." A refusal from the code is a
// decision about the request, so the claim keeps it. An accident is not, and the claim goes.
describe("decision 9: a refusal from the code is an outcome, and an accident keeps no claim", () => {
  it("DSOR-IDM-01c: a draft for INV-1005, which is not issued, is refused twice with one key, and the code runs once", async () => {
    const { registry, runs } = countedRegistry([]);
    const log = createLog();
    const input = { invoice: "dsor://org_456/invoice/INV-1005" };
    const first = keyed({ ...AGENT, request_id: "req_fri_0301" }, "pay-INV-1005");
    const retry = keyed({ ...AGENT, request_id: "req_fri_0302" }, "pay-INV-1005");
    const one = await call(registry, log, first, "payment.create", input);
    const two = await call(registry, log, retry, "payment.create", input);
    expect([heard(one), heard(two)]).toStrictEqual(["CONFLICT", "CONFLICT"]);
    expect(two).toMatchObject({ message: (one as { message: string }).message });
    expect(runs.count).toBe(1);
    expect((await log.records()).map(ours)).toStrictEqual([
      { key: "pay-INV-1005" },
      { key: "pay-INV-1005", replay_of: "req_fri_0301" },
    ]);
  });

  it("step 20's decision 9: the code fails by accident: INTERNAL_ERROR, and the retry with the key runs it again and drafts PAY-901", async () => {
    const rows: Payment[] = [];
    const { registry, runs } = countedRegistry(rows, () => {
      throw new Error("connection reset");
    });
    const lost = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(lost).toMatchObject({ code: "INTERNAL_ERROR" });
    const retry = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(retry)).toMatchObject({ id: "PAY-901" });
    expect(runs.count).toBe(2);
  });

  // DSoR throws INTERNAL_ERROR as a refusal for its own faults, so it is an accident too. Found by
  // the review.
  it("step 20's decision 9: an INTERNAL_ERROR refusal from the code keeps no claim, and the retry runs the code again", async () => {
    const { registry, runs } = countedRegistry([], () => {
      throw new Refusal("INTERNAL_ERROR", "the store answered with a row of someone else");
    });
    const first = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(first).toMatchObject({ code: "INTERNAL_ERROR" });
    const retry = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(retry)).toMatchObject({ id: "PAY-901" });
    expect(runs.count).toBe(2);
  });

  // The retry class is a promise about a retry with the same key, so the claim must not keep it.
  it("step 20's decision 9: a refusal whose retry class is safe_same_key keeps no claim, and the retry runs the code again", async () => {
    const { registry, runs } = countedRegistry([], () => {
      throw new Refusal("CONNECTOR_UNAVAILABLE", "the bank did not answer");
    });
    const first = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(first).toMatchObject({ code: "CONNECTOR_UNAVAILABLE", retry: "safe_same_key" });
    const retry = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(retry)).toMatchObject({ id: "PAY-901" });
    expect(runs.count).toBe(2);
  });

  // The company check runs inside the claim, so a bug's answer is never kept, and never replayed.
  it("step 20's decision 6: the code answers with a row of org_789: INTERNAL_ERROR, no claim is kept, and the retry runs the code again", async () => {
    const { registry, runs } = countedRegistry([], () => ({ tenant_id: "org_789", id: "PAY-1" }));
    const first = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(first).toMatchObject({ code: "INTERNAL_ERROR" });
    const retry = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      INV_1008,
    );
    expect(heard(retry)).toMatchObject({ id: "PAY-901" });
    expect(runs.count).toBe(2);
  });
});

describe("decision 5: the fingerprint", () => {
  it("step 20's decision 5: canonical JSON sorts each object's keys, keeps a list's order, and adds no spaces", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 5, e: 4 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"e":4,"f":5}]},"b":1}',
    );
  });

  // RFC 8785 compares keys by UTF-16 code units: capitals before small letters, and an emoji,
  // whose two code units start at D83D, before a letter at FB33. A comparison by language, or
  // by whole code points, puts them in another order. Found by the review.
  it("step 20's decision 5: canonical JSON orders keys by their UTF-16 code units", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3 })).toBe('{"B":2,"a":3,"b":1}');
    expect(canonicalJson({ "\uFB33": 1, "\u{1F600}": 2 })).toBe('{"\u{1F600}":2,"\uFB33":1}');
  });

  it("step 20's decision 5: two inputs that differ only in the order of their keys have one fingerprint", () => {
    expect(payloadHash({ invoice: "x", note: "y" })).toBe(payloadHash({ note: "y", invoice: "x" }));
  });

  it("step 20's decision 5: a list in another order is another request", () => {
    expect(payloadHash({ items: [1, 2] })).not.toBe(payloadHash({ items: [2, 1] }));
  });

  it("step 20's decision 5: a fingerprint is sha256: and 64 hex digits", () => {
    expect(payloadHash(INV_1008)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("step 20's decision 5: a number is written as JSON writes it, so 1.50 and 1.5 are one value", () => {
    expect(canonicalJson({ n: 1.5 })).toBe('{"n":1.5}');
    expect(payloadHash(JSON.parse('{"n":1.50}'))).toBe(payloadHash({ n: 1.5 }));
  });
});
