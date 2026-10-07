// payment.create makes a draft from the invoice DSoR reads, and
// payment.cancel undoes it, through the same checklist as every call (step 17's README, C3,
// C5, and C6; DSOR-EXE-05c in specs/dsor/03-execution.md, section 24).
import { describe, expect, it } from "vitest";
import type { Company } from "../src/company.ts";
import type { Answer } from "../src/envelope.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import { memoryInvoices, type InvoiceStore } from "../src/invoice.ts";
import { money } from "../src/money.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { NO_SLIPS } from "../src/slips.ts";
import {
  AGENT,
  CFO,
  FOREIGN_URI,
  LOG_IN_FIRST,
  OUR_EXTENSIONS,
  PAY_901_DRAFT,
  SUPERVISOR,
  THE_789_SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_SUPERVISOR,
  USER_700,
  correlationFor,
  handlers,
  keyed,
  notGranted,
  notValid,
  paymentRegistry,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  UNEXPECTED,
  type Caller,
} from "./helpers.ts";

const PAY_901 = "dsor://org_456/payment/PAY-901";

/** A refusal with this code and message, naming this caller. */
function refused(code: string, message: string, caller: Caller): unknown {
  return { code, message, retry: "never", correlation: correlationFor(caller) };
}

/** A registry of its own, with the list of payments it writes, and a log. */
function fresh(): { on: Registry; rows: Payment[]; log: MemoryLog } {
  const rows: Payment[] = [];
  return { on: paymentRegistry(rows), rows, log: createLog() };
}

// Since step 20, every command carries an idempotency key, and each call below sends a new one,
// so no call is the retry of another (step 20's README, decision 3).
/** Asks payment.create for an invoice of org_456, by its id, as user_123. */
function createFor(on: Registry, log: MemoryLog, id: string, who = SUPERVISOR): Promise<Answer> {
  return call(on, log, keyed(who), "payment.create", { invoice: `dsor://org_456/invoice/${id}` });
}

/** Asks payment.cancel for a payment, by its URI. */
function cancel(on: Registry, log: MemoryLog, payment: string, who: RequestEnvelope = SUPERVISOR) {
  return call(on, log, keyed(who), "payment.cancel", { payment });
}

describe("C5: a draft is made only for an issued invoice, with the amount and vendor DSoR read", () => {
  // The map's "Done when": PAY-901 exists as a draft for 31,400.00 USD.
  it("step 17's decision 4: user_123 creates PAY-901, a draft for INV-1008's open amount and its vendor", async () => {
    const { on, rows, log } = fresh();
    expect(await createFor(on, log, "INV-1008")).toStrictEqual({
      data: PAY_901_DRAFT,
      // The amount is confidential, so the answer is.
      classification: "confidential",
      semantics: "compensatable",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  // A command's record names what it wrote, and its label. No connector: a command's answer
  // has no freshness (step 17's README, decision 2).
  it("DSOR-EXE-02: payment.create's record names the payment it wrote, and its label", async () => {
    const { on, log } = fresh();
    const answer = await createFor(on, log, "INV-1008");
    const records = await log.records();
    expect(records).toMatchObject([
      {
        operation: "payment.create@1",
        authorization: "ALLOW",
        result: "ok",
        tenant: "org_456",
        correlation: answer.correlation,
        resources: [PAY_901],
        row_count: 1,
        extensions: { [OUR_EXTENSIONS]: { classification: "confidential" } },
      },
    ]);
    expect(records[0]).not.toHaveProperty("connector");
    expect(records[0]!.extensions![OUR_EXTENSIONS]).not.toHaveProperty("freshness");
  });

  // DSoR reads the amount itself (DSOR-MOD-04), so the request has no place for one. The first
  // test of this block, where the draft holds the invoice's open amount, shows that DSoR read it.
  it("step 17's decision 4: a request that sends an amount is refused at line ⑥, and nothing is written", async () => {
    const { on, rows, log } = fresh();
    const input = {
      invoice: "dsor://org_456/invoice/INV-1008",
      amount: { value: "1.00", currency: "USD" },
    };
    expect(await call(on, log, SUPERVISOR, "payment.create", input)).toStrictEqual(
      refused(
        "VALIDATION_FAILED",
        notValid("payment.create", 'must NOT have additional properties: "amount"'),
        THE_SUPERVISOR,
      ),
    );
    expect(rows).toStrictEqual([]);
  });

  // A real run on 2026-10-04 read both: INV-1001 is paid, with 0.00 USD open, and INV-1005
  // is a draft that nobody issued (step 17's README, decision 13).
  it.each(["INV-1001", "INV-1005"])(
    "step 17's decision 13: %s is not issued, so it gets CONFLICT, and no draft",
    async (id) => {
      const { on, rows, log } = fresh();
      expect(await createFor(on, log, id)).toStrictEqual(
        refused(
          "CONFLICT",
          `invoice "${id}" is not issued, so no payment is drafted for it`,
          THE_SUPERVISOR,
        ),
      );
      expect(rows).toStrictEqual([]);
    },
  );

  it("DSOR-SRC-02b: another company's invoice gets TENANT_MISMATCH, and no draft", async () => {
    const { on, rows, log } = fresh();
    const input = { invoice: "dsor://org_789/invoice/INV-2001" };
    expect(await call(on, log, SUPERVISOR, "payment.create", input)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
    expect(rows).toStrictEqual([]);
  });

  it("step 17's decision 4: an invoice that does not exist gets RESOURCE_NOT_FOUND, and no draft", async () => {
    const { on, rows, log } = fresh();
    expect(await createFor(on, log, "INV-9999")).toStrictEqual(
      refused("RESOURCE_NOT_FOUND", 'no invoice "INV-9999"', THE_SUPERVISOR),
    );
    expect(rows).toStrictEqual([]);
  });

  it("step 17's decision 4: a vendor's URI is not an invoice's, so line ⑥ refuses it", async () => {
    const { on, rows, log } = fresh();
    const input = { invoice: "dsor://org_456/vendor/VENDOR-44" };
    expect(await call(on, log, SUPERVISOR, "payment.create", input)).toStrictEqual(
      refused(
        "VALIDATION_FAILED",
        notValid("payment.create", '/invoice must match pattern "^dsor://[^/]+/invoice/"'),
        THE_SUPERVISOR,
      ),
    );
    expect(rows).toStrictEqual([]);
  });

  // The code reads inside the active company only. org_789's INV-1008 has its own amount
  // and vendor.
  it("DSOR-IDN-03b: user_700 drafts org_789's INV-1008: its own amount and vendor", async () => {
    const { on, log } = fresh();
    const input = { invoice: "dsor://org_789/invoice/INV-1008" };
    expect(await call(on, log, keyed(USER_700), "payment.create", input)).toMatchObject({
      data: {
        tenant_id: "org_789",
        id: "PAY-901",
        invoice_id: "INV-1008",
        vendor_id: "VENDOR-77",
        amount: { value: "99000.00", currency: "USD" },
        status: "draft",
      },
      correlation: correlationFor(THE_789_SUPERVISOR),
    });
  });

  // Left open in step 17's README: so a company can count the payments of the others.
  it("step 17's left open: one counter numbers every company's payments", async () => {
    const { on, log } = fresh();
    await createFor(on, log, "INV-1008");
    const theirs = await call(on, log, keyed(USER_700), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(theirs).toMatchObject({ data: { tenant_id: "org_789", id: "PAY-902" } });
  });

  // Decision 10: until step 20's keys, a second request makes a second draft. Since step 20, a
  // second request with a key of its own still does: a key stops a retry, not a new request
  // (step 20's README, "Not the outcome").
  it("step 17's decision 10: a second create for INV-1008, with a key of its own, makes a second draft", async () => {
    const { on, rows, log } = fresh();
    await createFor(on, log, "INV-1008");
    await createFor(on, log, "INV-1008");
    expect(rows.map(({ id, status }) => `${id} ${status}`)).toStrictEqual([
      "PAY-901 draft",
      "PAY-902 draft",
    ]);
  });
});

describe("C6: a cancel changes only a draft", () => {
  it("step 17's decision 9: user_123 cancels PAY-901: it is cancelled, and the answer says atomic", async () => {
    const { on, rows, log } = fresh();
    await createFor(on, log, "INV-1008");
    const cancelled = { ...PAY_901_DRAFT, status: "cancelled" };
    expect(await cancel(on, log, PAY_901)).toStrictEqual({
      data: cancelled,
      classification: "confidential",
      semantics: "atomic",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    expect(rows).toStrictEqual([cancelled]);
  });

  it("step 17's decision 9: a second cancel gets CONFLICT, and the payment stays cancelled", async () => {
    const { on, rows, log } = fresh();
    await createFor(on, log, "INV-1008");
    await cancel(on, log, PAY_901);
    expect(await cancel(on, log, PAY_901)).toStrictEqual(
      refused(
        "CONFLICT",
        'payment "PAY-901" is not a draft, so it cannot be cancelled',
        THE_SUPERVISOR,
      ),
    );
    expect(rows.map(({ status }) => status)).toStrictEqual(["cancelled"]);
  });

  // A real run gave UPDATE 0 for both, so a second look tells them apart (decision 9).
  it("step 17's decision 9: a payment that does not exist gets RESOURCE_NOT_FOUND, not CONFLICT", async () => {
    const { on, log } = fresh();
    await createFor(on, log, "INV-1008");
    expect(await cancel(on, log, "dsor://org_456/payment/PAY-999")).toStrictEqual(
      refused("RESOURCE_NOT_FOUND", 'no payment "PAY-999"', THE_SUPERVISOR),
    );
  });

  // The cancel works inside the active company. org_789 has no PAY-901, whatever org_456 has.
  it("DSOR-IDN-03b: a cancel in org_789 does not find org_456's PAY-901, and changes nothing", async () => {
    const { on, rows, log } = fresh();
    await createFor(on, log, "INV-1008");
    const theirs = "dsor://org_789/payment/PAY-901";
    expect(await cancel(on, log, theirs, USER_700)).toStrictEqual(
      refused("RESOURCE_NOT_FOUND", 'no payment "PAY-901"', THE_789_SUPERVISOR),
    );
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });
});

describe("C3: the undo, payment.cancel, runs under the full checklist", () => {
  /** A draft PAY-901, then one cancel by this caller, and the records the cancel left. */
  async function cancelAs(who: RequestEnvelope, payment = PAY_901) {
    const { on, rows, log } = fresh();
    await createFor(on, log, "INV-1008");
    const answer = await cancel(on, log, payment, who);
    const records = (await log.records()).slice(1);
    return { answer, records, rows };
  }

  it("DSOR-EXE-05c: with no login, payment.cancel is refused, recorded, and changes nothing", async () => {
    const { answer, records, rows } = await cancelAs({});
    expect(answer).toStrictEqual(refused("AUTHENTICATION_REQUIRED", LOG_IN_FIRST, {}));
    expect(records).toMatchObject([{ authorization: "DENY", result: "AUTHENTICATION_REQUIRED" }]);
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  // Since step 18 the agent holds del_100, which lists no payment:cancel, so line ⑤ refuses
  // it (step 18's README, decision 5). Step 17's version stopped at line ③.
  it("DSOR-EXE-05c: payment.cancel by the agent, whose slip does not list it, is refused, recorded, and changes nothing", async () => {
    const { answer, records, rows } = await cancelAs(AGENT);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      correlation: correlationFor(THE_AGENT),
    });
    expect(records).toMatchObject([
      { operation: "payment.cancel@1", authorization: "DENY", result: "AUTHORIZATION_DENIED" },
    ]);
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  // The CFO holds neither payment permission (step 17's README, decision 6).
  it("DSOR-EXE-05c: payment.cancel by cfo_100 is refused at line ⑤, recorded, and changes nothing", async () => {
    const { answer, records, rows } = await cancelAs(CFO);
    expect(answer).toStrictEqual(
      refused("AUTHORIZATION_DENIED", notGranted("payment.cancel", "payment:cancel"), THE_CFO),
    );
    expect(records).toMatchObject([
      { operation: "payment.cancel@1", authorization: "DENY", result: "AUTHORIZATION_DENIED" },
    ]);
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  it("DSOR-EXE-05c: payment.cancel naming org_789's payment gets TENANT_MISMATCH, recorded", async () => {
    const { answer, records, rows } = await cancelAs(SUPERVISOR, "dsor://org_789/payment/PAY-901");
    expect(answer).toStrictEqual(refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR));
    expect(records).toMatchObject([
      { operation: "payment.cancel@1", authorization: "DENY", result: "TENANT_MISMATCH" },
    ]);
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  it("DSOR-EXE-05c: user_123's cancel runs every line a command reaches, and is recorded ALLOW", async () => {
    const { on, log } = fresh();
    await createFor(on, log, "INV-1008");
    const lines: number[] = [];
    await call(on, log, keyed(SUPERVISOR), "payment.cancel", { payment: PAY_901 }, (line) =>
      lines.push(line),
    );
    // Line ⑦ since step 20, where the key is claimed.
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 7, 9, 11]);
    expect((await log.records()).slice(1)).toMatchObject([
      {
        operation: "payment.cancel@1",
        authorization: "ALLOW",
        result: "ok",
        resources: [PAY_901],
      },
    ]);
  });
});

describe("the company the code is given writes only while its call runs", () => {
  // Step 15 closed the company's reads when line ⑨ ends. Its writes close with them, so code
  // that keeps the company cannot write a draft that no call recorded (step 17's README,
  // outcome 1).
  it("step 17's outcome 1: a company kept after line ⑨ writes nothing more", async () => {
    const rows: Payment[] = [];
    let kept: Company | undefined;
    const keeper: Handler = async (input, company) => {
      kept = company;
      return handlers["payment.create"]!(input, company);
    };
    const on = paymentRegistry(rows, shipped, { ...handlers, "payment.create": keeper });
    await call(on, createLog(), keyed(SUPERVISOR), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(rows).toHaveLength(1);
    const draft = { invoice_id: "INV-1008", vendor_id: "VENDOR-44", amount: rows[0]!.amount };
    await expect(kept!.payments.create(draft)).rejects.toThrow("this call has ended");
    await expect(kept!.payments.cancel("PAY-901")).rejects.toThrow("this call has ended");
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });
});

// B1 showed it. A command writes at line ⑨ and its record fails at line ⑪,
// so the side effect happened. Until step 20, with no idempotency key, a retry wrote a second
// draft, so DSoR answered INTERNAL_ERROR, which is never retried (step 17's README, decision
// 17). Since step 20 every command that reaches its code holds a claim, and a retry with the
// same key cannot run it twice. So the answer is EVIDENCE_STORE_UNAVAILABLE, safe_same_key
// (step 20's README, decision 10).
describe("decision 17, changed in step 20: once a command's code has run, a failed record is safe to retry with the same key only", () => {
  const brokenLog = {
    add: async (): Promise<never> => {
      throw new Error("disk full");
    },
  };
  const AFTER_IT_RAN =
    "DSoR could not record its decision after the command ran, and a retry with the same idempotency_key cannot run it twice";
  const lost = (caller: Caller): unknown => ({
    code: "EVIDENCE_STORE_UNAVAILABLE",
    message: AFTER_IT_RAN,
    retry: "safe_same_key",
    correlation: correlationFor(caller),
  });

  it("step 20's decision 10: payment.create's draft is written and its record fails: EVIDENCE_STORE_UNAVAILABLE, safe with the same key", async () => {
    const rows: Payment[] = [];
    const answer = await call(
      paymentRegistry(rows),
      brokenLog,
      keyed(SUPERVISOR),
      "payment.create",
      {
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    expect(answer).toStrictEqual(lost(THE_SUPERVISOR));
    // The known gap of decision 1: the draft stays, with no record, until step 36.
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  // The code refused, and the claim keeps the refusal, so a retry with the key hears it again.
  it("step 20's decision 10: a command whose code refused, with a failed record: the same answer", async () => {
    const answer = await call(paymentRegistry([]), brokenLog, keyed(SUPERVISOR), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1001",
    });
    expect(answer).toStrictEqual(lost(THE_SUPERVISOR));
  });

  // Refused before its code ran, nothing happened, so a retry is safe, and it says so.
  // An agent with no slip is refused at line ③, before its code (step 18's README, decision 2).
  it("DSOR-EXE-03b: a command refused before its code, with a failed record: EVIDENCE_STORE_UNAVAILABLE", async () => {
    const noSlip = paymentRegistry([], shipped, handlers, NO_SLIPS);
    const answer = await call(noSlip, brokenLog, keyed(AGENT), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message: "DSoR could not record its decision, so it refuses the call",
      retry: "safe_same_key",
      correlation: correlationFor(THE_AGENT),
    });
  });
});

// Found by the review (step 17's README, "Think it through").
describe("the review: what a broken step could have done with every test green", () => {
  // Finding A. Line ③ lets a query through for the agent, because a query changes nothing.
  // So a query's code is handed no payments: if it writes, the call fails.
  it("DSOR-DEL-01a: a query's code is handed no payments, so the agent's query writes nothing", async () => {
    const rows: Payment[] = [];
    const writes: Handler = async (input, company) => {
      const invoice = await handlers["invoice.get"]!(input, company);
      await company.payments.create({
        invoice_id: "INV-1008",
        vendor_id: "VENDOR-44",
        amount: { value: "31400.00", currency: "USD" },
      });
      return invoice;
    };
    const on = paymentRegistry(rows, shipped, { ...handlers, "invoice.get": writes });
    const answer = await call(on, createLog(), AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
    expect(rows).toStrictEqual([]);
  });

  // Every issued invoice in the fixtures has nothing paid yet, so drafting its whole amount
  // looked the same as drafting what is open. A store planted for this test has INV-1008
  // partly paid.
  it("step 17's decision 4: a partly paid invoice is drafted for what is still open, not its whole amount", async () => {
    const real = memoryInvoices();
    const partlyPaid: InvoiceStore = {
      ...real,
      get: async (tenant, id) => {
        const read = await real.get(tenant, id);
        const invoice = read.invoice && { ...read.invoice, open_amount: money("10000.00", "USD") };
        return { ...read, invoice };
      },
    };
    const rows: Payment[] = [];
    const on = buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      shippedInputs,
      shippedLabels,
      partlyPaid,
      memoryPayments(rows),
    );
    await createFor(on, createLog(), "INV-1008");
    expect(rows.map(({ amount }) => amount)).toStrictEqual([
      { value: "10000.00", currency: "USD" },
    ]);
  });

  // The code never reads the URI's middle part, so line ⑥'s /payment/ is the only guard.
  it.each([
    [
      "an invoice's URI that ends in a payment's id",
      { payment: "dsor://org_456/invoice/PAY-901" },
      '/payment must match pattern "^dsor://[^/]+/payment/"',
    ],
    [
      "an extra field",
      { payment: PAY_901, reason: "duplicate" },
      'must NOT have additional properties: "reason"',
    ],
    ["nothing at all", {}, "must have required property 'payment'"],
  ])(
    "DSOR-EXE-05c: payment.cancel given %s is refused at line ⑥, and PAY-901 stays a draft",
    async (_what, input, problem) => {
      const { on, rows, log } = fresh();
      await createFor(on, log, "INV-1008");
      expect(await call(on, log, SUPERVISOR, "payment.cancel", input)).toStrictEqual(
        refused("VALIDATION_FAILED", notValid("payment.cancel", problem), THE_SUPERVISOR),
      );
      expect(rows).toStrictEqual([PAY_901_DRAFT]);
    },
  );

  it("step 17's decision 4: payment.create given nothing at all is refused at line ⑥, and writes nothing", async () => {
    const { on, rows, log } = fresh();
    expect(await call(on, log, SUPERVISOR, "payment.create", {})).toStrictEqual(
      refused(
        "VALIDATION_FAILED",
        notValid("payment.create", "must have required property 'invoice'"),
        THE_SUPERVISOR,
      ),
    );
    expect(rows).toStrictEqual([]);
  });

  // A registry built without a store of payments writes nothing: when the store is missing,
  // the answer is no (as step 10's NO_STORE does for invoices).
  it.each([
    ["payment.create", { invoice: "dsor://org_456/invoice/INV-1008" }],
    ["payment.cancel", { payment: PAY_901 }],
  ])(
    "step 17's outcome 1: with no store of payments, %s fails with INTERNAL_ERROR",
    async (name, input) => {
      const noPayments = buildRegistry(
        shipped,
        handlers,
        shippedRoles,
        shippedInputs,
        shippedLabels,
        memoryInvoices(),
      );
      expect(await call(noPayments, createLog(), keyed(SUPERVISOR), name, input)).toStrictEqual(
        refused("INTERNAL_ERROR", UNEXPECTED, THE_SUPERVISOR),
      );
    },
  );

  // The memory store, alone. The pipeline copies every answer, so these can only be seen
  // here.
  it("step 17's decision 15: the memory store numbers after the rows it already holds", async () => {
    const rows: Payment[] = [structuredClone(PAY_901_DRAFT) as Payment];
    const made = await memoryPayments(rows).create("org_456", {
      invoice_id: "INV-1008",
      vendor_id: "VENDOR-44",
      amount: money("31400.00", "USD"),
    });
    expect(made.id).toBe("PAY-902");
  });

  it("step 17's outcome 1: the memory store keeps its own copies, so a caller cannot change a stored payment", async () => {
    const rows: Payment[] = [];
    const store = memoryPayments(rows);
    const amount = money("31400.00", "USD");
    const made = await store.create("org_456", {
      invoice_id: "INV-1008",
      vendor_id: "VENDOR-44",
      amount,
    });
    made.status = "cancelled";
    made.amount.value = "1.00";
    amount.value = "2.00";
    const { payment } = await store.cancel("org_456", "PAY-901");
    payment!.amount.value = "3.00";
    expect(rows.map(({ amount }) => amount.value)).toStrictEqual(["31400.00"]);
    expect(rows.map(({ status }) => status)).toStrictEqual(["cancelled"]);
  });
});
