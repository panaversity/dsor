// The cross-tenant suite learns lists (step 13's README, C5 and decision
// 6). A list names no single thing, so there is no URI to swap. The suite checks its rows
// instead: every item must carry the caller's company. Each test plants one list,
// invoice.browse, beside the shipped operations. Step 12's invoice.peek test, an operation
// with no URI whose answer is not a page, stays in cross-tenant.test.ts, word for word.
import { describe, expect, it } from "vitest";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import { createLog, type MemoryLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import { crossTenantSuite, readExamples, type Report, type Send } from "./cross-tenant.ts";
import {
  A_MEMORY_READ,
  afterARead,
  contract,
  handlers,
  INV_2001_OF_789,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  source,
  testSlips,
  storyDirectories,
} from "./helpers.ts";

// The callers of each company who may read, in the order of DSoR's table of logins.
const READERS_456 = ["accounts-payable-fte", "user_123", "cfo_100", "firm-ap-fte"];
const READERS_789 = ["firm-ap-fte", "user_700"];

/**
 * The suite's report, with invoice.browse planted: a list whose code is this handler. A
 * query unless the test asks for a command, and written to this log.
 */
/**
 * The suite's report with the shipped invoice.list's code replaced by this one. Its
 * contract, input schema, and example stay the shipped ones, so it is asked as invoice.list
 * is, with a cursor.
 */
function suiteWithListCode(handler: Handler, send: Send = call): Promise<Report> {
  const registry = buildRegistry(
    shipped,
    { ...handlers, "invoice.list": handler },
    shippedRoles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(),
    undefined,
    // Step 18: and the slips, so the agents call under them (step 18's README, decision 2).
    testSlips(),
    // NEW IN STEP 19: and the story's directories (step 19's README, decision 2).
    storyDirectories(),
  );
  return crossTenantSuite(registry, createLog(), readExamples(), send);
}

function suiteWithList(
  handler: Handler,
  kind: "query" | "command" = "query",
  log: MemoryLog = createLog(),
  // DSoR itself, unless the test hands the suite a fake one.
  send: Send = call,
): Promise<Report> {
  // A query that needs invoice:read, as invoice.get does, or a command that needs
  // invoice:issue, as invoice.issue does. Its input is a limit, and no URI.
  const browse = {
    ...contract(kind === "query" ? "invoice.get" : "invoice.issue"),
    id: "invoice.browse",
    input: { schema: "InvoiceBrowseRequest" },
    // A list answers a page, and its contract says so, as invoice.list's
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
    // The code reads once first, so a page it makes is not refused for
    // reading nothing (step 15's README, decision 6).
    { ...handlers, "invoice.browse": afterARead(handler) },
    shippedRoles,
    [...shippedInputs, source(input, "InvoiceBrowseRequest.schema.json")],
    shippedLabels,
    // The invoices in memory: the registry holds the store (step 10's README, decision 13).
    // Found by the Stage 2 review, and fixed from step 10 on.
    memoryInvoices(),
    undefined,
    // Step 18: and the slips, so the agents call under them (step 18's README, decision 2).
    testSlips(),
    // NEW IN STEP 19: and the story's directories (step 19's README, decision 2).
    storyDirectories(),
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
    const report = await suiteWithList(async (_input, company) => ({
      items: own(company.tenant),
    }));
    expect(report.findings).toStrictEqual([]);
    expect(report.attacked).toContain("invoice.browse");
  });

  // Since the Stage 2 review, the pipeline itself refuses a page that holds a row of
  // another company, with INTERNAL_ERROR (step 10's README, decision 14). So the suite's one
  // question, asked in org_456, gets no page, and the list gets step 12's finding (decision
  // 6). Found by the Stage 2 review, and fixed from step 10 on.
  it("DSOR-IDN-03b: a list that hands org_456 one of org_789's invoices is a finding, for each caller of org_456", async () => {
    const report = await suiteWithList(async (_input, { tenant }) => ({
      items: tenant === "org_456" ? [...own(tenant), INV_2001_OF_789] : own(tenant),
    }));
    expect(report.findings).toStrictEqual(["invoice.browse: no URI of org_456 in its example"]);
  });

  // The suite must not lean on the pipeline's check: it is the third layer. So a fake DSoR
  // slips org_789's INV-2001 into each page org_456 gets, after the pipeline has checked it,
  // as if that check were gone. The suite's own row check names it on both calls. Found by
  // the Stage 2 review, and fixed from step 13 on.
  it("DSOR-IDN-03b: handed a fake DSoR that slips one of org_789's invoices into org_456's pages, the suite names it for each caller of org_456", async () => {
    const slips: Send = async (reg, log, request, name, input) => {
      const answer = await call(reg, log, request, name, input);
      if (name !== "invoice.browse" || request.tenant !== "org_456" || !("data" in answer)) {
        return answer;
      }
      const { items } = answer.data as { items: unknown[] };
      return { ...answer, data: { items: [...items, INV_2001_OF_789] } };
    };
    const report = await suiteWithList(
      async (_input, { tenant }) => ({ items: own(tenant) }),
      "query",
      createLog(),
      slips,
    );
    // Step 12's search of the answer finds it too (its C8), on both calls since the Stage 2
    // review, so each caller has four findings.
    const foreign = `its same-company call answered with another company's data: tenant_id "org_789"`;
    const bare = `asked with only its required fields: answered with another company's data: tenant_id "org_789"`;
    const item = `items[12] carries tenant_id "org_789", not "org_456"`;
    expect(report.findings).toStrictEqual(
      READERS_456.flatMap((who) => [
        finding(who, "org_456", foreign),
        finding(who, "org_456", item),
        `invoice.browse as ${who} in org_456, ${bare}`,
        `invoice.browse as ${who} in org_456, asked with only its required fields: ${item}`,
      ]),
    );
  });

  // A row whose tenant_id is rewritten to the caller's passes the pipeline's answer check
  // and the item check. Only the search for the other company's canaries finds it: in the
  // same-company call, and in the page of the bare call, which the suite did not search
  // (step 12's README, decision 8). Found by the Stage 2 review, and fixed from step 13 on.
  it("DSOR-IDN-03b: a list that hands each company the other's INV-1008, its tenant_id rewritten, is a finding on both calls", async () => {
    const report = await suiteWithList(async (_input, { tenant }) => {
      const theirs = invoices.find((i) => i.id === "INV-1008" && i.tenant_id !== tenant)!;
      return { items: [...own(tenant), { ...theirs, tenant_id: tenant }] };
    });
    const said = "answered with another company's data";
    const both = (who: string, home: string, what: string): string[] => [
      finding(who, home, `its same-company call ${said}: ${what}`),
      `invoice.browse as ${who} in ${home}, asked with only its required fields: ${said}: ${what}`,
    ];
    expect(report.findings).toStrictEqual([
      ...READERS_456.flatMap((who) => both(who, "org_456", '"VENDOR-77"')),
      ...READERS_789.flatMap((who) => both(who, "org_789", '"VENDOR-44"')),
    ]);
  });

  // DSoR itself refuses this answer now, to everyone. With no tenant_id, an
  // item has no URI for the record of the read (step 14's README, decision 7). The suite
  // hears no page, and says so: still a finding, step 12's, word for word.
  it("DSOR-TEN-02b: a list whose items carry no tenant_id is a finding: DSoR refuses its answer", async () => {
    const report = await suiteWithList(async (_input, { tenant }) => ({
      items: own(tenant).map(({ tenant_id: _left_out, ...rest }) => rest),
    }));
    expect(report.findings).toStrictEqual(["invoice.browse: no URI of org_456 in its example"]);
  });

  // The suite's own check, which DSoR no longer lets such a page reach. A
  // fake DSoR answers the page anyway, as a DSoR without step 14's record would.
  it("DSOR-TEN-02b: a list whose items carry no tenant_id is a finding: their company cannot be checked", async () => {
    const noRecord: Send = async (registry, log, request, name, input) =>
      name === "invoice.browse"
        ? {
            data: {
              items: own(String(request.tenant)).map(({ tenant_id: _left_out, ...rest }) => rest),
            },
            classification: "internal",
            freshness: A_MEMORY_READ,
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
  // Since the Stage 2 review, the pipeline refuses the bare call's page, which holds both
  // companies' rows, with INTERNAL_ERROR (step 10's README, decision 14). The finding still
  // shows that the bare call was made. Found by the Stage 2 review, and fixed from step 10
  // on.
  it("DSOR-IDN-03b: a list that forgets the company only when asked with nothing is a finding", async () => {
    const report = await suiteWithList(async (input, { tenant }) => ({
      items: (input as { limit?: number }).limit === undefined ? invoices : own(tenant),
    }));
    const bare = (who: string, home: string): string =>
      `invoice.browse as ${who} in ${home}, asked with only its required fields: it is not answered with data: INTERNAL_ERROR`;
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => bare(who, "org_456")),
      ...READERS_789.map((who) => bare(who, "org_789")),
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
    const report = await suiteWithList(async (_input, { tenant }) =>
      tenant === "org_456" ? { items: own(tenant) } : own(tenant)[0],
    );
    // Since the Stage 2 review, DSoR refuses this answer itself, for everyone: an invoice's
    // amount is an object, and an InvoicePage has no line for amount, so nothing labels the
    // keys inside it (step 14's README, decision 3). Still a finding, from both calls. Found
    // by the Stage 2 review, and fixed from step 14 on.
    const refused = "is not answered with data: INTERNAL_ERROR";
    expect(report.findings).toStrictEqual(
      READERS_789.flatMap((who) => [
        finding(who, "org_789", `its same-company call ${refused}`),
        `invoice.browse as ${who} in org_789, asked with only its required fields: it ${refused}`,
      ]),
    );
  });
});

describe("C5: every page of a list is checked, not only the first", () => {
  // The shipped invoice.list's own code.
  const listCode = handlers["invoice.list"]!;

  /** The shipped list's code, with this row added to the end of org_456's page 2. */
  function slipsOntoPage2(row: unknown): Handler {
    return async (input, company) => {
      const page = (await listCode(input, company)) as { items: unknown[] };
      // Page 2 of org_456's list starts after INV-1010.
      const second = (input as { cursor?: string }).cursor === "INV-1010";
      if (!second || company.tenant !== "org_456") return page;
      return { ...page, items: [...page.items, row] };
    };
  }

  /** The two findings for each caller of org_456: one for each call's page 2. */
  function onPage2(why: string): string[] {
    return READERS_456.flatMap((who) => [
      `invoice.list as ${who} in org_456, page 2: ${why}`,
      `invoice.list as ${who} in org_456, asked with only its required fields, page 2: ${why}`,
    ]);
  }

  // The suite read only page 1 of a list. A list that slipped a row of org_789 onto page 2
  // gave no finding. Now the suite follows next_cursor, from the example and from the bare
  // call, and checks every page as it checks the first (step 13's README, decision 6). The
  // row as it is, the pipeline refuses as a bug (step 10's README, decision 14). With its
  // tenant_id rewritten, only the search for canaries can see it. Found by the Stage 2
  // review, and fixed from step 13 on.
  it.each([
    ["org_789's INV-2001", INV_2001_OF_789, "it is not answered with data: INTERNAL_ERROR"],
    [
      "org_789's INV-2001, its tenant_id rewritten,",
      { ...INV_2001_OF_789, tenant_id: "org_456" },
      `answered with another company's data: "INV-2001"`,
    ],
  ])(
    "DSOR-IDN-03b: a list that slips %s onto org_456's page 2 is a finding, from both calls",
    async (_what, row, why) => {
      const report = await suiteWithListCode(slipsOntoPage2(row));
      expect(report.findings).toStrictEqual(onPage2(why));
    },
  );

  // The leaks above sit on page 2, so a walk that checked only pages 1 and 2 passed every
  // test. This list holds one row a page and ends on page 10, the last page the walk reads,
  // with org_789's INV-2001 there. A check that stops at any page before it misses the leak.
  // Found by the orchestrator's hostile check of the Stage 2 review's fix, and fixed from
  // step 13 on.
  it("DSOR-IDN-03b: a list that slips org_789's INV-2001 onto page 10, its last, is a finding, from both calls", async () => {
    const report = await suiteWithListCode(async (input, company) => {
      // One row a page, whatever the caller asks for.
      const page = (await listCode({ ...(input as object), limit: 1 }, company)) as {
        items: { id: string }[];
      };
      // org_456's tenth invoice, INV-1010, ends its list: page 10, with no cursor.
      if (company.tenant !== "org_456" || page.items[0]?.id !== "INV-1010") return page;
      return { items: [...page.items, INV_2001_OF_789] };
    });
    const why = "it is not answered with data: INTERNAL_ERROR";
    expect(report.findings).toStrictEqual(
      READERS_456.flatMap((who) => [
        `invoice.list as ${who} in org_456, page 10: ${why}`,
        `invoice.list as ${who} in org_456, asked with only its required fields, page 10: ${why}`,
      ]),
    );
  });

  // A row with no tenant_id holds no canary, so only the check of the items can name it.
  // Found by a check of this fix: with page 2's items left unchecked, every test passed.
  // Fixed from step 13 on. In step 14, DSoR refuses such a row itself: it has no URI for the
  // record of the read (step 14's README, decision 7). So a fake DSoR slips it onto page 2
  // after the pipeline has checked the page, as a DSoR without that record would.
  it("DSOR-TEN-02b: a list that slips a row with no tenant_id onto org_456's page 2 is a finding, from both calls", async () => {
    const slipsAfter: Send = async (reg, log, request, name, input) => {
      const answer = await call(reg, log, request, name, input);
      const second = (input as { cursor?: string }).cursor === "INV-1010";
      if (name !== "invoice.list" || request.tenant !== "org_456" || !second) return answer;
      if (!("data" in answer)) return answer;
      const page = answer.data as { items: unknown[] };
      return { ...answer, data: { ...page, items: [...page.items, { id: "INV-1013" }] } };
    };
    const report = await suiteWithListCode(listCode, slipsAfter);
    const why = "items[2] has no tenant_id, so its company cannot be checked";
    expect(report.findings).toStrictEqual(onPage2(why));
  });

  // A cursor that never ends would keep the suite asking forever. The walk stops after 10
  // pages, the first one included, and names the list: the pages after them were not
  // checked. Found by the Stage 2 review, and fixed from step 13 on.
  it("DSOR-TEN-02b: a list whose cursor never ends is read for 10 pages from each call, then named", async () => {
    let calls = 0;
    // What the agent sends, the first reader of org_456 in DSoR's table of logins.
    const agentSent: unknown[] = [];
    const counting: Send = (reg, log, request, name, input) => {
      if (name === "invoice.list") calls += 1;
      if (name === "invoice.list" && request.token === "tok_7f3a") agentSent.push(input);
      return call(reg, log, request, name, input);
    };
    // Every page says that another follows, after INV-1008: the same page, again and again.
    // Both companies hold an INV-1008, so the cursor is no canary of either.
    const report = await suiteWithListCode(
      async (input, company) => ({
        ...((await listCode(input, company)) as object),
        next_cursor: "INV-1008",
      }),
      counting,
    );
    const said =
      "its cursor had not ended after 10 pages, so the pages after them were not checked";
    const both = (who: string, home: string): string[] => [
      `invoice.list as ${who} in ${home}: ${said}`,
      `invoice.list as ${who} in ${home}, asked with only its required fields: ${said}`,
    ];
    expect(report.findings).toStrictEqual([
      ...READERS_456.flatMap((who) => both(who, "org_456")),
      ...READERS_789.flatMap((who) => both(who, "org_789")),
    ]);
    // Decision 6's one question, then 10 pages from each of the two calls, for each of the
    // 6 readers.
    expect(calls).toBe(1 + 6 * 2 * 10);
    // Each page after the first is the same input again, with the cursor the page before
    // gave. Found by a check of this fix: a walk that sent the cursor alone passed every
    // test.
    const example = { limit: 10, cursor: "INV-1000" };
    expect(agentSent).toStrictEqual([
      // Decision 6's one question, then the example call: its page 1, then pages 2 to 10.
      example,
      example,
      ...Array.from({ length: 9 }, () => ({ limit: 10, cursor: "INV-1008" })),
      // The bare call: its page 1, then pages 2 to 10.
      {},
      ...Array.from({ length: 9 }, () => ({ cursor: "INV-1008" })),
    ]);
  });
});
