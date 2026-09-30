// Every request works inside exactly one company, by claim (C1 to C6 in
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
  OUR_EXTENSIONS,
  SUPERVISOR,
  THE_789_SUPERVISOR,
  THE_AGENT,
  THE_FIRM,
  THE_SUPERVISOR,
  USER_700,
  correlationFor,
  extraField,
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
    // Found by the review: a pattern that ignored case let ORG_456 through to line ②'s
    // membership check.
    ["the id in capital letters", "ORG_456"],
    ["the number 456", 456],
    ["a list that holds the id", ["org_456"]],
    ["null", null],
  ])("DSOR-IDN-03a: %s in the envelope is refused with VALIDATION_FAILED", async (_why, tenant) => {
    const request = tenant === undefined ? { token: "tok_7f3a" } : agentIn(tenant);
    expect(
      await call(registry, log, request, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual(refused("VALIDATION_FAILED", BAD_TENANT, THE_AGENT));
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

  it("DSOR-IDN-03a: the firm's agent works in org_456, and reads org_456's INV-1008", async () => {
    expect(
      await call(registry, log, FIRM_IN_456, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toStrictEqual({
      data: INV_1008_OF_456,
      correlation: correlationFor(THE_FIRM),
    });
  });

  it("DSOR-IDN-03a: the firm's agent works in org_789, and reads org_789's INV-1008", async () => {
    expect(
      await call(registry, log, FIRM_IN_789, "invoice.get", {
        invoice: "dsor://org_789/invoice/INV-1008",
      }),
    ).toStrictEqual({
      data: INV_1008_OF_789,
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
  it("DSOR-IDN-03b: org_456 reads INV-1008 and gets 31,400.00 USD from VENDOR-44", async () => {
    const answer = await call(registry, log, AGENT, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(answer).toStrictEqual({ data: INV_1008_OF_456, correlation: correlationFor(THE_AGENT) });
  });

  it("DSOR-IDN-03b: org_789 reads INV-1008 and gets 99,000.00 USD from VENDOR-77", async () => {
    const answer = await call(registry, log, USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toStrictEqual({
      data: INV_1008_OF_789,
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
    // Found by the review: a store that matched the start of the company, not all of it.
    expect(await store.get("org_45", "INV-1008")).toBeUndefined();
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
    const input = { invoice: "dsor://acme/invoice/INV-1008" };
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", input)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
  });

  // The whole input is searched, not only the fields a schema calls URIs (step 10's
  // README, decision 4). NEW IN STEP 12: invoice.get's input is a URI now, so no shipped
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

  // The URI check reads the copy line ⑥ checked, never the input again (step 07's README,
  // decision 9). Found by the review: checking the input a second time passed every test.
  // This input names org_789 the first time it is read, and org_456 after that.
  it("DSOR-SRC-02b: the URI check reads the copy line ⑥ checked, not the input again", async () => {
    let reads = 0;
    const input = {
      get invoice(): string {
        reads += 1;
        return reads === 1 ? FOREIGN_1008.invoice : GOOD_ISSUE.invoice;
      },
    };
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", input)).toStrictEqual(
      refused("TENANT_MISMATCH", FOREIGN_URI, THE_SUPERVISOR),
    );
  });

  // Found by the review: every test above works in the caller's first company, so a check
  // against the first membership, not the active company, passed them all.
  it("DSOR-SRC-02b: the firm's agent in org_789 naming org_456 in its arguments is refused", async () => {
    const input = { invoice: "dsor://org_456/invoice/INV-1008", tenant: "org_456" };
    expect(await call(registry, log, FIRM_IN_789, "invoice.get", input)).toStrictEqual(
      refused("TENANT_MISMATCH", otherTenant("tenant"), THE_FIRM),
    );
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
    const real = await call(registry, log, agentIn("org_789"), "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    const none = await call(registry, log, agentIn("org_999"), "invoice.get", {
      invoice: "dsor://org_999/invoice/INV-1008",
    });
    expect(withoutRequestId(real)).toStrictEqual(withoutRequestId(none));
    // Found by the review: "the same" alone passed with the membership check deleted, when
    // both became line ⑤'s refusal. The same, and the right refusal.
    expect(real).toStrictEqual(refused("AUTHORIZATION_DENIED", NOT_A_MEMBER, THE_AGENT));
  });

  it("DSOR-ERR-01b: org_789's INV-1008 and org_789's NOPE get the same refusal, word for word", async () => {
    const real = await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_1008);
    const none = await call(registry, log, SUPERVISOR, "invoice.issue", FOREIGN_NOPE);
    expect(withoutRequestId(real)).toStrictEqual(withoutRequestId(none));
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
      data: INV_1008_OF_456,
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

  it.each([
    ["the agent in org_456", AGENT, "org_456"],
    ["the firm's agent in org_789", FIRM_IN_789, "org_789"],
  ])("DSOR-TEN-01a: a call by %s is recorded with its company", async (_who, request, tenant) => {
    const fresh = createLog();
    await call(registry, fresh, request, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(await fresh.records()).toMatchObject([{ tenant }]);
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
