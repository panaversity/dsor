// Nobody calls getInvoice directly any more.
//
// A caller names an operation and passes arguments. The operation is looked up in the
// registry, so an operation with no contract cannot be called at all.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPaired,
  callOperation,
  handlerIds,
  operationIds,
  PAIRS_CHECKED,
} from "../src/operations.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import {
  payloadHash,
  refusal,
  resetProposalIds,
  resetRequestIds,
  success,
  validateEnvelope,
} from "../src/envelopes.ts";
import { aDatabase } from "./support/database.ts";

/** A stand-in handler table with every operation, for assertPaired tests. STEP 13: three. */
function handlersForBoth() {
  const stub = () =>
    ({ kind: "error", askedBy: "user_123", envelope: refusal("CONFLICT", "x") }) as const;

  // STEP 17: and the two payment operations.
  return {
    "invoice.get": stub,
    "invoice.issue": stub,
    "invoice.list": stub,
    "payment.cancel": stub,
    "payment.create": stub,
  };
}

/** The error envelope a refusal came back in, or a failure if it was not a refusal. */
function refusalFrom(answer: Awaited<ReturnType<typeof callOperation>>) {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${answer.kind}`);
  }

  expect(validateEnvelope("error", answer.envelope)).toBe(true);

  return answer.envelope;
}

// Every call needs a login. user_123 is the accounts-payable
// supervisor, and until step 06 nothing checks what she may do — only that she exists.
const SUPERVISOR = { loggedInAs: "user_123" } as const;
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";

// STEP 09: the log lives in a database, so these tests need one. A single PGlite for the
// whole file — creating one costs about 350ms, and one per test would turn this suite into minutes.
let db: Awaited<ReturnType<typeof aDatabase>>;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("callOperation", () => {
  it("DSOR-OPR-01: every contract in the registry has a handler, and every handler a contract", () => {
    // The strongest support this step can give DSOR-OPR-01. It does not prove nobody
    // imports getInvoice behind the registry's back: there is no door to close until
    // step 42. It does prove the two lists cannot drift apart.
    expect(operationIds().sort()).toEqual([
      "invoice.get",
      "invoice.issue",
      "invoice.list",
      "payment.cancel", // STEP 17
      "payment.create",
    ]);
  });

  // assertPaired runs at start-up, so these hand it the two lists directly. Asserting
  // on operationIds() alone would not do: that returns the registry's keys, so it says
  // the same thing whether the pairing is checked or not.
  it("DSOR-OPR-01: a contract with no handler is refused", () => {
    const registry = new Map([["invoice.cancel", {} as never]]);

    expect(() => assertPaired(registry, {})).toThrow(/invoice\.cancel/);
  });

  it("DSOR-OPR-01: a handler with no contract is refused", () => {
    expect(() =>
      assertPaired(new Map(), {
        "invoice.cancel": () => ({
          kind: "error",
          askedBy: "user_123",
          envelope: refusal("CONFLICT", "x"),
        }),
      }),
    ).toThrow(/invoice\.cancel/);
  });

  it("DSOR-ERR-01a: an operation with no contract is refused with UNSUPPORTED_CAPABILITY", async () => {
    for (const id of ["invoice.delete", "execute_sql"]) {
      const envelope = refusalFrom(await callOperation(SUPERVISOR, id, { invoice: INV_1008 }));

      expect(envelope.code).toBe("UNSUPPORTED_CAPABILITY");
      expect(envelope.retry).toBe("never");
      expect(envelope.message).toContain(id);
    }
  });

  // The module runs loadRegistry and assertPaired as it loads. No test in this process
  // can watch those lines run — by the time a test imports the module, they already have.
  // What a test can do is assert the state they guarantee, from outside.
  // The pairing check runs at module scope, and what a test can prove about it splits in
  // three. That assertPaired catches every mismatch: the three tests below. That the
  // lists it checks do match today: the second assertion here. That it actually ran at
  // load: only PAIRS_CHECKED, which holds how many pairs the walk looked at. A boolean used to
  // sit here and it proved nothing — deleting the call and leaving `return true` kept every test
  // green.
  //
  // What no test in this process can prove is the middle link: with the lists matching,
  // removing the call changes nothing observable. A child process importing a deliberately
  // mismatched module would close that, and costs more machinery than it teaches here.
  it("DSOR-OPR-01: the wiring was checked at start-up, not on first request", () => {
    expect(PAIRS_CHECKED).toBeGreaterThan(0);

    // Every contract, plus every id on the waiting list.
    expect(PAIRS_CHECKED).toBe(operationIds().length);

    // The state that check guarantees. A handler with no contract would be an unnamed
    // operation, which is the thing §7 exists to prevent.
    expect(handlerIds().sort()).toEqual(operationIds().sort());
  });

  // The waiting list is a parameter, so a rotten one can be handed in. In this step the
  // real list is empty — invoice.issue came off it — and these two checks are what stop a
  // future step leaving a stale note behind.
  it("DSOR-OPR-01: an id waiting for a handler must still have a contract", () => {
    expect(() => assertPaired(new Map(), {}, new Set(["invoice.delete"]))).toThrow(
      /waiting for a handler and has no contract/,
    );
  });

  it("DSOR-OPR-01: an id that has a handler must come off the waiting list", () => {
    expect(() =>
      assertPaired(loadRegistry(contractsFromDisk()), handlersForBoth(), new Set(["invoice.get"])),
    ).toThrow(/take it off the waiting list/);
  });

  it("DSOR-OPR-01: on load, every contract is accounted for", async () => {
    const ids = operationIds();

    // STEP 13: three. STEP 17: five, with the payments.
    expect(ids).toEqual([
      "invoice.get",
      "invoice.issue",
      "invoice.list",
      "payment.cancel",
      "payment.create",
    ]);

    // Each id either runs, or refuses for the single allowed reason. A contract nobody
    // had thought about would refuse with "no contract for", which cannot happen for an
    // id the registry just handed us — and that is the pairing, seen from the outside.
    for (const id of ids) {
      let refusal = "";

      try {
        await callOperation(SUPERVISOR, id, { invoice: INV_1008 });
      } catch (error) {
        refusal = (error as Error).message;
      }

      expect(refusal).not.toMatch(/no contract for it/);
    }
  });

  describe("invoice.get", () => {
    // A query's success is not in an envelope. There is no outcome value that means
    // "here is the data", so a read keeps handing back the invoice — the README says so.
    it("reads one invoice by its canonical address", async () => {
      const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

      if (answer.kind !== "data") {
        throw new Error(`expected data, got ${answer.kind}`);
      }

      expect(answer.invoice.amount?.value).toBe("31400.00");
    });

    it("DSOR-ERR-01a: an invoice we do not hold is RESOURCE_NOT_FOUND, never retryable", async () => {
      const envelope = refusalFrom(
        await callOperation(SUPERVISOR, "invoice.get", {
          invoice: "dsor://org_456/invoice/INV-9999",
        }),
      );

      expect(envelope.code).toBe("RESOURCE_NOT_FOUND");
      expect(envelope.retry).toBe("never");
    });

    // Step 02's README promised the entity segment stops being trusted text in step 03.
    // No rule id: this keeps that promise, it is not DSOR-RID-01b.
    it("DSOR-ERR-01a: an address whose entity no operation is named for is VALIDATION_FAILED", async () => {
      const envelope = refusalFrom(
        await callOperation(SUPERVISOR, "invoice.get", {
          invoice: "dsor://org_456/vendor/VENDOR-44",
        }),
      );

      expect(envelope.code).toBe("VALIDATION_FAILED");
      expect(envelope.retry).toBe("never");
    });

    it("DSOR-ERR-01a: an address that is not canonical, or missing, is VALIDATION_FAILED", async () => {
      expect(
        refusalFrom(await callOperation(SUPERVISOR, "invoice.get", { invoice: "INV-1008" })).code,
      ).toBe("VALIDATION_FAILED");
      expect(refusalFrom(await callOperation(SUPERVISOR, "invoice.get", {})).code).toBe(
        "VALIDATION_FAILED",
      );
    });

    // A regular expression turns whatever it is given into text first, so an object
    // with a toString would sail past parseUri and read a real invoice. Only checking
    // the type stops it — the same lesson formatUri taught in step 02.
    it("DSOR-ERR-01a: an argument that is not text is VALIDATION_FAILED, however convincing", async () => {
      const disguised = { toString: async () => INV_1008 } as unknown as string;
      const envelope = refusalFrom(
        await callOperation(SUPERVISOR, "invoice.get", { invoice: disguised }),
      );

      expect(envelope.code).toBe("VALIDATION_FAILED");
      expect(envelope.message).toMatch(/needs an invoice address/);
    });

    // The address names a company. Acting on a different company's invoice than the
    // address asked for is how one tenant reads another's records.
    // A NEAR MISS, which the org_999 case above cannot catch: a prefix match refuses org_999
    // too. Replacing the tenant's `!==` with a prefix test left every test green in step 03, and
    // `org_45` then read org_456's invoice. Fifth appearance of this shape in six steps.
    it("DSOR-ERR-01a: a tenant that is only part of ours is TENANT_MISMATCH, both ways round", async () => {
      for (const tenant of ["org_45", "org_4", "org_4567", "org_456789"]) {
        const envelope = refusalFrom(
          await callOperation(SUPERVISOR, "invoice.get", {
            invoice: `dsor://${tenant}/invoice/INV-1008`,
          }),
        );

        expect(envelope.code, tenant).toBe("TENANT_MISMATCH");
        expect(envelope.message, tenant).toContain(tenant);
      }
    });

    // The same near-miss question for the entity.
    it("DSOR-ERR-01a: an entity that is only part of ours is VALIDATION_FAILED", async () => {
      for (const entity of ["invoices", "invoice_line", "inv"]) {
        expect(
          refusalFrom(
            await callOperation(SUPERVISOR, "invoice.get", {
              invoice: `dsor://org_456/${entity}/INV-1008`,
            }),
          ).code,
          entity,
        ).toBe("VALIDATION_FAILED");
      }
    });

    // The caller's OWN argument: an object that inherits `invoice` carries an argument nobody
    // in this program passed.
    it("DSOR-ERR-01a: an invoice argument the object only inherits is not read", async () => {
      const inherited = Object.create({
        invoice: "dsor://org_456/invoice/INV-1008",
      }) as Record<string, unknown>;

      expect(inherited["invoice"]).toBe("dsor://org_456/invoice/INV-1008");
      expect(refusalFrom(await callOperation(SUPERVISOR, "invoice.get", inherited)).code).toBe(
        "VALIDATION_FAILED",
      );
    });

    it("DSOR-ERR-01a: an address for another company is TENANT_MISMATCH", async () => {
      const envelope = refusalFrom(
        await callOperation(SUPERVISOR, "invoice.get", {
          invoice: "dsor://org_999/invoice/INV-1008",
        }),
      );

      expect(envelope.code).toBe("TENANT_MISMATCH");
      expect(envelope.retry).toBe("never");
      expect(envelope.message).toContain("org_999");
    });
  });

  // the command split out of step 03 is carried out here, because a
  // command is what makes an envelope worth having.
  describe("invoice.issue", () => {
    // Issue, then issue again — in one test on purpose. Tests in one file share the
    // module, so a second test could not assume INV-1009 was still a draft. This also
    // covers the map's "done when": issuing twice returns an error envelope, not a throw.
    it("DSOR-SCH-01: issuing a draft returns COMMITTED, and the second attempt is CONFLICT", async () => {
      resetRequestIds();
      resetProposalIds();

      const first = await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 });

      if (first.kind !== "result") {
        throw new Error(`expected a result, got ${first.kind}`);
      }

      expect(validateEnvelope("result", first.envelope)).toBe(true);
      expect(first.envelope.outcome).toBe("COMMITTED");
      expect(first.envelope.semantics).toBe("atomic");
      expect(first.envelope.proposal).toBe("dsor://org_456/proposal/prop_0001");

      // The semantics on the envelope is the one the contract declares. It lives here because
      // there is one draft invoice, so this is the only place a result envelope exists to read.
      const declared = loadRegistry(contractsFromDisk()).get("invoice.issue")?.execution?.semantics;

      expect(declared).toBe("atomic");
      expect(first.envelope.semantics).toBe(declared);
      expect((first.envelope.data as { status: string }).status).toBe("issued");

      // Again. Nothing is thrown; the refusal is an envelope a caller can act on, and
      // its retry class says plainly that trying again cannot help.
      const second = refusalFrom(
        await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1009 }),
      );

      expect(second.code).toBe("CONFLICT");
      expect(second.retry).toBe("never");
      expect(second.message).toMatch(/draft/);
    });

    it("DSOR-ERR-01a: issuing an invoice that is already issued is CONFLICT", async () => {
      expect(
        refusalFrom(await callOperation(SUPERVISOR, "invoice.issue", { invoice: INV_1008 })).code,
      ).toBe("CONFLICT");
    });

    // Every bad-address refusal, on the command as well as the query. invoice.issue and
    // invoice.get share invoiceIdFrom, and until these existed only invoice.get proved
    // the sharing: deleting the command's refusal passthrough collapsed every bad address
    // to "undefined is not an invoice we hold" with all tests still green.
    it("DSOR-ERR-01a: a bad address to the command is refused the same way as to the query", async () => {
      const cases = [
        ["dsor://org_999/invoice/INV-1009", "TENANT_MISMATCH"],
        ["dsor://org_456/vendor/VENDOR-44", "VALIDATION_FAILED"],
        ["INV-1009", "VALIDATION_FAILED"],
      ] as const;

      for (const [address, code] of cases) {
        expect(
          refusalFrom(await callOperation(SUPERVISOR, "invoice.issue", { invoice: address })).code,
        ).toBe(code);
      }

      expect(refusalFrom(await callOperation(SUPERVISOR, "invoice.issue", {})).code).toBe(
        "VALIDATION_FAILED",
      );
    });

    // What this step can and cannot prove about `semantics`, stated plainly.
    //
    // An earlier version of this test guarded its only assertion with
    // `if (answer.kind === "result")`, and by the time it ran the one draft invoice had
    // already been issued by the test above — so the assertion never executed and the test
    // passed for no reason. The assertion now lives in that test instead, where a result
    // envelope really exists.
    //
    // What remains unprovable here: the handler reads `contract.execution?.semantics`, and
    // this step has exactly one command, whose contract declares `"atomic"`. Replacing that
    // read with the literal `"atomic"` is therefore indistinguishable — an equivalent mutant
    // given this data, not a test gap. A second command declaring something else would
    // separate them. Until then, `success()` at least provably carries whatever it is handed:
    it("DSOR-SCH-01: the result envelope carries the semantics it is given, whatever it is", () => {
      resetRequestIds();
      resetProposalIds();

      for (const semantics of ["atomic", "best_effort"]) {
        const envelope = success({
          tenant: "org_456",
          data: { ok: true },
          semantics,
          payloadHash: payloadHash("{}"),
        });

        expect(envelope.semantics).toBe(semantics);
        expect(validateEnvelope("result", envelope)).toBe(true);
      }
    });

    it("DSOR-ERR-01a: issuing an invoice we do not hold is RESOURCE_NOT_FOUND", async () => {
      expect(
        refusalFrom(
          await callOperation(SUPERVISOR, "invoice.issue", {
            invoice: "dsor://org_456/invoice/INV-9999",
          }),
        ).code,
      ).toBe("RESOURCE_NOT_FOUND");
    });

    it("the contract is no longer on the waiting list", () => {
      // assertPaired refuses an id that has both a handler and a place in the queue, so
      // this could not have been forgotten.
      expect(operationIds()).toContain("invoice.issue");
      expect(() =>
        assertPaired(loadRegistry(contractsFromDisk()), {
          "invoice.get": () => ({
            kind: "error",
            askedBy: "user_123",
            envelope: refusal("CONFLICT", "x"),
          }),
        }),
      ).toThrow(/invoice\.issue has a contract and no handler/);
    });
  });

  /**
   * NEW: the count includes the waiting list.
   *
   * `assertPaired` returns how many pairs it looked at, and both tests above hand it a *rotten*
   * waiting list and assert a throw — so nothing ever observed the return value on a path where the
   * waiting loop completes. A mutation sweep found it: `checked += 1` inside that loop could be
   * `+= 0` with every test green, which hollows out the one device this step uses to show the
   * start-up check really walked the lists (lesson 12).
   */
  it("DSOR-OPR-01: a valid waiting list is counted too", () => {
    const registry = loadRegistry(contractsFromDisk());
    const contracts = [...registry.keys()].length;

    // A legitimate queue: every operation but invoice.get has a contract and, here, no handler yet.
    const onlyGet = { "invoice.get": handlersForBoth()["invoice.get"]! };
    const waiting = new Set(["invoice.issue", "invoice.list", "payment.cancel", "payment.create"]);

    expect(assertPaired(registry, onlyGet, waiting)).toBe(contracts + waiting.size);

    // And with nothing waiting, it is the contracts alone.
    expect(assertPaired(registry, handlersForBoth(), new Set())).toBe(contracts);
  });
});
