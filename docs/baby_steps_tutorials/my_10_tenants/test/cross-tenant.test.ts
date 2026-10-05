// NEW IN STEP 10: an address for another company.
//
// Every invoice address names a company: dsor://org_789/invoice/INV-1008. From this step on it is
// compared against the company the REQUEST is for — decided in §21.2 from who is logged in — and
// never against a constant. And the refusal says nothing: the same words whether the company named
// exists or not, and nothing about the company you are in.
//
// Rule DSOR-SRC-02b: a tenant identifier inside operation arguments that disagrees with the
// security context MUST cause TENANT_MISMATCH or AUTHORIZATION_DENIED.
// Rule DSOR-ERR-01b: an error MUST NOT reveal the existence or attributes of a resource the caller
// is not authorized to read.
//
// The map's "done when" says a foreign address returns "the same not found as a URI that does not
// exist". Decision 88 chose TENANT_MISMATCH instead, because the spec names it and the spec is
// authoritative over the map — what the done-when MEANS, reveal nothing, is held to the letter.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { callOperation, makeDoor, PIPELINE } from "../src/operations.ts";
import { theLog, forgetTheLog } from "../src/audit.ts";
import type { Context } from "../src/pipeline.ts";
import { getInvoice } from "../src/invoice.ts";
import { aDatabase, resetInvoices } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT_FOR_456 = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const AGENT_FOR_789 = { loggedInAs: "accounts-payable-fte", tenant: "org_789" };

const OURS = "dsor://org_456/invoice/INV-1008";
const THEIRS = "dsor://org_789/invoice/INV-1008"; // a real company, not ours
const NOBODYS = "dsor://org_000/invoice/INV-1008"; // a company that does not exist
const MISSING = "dsor://org_456/invoice/INV-9999"; // our company, no such invoice

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

async function refusalFor(
  login: { loggedInAs: string; tenant?: string },
  invoice: string,
  more: Record<string, unknown> = {},
) {
  const answer = await callOperation(login, "invoice.get", { invoice, ...more });

  if (answer.kind !== "error") {
    throw new Error(`${invoice}: expected a refusal, got ${answer.kind}`);
  }

  return answer.envelope;
}

describe("an address for another company", () => {
  it("DSOR-SRC-02b: is refused with TENANT_MISMATCH, and a retry cannot help", async () => {
    const refused = await refusalFor(SUPERVISOR, THEIRS);

    expect(refused.code).toBe("TENANT_MISMATCH");
    expect(refused.retry).toBe("never");
  });

  it("DSOR-ERR-01b: the refusal names neither your company nor whether theirs exists", async () => {
    const real = await refusalFor(SUPERVISOR, THEIRS);
    const fake = await refusalFor(SUPERVISOR, NOBODYS);

    // Nothing about the company the caller is in.
    expect(real.message).not.toContain("org_456");
    expect(real.message).not.toContain("serves");

    // The same words for a company that exists and one that does not, but for the address echoed
    // back — which the caller typed, so it tells them nothing new.
    expect(real.code).toBe(fake.code);
    expect(real.message.replace(THEIRS, "ADDRESS")).toBe(fake.message.replace(NOBODYS, "ADDRESS"));
  });

  it("DSOR-SRC-02b: the agent working for org_456 is refused org_789's address, though it belongs to both", async () => {
    // The request is inside ONE company — the one the login named. Belonging to the other does not
    // make the other's addresses reachable from here; it makes a different login possible.
    const refused = await refusalFor(AGENT_FOR_456, THEIRS);

    expect(refused.code).toBe("TENANT_MISMATCH");
  });

  it("DSOR-SRC-02b: the agent working for org_789 is not refused org_789's address", async () => {
    // What it gets back is piece 3's business — today the store has no idea of company. What this
    // piece holds is only that the address is not a mismatch when the request is in that company.
    const answer = await callOperation(AGENT_FOR_789, "invoice.get", { invoice: THEIRS });

    if (answer.kind !== "data") {
      throw new Error(`expected org_789's invoice, got ${answer.kind}`);
    }

    expect(answer.invoice.uri).toBe(THEIRS);
  });

  it("DSOR-IDN-03b: the command path cannot reach the other company's invoice either", async () => {
    // invoice.issue, from both callers who are not working for org_789: refused at §21.6, the row
    // untouched, one DENY in org_456's log naming the operation, nothing in org_789's.
    await forgetTheLog("org_456");
    await forgetTheLog("org_789");

    for (const login of [SUPERVISOR, AGENT_FOR_456]) {
      const answer = await callOperation(login, "invoice.issue", { invoice: THEIRS });

      if (answer.kind !== "error") {
        throw new Error(`expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code).toBe("TENANT_MISMATCH");
    }

    expect((await getInvoice("org_789", "INV-1008"))?.status).toBe("draft");

    const ours = await theLog("org_456");

    expect(ours.map((r) => [r.authorization, r.operation])).toEqual([
      ["DENY", "invoice.issue@1"],
      ["DENY", "invoice.issue@1"],
    ]);
    expect(await theLog("org_789")).toHaveLength(0);
  });

  it("DSOR-SRC-02b: a foreign address in any own argument, not only invoice, is refused", async () => {
    // The §21.6 scan walks every own top-level string argument. Narrowing it to `invoice` alone
    // would leave this passing through to a handler that one day reads `other`.
    const refused = await refusalFor(SUPERVISOR, OURS, { other: THEIRS });

    expect(refused.code).toBe("TENANT_MISMATCH");
  });

  it("DSOR-TEN-01a: a command run inside org_789 gets a proposal address inside org_789", async () => {
    // `success()` used to build `dsor://org_456/proposal/...` for every tenant; a review ran this
    // exact command and got a receipt in the wrong company's proposal space.
    await resetInvoices();

    const answer = await callOperation(AGENT_FOR_789, "invoice.issue", { invoice: THEIRS });

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${answer.kind}`);
    }

    expect(answer.envelope.proposal).toMatch(/^dsor:\/\/org_789\/proposal\/prop_\d{4}$/);
  });

  it("DSOR-ERR-01b: a missing invoice in your own company is a different answer, on purpose", async () => {
    // Decision 88: TENANT_MISMATCH for another company's address, RESOURCE_NOT_FOUND for a missing
    // one of yours. The two are told apart — and the first still reveals nothing, because it is
    // computed from the address alone, before any lookup.
    const mine = await refusalFor(SUPERVISOR, MISSING);
    const theirs = await refusalFor(SUPERVISOR, THEIRS);

    expect(mine.code).toBe("RESOURCE_NOT_FOUND");
    expect(theirs.code).toBe("TENANT_MISMATCH");
  });

  it("DSOR-SRC-02b: your own company's address still works", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: OURS });

    expect(answer.kind).toBe("data");
  });
});

describe("where the refusal happens, and what the log says", () => {
  it("DSOR-EXE-02: a mismatching address is refused before the decision is recorded, as a DENY", async () => {
    // Piece 2 of this step checked the address in the handler, at §21.14 — after the decision was
    // recorded at §21.11 — and this request sat in the log as ALLOWED while the caller held a
    // refusal. The check moved to §21.6. This is the test that noticed.
    await forgetTheLog("org_456");
    await refusalFor(SUPERVISOR, THEIRS);

    const [record] = await theLog("org_456");

    expect(record?.authorization).toBe("DENY");
    expect(record?.result).toBe("TENANT_MISMATCH");
  });

  it("DSOR-IDN-03b: a validate stage that forgot the address check cannot leak the other company's invoice", async () => {
    // A door whose validate stage copies and hashes the arguments — enough to satisfy the door's
    // receipt checks — and skips the address check. The handler's own re-check is what stands
    // between that door and org_789's invoice, and it answers INTERNAL_ERROR, because a pipeline
    // that let the address through is this program's bug and not something the caller can act on.
    const forgetful = PIPELINE.map((stage) =>
      stage.name === "validate the input"
        ? {
            ...stage,
            run: (context: Context) => ({
              kind: "carry_on" as const,
              context: {
                ...context,
                given: Object.freeze({ ...context.args }),
                payloadHash: `sha256:${"0".repeat(64)}`,
              },
            }),
          }
        : stage,
    );
    const answer = await makeDoor(forgetful)(SUPERVISOR, "invoice.get", { invoice: THEIRS });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("INTERNAL_ERROR");
    expect(answer.envelope.message).toContain("another company");
  });
});
