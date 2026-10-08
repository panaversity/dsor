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
import { callOperation, makeDoor, PIPELINE, type Handler } from "../src/operations.ts";
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
      expect(Object.keys(theirs.invoice).sort()).toStrictEqual(["id", "status", "tenantId", "uri", "vendor"]);
      expect(ours.invoice.amount).toStrictEqual({ value: "31400.00", currency: "USD" });
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
      expect(ours.page.invoices.every((i) => i.amount !== undefined)).toBe(true);
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

describe("the field nobody labelled", () => {
  // The query written next year returns a field nobody put in the table. A field with no label
  // is confidential, so the agent does not see it — and the door is where that is decided, for
  // any handler, which is why this one is careless on purpose.
  const withABankAccount: Handler = async (_args, _contract, askedBy, tenant) => ({
    kind: "data",
    askedBy,
    invoice: Object.freeze({
      uri: `dsor://${tenant}/invoice/INV-1008`,
      tenantId: tenant,
      id: "INV-1008",
      vendor: "VENDOR-44",
      amount: Object.freeze({ value: "31400.00", currency: "USD" }),
      status: "issued",
      bank_account: "PK36 SCBL 0000 0011 2345 6702",
    } as Invoice),
  });

  it("DSOR-CLS-01: the agent does not see it, and it is listed; the supervisor sees it", async () => {
    const door = makeDoor(PIPELINE, { "invoice.get": withABankAccount });
    const theirs = await door(AGENT, "invoice.get", { invoice: INV_1008 });
    const ours = await door(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    if (theirs.kind === "data" && ours.kind === "data") {
      expect("bank_account" in theirs.invoice).toBe(false);
      expect(theirs.redactions).toStrictEqual([
        AMOUNT_WITHHELD,
        { field: "bank_account", reason: "clearance", treatment: "omitted" },
      ]);
      expect(theirs.classification).toBe("internal");
      expect((ours.invoice as Record<string, unknown>)["bank_account"]).toBe("PK36 SCBL 0000 0011 2345 6702");
      expect(ours.classification).toBe("confidential");
    } else {
      throw new Error(`expected data, got ${theirs.kind} and ${ours.kind}`);
    }
  });
});
