// STEP 12: the suite's questions, each fed an answer that lies, must throw.
//
// A mutation pass on the first version deleted the suite's assertions one at a time — the retry
// class, the untouched rows, the other company's log — and every deletion passed the whole suite,
// because nothing tests a test. So the six questions are functions, and this file calls each one
// with fakes: once with an honest answer, which must pass, and once with the lie that question
// exists to catch, which must throw. Delete an assertion from a question and its lie passes here.
//
// Rule DSOR-TEN-02b: an implementation MUST ship a cross-tenant test suite that exercises every
// operation with a foreign-tenant URI — and a suite that cannot fail is not one.

import { describe, expect, it } from "vitest";
import type { AuditRecord } from "../src/audit.ts";
import { refusal } from "../src/envelopes.ts";
import type { OperationAnswer } from "../src/operations.ts";
import { contractsFromDisk, loadRegistry } from "../src/registry.ts";
import {
  caseFor,
  NOBODYS,
  OURS,
  questions,
  THEIRS,
  type Case,
  type Deps,
  type Row,
} from "./support/cross-tenant-suite.ts";

const registry = loadRegistry(contractsFromDisk());
const GET: Case = caseFor("invoice.get", registry.get("invoice.get")!, {
  invoice: "dsor://org_456/invoice/INV-1008",
});
const ISSUE: Case = caseFor("invoice.issue", registry.get("invoice.issue")!, {
  invoice: "dsor://org_456/invoice/INV-1009",
});

/** The caller's own invoice, for an honest own-company answer. */
const OUR_INVOICE = {
  uri: "dsor://org_456/invoice/INV-1008",
  tenantId: "org_456",
  id: "INV-1008",
  vendor: "VENDOR-44",
  amount: { value: "31400.00", currency: "USD" },
  status: "issued",
} as const;

/** An invoice that looks like the other company's, for a lying answer to carry. */
const THEIR_INVOICE = {
  uri: "dsor://org_789/invoice/INV-1008",
  tenantId: "org_789",
  id: "INV-1008",
  vendor: "VENDOR-44",
  amount: { value: "18000.00", currency: "USD" },
  status: "draft",
} as const;

function record(
  requestId: string,
  authorization: "ALLOW" | "DENY",
  result: string,
  operation = "invoice.get@1",
): AuditRecord {
  return {
    correlation: { request_id: requestId },
    authorization,
    result,
    operation,
  } as unknown as AuditRecord;
}

/** Honest fakes: a door that refuses another company's address the way the pipeline does. */
function honest(overrides: Partial<Deps> = {}): Deps {
  const logs: Record<string, AuditRecord[]> = { [OURS]: [], [THEIRS]: [] };
  const rows: Record<string, Row[]> = {
    [OURS]: [
      { id: "INV-1008", status: "issued" },
      { id: "INV-1009", status: "draft" },
    ],
    [THEIRS]: [
      { id: "INV-1008", status: "draft" },
      { id: "INV-1009", status: "draft" },
    ],
  };
  let n = 0;

  return {
    reset: async () => {},
    rowsOf: async (tenant) => rows[tenant] ?? [],
    logOf: async (tenant) => logs[tenant] ?? [],
    call: async (id, request): Promise<OperationAnswer> => {
      const requestId = `req_${++n}`;
      const address = String(request["invoice"]);

      if (!address.startsWith(`dsor://${OURS}/`)) {
        logs[OURS]!.push(record(requestId, "DENY", "TENANT_MISMATCH", `${id}@1`));

        return {
          kind: "error",
          askedBy: "user_123",
          envelope: refusal(
            "TENANT_MISMATCH",
            `${address} is not an address in your company`,
            requestId,
            "user_123",
          ),
        };
      }

      logs[OURS]!.push(record(requestId, "ALLOW", "ALLOWED", `${id}@1`));

      // STEP 14: what leaves the door carries its label and its list, so a fake does too.
      return {
        kind: "data",
        askedBy: "user_123",
        invoice: OUR_INVOICE,
        classification: "confidential",
        redactions: [],
      };
    },
    ...overrides,
  };
}

describe("each question, honest and lied to", () => {
  it("passes every question when the door is honest", async () => {
    const deps = honest();

    for (const c of [GET, ISSUE]) {
      await questions.refused(deps, c);
      await questions.sameWhole(deps, c);
      await questions.somethingToTouch(deps, c);
      await questions.rowsUntouched(deps, c);
      await questions.oneDenyInTheLog(deps, c);
      await questions.ownExampleWorks(deps, c);
    }
  });

  it("refused: a door that hands the row over", async () => {
    const deps = honest({
      call: async () => ({
        kind: "data",
        askedBy: "user_123",
        invoice: THEIR_INVOICE,
        classification: "confidential",
        redactions: [],
      }),
    });

    await expect(questions.refused(deps, GET)).rejects.toThrow(/expected a refusal/);
  });

  it("refused: a refusal with a retry class that invites a retry", async () => {
    const deps = honest({
      call: async () => ({
        kind: "error",
        askedBy: "user_123",
        envelope: {
          ...refusal("TENANT_MISMATCH", "no", "req_1", "user_123"),
          retry: "safe_same_key",
        },
      }),
    });

    await expect(questions.refused(deps, GET)).rejects.toThrow();
  });

  it("sameWhole: a refusal that carries the other company's row where the words do not show it", async () => {
    // The hostile review's smuggling operation: the message is identical, the envelope is not.
    const base = honest();
    const deps = honest({
      call: async (id, request) => {
        const answer = await base.call(id, request);

        if (answer.kind === "error" && String(request["invoice"]).includes(THEIRS)) {
          return { ...answer, envelope: { ...answer.envelope, smuggled: THEIR_INVOICE } as never };
        }

        return answer;
      },
    });

    await expect(questions.sameWhole(deps, GET)).rejects.toThrow();
  });

  it("sameWhole: a refusal that names the caller's own company", async () => {
    const deps = honest({
      call: async (_id, request) => ({
        kind: "error",
        askedBy: "user_123",
        envelope: refusal(
          "TENANT_MISMATCH",
          `${String(request["invoice"])} is not in ${OURS}`,
          "req_1",
          "user_123",
        ),
      }),
    });

    await expect(questions.sameWhole(deps, GET)).rejects.toThrow();
  });

  it("sameWhole: a different refusal for a company that does not exist", async () => {
    const base = honest();
    const deps = honest({
      call: async (id, request) =>
        String(request["invoice"]).includes(NOBODYS)
          ? {
              kind: "error",
              askedBy: "user_123",
              envelope: refusal("RESOURCE_NOT_FOUND", "no such company", "req_1", "user_123"),
            }
          : base.call(id, request),
    });

    await expect(questions.sameWhole(deps, GET)).rejects.toThrow();
  });

  it("somethingToTouch: the other company lacks the number", async () => {
    const deps = honest({
      rowsOf: async (tenant) => (tenant === THEIRS ? [] : [{ id: "INV-1009", status: "draft" }]),
    });

    await expect(questions.somethingToTouch(deps, ISSUE)).rejects.toThrow(/has no INV-1009/);
  });

  it("somethingToTouch: the other company's row is in a state the command cannot act on", async () => {
    // The mutation pass's survivor: INV-1009 seeded already issued, nothing for a careless issue
    // to do, and the untouched-rows question true for the wrong reason.
    const deps = honest({
      rowsOf: async (tenant) => [
        { id: "INV-1009", status: tenant === THEIRS ? "issued" : "draft" },
      ],
    });

    await expect(questions.somethingToTouch(deps, ISSUE)).rejects.toThrow(/nothing to do to it/);
    // A read does not care what state the row is in.
    await questions.somethingToTouch(
      honest({
        rowsOf: async (tenant) => [
          { id: "INV-1008", status: tenant === THEIRS ? "paid" : "issued" },
        ],
      }),
      GET,
    );
  });

  it("rowsUntouched: a call that changed the other company's row", async () => {
    let calls = 0;
    const deps = honest({
      rowsOf: async (tenant) =>
        tenant === THEIRS ? [{ id: "INV-1009", status: calls > 0 ? "issued" : "draft" }] : [],
    });
    const base = deps.call;

    const lying: Deps = {
      ...deps,
      call: async (id, request) => {
        calls += 1;

        return base(id, request);
      },
    };

    await expect(questions.rowsUntouched(lying, ISSUE)).rejects.toThrow();
  });

  it("oneDenyInTheLog: an ALLOW recorded by the pipeline and a DENY appended by the handler", async () => {
    const base = honest();
    const deps = honest({
      ...base,
      call: async (id, request) => {
        const answer = await base.call(id, request);
        const logs = await base.logOf(OURS);
        const requestId = logs.at(-1)!.correlation.request_id;

        (logs as AuditRecord[]).unshift(record(requestId, "ALLOW", "ALLOWED"));

        return answer;
      },
      logOf: base.logOf,
    });

    await expect(questions.oneDenyInTheLog(deps, GET)).rejects.toThrow();
  });

  it("oneDenyInTheLog: a record in the other company's log", async () => {
    const base = honest();
    const deps: Deps = {
      ...base,
      call: async (id, request) => {
        const answer = await base.call(id, request);

        ((await base.logOf(THEIRS)) as AuditRecord[]).push(
          record("req_x", "DENY", "TENANT_MISMATCH"),
        );

        return answer;
      },
    };

    await expect(questions.oneDenyInTheLog(deps, GET)).rejects.toThrow();
  });

  it("ownExampleWorks: a door that refuses the caller's own address", async () => {
    const deps = honest({
      call: async () => ({
        kind: "error",
        askedBy: "user_123",
        envelope: refusal("TENANT_MISMATCH", "no", "req_1", "user_123"),
      }),
    });

    await expect(questions.ownExampleWorks(deps, GET)).rejects.toThrow();
  });

  it("ownExampleWorks: a success answer that carries the other company's row", async () => {
    // The critic's handler: org_456's invoice, and org_789's beside it, in a successful answer.
    const base = honest();
    const deps = honest({
      call: async (id, request) => {
        const answer = await base.call(id, request);

        return answer.kind === "data" ? ({ ...answer, leaked: THEIR_INVOICE } as never) : answer;
      },
    });

    await expect(questions.ownExampleWorks(deps, GET)).rejects.toThrow(/carries/);
  });

  it("the two by-name failures say what to add", () => {
    expect(() => questions.noExample("invoice.x")).toThrow(/no example_request/);
    expect(() => questions.noAddress("invoice.x")).toThrow(/no dsor:\/\/ address/);
  });
});
