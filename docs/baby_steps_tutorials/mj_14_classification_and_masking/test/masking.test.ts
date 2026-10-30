// NEW IN STEP 14: for an agent, every field above its clearance is left out before the
// answer leaves DSoR (DSOR-CLS-02a; step 14's README, C2). The invoices are in memory.
// test/masking.db.test.ts asks the same of the database.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { checkClassifications, readClassifications, type Kinds } from "../src/labels.ts";
import { clearanceOf, show } from "../src/masking.ts";
import { call } from "../src/pipeline.ts";
import { logins, type Principal } from "../src/principals.ts";
import { buildRegistry } from "../src/registry.ts";
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
  handlers,
  log,
  refusal,
  registry,
  runAs,
  shipped,
  shippedRoles,
  withPlanted,
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

  // Found by the Stage 2 review: rank() puts any text it does not know above restricted,
  // which is safe for a field and unsafe for a clearance. An agent whose clearance was
  // written INTERNAL, in capitals, got amount, with no redactions. Now any clearance that is
  // not exactly one of the four labels is public (step 14's README, decision 2). Fixed from
  // step 14 on.
  it.each([["INTERNAL"], ["Internal"], [" internal"], ["secret"], [""], [3]])(
    "DSOR-CLS-02a: an agent whose clearance is written %j is treated as public",
    (clearance) => {
      const agent = { id: "intake-fte", type: "agent", memberships: [], clearance };
      expect(clearanceOf(agent as unknown as Principal)).toBe("public");
    },
  );

  // The same through the real pipeline. The registry was built before the agent is planted,
  // because start-up refuses such a clearance (below).
  it("DSOR-CLS-02a: an agent whose clearance is spelled INTERNAL gets no amount, through the real pipeline", async () => {
    const memberships = [{ tenant_id: "org_456", roles: ["ap_agent"] }];
    const intake = { id: "intake-fte", type: "agent", memberships, clearance: "INTERNAL" };
    const answer = await withPlanted("tok_intake", intake as unknown as Principal, () =>
      call(registry, log, { token: "tok_intake", tenant: "org_456" }, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    );
    expect(JSON.stringify(answer)).not.toContain("31400.00");
    expect(answer).toMatchObject({ data: {}, classification: "public" });
  });

  // Start-up checks every clearance in DSoR's table, beside the role check, so a
  // misspelling stops the program and is fixed there (step 14's README, decision 2).
  it("step 14's decision 2: a clearance that is not one of the four labels stops start-up, naming the principal", async () => {
    const intake = { id: "intake-fte", type: "agent", memberships: [], clearance: "INTERNAL" };
    const message = await withPlanted("tok_intake", intake as unknown as Principal, () =>
      refusal(() => buildRegistry(shipped, handlers, shippedRoles)),
    );
    expect(message).toBe(
      'the registry refused to start:\n  principal "intake-fte" has the clearance "INTERNAL", which is not one of the four labels',
    );
    // And with it taken out again, the table starts.
    expect(refusal(() => buildRegistry(shipped, handlers, shippedRoles))).toBe("");
  });

  // Found by a hostile pass on the Stage 2 review's fix: the same hole one field over. A
  // type DSoR does not know, such as Agent in capitals, meant "not masked", and start-up
  // never checked it. Now only a known type that is not an agent goes unmasked, and
  // start-up refuses any other type, naming the principal (step 14's README, decision 5).
  // Fixed from step 14 on.
  it.each([["Agent"], ["AGENT"], ["ai_agent"]])(
    "DSOR-CLS-02a: a caller whose type is written %j is masked as an agent: it gets no amount",
    async (type) => {
      const memberships = [{ tenant_id: "org_456", roles: ["ap_agent"] }];
      const odd = { id: "intake-fte", type, memberships, clearance: "internal" };
      const answer = await withPlanted("tok_intake", odd as unknown as Principal, () =>
        call(registry, log, { token: "tok_intake", tenant: "org_456" }, "invoice.get", {
          invoice: "dsor://org_456/invoice/INV-1008",
        }),
      );
      expect(answer).toMatchObject({ data: MASKED_1008_OF_456, classification: "internal" });
      // And its answer names it as an agent, by the same rule. Found by a second hostile
      // pass on the Stage 2 review's fix: it was masked as an agent and named as a person.
      expect(answer.correlation).toStrictEqual({
        request_id: expect.any(String),
        agent_id: "intake-fte",
      });
    },
  );

  it("step 14's decision 5: a type that is not one of the four kinds of caller stops start-up, naming the principal", async () => {
    const odd = { id: "intake-fte", type: "Agent", memberships: [], clearance: "internal" };
    const message = await withPlanted("tok_intake", odd as unknown as Principal, () =>
      refusal(() => buildRegistry(shipped, handlers, shippedRoles)),
    );
    expect(message).toBe(
      'the registry refused to start:\n  principal "intake-fte" has the type "Agent", which is not one of the four kinds of caller',
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
  ])("DSOR-CLS-02a: a page with %s is refused for an agent, never sent", async (_what, page) => {
    expect(await runAs(AGENT, async () => page, "InvoicePage")).toMatchObject({
      code: "INTERNAL_ERROR",
      message: UNEXPECTED,
    });
  });
});
