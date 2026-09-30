// The cross-tenant suite learns lists (step 13's README, C5 and decision
// 6). A list names no single thing, so there is no URI to swap. The suite checks its rows
// instead: every item must carry the caller's company. Each test plants one list,
// invoice.browse, beside the shipped operations. Step 12's invoice.peek test, an operation
// with no URI whose answer is not a page, stays in cross-tenant.test.ts, word for word.
import { describe, expect, it } from "vitest";
import { invoices, type Invoice } from "../src/invoice.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import { crossTenantSuite, readExamples, type Report, type Send } from "./cross-tenant.ts";
import {
  INV_2001_OF_789,
  contract,
  handlers,
  shipped,
  shippedInputs,
  shippedRoles,
  source,
} from "./helpers.ts";

// The callers of each company who may read, in the order of DSoR's table of logins.
const READERS_456 = ["accounts-payable-fte", "user_123", "cfo_100", "firm-ap-fte"];
const READERS_789 = ["firm-ap-fte", "user_700"];

/**
 * The suite's report, with invoice.browse planted: a list whose code is this handler. A
 * query unless the test asks for a command, and written to this log.
 */
function suiteWithList(
  handler: Handler,
  kind: "query" | "command" = "query",
  log: MemoryLog = createLog(),
  // NEW IN STEP 14: DSoR itself, unless the test hands the suite a fake one.
  send: Send = call,
): Promise<Report> {
  // A query that needs invoice:read, as invoice.get does, or a command that needs
  // invoice:issue, as invoice.issue does. Its input is a limit, and no URI.
  const browse = {
    ...contract(kind === "query" ? "invoice.get" : "invoice.issue"),
    id: "invoice.browse",
    input: { schema: "InvoiceBrowseRequest" },
    // NEW IN STEP 14: a list answers a page, and its contract says so, as invoice.list's
    // does. Each field of the page is then masked by its own label (step 14's README,
    // decision 1).
    output: { schema: "InvoicePage" },
  };
  const input = {
    type: "object",
    properties: { limit: { type: "integer" } },
    additionalProperties: false,
  };
  const registry = buildRegistry(
    [...shipped, source(browse, "invoice.browse.json")],
    { ...handlers, "invoice.browse": handler },
    shippedRoles,
    [...shippedInputs, source(input, "InvoiceBrowseRequest.schema.json")],
  );
  const examples = [
    ...readExamples(),
    { file: "invoice.browse.json", text: JSON.stringify({ limit: 10 }) },
  ];
  return crossTenantSuite(registry, log, examples, send);
}

/** This company's invoices, in memory. */
function own(tenant: string): Invoice[] {
  return invoices.filter((invoice) => invoice.tenant_id === tenant);
}

/** The finding for one caller of invoice.browse, in one company. */
function finding(who: string, home: string, why: string): string {
  return `invoice.browse as ${who} in ${home}: ${why}`;
}

// A list is also asked with only the fields its input
// schema requires, {} here (step 13's README, decision 6).
/** The same finding, for the list asked with its example, then asked bare. */
function twice(who: string, home: string, why: string): string[] {
  const bare = `invoice.browse as ${who} in ${home}, asked with only its required fields: ${why}`;
  return [finding(who, home, why), bare];
}

describe("C5: a list, with no URI to swap, is checked by its rows", () => {
  it("DSOR-TEN-02b: a list whose every item carries the caller's company gives no finding", async () => {
    const report = await suiteWithList(async (_input, tenant) => ({ items: own(tenant) }));
    expect(report.findings).toStrictEqual([]);
    expect(report.attacked).toContain("invoice.browse");
  });

  it("DSOR-IDN-03b: a list that hands org_456 one of org_789's invoices is a finding, for each caller of org_456", async () => {
    const report = await suiteWithList(async (_input, tenant) => ({
      items: tenant === "org_456" ? [...own(tenant), INV_2001_OF_789] : own(tenant),
    }));
    // Step 12's search of the answer finds it too (its C8), so each caller has two findings.
    const foreign = `its same-company call answered with another company's data: tenant_id "org_789"`;
    expect(report.findings).toStrictEqual(
      READERS_456.flatMap((who) => [
        finding(who, "org_456", foreign),
        ...twice(who, "org_456", `items[12] carries tenant_id "org_789", not "org_456"`),
      ]),
    );
  });

  // NEW IN STEP 14: DSoR itself refuses this answer now, to everyone. With no tenant_id, an
  // item has no URI for the record of the read (step 14's README, decision 7). The suite
  // hears no page, and says so: still a finding, step 12's, word for word.
  it("DSOR-TEN-02b: a list whose items carry no tenant_id is a finding: DSoR refuses its answer", async () => {
    const report = await suiteWithList(async (_input, tenant) => ({
      items: own(tenant).map(({ tenant_id: _left_out, ...rest }) => rest),
    }));
    expect(report.findings).toStrictEqual(["invoice.browse: no URI of org_456 in its example"]);
  });

  // NEW IN STEP 14: the suite's own check, which DSoR no longer lets such a page reach. A
  // fake DSoR answers the page anyway, as a DSoR without step 14's record would.
  it("DSOR-TEN-02b: a list whose items carry no tenant_id is a finding: their company cannot be checked", async () => {
    const noRecord: Send = async (registry, log, request, name, input) =>
      name === "invoice.browse"
        ? {
            data: {
              items: own(String(request.tenant)).map(({ tenant_id: _left_out, ...rest }) => rest),
            },
            classification: "internal",
            correlation: { request_id: "req_fake" },
          }
        : call(registry, log, request, name, input);
    const report = await suiteWithList(async () => ({ items: [] }), "query", createLog(), noRecord);
    const why = "items[0] has no tenant_id, so its company cannot be checked";
    expect(report.findings).toStrictEqual([
      ...READERS_456.flatMap((who) => twice(who, "org_456", why)),
      ...READERS_789.flatMap((who) => twice(who, "org_789", why)),
    ]);
  });

  // A list with no company filter answers an empty page too, when nothing is left to read.
  it("DSOR-TEN-02b: a list that answers an empty page is a finding: it checks nothing", async () => {
    const report = await suiteWithList(async () => ({ items: [] }));
    const why = "its answer is a page with no items, so it checks nothing";
    expect(report.findings).toStrictEqual([
      ...READERS_456.flatMap((who) => twice(who, "org_456", why)),
      ...READERS_789.flatMap((who) => twice(who, "org_789", why)),
    ]);
  });

  // Found by the review: the example always carries a cursor, so the path with no cursor
  // was never asked.
  it("DSOR-IDN-03b: a list that forgets the company only when asked with nothing is a finding", async () => {
    const report = await suiteWithList(async (input, tenant) => ({
      items: (input as { limit?: number }).limit === undefined ? invoices : own(tenant),
    }));
    // invoices holds org_456's INV-1008 first, then org_789's.
    const bare = (who: string, home: string, why: string): string =>
      `invoice.browse as ${who} in ${home}, asked with only its required fields: ${why}`;
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) =>
        bare(who, "org_456", `items[1] carries tenant_id "org_789", not "org_456"`),
      ),
      ...READERS_789.map((who) =>
        bare(who, "org_789", `items[0] carries tenant_id "org_456", not "org_789"`),
      ),
    ]);
  });

  // Found by the review: the suite ran an operation to learn whether it answers with a
  // page. A command that runs would change something (step 13's README, decision 6).
  it("DSOR-TEN-02b: a command whose example holds no URI is step 12's finding, and is never called", async () => {
    const log = createLog();
    const report = await suiteWithList(async () => ({ items: [] }), "command", log);
    expect(report.findings).toStrictEqual(["invoice.browse: no URI of org_456 in its example"]);
    const calls = (await log.records()).filter((r) => r.operation === "invoice.browse@1");
    expect(calls).toStrictEqual([]);
  });

  // Found by the sweep: with "not a page" answered as no finding, every test stayed green.
  // The first question is asked in org_456 only, so org_789's answer is checked here.
  it("DSOR-TEN-02b: a list that answers org_789 with one invoice, not a page, is a finding there", async () => {
    const report = await suiteWithList(async (_input, tenant) =>
      tenant === "org_456" ? { items: own(tenant) } : own(tenant)[0],
    );
    const why = "its answer is not a page";
    expect(report.findings).toStrictEqual(READERS_789.flatMap((who) => twice(who, "org_789", why)));
  });
});
