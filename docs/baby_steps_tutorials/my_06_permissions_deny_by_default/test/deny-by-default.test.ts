// NEW IN STEP 06: the test the whole step exists for.
//
// The map's "done when" for this step reads: a caller with `invoice:read` can read and
// cannot issue. That caller is cfo_100 — the person who approves payments and does not do
// accounts-payable data entry.

import { describe, expect, it } from "vitest";
import { callOperation, type OperationAnswer } from "../src/operations.ts";

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

describe("anything not granted is refused", () => {
  it("DSOR-AUT-01b: cfo_100 may read an invoice", () => {
    const answer = callOperation(CFO, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "data") {
      throw new Error(`expected data, got ${answer.kind}`);
    }

    expect(answer.invoice.amount.value).toBe("31400.00");
  });

  // The other half of the map's "done when", and the step's whole point. cfo_100 is the most
  // senior person in the story and the only one who cannot do this. Permissions are not a
  // ladder.
  it("DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries", () => {
    const envelope = refusalFrom(callOperation(CFO, "invoice.issue", { invoice: INV_1009 }));

    expect(envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(envelope.retry).toBe("never");

    // INV-1009 is still a draft, so the refusal happened before anything was changed.
    const after = callOperation(CFO, "invoice.get", { invoice: INV_1009 });

    if (after.kind !== "data") {
      throw new Error("INV-1009 should still be readable");
    }

    expect(after.invoice.status).toBe("draft");
  });

  // Decision 35. The refusal says she may not do it, not what she was missing. Naming the
  // permission turns a refusal into a map of the permission model for anyone probing.
  it("DSOR-AUT-01b: the refusal does not say which permission was missing", () => {
    const envelope = refusalFrom(callOperation(CFO, "invoice.issue", { invoice: INV_1009 }));

    expect(envelope.message).toContain("cfo_100");
    expect(envelope.message).toContain("invoice.issue");
    expect(envelope.message).not.toContain("invoice:issue");
    expect(envelope.message).not.toMatch(/permission|granted|role|invoice:/);
  });

  it("DSOR-AUT-01b: a denial says who was denied", () => {
    const answer = callOperation(CFO, "invoice.issue", { invoice: INV_1009 });

    expect(answer.askedBy).toBe("cfo_100");
    expect(refusalFrom(answer).correlation.principal_id).toBe("cfo_100");
  });

  // Authority is settled before the arguments are looked at, and this is why it matters.
  // If the address were read first, cfo_100 would learn from the error code whether
  // INV-9999 exists — asking twice with two addresses and comparing the answers. Because
  // the permission is checked first, every one of these is the same refusal, and she learns
  // nothing about the data at all.
  //
  // This is the mechanism DSOR-ERR-01b needs. The rule itself is about a caller who may not
  // *read* a resource, and all three roles here may read invoices, so the step does not claim
  // it — see the README.
  it("DSOR-AUT-01b: being refused for authority tells the caller nothing about the data", () => {
    const attempts = [
      ["a draft that exists", INV_1009],
      ["an invoice that does not exist", "dsor://org_456/invoice/INV-9999"],
      ["an invoice that is already issued", INV_1008],
      ["an address that is not canonical", "INV-1009"],
      ["another company's invoice", "dsor://org_999/invoice/INV-1008"],
      ["the wrong kind of thing", "dsor://org_456/vendor/VENDOR-44"],
    ] as const;

    for (const [why, invoice] of attempts) {
      const envelope = refusalFrom(callOperation(CFO, "invoice.issue", { invoice }));

      expect(envelope.code, why).toBe("AUTHORIZATION_DENIED");
    }

    // Not even a missing argument is examined.
    expect(refusalFrom(callOperation(CFO, "invoice.issue", {})).code).toBe("AUTHORIZATION_DENIED");
  });

  // The agent holds invoice:issue, so it must get past the gate. INV-1008 is already issued,
  // so the honest proof is the refusal it gets *instead* of AUTHORIZATION_DENIED: CONFLICT
  // comes from the business rule, which only runs once authority has been settled. That way
  // this test does not need the one draft invoice, which the success test below uses.
  it("DSOR-AUT-01b: a caller who was granted invoice:issue gets past the gate", () => {
    const envelope = refusalFrom(callOperation(AGENT, "invoice.issue", { invoice: INV_1008 }));

    expect(envelope.code).toBe("CONFLICT");
    expect(envelope.code).not.toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-AUT-01b: everyone in the story may read", () => {
    for (const login of [CFO, SUPERVISOR, AGENT]) {
      const answer = callOperation(login, "invoice.get", { invoice: INV_1008 });

      expect(answer.kind, login.loggedInAs).toBe("data");
    }
  });

  // Last in the file on purpose: it uses up the only draft invoice.
  it("DSOR-AUT-01b: the supervisor may issue, and does", () => {
    const answer = callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${answer.kind}`);
    }

    expect(answer.envelope.outcome).toBe("COMMITTED");
    expect(answer.askedBy).toBe("user_123");
  });
});
