// NEW IN STEP 13: the cross-tenant suite learns lists (step 13's README, C5 and decision
// 6). A list names no single thing, so there is no URI to swap. The suite checks its rows
// instead: every item must carry the caller's company. Each test plants one list,
// invoice.browse, beside the shipped operations. Step 12's invoice.peek test, an operation
// with no URI whose answer is not a page, stays in cross-tenant.test.ts, word for word.
import { describe, expect, it } from "vitest";
import { invoices, type Invoice } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import { crossTenantSuite, readExamples, type Report } from "./cross-tenant.ts";
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

/** The suite's report, with invoice.browse planted: a list whose code is this handler. */
function suiteWithList(handler: Handler): Promise<Report> {
  // A query that needs invoice:read, as invoice.get does. Its input is a limit, and no URI.
  const browse = {
    ...contract("invoice.get"),
    id: "invoice.browse",
    input: { schema: "InvoiceBrowseRequest" },
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
  return crossTenantSuite(registry, createLog(), examples);
}

/** This company's invoices, in memory. */
function own(tenant: string): Invoice[] {
  return invoices.filter((invoice) => invoice.tenant_id === tenant);
}

/** The finding for one caller of invoice.browse, in one company. */
function finding(who: string, home: string, why: string): string {
  return `invoice.browse as ${who} in ${home}: ${why}`;
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
        finding(who, "org_456", `items[12] carries tenant_id "org_789", not "org_456"`),
      ]),
    );
  });

  it("DSOR-TEN-02b: a list whose items carry no tenant_id is a finding: their company cannot be checked", async () => {
    const report = await suiteWithList(async (_input, tenant) => ({
      items: own(tenant).map(({ tenant_id: _left_out, ...rest }) => rest),
    }));
    const why = "items[0] has no tenant_id, so its company cannot be checked";
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => finding(who, "org_456", why)),
      ...READERS_789.map((who) => finding(who, "org_789", why)),
    ]);
  });

  // A list with no company filter answers an empty page too, when nothing is left to read.
  it("DSOR-TEN-02b: a list that answers an empty page is a finding: it checks nothing", async () => {
    const report = await suiteWithList(async () => ({ items: [] }));
    const why = "its answer is a page with no items, so it checks nothing";
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => finding(who, "org_456", why)),
      ...READERS_789.map((who) => finding(who, "org_789", why)),
    ]);
  });
});
