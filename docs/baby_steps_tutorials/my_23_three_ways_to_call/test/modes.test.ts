// NEW IN STEP 23: three ways to call a command (decision 138).
//
// Rule DSOR-OPR-05: every command MUST support the execute, propose_only, and validate_only
// invocation modes.
// Rule DSOR-OPR-06: a validate_only invocation MUST NOT create a proposal, take a reservation, place
// a hold, or cause a side effect.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { getInvoice } from "../src/invoice.ts";
import { callOperation } from "../src/operations.ts";
import { aDatabase, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const ISSUE_1009 = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };

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

/** INV-1009's status now. */
const statusOf1009 = async (): Promise<string | undefined> =>
  (await getInvoice("org_456", "INV-1009")).value?.status;

describe("how a command is called travels beside its arguments", () => {
  it("DSOR-OPR-05: execute is what a request with no mode gets, and saying it changes nothing", async () => {
    const unsaid = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-unsaid",
    });

    expect(unsaid.kind === "result" && unsaid.envelope.outcome).toBe("COMMITTED");

    await resetTheStory();

    const said = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-said",
      mode: "execute",
    });

    expect(said.kind === "result" && said.envelope.outcome).toBe("COMMITTED");
  });

  for (const mode of ["EXECUTE", "dry_run", 1, null, ""]) {
    it(`DSOR-OPR-05: a mode that is not one of the three, ${JSON.stringify(mode)}, is refused and recorded, and nothing runs`, async () => {
      const answer = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
        idempotencyKey: `issue-mode-${String(mode)}`,
        mode,
      });

      expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
      expect(answer.kind === "error" && answer.envelope.message).toMatch(
        /execute, propose_only or validate_only/,
      );
      expect(await statusOf1009()).toBe("draft");
      expect((await theLog("org_456")).at(-1)?.result).toBe("VALIDATION_FAILED");
    });
  }

  it("DSOR-OPR-05: a query has one way to be called, and another mode is refused", async () => {
    const answer = await callOperation(
      SUPERVISOR,
      "invoice.get",
      { invoice: "dsor://org_456/invoice/INV-1008" },
      { mode: "validate_only" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(/a query/);
  });

  it("DSOR-IDM-01d: the same key in another mode is another request, and is refused", async () => {
    const first = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-one-key",
      mode: "propose_only",
    });

    expect(first.kind).toBe("result");

    const again = await callOperation(SUPERVISOR, "invoice.issue", ISSUE_1009, {
      idempotencyKey: "issue-one-key",
      mode: "execute",
    });

    expect(again.kind === "error" && again.envelope.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
