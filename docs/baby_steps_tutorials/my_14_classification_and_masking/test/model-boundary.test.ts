// NEW IN STEP 14: what leaves the door for an agent has been filtered by its clearance, says so,
// and carries a label.
//
// Measured on step 13's demo: the agent reads INV-1008 and gets `31400.00 USD`, the same line as
// the supervisor. An agent's answer travels to a model provider outside the company. So the
// amount left — and with invoice.list, a hundred amounts a page.
//
// Rule DSOR-CLS-02a: for agent principals, DSoR MUST omit, mask, or tokenize any field above the
// agent's clearance or barred by the tenant's model-egress policy before the response leaves DSoR.
// Rule DSOR-CLS-02b: a response from which fields were withheld MUST list the redactions.
// Rule DSOR-CLS-03: every query response MUST carry a classification label equal to the highest
// classification among the fields it contains.
// Rule DSOR-CLS-01: a field with no declared classification MUST be treated as CONFIDENTIAL.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Invoice } from "../src/invoice.ts";
import { leaveTheDoor } from "../src/boundary.ts";
import { refusal, success } from "../src/envelopes.ts";
import {
  callOperation,
  makeDoor,
  PIPELINE,
  type Handler,
  type OperationAnswer,
} from "../src/operations.ts";
import { labelOf } from "../src/classification.ts";
import { findPerson } from "../src/people.ts";
import { aDatabase, resetInvoices } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const AMOUNT_WITHHELD = { field: "amount", reason: "clearance", treatment: "omitted" };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
  await resetInvoices();
});

afterAll(async () => {
  await db.close();
});

describe("one invoice", () => {
  it("DSOR-CLS-02a: the agent's invoice has no amount; the supervisor's has it", async () => {
    const theirs = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(theirs.kind).toBe("data");
    expect(ours.kind).toBe("data");

    if (theirs.kind === "data" && ours.kind === "data") {
      expect("amount" in theirs.invoice).toBe(false);
      expect(Object.keys(theirs.invoice).sort()).toStrictEqual([
        "id",
        "status",
        "tenantId",
        "uri",
        "vendor",
      ]);
      // The supervisor's, whole: a review found a human silently losing `vendor` was caught by
      // nothing in this file.
      expect(ours.invoice).toStrictEqual({
        uri: INV_1008,
        tenantId: "org_456",
        id: "INV-1008",
        vendor: "VENDOR-44",
        amount: { value: "31400.00", currency: "USD" },
        status: "issued",
      });
    }
  });

  it("DSOR-CLS-02b: the agent's answer lists what was withheld, and the supervisor's lists nothing", async () => {
    const theirs = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect(theirs.redactions).toStrictEqual([AMOUNT_WITHHELD]);
      expect(ours.redactions).toStrictEqual([]);
    } else {
      throw new Error("expected data");
    }
  });

  it("DSOR-CLS-03: every answer carries the highest label among the fields it still holds", async () => {
    const theirs = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect(theirs.classification).toBe("internal"); // the amount is gone, the rest is internal
      expect(ours.classification).toBe("confidential"); // the amount is there
    } else {
      throw new Error("expected data");
    }
  });
});

describe("a page", () => {
  it("DSOR-CLS-02a: every invoice on the agent's page has lost its amount, listed once, and the page is labelled", async () => {
    const theirs = await callOperation(AGENT, "invoice.list", {});
    const ours = await callOperation(SUPERVISOR, "invoice.list", {});

    expect(theirs.kind).toBe("page");
    expect(ours.kind).toBe("page");

    if (theirs.kind === "page" && ours.kind === "page") {
      expect(theirs.page.invoices.length).toBeGreaterThan(1);
      expect(theirs.page.invoices.every((i) => !("amount" in i))).toBe(true);
      expect(theirs.redactions).toStrictEqual([AMOUNT_WITHHELD]);
      expect(theirs.classification).toBe("internal");
      expect(ours.page.invoices.every((i) => Object.keys(i).length === 6)).toBe(true);
      expect(ours.redactions).toStrictEqual([]);
      expect(ours.classification).toBe("confidential");
    }
  });
});

describe("a command's receipt", () => {
  it("DSOR-CLS-02a: the receipt the agent gets for issuing an invoice carries no amount either, and says so", async () => {
    const receipt = await callOperation(AGENT, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
    });

    expect(receipt.kind).toBe("result");

    if (receipt.kind === "result") {
      expect(receipt.envelope.outcome).toBe("COMMITTED");
      expect("amount" in receipt.envelope.data).toBe(false);
      expect(receipt.envelope.redactions).toStrictEqual([AMOUNT_WITHHELD]);
      expect(receipt.envelope.classification).toBe("internal");
    }
  });
});

/** A careless handler: whatever row it is given, as the answer to invoice.get. */
const handing = (row: object): Handler => {
  return async (_args, _contract, askedBy) => ({ kind: "data", askedBy, invoice: row as Invoice });
};

/** A row like INV-1008's, with fields added or, given as `undefined`, taken away. */
const aRow = (fields: Record<string, unknown>): object =>
  Object.freeze(
    Object.fromEntries(
      Object.entries({
        uri: INV_1008,
        tenantId: "org_456",
        id: "INV-1008",
        vendor: "VENDOR-44",
        amount: Object.freeze({ value: "31400.00", currency: "USD" }),
        status: "issued",
        ...fields,
      }).filter(([, value]) => value !== undefined),
    ),
  );

describe("the field nobody labelled", () => {
  // The query written next year returns a field nobody put in the table. A field with no label
  // is confidential, so the agent does not see it — and the door is where that is decided, for
  // any handler, which is why this one is careless on purpose. The row carries no amount, so the
  // supervisor's label comes from the unlabelled field alone.
  const withANote = handing(
    aRow({
      amount: undefined,
      notes: "paid in cash; the bank account is PK36 SCBL 0000 0011 2345 6702",
    }),
  );

  it("DSOR-CLS-01: the agent does not see it, and it is listed; the supervisor sees it, labelled confidential", async () => {
    const door = makeDoor(PIPELINE, { "invoice.get": withANote });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect("notes" in theirs.invoice).toBe(false);
      expect(theirs.redactions).toStrictEqual([
        { field: "notes", reason: "clearance", treatment: "omitted" },
      ]);
      expect(theirs.classification).toBe("internal");
      expect((ours.invoice as Record<string, unknown>)["notes"]).toMatch(/PK36/);
      expect(ours.classification).toBe("confidential");
    } else {
      throw new Error(`expected data, got ${theirs.kind} and ${ours.kind}`);
    }
  });

  it("DSOR-CLS-01: a field named like something every object inherits is unlabelled too, so it is confidential", async () => {
    // Decision 111. The label table is a JavaScript object, and every object inherits `toString`
    // and `valueOf`. The table used to answer those names with built-in functions, which are no
    // label at all, so the rule that an unlabelled field is confidential never fired. Measured
    // before: both left for the agent with the amount in them.
    const door = makeDoor(PIPELINE, {
      "invoice.get": handing(
        aRow({ amount: undefined, toString: "31400.00 USD", valueOf: "31400.00 USD" }),
      ),
    });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data") {
      expect(JSON.stringify(theirs)).not.toContain("31400.00");
      expect(theirs.redactions.map((r) => r.field)).toStrictEqual(["toString", "valueOf"]);
      expect(theirs.classification).toBe("internal");
    } else {
      throw new Error(`expected data, got ${theirs.kind}`);
    }
  });

  it("DSOR-CLS-01: a row with no address belongs to no entity, so every field of it is confidential", async () => {
    // One with no uri at all, one whose uri is not an address. The agent gets an empty invoice
    // and a list of everything; the label of nothing is public, and the list is the only sign.
    for (const row of [aRow({ uri: undefined }), aRow({ uri: "INV-1008" })]) {
      const door = makeDoor(PIPELINE, { "invoice.get": handing(row) });
      const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });

      expect(theirs.kind).toBe("data");

      if (theirs.kind === "data") {
        expect(theirs.invoice).toStrictEqual({});
        expect(theirs.redactions.map((r) => r.field)).toStrictEqual(Object.keys(row));
        expect(theirs.classification).toBe("public");
      }
    }
  });
});

describe("a restricted field", () => {
  // The table labels `bank_account` restricted before any column exists: the label comes with
  // the design. An agent cleared for internal loses it, and the supervisor's answer is labelled
  // restricted — the fourth label, reaching the door for the first time.
  it("DSOR-CLS-02a: above the clearance by two steps, taken out like any other; the supervisor's answer is restricted", async () => {
    const door = makeDoor(PIPELINE, {
      "invoice.get": handing(aRow({ bank_account: "PK36 SCBL 0000 0011 2345 6702" })),
    });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect(theirs.redactions.map((r) => r.field)).toStrictEqual(["amount", "bank_account"]);
      expect(theirs.classification).toBe("internal");
      expect(ours.classification).toBe("restricted");
    } else {
      throw new Error("expected data");
    }
  });
});

describe("a value the label cannot see inside", () => {
  it("DSOR-CLS-01: a confidential value nested inside an internal field does not leave, and the field is listed", async () => {
    // A reviewer got the amount out this way: `vendor` is internal, so a vendor whose value is an
    // object walked out whole, amount and all. A label describes a value it can see the whole of.
    // A value that is not a plain one — an object, an array, something with its own `toJSON` — is
    // confidential, whatever its field is called, which is `DSOR-CLS-01` one level down.
    const nested = aRow({
      vendor: { name: "VENDOR-44", amount: { value: "31400.00", currency: "USD" } },
    });
    const door = makeDoor(PIPELINE, { "invoice.get": handing(nested) });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect(JSON.stringify(theirs)).not.toContain("31400.00");
      expect(theirs.redactions.map((r) => r.field)).toStrictEqual(["vendor", "amount"]);
      expect(theirs.classification).toBe("internal");
      // And the human's answer is labelled by what the label could not see: confidential.
      expect(ours.classification).toBe("confidential");
    } else {
      throw new Error(`expected data, got ${theirs.kind} and ${ours.kind}`);
    }
  });

  it("DSOR-CLS-01: a value that answers JSON.stringify for itself is not a plain value either", async () => {
    const lying = aRow({
      vendor: { name: "VENDOR-44", toJSON: () => "VENDOR-44 owes 31400.00 USD" },
    });
    const door = makeDoor(PIPELINE, { "invoice.get": handing(lying) });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data") {
      expect(JSON.stringify(theirs)).not.toContain("31400.00");
      expect(theirs.redactions.map((r) => r.field)).toContain("vendor");
    } else {
      throw new Error("expected data");
    }
  });
});

describe("the one compound value a label can describe", () => {
  it("DSOR-CLS-01: an amount is one value, so its own label governs it — the break that lowers it is visible", async () => {
    // Money is `{ value, currency }`: an object with parts, and one value in this program's
    // vocabulary. Measured: with every object treated as unlabelled, lowering `amount` to
    // `internal` in the table changed nothing anywhere, because the rule above re-raised it to
    // confidential — the table's own entry had stopped mattering, and a break that used to fail
    // twenty-six tests failed two. A money value is described whole by its label.
    const theirs = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect(labelOf("invoice", "amount")).toBe("confidential");
      expect(theirs.redactions).toStrictEqual([AMOUNT_WITHHELD]);
      // The human's amount is there, whole, as the money it is.
      expect(ours.invoice.amount).toStrictEqual({ value: "31400.00", currency: "USD" });
      expect(ours.classification).toBe("confidential");
    } else {
      throw new Error("expected data");
    }
  });

  it("DSOR-CLS-01: a thing that is nearly money is not money, and is confidential", async () => {
    // Two parts and the right names is not enough: a third part, or a part that is not text, is
    // something the label cannot see the whole of.
    for (const nearly of [
      { value: "31400.00", currency: "USD", note: "and the bank account is PK36" },
      { value: { hidden: "31400.00" }, currency: "USD" },
    ]) {
      const door = makeDoor(PIPELINE, { "invoice.get": handing(aRow({ vendor: nearly })) });
      const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });

      expect(theirs.kind).toBe("data");

      if (theirs.kind === "data") {
        expect(JSON.stringify(theirs)).not.toContain("31400.00");
        expect(theirs.redactions.map((r) => r.field)).toContain("vendor");
      }
    }
  });

  it("DSOR-CLS-01: money in a field not declared to hold money is confidential, whatever that field's label", async () => {
    // Decision 110. Money keeps its field's label only in a field the table declares as money.
    // Measured before it: a handler that moved the amount into `vendor` sent it to the agent,
    // labelled internal, with nothing in the list.
    const door = makeDoor(PIPELINE, {
      "invoice.get": handing(
        aRow({ amount: undefined, vendor: { value: "31400.00", currency: "USD" } }),
      ),
    });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect(JSON.stringify(theirs)).not.toContain("31400.00");
      expect(theirs.redactions.map((r) => r.field)).toStrictEqual(["vendor"]);
      expect(theirs.classification).toBe("internal");
      // The person sees it, and the answer is labelled for what it holds: an amount.
      expect(ours.classification).toBe("confidential");
    } else {
      throw new Error(`expected data, got ${theirs.kind} and ${ours.kind}`);
    }
  });
});

describe("an answer the door cannot filter", () => {
  it("a handler that returns no row at all is the program's own error, never a crash", async () => {
    // A review handed the door a `data` answer whose invoice was null and got a raw TypeError out
    // of it, after the decision was recorded: no envelope, no code, nothing a caller can read.
    for (const row of [null, undefined, "INV-1008"]) {
      const door = makeDoor(PIPELINE, { "invoice.get": handing(row as unknown as object) });
      const answer = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

      expect(answer.kind, String(row)).toBe("error");

      if (answer.kind === "error") {
        expect(answer.envelope.code).toBe("INTERNAL_ERROR");
        expect(answer.envelope.retry).toBe("never");
      }
    }
  });

  it("a receipt that carries no data leaves as it came, with no label and no list", () => {
    // `data` is optional in result-envelope.schema.json, and step 17's first PENDING_APPROVAL
    // receipt has none. A review made the door throw on it, after the command had run. There is
    // nothing to filter and nothing to label: no data, no label.
    const envelope = {
      outcome: "COMMITTED" as const,
      proposal: "dsor://org_456/proposal/prop_0001",
      payload_hash: "sha256:0",
      semantics: "atomic",
      correlation: { request_id: "req_0", principal_id: "user_123" },
    };
    const leaving = leaveTheDoor(findPerson("accounts-payable-fte")!, {
      kind: "result",
      askedBy: "accounts-payable-fte",
      envelope: envelope as unknown as Parameters<typeof leaveTheDoor>[1] extends {
        envelope: infer E;
      }
        ? E
        : never,
    });

    expect(leaving.kind).toBe("result");

    if (leaving.kind === "result") {
      expect(leaving.envelope.classification).toBeUndefined();
      expect(leaving.envelope.redactions).toBeUndefined();
      expect("data" in leaving.envelope).toBe(false);
    }
  });
});

describe("the ceiling measures what leaves", () => {
  it("DSOR-QRY-01: a page too big only because of its amounts leaves for the agent, and is refused for the supervisor", async () => {
    // Step 13's ceiling is measured after this step's filter, which a comment claimed and no test
    // knew: a mutation moved the measurement back to the handler's answer and stayed green. Three
    // rows whose amounts are thirty thousand characters each are ninety kilobytes unfiltered and
    // a few hundred bytes with the amounts taken out.
    const fat = Array.from({ length: 3 }, (_u, i) =>
      aRow({
        uri: `dsor://org_456/invoice/INV-200${i}`,
        id: `INV-200${i}`,
        amount: { value: `${"3".repeat(30_000)}.00`, currency: "USD" },
      }),
    );
    const careless: Handler = async (_args, _contract, askedBy) => ({
      kind: "page",
      askedBy,
      page: { invoices: fat as Invoice[], next: undefined },
    });
    const door = makeDoor(PIPELINE, { "invoice.list": careless });
    const theirs = await door(AGENT, "invoice.list", {});
    const ours = await door(SUPERVISOR, "invoice.list", {});

    expect(theirs.kind).toBe("page"); // the amounts never left, so what left is small
    expect(ours.kind).toBe("error"); // what leaves for a human is over the ceiling

    if (ours.kind === "error") {
      expect(ours.envelope.code).toBe("INTERNAL_ERROR");
      expect(ours.envelope.message).toMatch(/bytes/);
    }
  });

  it("DSOR-ERR-01a: a filtered receipt is validated again, so one that does not validate never leaves", () => {
    // `success` validated the envelope it built; the door builds a second one with the label and
    // the list in it, and validates that. A mutation turned the second check off and stayed green.
    const envelope = success({
      data: aRow({}) as Readonly<Record<string, unknown>>,
      semantics: "atomic",
      payloadHash: "sha256:0",
      tenant: "org_456",
      requestId: "req_0",
      principalId: "user_123",
    });
    const smuggled = {
      ...envelope,
      surprise: "a field the schema does not have",
    } as typeof envelope;

    expect(() =>
      leaveTheDoor(findPerson("user_123")!, {
        kind: "result",
        askedBy: "user_123",
        envelope: smuggled,
      }),
    ).toThrow(/does not validate/);
  });
});

describe("a page of rows that do not look alike", () => {
  it("DSOR-CLS-02a: every row is filtered on its own, and the list names each field once", async () => {
    // A review's mutant filtered the first row and applied its result to the rest; the only page
    // test had two rows of the same shape and stayed green.
    const rows = [
      aRow({}),
      aRow({ id: "INV-1009", amount: undefined, notes: "a note nobody labelled" }),
      aRow({ id: "INV-1010", bank_account: "PK36 SCBL 0000 0011 2345 6702" }),
    ];
    const careless: Handler = async (_args, _contract, askedBy) => ({
      kind: "page",
      askedBy,
      page: { invoices: rows as Invoice[], next: undefined },
    });
    const door = makeDoor(PIPELINE, { "invoice.list": careless });
    const theirs = await door(AGENT, "invoice.list", {});
    const ours = await door(SUPERVISOR, "invoice.list", {});

    if (theirs.kind === "page" && ours.kind === "page") {
      expect(theirs.page.invoices.map((i) => Object.keys(i).sort())).toStrictEqual([
        ["id", "status", "tenantId", "uri", "vendor"],
        ["id", "status", "tenantId", "uri", "vendor"],
        ["id", "status", "tenantId", "uri", "vendor"],
      ]);
      expect(theirs.redactions.map((r) => r.field)).toStrictEqual([
        "amount",
        "notes",
        "bank_account",
      ]);
      expect(theirs.classification).toBe("internal");
      expect(ours.page.invoices.map((i) => Object.keys(i).length)).toStrictEqual([6, 6, 7]);
      expect(ours.classification).toBe("restricted");
    } else {
      throw new Error("expected pages");
    }
  });

  it("DSOR-CLS-03: an empty page is labelled public and lists nothing, for both callers", async () => {
    const after = { after: "dsor://org_456/invoice/INV-9999" };
    const theirs = await callOperation(AGENT, "invoice.list", after);
    const ours = await callOperation(SUPERVISOR, "invoice.list", after);

    for (const answer of [theirs, ours]) {
      expect(answer.kind).toBe("page");

      if (answer.kind === "page") {
        expect(answer.page.invoices).toStrictEqual([]);
        expect(answer.classification).toBe("public"); // the highest label among no fields
        expect(answer.redactions).toStrictEqual([]);
      }
    }
  });

  it("the next cursor is an address too, and goes with the rows' addresses", () => {
    // An agent cleared for public loses `uri`; a `next` that still carried the address would hand
    // it over anyway. Through leaveTheDoor directly, because no principal in the story is cleared
    // for public.
    const agent = { ...findPerson("accounts-payable-fte")!, clearance: undefined };
    const leaving = leaveTheDoor(agent, {
      kind: "page",
      askedBy: agent.id,
      page: { invoices: [aRow({}) as Invoice], next: INV_1008 },
    });

    expect(leaving.kind).toBe("page");

    if (leaving.kind === "page") {
      expect(leaving.page.next).toBeUndefined();
      expect(leaving.redactions.map((r) => r.field)).toContain("next");
    }
  });
});

describe("the parts of an answer that are not rows", () => {
  // Decision 112. The door filtered every field of every row, and copied the rest of the answer as
  // the handler gave it. A handler that put the row somewhere else, behind a cast, sent the amount
  // to the agent, with `amount` listed as withheld beside it.
  const smuggled = { who: "accounts-payable-fte", amount: { value: "31400.00", currency: "USD" } };
  const lying = smuggled as unknown as string;

  it("DSOR-CLS-02a: who asked is written by the door, whatever the handler wrote there", async () => {
    // Measured before: the first three answers carried 31400.00 in `askedBy`, through the door.
    const answers: OperationAnswer[] = [
      await makeDoor(PIPELINE, {
        "invoice.get": async () => ({ kind: "data", askedBy: lying, invoice: aRow({}) as Invoice }),
      })(AGENT, "invoice.get", { invoice: INV_1008 }),
      await makeDoor(PIPELINE, {
        "invoice.list": async () => ({
          kind: "page",
          askedBy: lying,
          page: { invoices: [aRow({}) as Invoice], next: undefined },
        }),
      })(AGENT, "invoice.list", {}),
      await makeDoor(PIPELINE, {
        "invoice.get": async () => ({
          kind: "error",
          askedBy: lying,
          envelope: refusal("VALIDATION_FAILED", "no such invoice"),
        }),
      })(AGENT, "invoice.get", { invoice: INV_1008 }),
    ];

    // And a command's receipt, with its row and without one, straight through the filter: every
    // way out of the door writes who asked.
    const receipt = success({
      data: aRow({}) as Readonly<Record<string, unknown>>,
      semantics: "atomic",
      payloadHash: "sha256:0",
      tenant: "org_456",
      requestId: "req_0",
      principalId: "accounts-payable-fte",
    });

    const withoutItsRow = { ...receipt, data: undefined } as unknown as typeof receipt;

    for (const envelope of [receipt, withoutItsRow]) {
      answers.push(
        leaveTheDoor(findPerson("accounts-payable-fte")!, {
          kind: "result",
          askedBy: lying,
          envelope,
        }),
      );
    }

    expect(answers.map((answer) => answer.kind)).toStrictEqual([
      "data",
      "page",
      "error",
      "result",
      "result",
    ]);

    for (const answer of answers) {
      expect(answer.askedBy, answer.kind).toBe("accounts-payable-fte");
      expect(JSON.stringify(answer), answer.kind).not.toContain("31400.00");
    }
  });
});
