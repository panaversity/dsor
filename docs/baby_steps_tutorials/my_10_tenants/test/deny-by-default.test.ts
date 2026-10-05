// NEW IN STEP 06: the test the whole step exists for.
//
// The map's "done when" for this step reads: a caller with `invoice:read` can read and cannot
// issue. That caller is cfo_100 — she approves payments, and does not type invoices into the
// accounts-payable system.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { aDatabase } from "./support/database.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

const CFO = { loggedInAs: "cfo_100" } as const;
const SUPERVISOR = { loggedInAs: "user_123" } as const;
const AGENT = { loggedInAs: "accounts-payable-fte" } as const;

/** The error envelope an answer carries, or a failure if it was not a refusal. */
function refusalFrom(answer: OperationAnswer) {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${answer.kind}`);
  }

  return answer.envelope;
}

// STEP 09: the log lives in a database, so these tests need one. A single PGlite for the
// whole file — creating one costs about 350ms, and one per test would turn this suite into minutes.
let db: Awaited<ReturnType<typeof aDatabase>>;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("anything not granted is refused", () => {
  it("DSOR-AUT-01b: cfo_100 may read an invoice", async () => {
    const answer = await callOperation(CFO, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "data") {
      throw new Error(`expected data, got ${answer.kind}`);
    }

    expect(answer.invoice.amount.value).toBe("31400.00");
  });

  // The other half of the map's "done when", and the point of the step.
  it("DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries", async () => {
    const envelope = refusalFrom(await callOperation(CFO, "invoice.issue", { invoice: INV_1009 }));

    expect(envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(envelope.retry).toBe("never");

    // Still a draft, so the refusal happened before anything changed.
    const after = await callOperation(CFO, "invoice.get", { invoice: INV_1009 });

    if (after.kind !== "data") {
      throw new Error("INV-1009 should still be readable");
    }

    expect(after.invoice.status).toBe("draft");
  });

  // Decision 35. It says she may not do it, not what she was missing. A refusal that names the
  // missing permission draws the permission model for anyone willing to ask twenty times.
  it("DSOR-AUT-01b: the refusal does not say which permission was missing", async () => {
    const envelope = refusalFrom(await callOperation(CFO, "invoice.issue", { invoice: INV_1009 }));

    expect(envelope.message).toContain("cfo_100");
    expect(envelope.message).toContain("invoice.issue");
    expect(envelope.message).not.toContain("invoice:issue");
    expect(envelope.message).not.toMatch(/permission|granted|role|invoice:/);
  });

  // Asserting against CFO.loggedInAs, not the literal "cfo_100". A hostile review pointed out
  // that a test whose expected value is a constant cannot tell the caller's real id from that
  // one string — the same trap step 05's attribution test fell into.
  it("DSOR-AUT-01b: a denial says who was denied", async () => {
    const answer = await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    expect(answer.askedBy).toBe(CFO.loggedInAs);
    expect(refusalFrom(answer).correlation.principal_id).toBe(CFO.loggedInAs);
  });

  // Step 05's rule, applied to authorization. Who you are never comes from the arguments, and
  // neither does *what you may do*. A hostile review proved this was untested: making the gate
  // believe a `permission` written into the arguments let cfo_100 issue the invoice, with all
  // 126 tests still green.
  it("DSOR-SRC-02a: the permission comes from the contract, never from the arguments", async () => {
    const planted = [
      { permission: "invoice:read" },
      { permission: "" },
      { authorization: { permission: "invoice:read" } },
      { needed: "invoice:read", required_permission: "invoice:read" },
    ] as const;

    for (const extra of planted) {
      const envelope = refusalFrom(
        await callOperation(CFO, "invoice.issue", { invoice: INV_1009, ...extra }),
      );

      expect(envelope.code, JSON.stringify(extra)).toBe("AUTHORIZATION_DENIED");
    }

    // And it still is not issued.
    const after = await callOperation(CFO, "invoice.get", { invoice: INV_1009 });

    if (after.kind !== "data") {
      throw new Error("INV-1009 should still be readable");
    }

    expect(after.invoice.status).toBe("draft");
  });

  // The denial is a new return site, and every answer in this program is frozen because
  // `readonly` is erased before Node runs. No test covered this one.
  it("a denial cannot be edited after it is handed out", async () => {
    const answer = await callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    expect(Object.isFrozen(answer)).toBe(true);
    expect(() => {
      (answer as { askedBy: string }).askedBy = "user_123";
    }).toThrow(TypeError);
  });

  // Why the gate goes *before* the arguments are read.
  //
  // If the address were read first, cfo_100 could ask about INV-1009 and INV-9999 and compare
  // the two answers: RESOURCE_NOT_FOUND for one, AUTHORIZATION_DENIED for the other. Two
  // different answers would tell her which invoices exist — she would be counting records she
  // has no permission to touch, one guess at a time. Because authority is settled first, every
  // one of these is the same refusal and she learns nothing.
  //
  // This is the mechanism DSOR-ERR-01b needs. The rule itself is about a caller who may not
  // *read* a resource, and all three roles here hold invoice:read, so the step cannot claim it.
  it("DSOR-AUT-01b: being refused for authority tells the caller nothing about the data", async () => {
    const attempts = [
      ["a draft that exists", INV_1009],
      ["an invoice that does not exist", "dsor://org_456/invoice/INV-9999"],
      ["an invoice that is already issued", INV_1008],
      ["an address that is not canonical", "INV-1009"],
      ["another company's invoice", "dsor://org_999/invoice/INV-1008"],
      ["the wrong kind of thing", "dsor://org_456/vendor/VENDOR-44"],
    ] as const;

    const seen = new Set<string>();

    for (const [why, invoice] of attempts) {
      const envelope = refusalFrom(await callOperation(CFO, "invoice.issue", { invoice }));

      expect(envelope.code, why).toBe("AUTHORIZATION_DENIED");
      seen.add(envelope.message);
    }

    // Not even a missing argument is examined — and its message joins the set, so a message
    // that varied with the arguments could not hide here either.
    const noArgument = refusalFrom(await callOperation(CFO, "invoice.issue", {}));

    expect(noArgument.code).toBe("AUTHORIZATION_DENIED");
    seen.add(noArgument.message);

    // And arguments that cannot be written down at all. These are the ones that matter, because
    // they are the only ones the *validate* stage can refuse by itself — so they are the only
    // inputs that can tell whether authority was settled first.
    //
    // Every attempt above is a perfectly writable string, so each of their refusals comes from
    // further downstream, and a review proved it: authorization could be moved to run AFTER the
    // arguments were read and all 161 tests stayed green. cfo_100 then got VALIDATION_FAILED for
    // an unwritable argument and AUTHORIZATION_DENIED for a writable one — two distinguishable
    // answers where this step promises one.
    const circular: Record<string, unknown> = { invoice: INV_1009 };

    circular["itself"] = circular;

    for (const [why, args] of [
      ["a circular argument", circular],
      ["a BigInt", { invoice: INV_1009, big: 1n }],
      [
        "a getter that throws",
        {
          get invoice(): string {
            throw new Error("boom");
          },
        },
      ],
    ] as const) {
      const envelope = refusalFrom(
        await callOperation(CFO, "invoice.issue", args as Readonly<Record<string, unknown>>),
      );

      expect(envelope.code, why).toBe("AUTHORIZATION_DENIED");
      seen.add(envelope.message);
    }

    // One message for all ten, so the words cannot be compared either.
    expect(seen.size).toBe(1);
  });

  // The agent holds invoice:issue, so it must get past the gate. INV-1008 is already issued, so
  // the honest proof is the refusal it gets *instead* of AUTHORIZATION_DENIED: CONFLICT comes
  // from the business rule, which only runs once authority is settled. That way this test does
  // not need the one draft invoice, which the last test uses.
  it("DSOR-AUT-01b: a caller who was granted invoice:issue gets past the gate", async () => {
    const envelope = refusalFrom(
      await callOperation(AGENT, "invoice.issue", { invoice: INV_1008 }),
    );

    expect(envelope.code).toBe("CONFLICT");
  });

  it("DSOR-AUT-01b: everyone in the story may read", async () => {
    for (const login of [CFO, SUPERVISOR, AGENT]) {
      const answer = await callOperation(login, "invoice.get", { invoice: INV_1008 });

      expect(answer.kind, login.loggedInAs).toBe("data");
    }
  });

  // Last in the file on purpose: it uses up the only draft invoice.
  it("DSOR-AUT-01b: the supervisor may issue, and does", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${answer.kind}`);
    }

    expect(answer.envelope.outcome).toBe("COMMITTED");
    expect(answer.askedBy).toBe("user_123");
  });
});
