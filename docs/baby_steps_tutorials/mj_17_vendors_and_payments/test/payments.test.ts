// NEW IN STEP 17: payment.create makes a draft from the invoice DSoR reads, and
// payment.cancel undoes it, through the same checklist as every call (step 17's README, C3,
// C5, and C6; DSOR-EXE-05c in specs/dsor/03-execution.md, section 24).
import { describe, expect, it } from "vitest";
import type { Company } from "../src/company.ts";
import type { Answer } from "../src/envelope.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Handler, Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
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
  needsDelegation,
  notGranted,
  notValid,
  paymentRegistry,
  shipped,
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

/** Asks payment.create for an invoice of org_456, by its id, as user_123. */
function createFor(on: Registry, log: MemoryLog, id: string, who = SUPERVISOR): Promise<Answer> {
  return call(on, log, who, "payment.create", { invoice: `dsor://org_456/invoice/${id}` });
}

/** Asks payment.cancel for a payment, by its URI. */
function cancel(on: Registry, log: MemoryLog, payment: string, who: RequestEnvelope = SUPERVISOR) {
  return call(on, log, who, "payment.cancel", { payment });
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
    expect(await call(on, log, USER_700, "payment.create", input)).toMatchObject({
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
    const theirs = await call(on, log, USER_700, "payment.create", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(theirs).toMatchObject({ data: { tenant_id: "org_789", id: "PAY-902" } });
  });

  // Decision 10: until step 20's keys, a second request makes a second draft.
  it("step 17's decision 10: a second create for INV-1008 makes a second draft", async () => {
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

  it("DSOR-EXE-05c: payment.cancel by the agent is refused at line ③, recorded, and changes nothing", async () => {
    const { answer, records, rows } = await cancelAs(AGENT);
    expect(answer).toStrictEqual(
      refused("DELEGATION_REQUIRED", needsDelegation("payment.cancel"), THE_AGENT),
    );
    expect(records).toMatchObject([
      { operation: "payment.cancel@1", authorization: "DENY", result: "DELEGATION_REQUIRED" },
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
    await call(on, log, SUPERVISOR, "payment.cancel", { payment: PAY_901 }, (line) =>
      lines.push(line),
    );
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 9, 11]);
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
    await call(on, createLog(), SUPERVISOR, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(rows).toHaveLength(1);
    const draft = { invoice_id: "INV-1008", vendor_id: "VENDOR-44", amount: rows[0]!.amount };
    await expect(kept!.payments.create(draft)).rejects.toThrow("this call has ended");
    await expect(kept!.payments.cancel("PAY-901")).rejects.toThrow("this call has ended");
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });
});

// NEW IN STEP 17: B1 showed it. A command writes at line ⑨ and its record fails at line ⑪,
// so the side effect happened. EVIDENCE_STORE_UNAVAILABLE would tell the caller a retry is
// safe, and with no idempotency key until step 20, a retry writes a second draft. DSOR-ERR-02
// forbids such an answer for a command unless the side effect provably did not occur. Once a
// command's code has run, DSoR cannot prove that, so it answers INTERNAL_ERROR, which is
// never retried (step 17's README, decision 17).
describe("decision 17: once a command's code has run, a failed record is never answered as safe to retry", () => {
  const brokenLog = {
    add: async (): Promise<never> => {
      throw new Error("disk full");
    },
  };
  const AFTER_IT_RAN =
    "DSoR could not record its decision after the command ran, so a retry is not safe";

  it("step 17's decision 17: payment.create's draft is written and its record fails: INTERNAL_ERROR, retry never", async () => {
    const rows: Payment[] = [];
    const answer = await call(paymentRegistry(rows), brokenLog, SUPERVISOR, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", AFTER_IT_RAN, THE_SUPERVISOR));
    // The known gap of decision 1: the draft stays, with no record, until step 36.
    expect(rows).toStrictEqual([PAY_901_DRAFT]);
  });

  // The code refused, but DSoR cannot see whether it wrote first, so the answer is the same.
  it("step 17's decision 17: a command whose code refused, with a failed record: INTERNAL_ERROR too", async () => {
    const answer = await call(paymentRegistry([]), brokenLog, SUPERVISOR, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1001",
    });
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", AFTER_IT_RAN, THE_SUPERVISOR));
  });

  // Refused before its code ran, nothing happened, so a retry is safe, and it says so.
  it("DSOR-EXE-03b: a command refused before its code, with a failed record: EVIDENCE_STORE_UNAVAILABLE", async () => {
    const answer = await call(paymentRegistry([]), brokenLog, AGENT, "payment.create", {
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
