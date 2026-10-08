// NEW IN STEP 14: a read that handed out confidential data is written down — who, what, which rows,
// and how many — before the answer leaves.
//
// Step 13's log says ALLOW for a read of one invoice and ALLOW for a page of a hundred, and nothing
// else: the two records are the same record. The decision record is written before the handler
// runs (DSOR-EXE-02) and the log can never be updated (DSOR-AUD-04a), so what the read returned has
// to be a second record, written after the fetch and before the answer leaves.
//
// Rule DSOR-CLS-05: reads that return CONFIDENTIAL or RESTRICTED data MUST be audited with
// principal, actor chain, operation, resource scope, and row count.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog, verifyChain, type AuditRecord } from "../src/audit.ts";
import { overPGlite } from "../src/database.ts";
import { callOperation } from "../src/operations.ts";
import { useDatabase } from "../src/store.ts";
import { aDatabase, forgetTheLog, resetInvoices } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const TUTORIAL = "com.panaversity.tutorial";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
  await resetInvoices();
});

beforeEach(async () => {
  await forgetTheLog("org_456");
});

afterAll(async () => {
  await db.close();
});

const rowCountOf = (record: AuditRecord): unknown =>
  (record.extensions?.[TUTORIAL] as Record<string, unknown> | undefined)?.["row_count"];

describe("a confidential read is written down", () => {
  it("DSOR-CLS-05: the supervisor's read of one invoice — after the decision, naming the row and the count", async () => {
    await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    const log = await theLog("org_456");

    expect(log.map((r) => r.kind)).toStrictEqual(["decision", "classified_read"]);

    const read = log[1]!;

    expect(read.operation).toBe("invoice.get@1");
    expect(read.identity.subject).toBe("user_123");
    expect(read.identity.actor_chain).toStrictEqual([]); // nobody acts on anyone's behalf until step 18
    expect(read.resources).toStrictEqual([INV_1008]);
    expect(rowCountOf(read)).toBe(1);
    expect(read.result).toBe("READ");
    expect(verifyChain(log)).toBe(true);
  });

  it("DSOR-CLS-05: a page — every address on it, and how many", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.list", { limit: 3 });

    expect(answer.kind).toBe("page");

    const read = (await theLog("org_456")).at(-1)!;

    expect(read.kind).toBe("classified_read");
    expect(read.operation).toBe("invoice.list@1");
    // Three asked for, two given: the story's org_456 holds INV-1008 and INV-1009. The record says
    // what was returned, not what was asked.
    expect(read.resources).toStrictEqual([
      "dsor://org_456/invoice/INV-1008",
      "dsor://org_456/invoice/INV-1009",
    ]);
    expect(rowCountOf(read)).toBe(2);
  });
});

describe("a read that handed out nothing confidential", () => {
  it("the agent's read of the same invoice left as internal, so it is a decision and nothing more", async () => {
    await callOperation(AGENT, "invoice.get", { invoice: INV_1008 });
    await callOperation(AGENT, "invoice.list", { limit: 3 });

    expect((await theLog("org_456")).map((r) => r.kind)).toStrictEqual(["decision", "decision"]);
  });
});

describe("before the answer leaves", () => {
  it("DSOR-CLS-05: when the record of the read cannot be written, the data does not leave", async () => {
    // A connection that lets every statement through except the one INSERT of a classified_read
    // record. The decision is recorded, the rows are read, and then the evidence fails: the caller
    // must get a refusal and not the invoice, because a read nobody wrote down did not happen.
    const real = overPGlite(db);

    useDatabase({
      query: async <T>(sql: string, params?: unknown[], tenant?: string) => {
        if (sql.includes("INSERT INTO public.audit") && params?.[7] === "classified_read") {
          throw new Error("the evidence store is down");
        }

        return real.query<T>(sql, params, tenant);
      },
    });

    try {
      const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

      expect(answer.kind).toBe("error");

      if (answer.kind === "error") {
        expect(answer.envelope.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
        expect(JSON.stringify(answer)).not.toContain("31400.00");
      }
    } finally {
      useDatabase(real);
    }
  });
});
