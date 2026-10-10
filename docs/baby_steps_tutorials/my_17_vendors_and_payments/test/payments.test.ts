// NEW IN STEP 17: the first command whose effect can be undone, and the operation that undoes it.
//
// `payment.create` makes a draft payment for one of the company's invoices, to that invoice's own
// vendor. `payment.cancel` takes a draft back. And every command now says, in its contract and on
// every receipt, which execution semantics apply: whether it commits in one transaction, can be
// undone by an operation it names, or cannot be undone at all (decision 125).
//
// Rule DSOR-EXE-05a: every command MUST declare one of these execution semantics in its contract.
// Rule DSOR-EXE-05b: every command result MUST state the execution semantics that applied.
// Rule DSOR-EXE-05c: a COMPENSATABLE or SAGA operation MUST name its compensating operations,
// which run under the full pipeline.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { success, type ErrorEnvelope, type ResultEnvelope } from "../src/envelopes.ts";
import {
  callOperation,
  makeDoor,
  PIPELINE,
  type Handler,
  type OperationAnswer,
} from "../src/operations.ts";
import { createPayment } from "../src/payment.ts";
import { contractsFromDisk, loadRegistry, type ContractDocument } from "../src/registry.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const CFO = { loggedInAs: "cfo_100" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const PAY_901 = "dsor://org_456/payment/PAY-901";
const AMOUNT = Object.freeze({ value: "31400.00", currency: "USD" });

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  await forgetTheLog("org_456");
});

/** The receipt of a command that ran, or an error naming what came back instead. */
function receiptOf(answer: OperationAnswer): ResultEnvelope {
  if (answer.kind !== "result") {
    throw new Error(`expected a receipt, got ${JSON.stringify(answer)}`);
  }

  return answer.envelope;
}

/** The refusal, or an error naming what came back instead. */
function refusalOf(answer: OperationAnswer): ErrorEnvelope {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  }

  return answer.envelope;
}

/** org_456's payments, as the owner reads them: number and status. */
const paymentsOf456 = async (): Promise<string[]> =>
  asTheOwner(async () =>
    (
      await db.query<{ id: string; status: string }>(
        "SELECT id, status FROM public.payments WHERE tenant_id = 'org_456' ORDER BY id",
      )
    ).rows.map((row) => `${row.id} ${row.status}`),
  );

describe("every command says whether it can be undone", () => {
  const registry = loadRegistry(contractsFromDisk());

  it("DSOR-EXE-05a: every command's contract declares its execution semantics", () => {
    const commands = [...registry.values()]
      .filter((contract) => contract.kind === "command")
      .map((contract) => `${contract.id} ${contract.execution?.semantics}`)
      .sort();

    expect(commands).toStrictEqual([
      "invoice.issue atomic",
      "payment.cancel atomic",
      "payment.create compensatable",
    ]);
  });

  it("DSOR-EXE-05c: payment.create names payment.cancel as the operation that undoes it", () => {
    expect(registry.get("payment.create")?.execution).toStrictEqual({
      semantics: "compensatable",
      compensated_by: ["payment.cancel"],
    });
  });
});

describe("payment.create", () => {
  it("DSOR-EXE-05b: makes PAY-902, a draft for 31,400.00 USD paying INV-1008 to VENDOR-44, and says it can be undone", async () => {
    const receipt = receiptOf(
      await callOperation(SUPERVISOR, "payment.create", { invoice: INV_1008, amount: AMOUNT }),
    );

    expect(receipt.outcome).toBe("COMMITTED");
    expect(receipt.semantics).toBe("compensatable");
    expect(receipt.data).toStrictEqual({
      uri: "dsor://org_456/payment/PAY-902",
      tenantId: "org_456",
      id: "PAY-902",
      vendor: "dsor://org_456/vendor/VENDOR-44",
      invoice: INV_1008,
      amount: { value: "31400.00", currency: "USD" },
      status: "draft",
    });
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft", "PAY-902 draft"]);
  });

  it("DSOR-CLS-02a: the agent's receipt leaves the amount out, though the agent sent it", async () => {
    const receipt = receiptOf(
      await callOperation(AGENT, "payment.create", { invoice: INV_1008, amount: AMOUNT }),
    );

    expect(receipt.semantics).toBe("compensatable");
    expect(receipt.data).not.toHaveProperty("amount");
    expect(receipt.redactions).toStrictEqual([
      { field: "amount", reason: "clearance", treatment: "omitted" },
    ]);
  });

  it("a payment for an invoice the company does not hold is refused, and nothing is made", async () => {
    // INV-2001 is org_789's alone. Asked as org_456, it is an invoice org_456 does not hold.
    const refusal = refusalOf(
      await callOperation(SUPERVISOR, "payment.create", {
        invoice: "dsor://org_456/invoice/INV-2001",
        amount: AMOUNT,
      }),
    );

    expect(refusal.code).toBe("RESOURCE_NOT_FOUND");
    expect(refusal.retry).toBe("never");
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft"]);
  });

  it("an amount a payment cannot carry is refused before anything is written", async () => {
    for (const amount of [
      undefined,
      31400,
      "31400.00",
      { value: 31400, currency: "USD" },
      { value: "0.00", currency: "USD" },
      { value: "0", currency: "USD" },
      { value: "-5.00", currency: "USD" },
      // Three decimals: the column holds two, and PostgreSQL would round this to 31400.01.
      { value: "31400.005", currency: "USD" },
      // Seventeen digits before the point: more than the column holds.
      { value: "12345678901234567.00", currency: "USD" },
      { value: "31,400.00", currency: "USD" },
      { value: "31400.00", currency: "usd" },
    ]) {
      const refusal = refusalOf(
        await callOperation(SUPERVISOR, "payment.create", { invoice: INV_1008, amount }),
      );

      expect(refusal.code, JSON.stringify(amount)).toBe("VALIDATION_FAILED");
      expect(refusal.retry, JSON.stringify(amount)).toBe("never");
    }

    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft"]);
  });

  it("the largest amount the column holds, to the cent, is made as it was sent", async () => {
    const receipt = receiptOf(
      await callOperation(SUPERVISOR, "payment.create", {
        invoice: INV_1008,
        amount: { value: "9999999999999999.99", currency: "USD" },
      }),
    );

    expect(receipt.data?.["amount"]).toStrictEqual({
      value: "9999999999999999.99",
      currency: "USD",
    });
  });

  it("DSOR-AUT-01b: the CFO may not make a payment", async () => {
    const refusal = refusalOf(
      await callOperation(CFO, "payment.create", { invoice: INV_1008, amount: AMOUNT }),
    );

    expect(refusal.code).toBe("AUTHORIZATION_DENIED");
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft"]);
  });
});

describe("payment.cancel", () => {
  it("DSOR-EXE-05b: takes PAY-901 back, and says how: atomic, one statement that commits or not", async () => {
    const receipt = receiptOf(await callOperation(SUPERVISOR, "payment.cancel", { payment: PAY_901 }));

    expect(receipt.semantics).toBe("atomic");
    expect(receipt.data?.["status"]).toBe("cancelled");
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 cancelled"]);
  });

  it("a cancelled payment is not cancelled again: CONFLICT, and asking again cannot help", async () => {
    receiptOf(await callOperation(SUPERVISOR, "payment.cancel", { payment: PAY_901 }));

    const refusal = refusalOf(await callOperation(SUPERVISOR, "payment.cancel", { payment: PAY_901 }));

    expect(refusal.code).toBe("CONFLICT");
    expect(refusal.retry).toBe("never");
    expect(refusal.message).toMatch(/PAY-901 is cancelled/);
  });

  it("a payment the company does not hold is not found", async () => {
    const refusal = refusalOf(
      await callOperation(SUPERVISOR, "payment.cancel", { payment: "dsor://org_456/payment/PAY-999" }),
    );

    expect(refusal.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("an invoice's address is not a payment's", async () => {
    const refusal = refusalOf(await callOperation(SUPERVISOR, "payment.cancel", { payment: INV_1008 }));

    expect(refusal.code).toBe("VALIDATION_FAILED");
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft"]);
  });

  it("DSOR-EXE-05c: what payment.create made, payment.cancel undoes", async () => {
    const made = receiptOf(
      await callOperation(AGENT, "payment.create", { invoice: INV_1008, amount: AMOUNT }),
    );
    const address = String(made.data?.["uri"]);
    const undone = receiptOf(await callOperation(AGENT, "payment.cancel", { payment: address }));

    expect(undone.data?.["uri"]).toBe(address);
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft", "PAY-902 cancelled"]);
  });

  it("DSOR-EXE-05c: the undo runs under the full pipeline: its own permission, its own decision in the log", async () => {
    // The CFO may not cancel, as the CFO may not create: the undo is an operation like any other.
    expect(refusalOf(await callOperation(CFO, "payment.cancel", { payment: PAY_901 })).code).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(await paymentsOf456()).toStrictEqual(["PAY-901 draft"]);

    receiptOf(await callOperation(SUPERVISOR, "payment.cancel", { payment: PAY_901 }));

    const decisions = (await theLog("org_456"))
      .filter((record) => record.kind === "decision")
      .map((record) => `${record.operation} ${record.authorization} ${record.result}`);

    expect(decisions).toStrictEqual([
      "payment.cancel@1 DENY AUTHORIZATION_DENIED",
      "payment.cancel@1 ALLOW ALLOWED",
    ]);
  });
});

describe("the door says the semantics, from the contract", () => {
  it("DSOR-EXE-05b: a handler that writes the wrong semantics does not change what the caller is told", async () => {
    // A careless handler, begun as a copy of one whose effect commits once: it makes the payment,
    // and says `atomic` on the receipt. The contract says the payment can be undone, and the door
    // says so.
    const careless: Handler = async (_args, _contract, askedBy, tenant, hash, requestId) => {
      const made = await createPayment(tenant, "INV-1008", AMOUNT);

      if (made.kind !== "created") {
        throw new Error("the story has no INV-1008 to pay");
      }

      return {
        kind: "result",
        askedBy,
        envelope: success({
          data: made.payment as unknown as Record<string, unknown>,
          semantics: "atomic",
          payloadHash: hash,
          tenant,
          principalId: askedBy,
          requestId,
        }),
      };
    };
    const door = makeDoor(PIPELINE, { "payment.create": careless });

    const receipt = receiptOf(await door(SUPERVISOR, "payment.create", { invoice: INV_1008, amount: AMOUNT }));

    expect(receipt.semantics).toBe("compensatable");
  });
});

describe("what undoes an operation is an operation the program has", () => {
  /** The contracts on disk, with payment.create's execution replaced. */
  const withExecution = (execution: unknown): ContractDocument[] =>
    contractsFromDisk().map((contract) =>
      contract.expectedId === "payment.create"
        ? { ...contract, document: { ...(contract.document as object), execution } }
        : contract,
    );

  it("DSOR-EXE-05c: an operation undone by one this program does not have stops the program", () => {
    expect(() =>
      loadRegistry(withExecution({ semantics: "compensatable", compensated_by: ["payment.vanish"] })),
    ).toThrow(/payment\.vanish/);
  });

  it("DSOR-EXE-05c: a query cannot undo anything, so naming one stops the program", () => {
    expect(() =>
      loadRegistry(withExecution({ semantics: "compensatable", compensated_by: ["invoice.get"] })),
    ).toThrow(/invoice\.get.*query/);
  });

  it("DSOR-EXE-05c: an operation that can be undone, and names nothing that undoes it, is refused", () => {
    // Without the key, the specification's schema refuses it. With an empty list, the schema takes
    // it, and the registry used to (decision 126): an undo promised and none named.
    expect(() => loadRegistry(withExecution({ semantics: "compensatable" }))).toThrow(/compensated_by/);
    expect(() =>
      loadRegistry(withExecution({ semantics: "compensatable", compensated_by: [] })),
    ).toThrow(/names nothing that undoes it/);
    expect(() => loadRegistry(withExecution({ semantics: "saga", compensated_by: [] }))).toThrow(
      /names nothing that undoes it/,
    );
  });

  it("DSOR-EXE-05c: an operation is not its own undo, and names each undo once", () => {
    // NEW IN STEP 17, decision 126: a careless contract that named payment.create where it meant
    // payment.cancel promised an undo that makes a second payment.
    expect(() =>
      loadRegistry(
        withExecution({ semantics: "compensatable", compensated_by: ["payment.create"] }),
      ),
    ).toThrow(/payment\.create is undone by itself/);
    expect(() =>
      loadRegistry(
        withExecution({
          semantics: "compensatable",
          compensated_by: ["payment.cancel", "payment.cancel"],
        }),
      ),
    ).toThrow(/names payment\.cancel twice/);
  });
});
