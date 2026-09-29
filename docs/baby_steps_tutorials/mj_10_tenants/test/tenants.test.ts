// NEW IN STEP 10: every request works inside exactly one company, by claim (C1 to C6 in
// step 10's README). The unit tests read the invoices in memory. test/tenants.db.test.ts
// asks the same of the database.
import { describe, expect, it } from "vitest";
import { Refusal, type Answer } from "../src/envelope.ts";
import { invoiceUri, invoices, memoryInvoices } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import { permissionsOf } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { whoIsCalling } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { checkUrisInTenant } from "../src/tenants.ts";
import {
  AGENT,
  BAD_TENANT,
  FIRM_IN_456,
  FIRM_IN_789,
  FOREIGN_URI,
  GOOD_ISSUE,
  INV_1008_OF_456,
  INV_1008_OF_789,
  INV_2001_OF_789,
  NOBODY,
  NOT_A_MEMBER,
  SUPERVISOR,
  THE_789_SUPERVISOR,
  THE_AGENT,
  THE_FIRM,
  THE_SUPERVISOR,
  USER_700,
  correlationFor,
  log,
  notGranted,
  notValid,
  otherTenant,
  registry,
  withoutRequestId,
  type Caller,
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
const FOREIGN_1008 = { invoice: "dsor://org_789/invoice/INV-1008" };
const FOREIGN_NOPE = { invoice: "dsor://org_789/invoice/NOPE" };

describe("C1: each request works in exactly one company, which the caller belongs to", () => {
  // Refused as a malformed envelope: its form tells nothing about who exists (step 10's
  // README, decision 2).
  it.each([
    ["no tenant", undefined],
    ["a name, not an id", "acme"],
    ["an empty text", ""],
    ["org_ with no digits", "org_"],
    ["a space after the id", "org_456 "],
    ["the number 456", 456],
    ["a list that holds the id", ["org_456"]],
    ["null", null],
  ])("DSOR-IDN-03a: %s in the envelope is refused with VALIDATION_FAILED", async (_why, tenant) => {
    const request = tenant === undefined ? { token: "tok_7f3a" } : agentIn(tenant);
    expect(await call(registry, log, request, "invoice.get", { id: "INV-1008" })).toStrictEqual(
      refused("VALIDATION_FAILED", BAD_TENANT, THE_AGENT),
    );
  });

  it("DSOR-IDN-03a: the agent asking to work in org_789, where it is no member, is denied", async () => {
    const answer = await call(registry, log, agentIn("org_789"), "invoice.get", { id: "INV-1008" });
    expect(answer).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  it("DSOR-IDN-03a: the agent asking to work in org_999, which does not exist, is denied", async () => {
    const answer = await call(registry, log, agentIn("org_999"), "invoice.get", { id: "INV-1008" });
    expect(answer).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  it("DSOR-IDN-03a: the firm's agent works in org_456, and reads org_456's INV-1008", async () => {
    expect(await call(registry, log, FIRM_IN_456, "invoice.get", { id: "INV-1008" })).toStrictEqual(
      {
        data: INV_1008_OF_456,
        correlation: correlationFor(THE_FIRM),
      },
    );
  });

  it("DSOR-IDN-03a: the firm's agent works in org_789, and reads org_789's INV-1008", async () => {
    expect(await call(registry, log, FIRM_IN_789, "invoice.get", { id: "INV-1008" })).toStrictEqual(
      {
        data: INV_1008_OF_789,
        correlation: correlationFor(THE_FIRM),
      },
    );
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
    const answer = await call(registry, log, { tenant: "acme" }, "invoice.get", { id: "INV-1008" });
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED", correlation: NOBODY });
  });
});

describe("C2: a read looks only inside the active company", () => {
  it("DSOR-IDN-03b: org_456 reads INV-1008 and gets 31,400.00 USD from VENDOR-44", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", { id: "INV-1008" });
    expect(answer).toStrictEqual({ data: INV_1008_OF_456, correlation: correlationFor(THE_AGENT) });
  });

  it("DSOR-IDN-03b: org_789 reads INV-1008 and gets 99,000.00 USD from VENDOR-77", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", { id: "INV-1008" });
    expect(answer).toStrictEqual({
      data: INV_1008_OF_789,
      correlation: correlationFor(THE_789_SUPERVISOR),
    });
  });

  it("DSOR-IDN-03b: org_789 reads INV-2001, which only org_789 has", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", { id: "INV-2001" });
    expect(answer).toMatchObject({ data: INV_2001_OF_789 });
  });

  // INV-2001 exists, in org_789. From org_456 it is not there at all.
  it("DSOR-IDN-03b: org_456 reading INV-2001 hears the same as for INV-9999, which nobody has", async () => {
    const theirs = await call(registry, log, AGENT, "invoice.get", { id: "INV-2001" });
    const nobodys = await call(registry, log, AGENT, "invoice.get", { id: "INV-9999" });
    expect(theirs).toStrictEqual(refused("RESOURCE_NOT_FOUND", 'no invoice "INV-2001"', THE_AGENT));
    // Word for word, once the id the caller itself sent is set aside.
    const asSent = JSON.stringify(withoutRequestId(nobodys)).replaceAll("INV-9999", "INV-2001");
    expect(JSON.stringify(withoutRequestId(theirs))).toBe(asSent);
  });

  it("DSOR-IDN-03b: the store in memory finds an invoice by company and id together", async () => {
    const store = memoryInvoices();
    expect(await store.get("org_456", "INV-1008")).toStrictEqual(INV_1008_OF_456);
    expect(await store.get("org_789", "INV-1008")).toStrictEqual(INV_1008_OF_789);
    expect(await store.get("org_789", "INV-2001")).toStrictEqual(INV_2001_OF_789);
    expect(await store.get("org_456", "INV-2001")).toBeUndefined();
    expect(await store.get("org_999", "INV-1008")).toBeUndefined();
  });
});

describe("C3: only the caller's roles in the active company count", () => {
  it.each([
    ["org_456", ["invoice:read"]],
    ["org_789", ["invoice:issue", "invoice:read"]],
    ["org_999", []],
  ])(
    "DSOR-AUT-01b: in %s, the firm's agent holds only what its roles there grant",
    (tenant, held) => {
      const firm = whoIsCalling({ token: "tok_9b52" });
      expect([...permissionsOf(firm, registry.roles, tenant)].sort()).toStrictEqual(held);
    },
  );

  it("DSOR-IDN-03a: the firm's agent is denied invoice.issue in org_456", async () => {
    const answer = await call(registry, log, FIRM_IN_456, "invoice.issue", GOOD_ISSUE);
    expect(answer).toStrictEqual(
      refused("AUTHORIZATION_DENIED", notGranted("invoice.issue", "invoice:issue"), THE_FIRM),
    );
  });

  it("DSOR-IDN-03a: the firm's agent passes line ⑤ for invoice.issue in org_789", async () => {
    const answer = await call(registry, log, FIRM_IN_789, "invoice.issue", FOREIGN_1008);
    expect(answer).toStrictEqual(
      refused("UNSUPPORTED_CAPABILITY", '"invoice.issue" is not built yet', THE_FIRM),
    );
  });
});

describe("C4: a company in the arguments that is not the active one is refused", () => {
  // The same places step 05 checks for a principal (step 10's README, decision 4).
  it.each([
    ["tenant", { id: "INV-1008", tenant: "org_789" }],
    ["tenant_id", { id: "INV-1008", tenant_id: "org_789" }],
    ["correlation.tenant", { id: "INV-1008", correlation: { tenant: "org_789" } }],
    ["correlation.tenant_id", { id: "INV-1008", correlation: { tenant_id: "org_789" } }],
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
        id: "INV-1008",
        tenant: value,
      });
      expect(answer).toStrictEqual(refused("TENANT_MISMATCH", otherTenant("tenant"), THE_AGENT));
    },
  );

  // The field is still refused, by line ⑥: invoice.get's input has no tenant field. What
  // matters here is that it is not refused as a mismatch.
  it("a tenant field naming the active company is not a mismatch", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", {
      id: "INV-1008",
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
    const input = { invoice: "dsor://acme/invoice/INV-1008" };
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", input)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
  });

  // The whole input is searched, not only the fields a schema calls URIs (step 10's
  // README, decision 4). invoice.get's id is any text.
  it.each([["dsor://org_789/invoice/INV-1008"], ["DSOR://org_789/invoice/INV-1008"]])(
    "DSOR-SRC-02b: %s as invoice.get's id is refused with TENANT_MISMATCH",
    async (id) => {
      expect(await call(registry, log, AGENT, "invoice.get", { id })).toStrictEqual(
        refused("TENANT_MISMATCH", FOREIGN_URI, THE_AGENT),
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

  // Line ⑤ still comes first: the agent may not issue at all.
  it("the agent sending a foreign URI to invoice.issue is denied at line ⑤ first", async () => {
    expect(await call(registry, log, AGENT, "invoice.issue", FOREIGN_1008)).toStrictEqual(
      refused("AUTHORIZATION_DENIED", notGranted("invoice.issue", "invoice:issue"), THE_AGENT),
    );
  });
});

describe("C5: a refusal never tells whether another company, or its invoice, exists", () => {
  it("DSOR-ERR-01b: org_789 and org_999 get the same refusal, word for word", async () => {
    const real = await call(registry, log, agentIn("org_789"), "invoice.get", { id: "INV-1008" });
    const none = await call(registry, log, agentIn("org_999"), "invoice.get", { id: "INV-1008" });
    expect(withoutRequestId(real)).toStrictEqual(withoutRequestId(none));
  });

  it("DSOR-ERR-01b: org_789's INV-1008 and org_789's NOPE get the same refusal, word for word", async () => {
    const real = await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_1008);
    const none = await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_NOPE);
    expect(withoutRequestId(real)).toStrictEqual(withoutRequestId(none));
  });
});

describe("C6: every invoice and every record carries its company", () => {
  it("DSOR-TEN-01a: every invoice in memory carries a tenant_id in the form org_ and digits", () => {
    for (const invoice of invoices) expect(invoice.tenant_id).toMatch(/^org_[0-9]+$/);
  });

  it("DSOR-TEN-01a: an invoice's URI names its own company", () => {
    expect(invoiceUri(INV_1008_OF_789 as never)).toBe("dsor://org_789/invoice/INV-1008");
  });

  it.each([
    ["the agent in org_456", AGENT, "org_456"],
    ["the firm's agent in org_789", FIRM_IN_789, "org_789"],
  ])("DSOR-TEN-01a: a call by %s is recorded with its company", async (_who, request, tenant) => {
    const fresh = createLog();
    await call(registry, fresh, request, "invoice.get", { id: "INV-1008" });
    expect(await fresh.records()).toMatchObject([{ tenant }]);
  });

  it("DSOR-TEN-01a: a mismatch is recorded with the active company, not the one it named", async () => {
    const fresh = createLog();
    await call(registry, fresh, AGENT, "invoice.get", { id: "INV-1008", tenant: "org_789" });
    expect(await fresh.records()).toMatchObject([{ tenant: "org_456", result: "TENANT_MISMATCH" }]);
  });

  // No company has been checked yet, so the record names none (step 10's README, decision 6).
  it.each([
    ["no login", { tenant: "org_456" }],
    ["a tenant that is not an id", agentIn("acme")],
    ["a company the caller is no member of", agentIn("org_789")],
  ])("DSOR-TEN-01a: a refusal for %s is recorded with no company", async (_why, request) => {
    const fresh = createLog();
    await call(registry, fresh, request, "invoice.get", { id: "INV-1008" });
    const [record] = await fresh.records();
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty("tenant");
  });
});
