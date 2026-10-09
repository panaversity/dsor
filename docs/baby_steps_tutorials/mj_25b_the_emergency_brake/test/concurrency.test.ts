// Optimistic concurrency. A command names the version of the record its caller decided on, and
// DSoR refuses with STALE_STATE when the record has moved on (DSOR-CON-01a and DSOR-CON-01b in
// specs/dsor/03-execution.md, section 23; step 21's README, C1 to C10). Here the records are in
// memory. test/concurrency.db.test.ts proves the race and the database's own versions.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { checkedLabel } from "../src/freshness.ts";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import { money } from "../src/money.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import {
  AGENT,
  PAY_901_DRAFT,
  SUPERVISOR,
  contract,
  handlers,
  inputsWith,
  keyed,
  notValid,
  refusal,
  runAs,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  shippedWith,
  storyDirectories,
  testSlips,
  withPlanted,
} from "./helpers.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const PAY_901 = "dsor://org_456/payment/PAY-901";

// The refusals, typed out rather than imported.
const NEEDS_VERSION =
  "payment.cancel: an optimistic command's input must require expected_version, a whole number from 1 to 2147483647 (DSOR-CON-01b)";
// Step 14's message for a refusal whose reason is above the caller's clearance.
const WITHHELD = "the operation refused the call, and its reason is above the caller's clearance";
/** The refusal of a request decided on an older version of a record. */
function stale(record: string, now: number, decided: number): string {
  return `${record} is at version ${now}, and the request was decided on version ${decided}`;
}

/** The data of an answer, or its code when it was refused. */
function heard(answer: Answer): unknown {
  // Since step 23, a READY or VALIDATED answer has neither, and is heard as its outcome.
  if ("code" in answer) return answer.code;
  return "data" in answer ? answer.data : answer.outcome;
}

/**
 * The story's invoices, a copy for one test, and the shipped operations reading them. The test
 * may change an invoice in its copy, as org_456's accounts system does.
 */
function story(code: Record<string, Handler> = handlers): {
  registry: Registry;
  list: Invoice[];
  rows: Payment[];
} {
  const list = structuredClone(invoices);
  const rows: Payment[] = [];
  const registry = buildRegistry(
    shipped,
    code,
    shippedRoles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(list),
    memoryPayments(rows),
    testSlips(),
    storyDirectories(),
  );
  return { registry, list, rows };
}

/** 02:06: the accounts system records a credit note on INV-1008, which is version 2 now. */
function creditNote(list: Invoice[]): void {
  const found = list.find((i) => i.tenant_id === "org_456" && i.id === "INV-1008")!;
  found.open_amount = money("10000.00", "USD");
  found.version = 2;
}

describe("C1: every command declares a strategy that DSoR keeps", () => {
  it.each(["pessimistic", "connector_managed"])(
    "DSOR-CON-01a: start-up refuses a command whose strategy is %s, which this step does not build",
    (strategy) => {
      const changed = { ...contract("payment.cancel"), concurrency: { strategy } };
      expect(refusal(() => buildRegistry(shippedWith(changed), handlers, shippedRoles))).toContain(
        `payment.cancel: the concurrency strategy "${strategy}" is not built yet (DSOR-CON-01a)`,
      );
    },
  );

  it("DSOR-CON-01a: the strategy none is a strategy, and start-up accepts it", () => {
    const changed = { ...contract("payment.cancel"), concurrency: { strategy: "none" } };
    expect(refusal(() => buildRegistry(shippedWith(changed), handlers, shippedRoles))).toBe("");
  });

  // The contract's promise needs a version to compare. An input with no place for one cannot
  // keep it.
  it("DSOR-CON-01b: start-up refuses an optimistic command whose input does not require expected_version", () => {
    const loose = {
      type: "object",
      properties: { payment: { type: "string", pattern: "^dsor://[^/]+/payment/" } },
      required: ["payment"],
      additionalProperties: false,
    };
    const inputs = inputsWith("PaymentCancelRequest.schema.json", JSON.stringify(loose));
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, inputs))).toContain(
      NEEDS_VERSION,
    );
  });

  // One condition at a time. Found by the review: a schema that failed them all at once could
  // not tell which check was there.
  it.each([
    ["an optional version", { required: ["payment"] }, {}],
    ["a version of type number", {}, { type: "number" }],
    ["a version that may be 0", {}, { minimum: 0 }],
    ["a version with no minimum", {}, { minimum: undefined }],
    ["a version with no maximum", {}, { maximum: undefined }],
    ["a version larger than the column holds", {}, { maximum: 2 ** 53 }],
  ])("DSOR-CON-01b: start-up refuses an optimistic command's input with %s", (_, top, version) => {
    const schema = JSON.parse(
      shippedInputs.find((s) => s.file === "PaymentCancelRequest.schema.json")!.text,
    );
    const changed = {
      ...schema,
      ...top,
      properties: {
        ...schema.properties,
        expected_version: { ...schema.properties.expected_version, ...version },
      },
    };
    const inputs = inputsWith("PaymentCancelRequest.schema.json", JSON.stringify(changed));
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles, inputs))).toContain(
      NEEDS_VERSION,
    );
  });
});

describe("C2: a draft decided on another version of the invoice is refused", () => {
  it("DSOR-CON-01b: the agent decided on version 1 of INV-1008, which is version 2 now: STALE_STATE, and no draft", async () => {
    const { registry, list, rows } = story();
    creditNote(list);
    const log = createLog();
    const lines: number[] = [];
    const answer = await call(
      registry,
      log,
      keyed(AGENT),
      "payment.create",
      { invoice: INV_1008, expected_version: 1 },
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({
      code: "STALE_STATE",
      message: stale('invoice "INV-1008"', 2, 1),
      retry: "after_state_refresh",
    });
    expect(rows).toStrictEqual([]);
    // The code ran, and refused: the record says ALLOW, with the refusal as its result.
    // Line ⑧ since step 22, where the proposal is made.
    // Since step 24, line ⑩ too: the limits, after line ⑨'s read (step 24's README, decision 6).
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(await log.records()).toMatchObject([{ authorization: "ALLOW", result: "STALE_STATE" }]);
  });

  it("DSOR-CON-01b: the agent reads again, decides on version 2, and drafts the 10,000.00 USD that is open", async () => {
    const { registry, list } = story();
    creditNote(list);
    const read = await call(registry, createLog(), AGENT, "invoice.get", { invoice: INV_1008 });
    expect(heard(read)).toMatchObject({ id: "INV-1008", version: 2 });
    const answer = await call(registry, createLog(), keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1008,
      expected_version: 2,
    });
    expect(heard(answer)).toMatchObject({
      invoice_id: "INV-1008",
      amount: { value: "10000.00", currency: "USD" },
      status: "draft",
      version: 1,
    });
  });
});

describe("C4 and C6: a cancel decided on another version of the payment", () => {
  /** user_123's draft PAY-901 of INV-1008, and her first cancel, decided on version 1. */
  async function cancelledOnce() {
    const { registry, rows } = story();
    await call(registry, createLog(), keyed(SUPERVISOR), "payment.create", {
      invoice: INV_1008,
      expected_version: 1,
    });
    const first = await call(registry, createLog(), keyed(SUPERVISOR), "payment.cancel", {
      payment: PAY_901,
      expected_version: 1,
    });
    return { registry, rows, first };
  }

  it("DSOR-CON-01b: user_123 cancels PAY-901 on version 1: cancelled, and it is version 2", async () => {
    const { first } = await cancelledOnce();
    expect(heard(first)).toMatchObject({ id: "PAY-901", status: "cancelled", version: 2 });
  });

  it("DSOR-CON-01b: a second cancel decided on version 1 gets STALE_STATE, and the payment does not change", async () => {
    const { registry, rows } = await cancelledOnce();
    const again = await call(registry, createLog(), keyed(SUPERVISOR), "payment.cancel", {
      payment: PAY_901,
      expected_version: 1,
    });
    expect(again).toMatchObject({
      code: "STALE_STATE",
      message: stale('payment "PAY-901"', 2, 1),
      retry: "after_state_refresh",
    });
    expect(rows).toMatchObject([{ id: "PAY-901", status: "cancelled", version: 2 }]);
  });

  // A draft at version 2, which something outside DSoR changed: still a draft, so only the
  // version says that the cancel was decided on old facts. Found while planning break B4.
  it("DSOR-CON-01b: a cancel decided on version 1 of a draft that is version 2 now gets STALE_STATE, and the draft stays", async () => {
    const rows: Payment[] = [{ ...structuredClone(PAY_901_DRAFT), version: 2 } as Payment];
    const registry = buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      shippedInputs,
      shippedLabels,
      memoryInvoices(structuredClone(invoices)),
      memoryPayments(rows),
      testSlips(),
      storyDirectories(),
    );
    const answer = await call(registry, createLog(), keyed(SUPERVISOR), "payment.cancel", {
      payment: PAY_901,
      expected_version: 1,
    });
    expect(answer).toMatchObject({
      code: "STALE_STATE",
      message: stale('payment "PAY-901"', 2, 1),
    });
    expect(rows).toMatchObject([{ status: "draft", version: 2 }]);
  });

  // §23: CONFLICT is reserved for business-rule conflicts.
  it("step 21's decision 7: a second cancel decided on version 2 knows the facts, and gets the business rule's CONFLICT", async () => {
    const { registry } = await cancelledOnce();
    const again = await call(registry, createLog(), keyed(SUPERVISOR), "payment.cancel", {
      payment: PAY_901,
      expected_version: 2,
    });
    expect(again).toMatchObject({
      code: "CONFLICT",
      message: 'payment "PAY-901" is not a draft, so it cannot be cancelled',
    });
  });

  it("step 21's decision 7: a draft for INV-1005, a draft invoice, decided on version 2 of it, is stale before it is a conflict", async () => {
    const { registry } = story();
    const input = { invoice: "dsor://org_456/invoice/INV-1005" };
    const onTwo = await call(registry, createLog(), keyed(AGENT), "payment.create", {
      ...input,
      expected_version: 2,
    });
    const onOne = await call(registry, createLog(), keyed(AGENT), "payment.create", {
      ...input,
      expected_version: 1,
    });
    expect([heard(onTwo), heard(onOne)]).toStrictEqual(["STALE_STATE", "CONFLICT"]);
  });

  it("step 21's decision 7: a cancel of a payment that does not exist is not found, whatever version it names", async () => {
    const { registry } = story();
    const answer = await call(registry, createLog(), keyed(SUPERVISOR), "payment.cancel", {
      payment: "dsor://org_456/payment/PAY-999",
      expected_version: 1,
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });
});

describe("C8: a read of one record states its version", () => {
  it("DSOR-FRS-01a: invoice.get answers INV-1008 at version 1, and its label names resource_version 1", async () => {
    const { registry } = story();
    const answer = await call(registry, createLog(), AGENT, "invoice.get", { invoice: INV_1008 });
    expect(answer).toMatchObject({
      data: { id: "INV-1008", version: 1 },
      freshness: { mode: "current", connector: "memory", resource_version: "1" },
    });
  });

  it("DSOR-FRS-01a: after the credit note, the label names resource_version 2", async () => {
    const { registry, list } = story();
    creditNote(list);
    const answer = await call(registry, createLog(), AGENT, "invoice.get", { invoice: INV_1008 });
    expect(answer).toMatchObject({ freshness: { resource_version: "2" } });
  });

  // A page holds many records, and each row carries its own version.
  it("step 21's decision 9: invoice.list's label names no resource_version, and each row its version", async () => {
    const { registry } = story();
    const answer = await call(registry, createLog(), AGENT, "invoice.list", {});
    expect(answer).toHaveProperty("freshness");
    expect((answer as { freshness: object }).freshness).not.toHaveProperty("resource_version");
    const page = heard(answer) as { items: { version: number }[] };
    expect(page.items.every((item) => item.version === 1)).toBe(true);
  });
});

// An agent with no clearance written down sees only public fields, as test/sweep-gaps.test.ts
// plants it. intake-fte holds a slip of its own in the tests' slips.
const INTAKE = { token: "tok_intake", tenant: "org_456" };
function asIntake<T>(run: () => Promise<T>): Promise<T> {
  const memberships = [{ tenant_id: "org_456", roles: ["ap_agent"] }];
  return withPlanted("tok_intake", { id: "intake-fte", type: "agent", memberships }, run);
}

describe("decision 9, from the review: the version follows the caller's clearance", () => {
  // Masking hid the version in the data, so the label must not name it either.
  it("DSOR-CLS-02a: an agent that may see only public fields reads INV-1008: no version in its data, and none in its label", async () => {
    const { registry } = story();
    const answer = await asIntake(() =>
      call(registry, createLog(), INTAKE, "invoice.get", { invoice: INV_1008 }),
    );
    expect(answer).toMatchObject({ data: {}, classification: "public" });
    expect((answer as { redactions: { field: string }[] }).redactions).toContainEqual(
      expect.objectContaining({ field: "version" }),
    );
    expect((answer as { freshness: object }).freshness).not.toHaveProperty("resource_version");
  });

  // The stale refusal names two versions, which are internal, so its reason is withheld.
  it("DSOR-CLS-02a: that agent's stale draft hears STALE_STATE, with its reason withheld", async () => {
    const { registry, list } = story();
    creditNote(list);
    const answer = await asIntake(() =>
      call(registry, createLog(), keyed(INTAKE), "payment.create", {
        invoice: INV_1008,
        expected_version: 1,
      }),
    );
    expect(answer).toMatchObject({ code: "STALE_STATE", message: WITHHELD });
  });
});

describe("decision 9, from the review: a label's version", () => {
  it.each([
    ["empty", ""],
    ["with a space", "1 2"],
    ["of 129 characters", "9".repeat(129)],
    ["a number", 1],
  ])("DSOR-FRS-01a: a label whose version is %s is not a label", (_, version) => {
    const label = { mode: "current", observed_at: "2026-10-07T02:05:00Z", connector: "memory" };
    expect(() => checkedLabel({ ...label, resource_version: version })).toThrow(
      "a read's label names a version that is not one",
    );
  });

  // An answer built from two reads has no one version.
  it("DSOR-FRS-01a: a query that reads INV-1008 and INV-1009 states no resource_version", async () => {
    const answer = await runAs(AGENT, async (_input, company) => {
      const one = await company.invoices.get("INV-1008");
      await company.invoices.get("INV-1009");
      return one;
    });
    expect(answer).toHaveProperty("freshness");
    expect((answer as { freshness: object }).freshness).not.toHaveProperty("resource_version");
  });
});

describe("C9: expected_version is required, a whole number from 1 to 2147483647", () => {
  it.each([
    ["no version", {}, "must have required property 'expected_version'"],
    ["0", { expected_version: 0 }, "/expected_version must be >= 1"],
    ["text", { expected_version: "1" }, "/expected_version must be integer"],
    ["1.5", { expected_version: 1.5 }, "/expected_version must be integer"],
    // Found by the review: a larger version reached the database's integer column.
    ["2147483648", { expected_version: 2147483648 }, "/expected_version must be <= 2147483647"],
  ])(
    "step 21's decision 5: payment.create with %s is refused at line ⑥",
    async (_, version, problem) => {
      const { registry, rows } = story();
      const lines: number[] = [];
      const answer = await call(
        registry,
        createLog(),
        keyed(AGENT),
        "payment.create",
        { invoice: INV_1008, ...version },
        (n) => lines.push(n),
      );
      expect(answer).toMatchObject({
        code: "VALIDATION_FAILED",
        message: notValid("payment.create", problem),
      });
      expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 11]);
      expect(rows).toStrictEqual([]);
    },
  );

  it("step 21's decision 5: payment.cancel with no version is refused at line ⑥", async () => {
    const { registry } = story();
    const answer = await call(registry, createLog(), keyed(SUPERVISOR), "payment.cancel", {
      payment: PAY_901,
    });
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: notValid("payment.cancel", "must have required property 'expected_version'"),
    });
  });
});

describe("C10: a stale refusal is kept with its key", () => {
  it("DSOR-IDM-01c: the same stale request with the same key hears STALE_STATE again, and the code runs once", async () => {
    let runs = 0;
    const counted: Handler = async (input, company) => {
      runs += 1;
      return handlers["payment.create"]!(input, company);
    };
    const { registry, list } = story({ ...handlers, "payment.create": counted });
    creditNote(list);
    const request = { invoice: INV_1008, expected_version: 1 };
    const one = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      request,
    );
    const two = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      request,
    );
    expect([heard(one), heard(two)]).toStrictEqual(["STALE_STATE", "STALE_STATE"]);
    expect(runs).toBe(1);
  });

  // Deciding again is a new request: its fingerprint holds the new version.
  it("step 21's decision 3: the decision on version 2 under the old key is IDEMPOTENCY_CONFLICT, and under a new key a draft", async () => {
    const { registry, list } = story();
    creditNote(list);
    await call(registry, createLog(), keyed(AGENT, "pay-INV-1008-a"), "payment.create", {
      invoice: INV_1008,
      expected_version: 1,
    });
    const oldKey = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-a"),
      "payment.create",
      {
        invoice: INV_1008,
        expected_version: 2,
      },
    );
    const newKey = await call(
      registry,
      createLog(),
      keyed(AGENT, "pay-INV-1008-b"),
      "payment.create",
      {
        invoice: INV_1008,
        expected_version: 2,
      },
    );
    expect(heard(oldKey)).toBe("IDEMPOTENCY_CONFLICT");
    expect(heard(newKey)).toMatchObject({ id: "PAY-901", status: "draft" });
  });
});
