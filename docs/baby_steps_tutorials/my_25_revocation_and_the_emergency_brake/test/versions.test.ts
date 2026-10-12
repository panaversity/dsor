// STEP 21: optimistic concurrency.
//
// A caller decides on a record as it read it. If the record has moved on before the command runs,
// the decision was about something that no longer exists, and DSoR refuses it: "re-read and decide
// again". Each invoice and payment carries a version, raised by one with every change (decision 133).
//
// Rule DSOR-CON-01a: every command MUST declare its concurrency strategy.
// Rule DSOR-CON-01b: an optimistic command MUST return STALE_STATE when the resource version differs
// from the version the decision was made on.
// Rule DSOR-FRS-01a: every query result MUST state observed_at, the resource_version where one
// exists, the connector, and the freshness mode actually delivered.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { getInvoice, issueInvoice } from "../src/invoice.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import { paymentsOf } from "../src/payment.ts";
import { callOperation } from "./support/door.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";

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

describe("every invoice and payment has a version", () => {
  it("DSOR-FRS-01a: a read says the version, and the story starts at 1", async () => {
    const answer = await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "data") {
      throw new Error(`expected a row, got ${JSON.stringify(answer)}`);
    }

    expect(answer.invoice.version).toBe(1);
    expect((await paymentsOf("org_456")).map((p) => `${p.id} ${p.version}`)).toStrictEqual([
      "PAY-901 1",
    ]);
  });

  it("DSOR-CON-01b: every change raises the version by one, in the same statement", async () => {
    await callOperation(SUPERVISOR, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });

    expect((await getInvoice("org_456", "INV-1009")).value?.version).toBe(2);
  });

  it("the version is a whole number from 1, and the table says so", async () => {
    const { rows } = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT table_name || '.' || column_name AS column_name, is_nullable FROM information_schema.columns
        WHERE column_name = 'version' AND table_name IN ('invoices', 'payments') ORDER BY 1`,
    );

    expect(rows).toStrictEqual([
      { column_name: "invoices.version", is_nullable: "NO" },
      { column_name: "payments.version", is_nullable: "NO" },
    ]);
  });
});

describe("a command says the version it decided on", () => {
  const INV_1009 = "dsor://org_456/invoice/INV-1009";
  const PAY_901 = "dsor://org_456/payment/PAY-901";

  it("DSOR-CON-01a: every command declares its strategy: optimistic where it changes a record, none where it makes one", () => {
    const strategies = Object.fromEntries(
      [...loadRegistry(contractsFromDisk()).values()]
        .filter((c) => c.kind === "command")
        .map((c) => [
          c.id,
          (c as unknown as { concurrency: { strategy: string } }).concurrency.strategy,
        ]),
    );

    expect(strategies).toStrictEqual({
      // NEW IN STEP 25: a brake has no version to decide on; pulling one that is on, or
      // releasing one that is not, is refused for what it is (decision 142).
      "control.suspend": "none",
      // NEW IN STEP 25: nor a slip; revoking one that is not active is refused for what it is.
      "delegation.revoke": "none",
      "invoice.issue": "optimistic",
      "payment.cancel": "optimistic",
      "payment.create": "none",
    });
  });

  it("DSOR-CON-01b: an optimistic command with no version, or one that is not a whole number from 1, is refused, and each refusal is recorded as a DENY", async () => {
    for (const [id, args] of [
      ["invoice.issue", { invoice: INV_1009 }],
      ["payment.cancel", { payment: PAY_901 }],
    ] as const) {
      // Decision 134: and nothing past PostgreSQL's largest INTEGER, which made the door throw.
      for (const given of [undefined, 0, -1, 1.5, "1", null, 2 ** 31, 1e300]) {
        const answer = await callOperation(SUPERVISOR, id, { ...args, expected_version: given });

        expect(answer.kind === "error" && answer.envelope.code, `${id} ${String(given)}`).toBe(
          "VALIDATION_FAILED",
        );
      }
    }

    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
    // Decision 152: and the log says so, sixteen times. The handlers ask for the version again, so
    // the answer above is VALIDATION_FAILED even when §21.6 lets a bad version through; only the log
    // shows that §21.11 then recorded ALLOW for a request that was never valid.
    expect(
      (await theLog("org_456"))
        .filter((r) => r.kind === "decision")
        .map((r) => `${r.authorization} ${r.result}`),
    ).toStrictEqual(Array(16).fill("DENY VALIDATION_FAILED"));
  });

  // Decision 152: since step 23 a command can be prepared, propose_only, or tried as a dry run,
  // validate_only, and neither runs the handler that asks for the version a second time. For those
  // two, §21.6 is the only check: with it weakened, a bad version was prepared READY and dry-run
  // VALIDATED (measured).
  it("DSOR-CON-01b: a prepared command or a dry run with a version that is not a whole number from 1 is refused at §21.6, and recorded as a DENY", async () => {
    let key = 0;

    for (const mode of ["propose_only", "validate_only"] as const) {
      for (const [id, args] of [
        ["invoice.issue", { invoice: INV_1009 }],
        ["payment.cancel", { payment: PAY_901 }],
      ] as const) {
        for (const given of [undefined, 0, -1, 1.5, "1", null, 2 ** 31, 1e300]) {
          // A key of its own, so that nothing after §21.6 refuses it for some other reason.
          key += 1;

          const answer = await callOperation(
            SUPERVISOR,
            id,
            { ...args, expected_version: given },
            { idempotencyKey: `bad-version-${key}`, mode },
          );

          expect(
            answer.kind === "error" && answer.envelope.code,
            `${mode} ${id} ${String(given)}`,
          ).toBe("VALIDATION_FAILED");
        }
      }
    }

    expect(
      (await theLog("org_456"))
        .filter((r) => r.kind === "decision")
        .map((r) => `${r.authorization} ${r.result}`),
    ).toStrictEqual(Array(32).fill("DENY VALIDATION_FAILED"));
  });

  it("DSOR-CON-01b: a missing version is refused at §21.6, and recorded as the DENY it is", async () => {
    // Decision 134: the handlers asked by hand, after §21.11 had recorded ALLOW.
    await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    const decisions = (await theLog("org_456")).filter((r) => r.kind === "decision");

    expect(decisions.map((r) => `${r.authorization} ${r.result}`)).toStrictEqual([
      "DENY VALIDATION_FAILED",
    ]);
  });

  it("DSOR-CON-01a: a strategy this program does not carry out stops it at load", () => {
    for (const strategy of ["pessimistic", "connector_managed"]) {
      const declared = contractsFromDisk().map((c) =>
        c.expectedId === "payment.cancel"
          ? { ...c, document: { ...(c.document as object), concurrency: { strategy } } }
          : c,
      );

      expect(() => loadRegistry(declared), strategy).toThrow(/payment\.cancel/);
    }
  });

  it("DSOR-CON-01b: an invoice that moved on since the version read is STALE_STATE, and is not touched", async () => {
    await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009, expected_version: 1 });

    const stale = await callOperation(AGENT, "invoice.issue", {
      invoice: INV_1009,
      expected_version: 1,
    });

    expect(stale.kind === "error" && stale.envelope.code).toBe("STALE_STATE");
    expect(stale.kind === "error" && stale.envelope.retry).toBe("after_state_refresh");
    expect((await getInvoice("org_456", "INV-1009")).value?.version).toBe(2);

    // Re-read, decide again: on version 2 the answer is the business rule's.
    const again = await callOperation(AGENT, "invoice.issue", {
      invoice: INV_1009,
      expected_version: 2,
    });

    expect(again.kind === "error" && again.envelope.code).toBe("CONFLICT");
  });

  it("DSOR-CON-01b: so does a payment, cancelled since the version read", async () => {
    expect(
      (await callOperation(SUPERVISOR, "payment.cancel", { payment: PAY_901, expected_version: 1 }))
        .kind,
    ).toBe("result");

    const stale = await callOperation(AGENT, "payment.cancel", {
      payment: PAY_901,
      expected_version: 1,
    });

    expect(stale.kind === "error" && stale.envelope.code).toBe("STALE_STATE");
    // Decision 152: and word for word, as for an invoice. The invoice's test pins the shared
    // words, so a number written into the payment's own call to them passed every test.
    expect(stale.kind === "error" && stale.envelope.message).toBe(
      "PAY-901 has changed since the version the decision was made on; read it again and decide again",
    );
  });

  it("DSOR-CON-01b: two changes on one version, sent together: one is made, the other finds it stale", async () => {
    // At the store, because two decisions in one company at one moment also race for the next
    // place in its log, which is the log's to settle (audit-race.test.ts), not this step's.
    const both = await Promise.all([
      issueInvoice("org_456", "INV-1009", 1),
      issueInvoice("org_456", "INV-1009", 1),
    ]);

    expect(both.map((o) => o.kind).sort()).toStrictEqual(["issued", "stale"]);
    expect((await getInvoice("org_456", "INV-1009")).value?.version).toBe(2);
  });
});

describe("the version, and nothing else, decides staleness", () => {
  // Decision 134: with the version taken out of the UPDATE, every test above still passed, because
  // the status alone refused each case. These two pass only if the version is asked.
  it("DSOR-CON-01b: a draft at version 1, decided on as version 7, is STALE_STATE and untouched", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 7,
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("STALE_STATE");
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
  });

  it("DSOR-CON-01b: a draft reopened at version 3, decided on as version 1, is STALE_STATE and untouched", async () => {
    await asTheOwner(() =>
      db.exec(
        "UPDATE public.invoices SET version = 3 WHERE tenant_id = 'org_456' AND id = 'INV-1009'",
      ),
    );

    expect(await issueInvoice("org_456", "INV-1009", 1)).toStrictEqual({
      kind: "stale",
      version: 3,
    });
    expect((await getInvoice("org_456", "INV-1009")).value?.status).toBe("draft");
  });

  it("DSOR-CON-01b: a draft payment at version 1, decided on as version 7, is STALE_STATE and not cancelled", async () => {
    const answer = await callOperation(SUPERVISOR, "payment.cancel", {
      payment: "dsor://org_456/payment/PAY-901",
      expected_version: 7,
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("STALE_STATE");
    expect((await paymentsOf("org_456")).find((p) => p.id === "PAY-901")?.status).toBe("draft");
  });

  it("DSOR-CON-01b: cancelling a payment raises its version, and a new payment starts at 1", async () => {
    const made = await callOperation(SUPERVISOR, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      amount: { value: "10.00", currency: "USD" },
    });

    expect(made.kind === "result" && made.envelope.data?.["version"]).toBe(1);

    const cancelled = await callOperation(SUPERVISOR, "payment.cancel", {
      payment: "dsor://org_456/payment/PAY-901",
      expected_version: 1,
    });

    expect(cancelled.kind === "result" && cancelled.envelope.data?.["version"]).toBe(2);
  });

  it("DSOR-CON-01b: STALE_STATE does not hand over the new version: read again, and decide again", async () => {
    await issueInvoice("org_456", "INV-1009", 1);

    const stale = await callOperation(AGENT, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });

    expect(stale.kind === "error" && stale.envelope.code).toBe("STALE_STATE");
    // The whole message, word for word: a number anywhere in it, in any wording, is a version the
    // agent could retry on without reading (decision 135).
    expect(stale.kind === "error" && stale.envelope.message).toBe(
      "INV-1009 has changed since the version the decision was made on; read it again and decide again",
    );
  });
});
