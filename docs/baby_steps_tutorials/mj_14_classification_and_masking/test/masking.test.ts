// NEW IN STEP 14: for an agent, every field above its clearance is left out before the
// answer leaves DSoR (DSOR-CLS-02a; step 14's README, C2). The invoices are in memory.
// test/masking.db.test.ts asks the same of the database.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { checkClassifications, readClassifications, type Kinds } from "../src/labels.ts";
import { clearanceOf, show } from "../src/masking.ts";
import { call } from "../src/pipeline.ts";
import { logins } from "../src/principals.ts";
import {
  AGENT,
  FIRM_IN_456,
  FIRM_IN_789,
  INV_1008_OF_456,
  MASKED_1008_OF_456,
  MASKED_1008_OF_789,
  PLANTED,
  PLANTED_MASKED,
  SUPERVISOR,
  UNEXPECTED,
  log,
  registry,
  runAs,
} from "./helpers.ts";

/** The shipped labels, read the way start-up reads them. */
function shippedKinds(): Kinds {
  return checkClassifications(readClassifications()).kinds;
}

/** The data of an answer, or the whole answer when it was refused. */
function dataOf(answer: Answer): unknown {
  return "data" in answer ? answer.data : answer;
}

/** The clearance DSoR's table of logins gives this principal. */
function clearanceOfId(id: string): unknown {
  const principal = [...logins.values()].find((p) => p.id === id);
  if (principal === undefined) throw new Error(`no principal ${id}`);
  return clearanceOf(principal);
}

describe("C2: for an agent, every field above its clearance is left out", () => {
  it("DSOR-CLS-02a: accounts-payable-fte reads INV-1008 without amount and open_amount, and every other field as before", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(dataOf(answer)).toStrictEqual(MASKED_1008_OF_456);
  });

  // In org_789 the firm's agent holds the supervisor's role. Masking follows the kind of
  // principal, never its role (step 14's README, decision 5).
  it.each([
    ["org_456", FIRM_IN_456, "dsor://org_456/invoice/INV-1008", MASKED_1008_OF_456],
    ["org_789", FIRM_IN_789, "dsor://org_789/invoice/INV-1008", MASKED_1008_OF_789],
  ])(
    "DSOR-CLS-02a: firm-ap-fte reads %s's INV-1008 without amount and open_amount",
    async (_company, who, invoice, masked) => {
      expect(dataOf(await call(registry, log, who, "invoice.get", { invoice }))).toStrictEqual(
        masked,
      );
    },
  );

  it.each([
    ["accounts-payable-fte in org_456", AGENT, "INV-1010"],
    ["firm-ap-fte in org_789", FIRM_IN_789, undefined],
  ])(
    "DSOR-CLS-02a: invoice.list as %s: no item has amount or open_amount, and the page keeps its next_cursor",
    async (_who, who, cursor) => {
      const answer = await call(registry, log, who, "invoice.list", {});
      const page = dataOf(answer) as { items: object[]; next_cursor?: string };
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(Object.keys(item).sort()).toStrictEqual(["id", "status", "tenant_id", "vendor_id"]);
      }
      expect(page.next_cursor).toBe(cursor);
    },
  );

  it("DSOR-CLS-01: a field with no label is left out of the agent's answer", async () => {
    expect(dataOf(await runAs(AGENT, async () => ({ ...PLANTED })))).toStrictEqual(PLANTED_MASKED);
  });
});

describe("C2: each agent's clearance", () => {
  it("DSOR-CLS-02a: both agents have the clearance internal, and no person has one", () => {
    expect(clearanceOfId("accounts-payable-fte")).toBe("internal");
    expect(clearanceOfId("firm-ap-fte")).toBe("internal");
    expect(clearanceOfId("user_123")).toBeUndefined();
    expect(clearanceOfId("cfo_100")).toBeUndefined();
    expect(clearanceOfId("user_700")).toBeUndefined();
  });

  // Break Y6. Never a default that shows more (step 14's README, decision 2).
  it("DSOR-CLS-02a: an agent with no clearance written down is treated as public, the lowest", () => {
    expect(clearanceOf({ id: "intake-fte", type: "agent", memberships: [] })).toBe("public");
  });

  it("DSOR-CLS-02a: at public, every field of INV-1008 is left out", () => {
    expect(show(INV_1008_OF_456, "Invoice", shippedKinds(), "public").data).toStrictEqual({});
  });

  // §19.2's example gives the agent confidential. A field at the clearance is shown.
  it("DSOR-CLS-02a: at confidential, a field labelled confidential is shown: amount", () => {
    expect(show(INV_1008_OF_456, "Invoice", shippedKinds(), "confidential").data).toStrictEqual(
      INV_1008_OF_456,
    );
  });

  // No clearance given means a person, who is not masked (step 14's README, decision 5).
  it("DSOR-CLS-02a: with no clearance, nothing is left out", () => {
    expect(show(INV_1008_OF_456, "Invoice", shippedKinds(), undefined).data).toStrictEqual(
      INV_1008_OF_456,
    );
  });
});

describe("C2: where the masking happens", () => {
  // Right after line ⑨ and before step 13's 64 KiB check, so the size measured is the size
  // that leaves (step 14's README, decision 5).
  it("DSOR-CLS-02a: the masking comes before the 64 KiB check: a large field the agent may not see does not refuse its answer", async () => {
    const large = async (): Promise<object> => ({
      ...PLANTED,
      vendor_bank_account: "x".repeat(70 * 1024),
    });
    expect(dataOf(await runAs(AGENT, large))).toStrictEqual(PLANTED_MASKED);
    expect(await runAs(SUPERVISOR, large)).toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
  });

  // What is not a record has no fields to label, so DSoR cannot tell which part is safe. An
  // agent gets none of it (step 14's README, decision 3).
  it.each([
    ["text", "INV-1008 is 31,400.00 USD"],
    ["a number", 31400],
    ["null", null],
    ["nothing", undefined],
    ["a list", [INV_1008_OF_456]],
  ])(
    "DSOR-CLS-02a: an answer that is not a record of its kind, %s, is refused for an agent, never sent",
    async (_what, value) => {
      expect(await runAs(AGENT, async () => value)).toMatchObject({
        code: "INTERNAL_ERROR",
        message: UNEXPECTED,
      });
    },
  );

  it.each([
    ["an item that is not a record", { items: ["INV-1008 is 31,400.00 USD"] }],
    ["items that are not a list", { items: "INV-1008 is 31,400.00 USD" }],
  ])(
    "DSOR-CLS-02a: a page with %s is refused for an agent, never sent",
    async (_what, page) => {
      expect(await runAs(AGENT, async () => page, "InvoicePage")).toMatchObject({
        code: "INTERNAL_ERROR",
        message: UNEXPECTED,
      });
    },
  );
});
