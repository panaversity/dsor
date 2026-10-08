// Every request works inside exactly one company, by claim (C1 to C6 in
// step 10's README). The unit tests read the invoices in memory. test/tenants.db.test.ts
// asks the same of the database.
import { describe, expect, it, vi } from "vitest";
import type { Company } from "../src/company.ts";
import { Refusal, type Answer } from "../src/envelope.ts";
import { invoiceUri, invoices, memoryInvoices, type InvoiceStore } from "../src/invoice.ts";
import { createLog, type DecisionLog } from "../src/log.ts";
import { effectivePermissions } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { whoIsCalling, type Principal } from "../src/principals.ts";
import { buildRegistry, type Handler, type Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import type { Slip } from "../src/slips.ts";
import { checkUrisInTenant } from "../src/tenants.ts";
import { parseUri } from "../src/uri.ts";
import {
  AGENT,
  BAD_TENANT,
  CFO,
  contract,
  correlationFor,
  extraField,
  FIRM_IN_456,
  FIRM_IN_789,
  FOREIGN_URI,
  FROM_MEMORY,
  GOOD_ISSUE,
  handlers,
  INV_1008_OF_456,
  INV_1008_OF_789,
  INV_2001_OF_789,
  log,
  MASKED_1008_OF_456,
  MASKED_1008_OF_789,
  MASKED_REDACTIONS,
  NOBODY,
  NOT_A_MEMBER,
  notGranted,
  notValid,
  otherTenant,
  OUR_EXTENSIONS,
  registry,
  registryWith,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  source,
  SUPERVISOR,
  THE_789_SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_FIRM,
  THE_SUPERVISOR,
  type Caller,
  UNEXPECTED,
  USER_700,
  forComparing,
  withPlanted,
  testSlips,
  DEL_101,
  DEL_102,
  storyDirectories,
} from "./helpers.ts";

/** The error envelope a test expects, with a request id DSoR made. */
function refused(code: string, message: string, caller: Caller): Record<string, unknown> {
  return { code, message, retry: "never", correlation: correlationFor(caller) };
}

/** The agent's call, working in this company instead of org_456. */
function agentIn(tenant: unknown): RequestEnvelope {
  return { ...AGENT, tenant };
}

/** The lines of the checklist a call ran, and its answer. */
async function linesRun(
  request: RequestEnvelope,
  name: string,
  input: unknown,
): Promise<{ answer: Answer; lines: number[] }> {
  const lines: number[] = [];
  const answer = await call(registry, log, request, name, input, (line) => lines.push(line));
  return { answer, lines };
}

// The foreign URIs of C4 and C5: one names an invoice org_789 has, one names nothing.
// With a version, so line ⑥ lets them through (step 21's README, decision 10).
const FOREIGN_1008 = { invoice: "dsor://org_789/invoice/INV-1008", expected_version: 1 };
const FOREIGN_NOPE = { invoice: "dsor://org_789/invoice/NOPE", expected_version: 1 };

/**
 * The shipped registry, with test.free planted: invoice.get's contract and code, and an input
 * that allows a nested object and an object with keys of any name. No shipped input does.
 * Found by the Stage 2 review, and fixed from step 12 on.
 */
function registryWithFreeInput(): Registry {
  const free = {
    ...contract("invoice.get"),
    id: "test.free",
    input: { schema: "TestFreeRequest" },
  };
  const schema = {
    type: "object",
    properties: {
      invoice: { type: "string" },
      details: {
        type: "object",
        properties: {
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: { ref: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      tags: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["invoice"],
    additionalProperties: false,
  };
  return buildRegistry(
    [...shipped, source(free, "test.free.json")],
    { ...handlers, "test.free": handlers["invoice.get"]! },
    shippedRoles,
    [...shippedInputs, source(schema, "TestFreeRequest.schema.json")],
    shippedLabels,
    memoryInvoices(),
    undefined,
    // Step 18: and the slips, so the agents call under them (step 18's README, decision 2).
    testSlips(),
    // And the story's directories (step 19's README, decision 2).
    storyDirectories(),
  );
}

describe("C1: each request works in exactly one company, which the caller belongs to", () => {
  // Refused as a malformed envelope: its form tells nothing about who exists (step 10's
  // README, decision 2).
  it.each([
    ["no tenant", undefined],
    ["a name, not an id", "acme"],
    ["an empty text", ""],
    ["org_ with no digits", "org_"],
    ["a space after the id", "org_456 "],
    // Found by the review: a pattern that ignored case let ORG_456 through to line ②'s
    // membership check.
    ["the id in capital letters", "ORG_456"],
    ["the number 456", 456],
    ["a list that holds the id", ["org_456"]],
    ["null", null],
    // An id has at most 18 digits (step 10's README, decision 12). Found by the Stage 2
    // review, and fixed from step 10 on.
    ["19 digits, one more than an id may have", `org_${"1".repeat(19)}`],
    ["a million digits", `org_${"9".repeat(1_000_000)}`],
  ])("DSOR-IDN-03a: %s in the envelope is refused with VALIDATION_FAILED", async (_why, tenant) => {
    const request = tenant === undefined ? { token: "tok_7f3a" } : agentIn(tenant);
    expect(
      await call(registry, log, request, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual(refused("VALIDATION_FAILED", BAD_TENANT, THE_AGENT));
  });

  // 18 digits is still an id, so it is refused as a company the caller is no member of. With
  // the limit set one lower, this test fails (step 10's README, decision 12). Found by the
  // Stage 2 review, and fixed from step 10 on.
  it("DSOR-IDN-03a: a company of 18 digits is still an id, and the agent is no member of it", async () => {
    const answer = await call(registry, log, agentIn(`org_${"1".repeat(18)}`), "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  it("DSOR-IDN-03a: the agent asking to work in org_789, where it is no member, is denied", async () => {
    const answer = await call(registry, log, agentIn("org_789"), "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  it("DSOR-IDN-03a: the agent asking to work in org_999, which does not exist, is denied", async () => {
    const answer = await call(registry, log, agentIn("org_999"), "invoice.get", {
      invoice: "dsor://org_999/invoice/INV-1008",
    });
    expect(answer).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  // The agent's invoice comes without its amounts. Its company and vendor
  // still say whose invoice it is (step 14's README, outcome 1).
  it("DSOR-IDN-03a: the firm's agent works in org_456, and reads org_456's INV-1008", async () => {
    expect(
      await call(registry, log, FIRM_IN_456, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual({
      data: MASKED_1008_OF_456,
      // Its label (DSOR-CLS-03).
      classification: "internal",
      redactions: MASKED_REDACTIONS,
      freshness: FROM_MEMORY,
      correlation: correlationFor(THE_FIRM),
    });
  });

  it("DSOR-IDN-03a: the firm's agent works in org_789, and reads org_789's INV-1008", async () => {
    expect(
      await call(registry, log, FIRM_IN_789, "invoice.get", {
        invoice: "dsor://org_789/invoice/INV-1008",
      }),
    ).toStrictEqual({
      data: MASKED_1008_OF_789,
      // Its label (DSOR-CLS-03).
      classification: "internal",
      redactions: MASKED_REDACTIONS,
      freshness: FROM_MEMORY,
      correlation: correlationFor(THE_FIRM),
    });
  });

  // Line ② comes right after line ①, before DSoR looks for the operation (step 10's README,
  // decision 2). So a stranger to org_789 learns nothing about which operations exist there.
  it("DSOR-IDN-03a: line ② runs right after line ①, before the operation is looked up", async () => {
    const { answer, lines } = await linesRun(agentIn("org_789"), "invoice.delete", {});
    expect(answer).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
    expect(lines).toStrictEqual([1, 2, 11]);
  });

  // No rule id: the order ① then ② is §21's. Who is calling comes first.
  it("a call with no login and a bad tenant hears about the login first", async () => {
    const answer = await call(registry, log, { tenant: "acme" }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED", correlation: NOBODY });
  });
});

describe("C2: a read looks only inside the active company", () => {
  // Read by cfo_100, a person, as org_789's by user_700. The agent's answer
  // has no amount (step 14's README, decision 5).
  it("DSOR-IDN-03b: org_456 reads INV-1008 and gets 31,400.00 USD from VENDOR-44", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual({
      data: INV_1008_OF_456,
      // Its label (DSOR-CLS-03).
      classification: "confidential",
      freshness: FROM_MEMORY,
      correlation: correlationFor(THE_CFO),
    });
  });

  it("DSOR-IDN-03b: org_789 reads INV-1008 and gets 99,000.00 USD from VENDOR-77", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toStrictEqual({
      data: INV_1008_OF_789,
      // Its label (DSOR-CLS-03).
      classification: "confidential",
      freshness: FROM_MEMORY,
      correlation: correlationFor(THE_789_SUPERVISOR),
    });
  });

  it("DSOR-IDN-03b: org_789 reads INV-2001, which only org_789 has", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-2001",
    });
    expect(answer).toMatchObject({ data: INV_2001_OF_789 });
  });

  // INV-2001 exists, in org_789. From org_456 it is not there at all.
  it("DSOR-IDN-03b: org_456 reading INV-2001 hears the same as for INV-9999, which nobody has", async () => {
    const theirs = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-2001",
    });
    const nobodys = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });
    expect(theirs).toStrictEqual(refused("RESOURCE_NOT_FOUND", 'no invoice "INV-2001"', THE_AGENT));
    // Word for word, once the id the caller itself sent is set aside.
    const asSent = JSON.stringify(forComparing(nobodys)).replaceAll("INV-9999", "INV-2001");
    expect(JSON.stringify(forComparing(theirs))).toBe(asSent);
  });

  it("DSOR-IDN-03b: the store in memory finds an invoice by company and id together", async () => {
    // The store gives the invoice beside its read's label.
    const store = memoryInvoices();
    const found = async (tenant: string, id: string): Promise<unknown> =>
      (await store.get(tenant, id)).invoice;
    expect(await found("org_456", "INV-1008")).toStrictEqual(INV_1008_OF_456);
    expect(await found("org_789", "INV-1008")).toStrictEqual(INV_1008_OF_789);
    expect(await found("org_789", "INV-2001")).toStrictEqual(INV_2001_OF_789);
    expect(await found("org_456", "INV-2001")).toBeUndefined();
    expect(await found("org_999", "INV-1008")).toBeUndefined();
    // Found by the review: a store that matched the start of the company, not all of it.
    expect(await found("org_45", "INV-1008")).toBeUndefined();
  });
});

describe("C3: only the caller's roles in the active company count", () => {
  // Since step 18 the firm's agent holds no role. In each company it may do what its slip
  // there lists and the signer holds now: del_101 from user_123, del_102 from user_700, and
  // nothing in org_999 (step 18's README, decisions 2 and 4). Since step 19 the signer's roles
  // are the ones line ③ found in her company's directory: ap_supervisor for both (step 19's
  // README, decision 2). The comment stands here, not inside the call, so the spec guard can
  // read the title.
  it.each([
    // ap_agent in org_456 and ap_supervisor in org_789, with step 17's payment permissions.
    ["org_456", DEL_101, ["ap_supervisor"], ["invoice:read", "payment:create"]],
    [
      "org_789",
      DEL_102,
      ["ap_supervisor"],
      ["invoice:issue", "invoice:read", "payment:cancel", "payment:create"],
    ],
    ["org_999", undefined, undefined, []],
  ])(
    "DSOR-DEL-02: in %s, the firm's agent may do only what its slip there and its signer allow",
    (tenant, slip, signerRoles, held) => {
      const firm = whoIsCalling({ token: "tok_9b52" });
      const may = effectivePermissions(
        firm,
        registry.roles,
        tenant,
        slip as Slip | undefined,
        signerRoles,
      );
      expect([...may].sort()).toStrictEqual(held);
    },
  );

  // Until step 16 the firm's agent made the two calls below. Since step 17 an agent's command
  // stops at line ③, before line ⑤ looks at its roles (step 17's README, decision 5). So a
  // person with the firm's two kinds of role makes them: reader in org_456, supervisor in
  // org_789.
  const clerk: Principal = {
    id: "firm-clerk",
    type: "human",
    memberships: [
      { tenant_id: "org_456", roles: ["CFO"] },
      { tenant_id: "org_789", roles: ["ap_supervisor"] },
    ],
  };
  const CLERK_IN = (tenant: string): RequestEnvelope => ({ token: "tok_clerk", tenant });

  it("DSOR-IDN-03a: a person who supervises in org_789 is denied invoice.issue in org_456", async () => {
    const answer = await withPlanted("tok_clerk", clerk, () =>
      call(registry, log, CLERK_IN("org_456"), "invoice.issue", GOOD_ISSUE),
    );
    expect(answer).toStrictEqual(
      refused("AUTHORIZATION_DENIED", notGranted("invoice.issue", "invoice:issue"), {
        principal_id: "firm-clerk",
      }),
    );
  });

  it("DSOR-IDN-03a: the same person passes line ⑤ for invoice.issue in org_789", async () => {
    const answer = await withPlanted("tok_clerk", clerk, () =>
      call(registry, log, CLERK_IN("org_789"), "invoice.issue", FOREIGN_1008),
    );
    expect(answer).toStrictEqual(
      refused("UNSUPPORTED_CAPABILITY", '"invoice.issue" is not built yet', {
        principal_id: "firm-clerk",
      }),
    );
  });
});

describe("C4: a company in the arguments that is not the active one is refused", () => {
  // The same places step 05 checks for a principal (step 10's README, decision 4).
  it.each([
    ["tenant", { invoice: "dsor://org_456/invoice/INV-1008", tenant: "org_789" }],
    ["tenant_id", { invoice: "dsor://org_456/invoice/INV-1008", tenant_id: "org_789" }],
    [
      "correlation.tenant",
      { invoice: "dsor://org_456/invoice/INV-1008", correlation: { tenant: "org_789" } },
    ],
    [
      "correlation.tenant_id",
      { invoice: "dsor://org_456/invoice/INV-1008", correlation: { tenant_id: "org_789" } },
    ],
    // §12's own spellings. Found by the review: they fell through to line ⑥.
    ["tenantId", { invoice: "dsor://org_456/invoice/INV-1008", tenantId: "org_789" }],
    ["activeTenantId", { invoice: "dsor://org_456/invoice/INV-1008", activeTenantId: "org_789" }],
    [
      "correlation.tenantId",
      { invoice: "dsor://org_456/invoice/INV-1008", correlation: { tenantId: "org_789" } },
    ],
    [
      "correlation.activeTenantId",
      { invoice: "dsor://org_456/invoice/INV-1008", correlation: { activeTenantId: "org_789" } },
    ],
  ])(
    "DSOR-SRC-02b: org_789 in %s, from inside org_456, is refused with TENANT_MISMATCH",
    async (place, input) => {
      expect(await call(registry, log, AGENT, "invoice.get", input)).toStrictEqual(
        refused("TENANT_MISMATCH", otherTenant(place), THE_AGENT),
      );
    },
  );

  // Anything there but the active company's own id: a company that does not exist, a
  // list or an object that holds one, a number.
  it.each([["org_999"], [["org_789"]], [{ id: "org_789" }], [789], [null]])(
    "DSOR-SRC-02b: a tenant field holding %j is refused with TENANT_MISMATCH",
    async (value) => {
      const answer = await call(registry, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
        tenant: value,
      });
      expect(answer).toStrictEqual(refused("TENANT_MISMATCH", otherTenant("tenant"), THE_AGENT));
    },
  );

  // The field is still refused, by line ⑥: invoice.get's input has no tenant field. What
  // matters here is that it is not refused as a mismatch.
  it("a tenant field naming the active company is not a mismatch", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
      tenant: "org_456",
    });
    expect(answer).toStrictEqual(
      refused(
        "VALIDATION_FAILED",
        notValid("invoice.get", 'must NOT have additional properties: "tenant"'),
        THE_AGENT,
      ),
    );
  });

  // Before "is it built", so a foreign URI is never answered as "not built yet" (step 10's
  // README, decision 4).
  it("DSOR-SRC-02b: user_123 issuing org_789's INV-1008 from inside org_456 hears TENANT_MISMATCH", async () => {
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_1008)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
  });

  it("DSOR-SRC-02b: the same call with org_456's own URI reaches 'not built yet'", async () => {
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", GOOD_ISSUE)).toStrictEqual(
      refused("UNSUPPORTED_CAPABILITY", '"invoice.issue" is not built yet', THE_SUPERVISOR),
    );
  });

  // The schema's pattern lets "acme" through as a tenant. It is no company's id, so it is
  // never the active one.
  it("DSOR-SRC-02b: a URI whose tenant is a name, dsor://acme/…, is refused with TENANT_MISMATCH", async () => {
    const input = { invoice: "dsor://acme/invoice/INV-1008", expected_version: 1 };
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", input)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
  });

  // The whole input is searched, not only the fields a schema calls URIs (step 10's
  // README, decision 4). invoice.get's input is a URI now, so no shipped
  // operation has a field of any text left, and the search is asked directly (step 12's
  // README, decision 1).
  it.each([["dsor://org_789/invoice/INV-1008"], ["DSOR://org_789/invoice/INV-1008"]])(
    "DSOR-SRC-02b: %s in a field of any text is refused with TENANT_MISMATCH",
    (text) => {
      expect(() => checkUrisInTenant({ note: text }, "org_456")).toThrow(
        new Refusal("TENANT_MISMATCH", FOREIGN_URI),
      );
    },
  );

  it("DSOR-SRC-02b: a foreign URI deep inside the input is found", () => {
    const deep = { a: [{ b: "text" }, { c: ["dsor://org_789/invoice/INV-1008"] }] };
    expect(() => checkUrisInTenant(deep, "org_456")).toThrow(
      new Refusal("TENANT_MISMATCH", FOREIGN_URI),
    );
    const own = { a: [{ b: "text" }, { c: ["dsor://org_456/invoice/INV-1008"] }] };
    expect(() => checkUrisInTenant(own, "org_456")).not.toThrow();
  });

  // Found by the review: a check that skipped the names of fields passed every test.
  it("DSOR-SRC-02b: a foreign URI used as the name of a field is found", () => {
    expect(() => checkUrisInTenant({ "dsor://org_789/invoice/INV-1008": 1 }, "org_456")).toThrow(
      new Refusal("TENANT_MISMATCH", FOREIGN_URI),
    );
  });

  // The two tests above ask the search itself. With the pipeline changed to hand it only the
  // input's top-level texts, every test stayed green, because no shipped input holds an
  // object or a key of its own. So a call is planted again: test.free, whose input allows a
  // nested object and an object with keys of any name (step 10's README, decision 4). Found
  // by the Stage 2 review, and fixed from step 12 on.
  it.each([
    ["deep inside a nested object", { details: { lines: [{ ref: FOREIGN_1008.invoice }] } }],
    ["used as a key", { tags: { [FOREIGN_1008.invoice]: "seen" } }],
  ])(
    "DSOR-SRC-02b: through call, a URI of org_789 %s is refused with TENANT_MISMATCH",
    async (_where, extra) => {
      const input = { invoice: "dsor://org_456/invoice/INV-1008", ...extra };
      expect(await call(registryWithFreeInput(), log, AGENT, "test.free", input)).toStrictEqual(
        refused("TENANT_MISMATCH", FOREIGN_URI, THE_AGENT),
      );
    },
  );

  // The same shapes, with org_456's own URI, reach the code. So the refusals above come from
  // the company, not from line ⑥. The agent's answer is masked as step 14 masks it.
  it("DSOR-SRC-02b: through call, the same shapes holding org_456's own URI reach the code", async () => {
    const own = "dsor://org_456/invoice/INV-1008";
    const input = { invoice: own, details: { lines: [{ ref: own }] }, tags: { [own]: "seen" } };
    expect(await call(registryWithFreeInput(), log, AGENT, "test.free", input)).toStrictEqual(
      MASKED_ANSWER,
    );
  });

  // Found by the review: a check that skipped long texts passed every test.
  it("DSOR-SRC-02b: a long foreign URI is found", () => {
    const long = `dsor://org_789/invoice/${"X".repeat(200)}`;
    expect(() => checkUrisInTenant({ id: long }, "org_456")).toThrow(
      new Refusal("TENANT_MISMATCH", FOREIGN_URI),
    );
  });

  // No rule id: text that only starts like a URI is not one. Found by the review: a check
  // for "dsor:" instead of "dsor://" refused it and passed every test.
  it("text that starts with dsor: but is not a URI passes", () => {
    expect(() => checkUrisInTenant({ note: "dsor:notes" }, "org_456")).not.toThrow();
  });

  // The URI check reads line ①'s copy, which line ⑥ checked, never the input again (step 07's
  // README, decision 9). Found by the review: checking the input a second time passed every
  // test. This input names org_789 the first time it is read, and org_456 after that.
  it("DSOR-SRC-02b: the URI check reads the copy line ⑥ checked, not the input again", async () => {
    let reads = 0;
    const input = {
      get invoice(): string {
        reads += 1;
        return reads === 1 ? FOREIGN_1008.invoice : GOOD_ISSUE.invoice;
      },
      expected_version: 1,
    };
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", input)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
  });

  // Found by the review: every test above works in the caller's first company, so a check
  // against the first membership, not the active company, passed them all.
  it("DSOR-SRC-02b: the firm's agent in org_789 naming org_456 in its arguments is refused", async () => {
    // Its own company's URI, so the tenant field is the one foreign thing. Found by step
    // 12's review: step 12's change to URIs had put org_456's here.
    const input = { invoice: "dsor://org_789/invoice/INV-1008", tenant: "org_456" };
    expect(await call(registry, log, FIRM_IN_789, "invoice.get", input)).toStrictEqual(
      refused("TENANT_MISMATCH", otherTenant("tenant"), THE_FIRM),
    );
  });

  // An earlier line still comes first. Until step 16 it was line ⑤: the agent may not issue.
  // In step 17 it was line ③: an agent ran no command without a delegation. Since step 18
  // the agent passes line ③ under del_100, which lists no invoice:issue, so line ⑤ refuses
  // it again, before the URI's company is checked (step 18's README, decision 5).
  it("the agent sending a foreign URI to invoice.issue is refused at line ⑤ first", async () => {
    expect(await call(registry, log, AGENT, "invoice.issue", FOREIGN_1008)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      correlation: correlationFor(THE_AGENT),
    });
  });
});

describe("C5: a refusal never tells whether another company, or its invoice, exists", () => {
  it("DSOR-ERR-01b: org_789 and org_999 get the same refusal, word for word", async () => {
    const real = await call(registry, log, agentIn("org_789"), "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    const none = await call(registry, log, agentIn("org_999"), "invoice.get", {
      invoice: "dsor://org_999/invoice/INV-1008",
    });
    expect(forComparing(real)).toStrictEqual(forComparing(none));
    // Found by the review: "the same" alone passed with the membership check deleted, when
    // both became line ⑤'s refusal. The same, and the right refusal.
    expect(real).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  it("DSOR-ERR-01b: org_789's INV-1008 and org_789's NOPE get the same refusal, word for word", async () => {
    const real = await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_1008);
    const none = await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_NOPE);
    expect(forComparing(real)).toStrictEqual(forComparing(none));
    expect(real).toStrictEqual(refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR));
  });
});

describe("C7: an envelope carries exactly one company, and nothing DSoR does not read", () => {
  // Found by the review: this envelope worked in org_456, and org_789 was ignored without a
  // word (step 10's README, decision 11).
  it("DSOR-IDN-03a: an envelope naming a second company, in tenant_id, is refused", async () => {
    const request = { ...AGENT, tenant_id: "org_789" };
    expect(
      await call(registry, log, request, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual(refused("VALIDATION_FAILED", extraField("tenant_id"), THE_AGENT));
  });

  // The list says what is allowed, so any other name is refused, however it is spelled.
  it.each([["tenantId"], ["activeTenantId"], ["company"], ["delegation_id"], ["TOKEN"]])(
    "DSOR-IDN-03a: an envelope with the extra field %s is refused",
    async (field) => {
      const request = { ...AGENT, [field]: "org_789" };
      expect(
        await call(registry, log, request, "invoice.get", {
          invoice: "dsor://org_456/invoice/INV-1008",
        }),
      ).toStrictEqual(refused("VALIDATION_FAILED", extraField(field), THE_AGENT));
    },
  );

  it("a call with no login and an extra envelope field hears about the login first", async () => {
    const request = { tenant: "org_456", tenant_id: "org_789" };
    expect(
      await call(registry, log, request, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("an envelope with only token, tenant, and request_id is not refused for its fields", async () => {
    const request = { ...AGENT, request_id: "ap-desk-7" };
    expect(
      await call(registry, log, request, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toMatchObject({
      // Without its amounts, because the agent asks.
      data: MASKED_1008_OF_456,
    });
  });
});

describe("C6: every invoice and every record carries its company", () => {
  it("DSOR-TEN-01a: every invoice in memory carries a tenant_id in the form org_ and digits", () => {
    for (const invoice of invoices) expect(invoice.tenant_id).toMatch(/^org_[0-9]+$/);
  });

  it("DSOR-TEN-01a: an invoice's URI names its own company", () => {
    expect(invoiceUri(INV_1008_OF_789 as never)).toBe("dsor://org_789/invoice/INV-1008");
  });

  // Each reads its own company's INV-1008, and succeeds. Found by step 12's review: step
  // 12's change to URIs had sent org_456's URI from org_789, a refusal, and the test
  // still passed, because a refusal after line ② names the company too.
  it.each([
    ["the agent in org_456", AGENT, "org_456"],
    ["the firm's agent in org_789", FIRM_IN_789, "org_789"],
  ])("DSOR-TEN-01a: a call by %s is recorded with its company", async (_who, request, tenant) => {
    const fresh = createLog();
    await call(registry, fresh, request, "invoice.get", {
      invoice: `dsor://${tenant}/invoice/INV-1008`,
    });
    expect(await fresh.records()).toMatchObject([{ tenant, result: "ok" }]);
  });

  it("DSOR-TEN-01a: a mismatch is recorded with the active company, not the one it named", async () => {
    const fresh = createLog();
    await call(registry, fresh, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
      tenant: "org_789",
    });
    expect(await fresh.records()).toMatchObject([{ tenant: "org_456", result: "TENANT_MISMATCH" }]);
  });

  // The company a non-member asked for is kept as a claim, never as the record's tenant
  // (step 10's README, decision 6).
  it.each([["org_789"], ["org_999"]])(
    "a non-member's refusal for %s keeps the company it asked for, as a claim",
    async (tenant) => {
      const fresh = createLog();
      await call(registry, fresh, agentIn(tenant), "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      });
      const [record] = await fresh.records();
      expect(record).not.toHaveProperty("tenant");
      expect(record).toMatchObject({
        extensions: { [OUR_EXTENSIONS]: { requested_tenant: tenant } },
      });
    },
  );

  // A company of a million digits was a well-formed id, so the record kept it whole: a record
  // of 1,000,433 bytes that dsor_runtime can never remove. Threat T12 in §10.2, audit
  // flooding (step 10's README, decision 12). Found by the Stage 2 review, and fixed from
  // step 10 on.
  it("step 10's decision 12: a company of a million digits leaves a small record, with no claim", async () => {
    const fresh = createLog();
    await call(registry, fresh, agentIn(`org_${"9".repeat(1_000_000)}`), "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    const [record] = await fresh.records();
    expect(record).toMatchObject({ result: "VALIDATION_FAILED" });
    expect(record).not.toHaveProperty("extensions");
    expect(JSON.stringify(record).length).toBeLessThan(1024);
  });

  // A malformed id is text the caller wrote, and could be anything, so it is not kept. A
  // refusal at line ①, or a call line ② let through, keeps no claim either.
  it.each([
    ["a tenant that is not an id", agentIn("acme")],
    ["no login", { tenant: "org_789" }],
    ["a call that succeeds", AGENT],
    ["a mismatch in the arguments", { ...AGENT, request_id: "mismatch" }],
  ])("a record for %s keeps no claimed company", async (_why, request) => {
    const fresh = createLog();
    const input =
      request.request_id === "mismatch"
        ? { invoice: "dsor://org_456/invoice/X", tenant: "org_789" }
        : { invoice: "dsor://org_456/invoice/X" };
    await call(registry, fresh, request, "invoice.get", input);
    const [record] = await fresh.records();
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty("extensions");
  });

  // No company has been checked yet, so the record names none (step 10's README, decision 6).
  it.each([
    ["no login", { tenant: "org_456" }],
    ["a tenant that is not an id", agentIn("acme")],
    ["a company the caller is no member of", agentIn("org_789")],
  ])("DSOR-TEN-01a: a refusal for %s is recorded with no company", async (_why, request) => {
    const fresh = createLog();
    await call(registry, fresh, request, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    const [record] = await fresh.records();
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty("tenant");
  });
});

// What the agent hears for org_456's INV-1008: the invoice without its amounts, with its
// label, and what was left out (step 14's README, outcome 1).
const MASKED_ANSWER = {
  data: MASKED_1008_OF_456,
  classification: "internal",
  redactions: MASKED_REDACTIONS,
  freshness: FROM_MEMORY,
  correlation: correlationFor(THE_AGENT),
};

describe("C8: the code can reach only the active company, and its answer must belong to it", () => {
  // The code was given the whole store and a bare company id, and named the company at each
  // read. So the lock trusted the company the code asked for. Now it gets one company's
  // store (step 10's README, decision 13). Found by the Stage 2 review, and fixed from step
  // 10 on. From step 13, that store reads by id and lists by page.
  it("DSOR-IDN-03b: the code is given only the active company: its id, and its invoices to read by id or by page", async () => {
    // The code reads while its call runs. Once line ⑨ ends, the company
    // reads nothing more (step 15's README, decision 5).
    const seen: { one?: unknown; listed?: unknown[] } = {};
    const spy = vi.fn<Handler>(async (_input, company) => {
      seen.one = await company.invoices.get("INV-1008");
      seen.listed = (await company.invoices.list(undefined, 20)).map(({ tenant_id }) => tenant_id);
      return "ran";
    });
    await call(registryWith(spy), log, FIRM_IN_789, "test.run", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const company = spy.mock.calls[0]?.[1] as Company;
    // Every key, even a hidden one or a symbol, and nothing behind the objects either.
    // Found by a hostile pass on the Stage 2 review's fix: a hidden store, or the store as
    // the prototype of invoices, passed a check of the visible keys.
    // Since step 17, its payments too, bound the same way (step 17's README, outcome 1).
    expect(Reflect.ownKeys(company)).toStrictEqual(["tenant", "invoices", "payments"]);
    expect(Object.getPrototypeOf(company)).toBe(Object.prototype);
    expect(company.tenant).toBe("org_789");
    expect(Reflect.ownKeys(company.invoices)).toStrictEqual(["get", "list"]);
    expect(Object.getPrototypeOf(company.invoices)).toBe(Object.prototype);
    expect(Reflect.ownKeys(company.payments)).toStrictEqual(["create", "cancel"]);
    expect(Object.getPrototypeOf(company.payments)).toBe(Object.prototype);
    expect(seen.one).toStrictEqual(INV_1008_OF_789);
    expect(seen.listed).toStrictEqual(Array(5).fill("org_789"));
  });

  // A row of another company in the answer is a bug in the code. The call fails with the
  // fixed message for a bug, so nothing of the row leaks. The checks let the call reach the
  // code, so the record says ALLOW (step 10's README, decision 14). Found by the Stage 2
  // review, and fixed from step 10 on.
  it("step 10's decision 14: an answer that holds org_789's row fails with INTERNAL_ERROR in org_456, and nothing of it leaks", async () => {
    const fresh = createLog();
    const theirs = registryWith(() => structuredClone(INV_1008_OF_789));
    const answer = await call(theirs, fresh, AGENT, "test.run", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
    expect(JSON.stringify(answer)).not.toMatch(/VENDOR-77|99000|org_789/);
    expect(await fresh.records()).toMatchObject([
      { authorization: "ALLOW", result: "INTERNAL_ERROR", reason: UNEXPECTED, tenant: "org_456" },
    ]);
    // Step 14 names what a read returned in its record. This one returned nothing, so its
    // record names no resource and no row (step 14's README, decision 7).
    const [record] = await fresh.records();
    expect(record).not.toHaveProperty("resources");
    expect(record).not.toHaveProperty("row_count");
  });

  // The company check reads the answer before masking does. An agent at public is given
  // nothing of an invoice, tenant_id included, so a check after masking would find no row
  // to refuse, and the record would name org_789's invoice. Found by a hostile pass on the
  // Stage 2 review's fix: with the check moved after masking, every test passed. Fixed from
  // step 14 on.
  it("step 10's decision 14: an agent at public, whose code answers with org_789's row, fails with INTERNAL_ERROR, though masking would leave it nothing", async () => {
    // Since step 18 an agent holds no role: intake-fte works under its test slip, del_190
    // (step 18's README, decision 11).
    const memberships = [{ tenant_id: "org_456", roles: [] }];
    const intake: Principal = { id: "intake-fte", type: "agent", memberships };
    const fresh = createLog();
    const answer = await withPlanted("tok_intake", intake, () =>
      call(
        registryWith(() => structuredClone(INV_1008_OF_789)),
        fresh,
        { token: "tok_intake", tenant: "org_456" },
        "test.run",
        { invoice: "dsor://org_456/invoice/INV-1008" },
      ),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
    const [record] = await fresh.records();
    expect(record).toMatchObject({ authorization: "ALLOW", result: "INTERNAL_ERROR" });
    expect(record).not.toHaveProperty("resources");
  });

  // A page is an answer like any other, so each of its items is checked. Here the real
  // invoice.list reads through a store whose list forgets the company, as break X5 does,
  // and org_456's first page holds org_789's INV-1008 (step 10's README, decision 14).
  // Found by the Stage 2 review, and fixed from step 13 on.
  it("step 10's decision 14: a page that holds one row of org_789 fails with INTERNAL_ERROR in org_456, and nothing of it leaks", async () => {
    const memory = memoryInvoices();
    // Its rows come beside the label of the read, as every store's do.
    const forgetful: InvoiceStore = {
      get: memory.get,
      list: async (tenant, after, count) => ({
        rows: invoices
          .filter((invoice) => after === undefined || invoice.id > after)
          .slice(0, count)
          .map((invoice) => structuredClone(invoice)),
        freshness: (await memory.list(tenant, after, count)).freshness,
      }),
    };
    const fresh = createLog();
    const leaky = buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      shippedInputs,
      shippedLabels,
      forgetful,
      undefined,
      // Step 18: and the slips, so the agents call under them (step 18's README, decision 2).
      testSlips(),
      // And the story's directories (step 19's README, decision 2).
      storyDirectories(),
    );
    const answer = await call(leaky, fresh, AGENT, "invoice.list", {});
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
    expect(JSON.stringify(answer)).not.toMatch(/VENDOR-77|99000|org_789/);
    expect(await fresh.records()).toMatchObject([
      { authorization: "ALLOW", result: "INTERNAL_ERROR", reason: UNEXPECTED, tenant: "org_456" },
    ]);
    const [record] = await fresh.records();
    expect(record).not.toHaveProperty("resources");
    expect(record).not.toHaveProperty("row_count");
  });

  // Code that makes a store of its own can still name any company. Its answer gives it away
  // (step 10's README, decision 14). Found by the Stage 2 review, and fixed from step 10 on.
  it("step 10's decision 14: code that reads org_789 through a store of its own is caught by its answer", async () => {
    const itsOwn = memoryInvoices();
    // The invoice, out of what the store gives.
    const reachesAround: Handler = async (input) =>
      (await itsOwn.get("org_789", parseUri((input as { invoice: string }).invoice).id)).invoice;
    const answer = await call(registryWith(reachesAround), log, AGENT, "test.run", {
      invoice: "dsor://org_456/invoice/INV-2001",
    });
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
  });

  // The check read the code's live answer, and the caller got that same object. So a row the
  // code changed after the check, a field that reads differently the second time, or a
  // toJSON got org_789's row past it. Now DSoR checks its own copy and sends that copy, as
  // line ① does for the input (step 10's README, decision 14). Found by a hostile pass on
  // the Stage 2 review's fix, and fixed from step 10 on.
  it("step 10's decision 14: a row the code changes after it returns reaches the caller as it was checked", async () => {
    const row = { ...INV_1008_OF_456 };
    const changesLater: Handler = () => {
      setTimeout(() => Object.assign(row, INV_1008_OF_789), 5);
      return row;
    };
    // A log that takes 20 ms to keep a record, as a database can. It only adds: a log the
    // pipeline is given needs nothing more (step 11's README, decision 6).
    const slow: DecisionLog = {
      add: () => new Promise<void>((done) => setTimeout(done, 20)),
    };
    const answer = await call(registryWith(changesLater), slow, AGENT, "test.run", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    // The agent's answer, masked as step 14 masks it: org_456's invoice, without its amounts.
    expect(answer).toStrictEqual(MASKED_ANSWER);
  });

  it("step 10's decision 14: a tenant_id that reads org_456 first and org_789 after reaches the caller as org_456", async () => {
    let reads = 0;
    const row: Record<string, unknown> = { ...INV_1008_OF_456 };
    Object.defineProperty(row, "tenant_id", {
      enumerable: true,
      get: () => (reads++ === 0 ? "org_456" : "org_789"),
    });
    const answer = await call(
      registryWith(() => row),
      log,
      AGENT,
      "test.run",
      { invoice: "dsor://org_456/invoice/INV-1008" },
    );
    expect(JSON.stringify(answer)).not.toMatch(/org_789/);
    // The agent's answer, masked as step 14 masks it: org_456's invoice, without its amounts.
    expect(answer).toStrictEqual(MASKED_ANSWER);
  });

  it("step 10's decision 14: an answer whose toJSON shows org_789's row fails with INTERNAL_ERROR", async () => {
    const disguised = { toJSON: () => INV_2001_OF_789 };
    const answer = await call(
      registryWith(() => disguised),
      log,
      AGENT,
      "test.run",
      {
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
  });

  it("step 10's decision 14: an answer that JSON cannot carry fails with INTERNAL_ERROR", async () => {
    const answer = await call(
      registryWith(() => ({ count: 1n })),
      log,
      AGENT,
      "test.run",
      {
        invoice: "dsor://org_456/invoice/INV-1008",
      },
    );
    expect(answer).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
  });

  // The code's store and the answer check get the company line ② read, once. Found by a
  // hostile pass on the Stage 2 review's fix: reading the envelope's tenant again for them
  // passed every test, and this envelope then read org_789's INV-2001 (step 10's README,
  // decisions 2 and 13).
  it("DSOR-IDN-03a: an envelope whose tenant reads org_456 first and org_789 after works in org_456 only", async () => {
    let reads = 0;
    const shifty = {
      token: "tok_7f3a",
      get tenant(): string {
        return reads++ === 0 ? "org_456" : "org_789";
      },
    };
    expect(
      await call(registry, log, shifty, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-2001",
      }),
    ).toStrictEqual(refused("RESOURCE_NOT_FOUND", 'no invoice "INV-2001"', THE_AGENT));
  });

  // When the store is missing, the answer is no (step 10's README, decision 13). Found by
  // the Stage 2 review, and fixed from step 10 on.
  it("step 10's decision 13: a registry built without a store reads no invoice, and fails with INTERNAL_ERROR", async () => {
    // Step 18: no store of invoices, and the slips, so the agent reaches the missing store.
    const noStore = buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      undefined,
      undefined,
      undefined,
      undefined,
      testSlips(),
      // And the story's directories (step 19's README, decision 2).
      storyDirectories(),
    );
    expect(
      await call(noStore, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual(refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT));
  });

  // The same for a list. Found by the Stage 2 review, and fixed from step 13 on.
  it("step 10's decision 13: a registry built without a store lists no invoice, and fails with INTERNAL_ERROR", async () => {
    // Step 18: no store of invoices, and the slips, so the agent reaches the missing store.
    const noStore = buildRegistry(
      shipped,
      handlers,
      shippedRoles,
      undefined,
      undefined,
      undefined,
      undefined,
      testSlips(),
      // And the story's directories (step 19's README, decision 2).
      storyDirectories(),
    );
    expect(await call(noStore, log, AGENT, "invoice.list", {})).toStrictEqual(
      refused("INTERNAL_ERROR", UNEXPECTED, THE_AGENT),
    );
  });
});
