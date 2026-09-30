// The cross-tenant suite, by claim (C1 to C8 in step 12's README). It runs
// over the shipped registry, over registries with one fake operation planted in each, and
// with fake DSoRs. The invoices are in memory, so `pnpm check`, and CI, run it on every
// push. test/cross-tenant.db.test.ts runs it again on the database.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Refusal, type Answer, type ErrorCode } from "../src/envelope.ts";
import { invoices, memoryInvoices, type Invoice } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import {
  buildRegistry,
  type ContractSource,
  type Handler,
  type Registry,
} from "../src/registry.ts";
import { parseUri } from "../src/uri.ts";
import { foreignIn, swaps } from "./companies.ts";
import {
  attackersOf,
  compare,
  crossTenantSuite,
  judge,
  readExamples,
  type Report,
  type Send,
} from "./cross-tenant.ts";
import {
  FOREIGN_URI,
  INV_1008_OF_456,
  contract,
  handlers,
  registry,
  shipped,
  shippedInputs,
  shippedRoles,
  source,
} from "./helpers.ts";

// The examples this step ships, one for each operation.
const examples = readExamples();

// A good example for a planted operation that takes invoice.get's input.
const GOOD = { invoice: "dsor://org_456/invoice/INV-1008" };

// The callers of each company who may read, in the order of DSoR's table of logins.
const READERS_456 = ["accounts-payable-fte", "user_123", "cfo_100", "firm-ap-fte"];
const READERS_789 = ["firm-ap-fte", "user_700"];

/** One fake operation to plant beside the shipped ones, only inside one test. */
type Plant = {
  id: string;
  // invoice:read unless the test names another.
  permission?: string;
  // invoice.get's input schema unless the test gives one of its own.
  input?: { name: string; schema: object };
  handler?: Handler;
  // The text of its example file. None means the file is missing.
  example?: string;
  // NEW IN STEP 14: the kind its answer is. An Invoice, as invoice.get's, unless the test
  // names another (step 14's README, decision 1).
  output?: string;
};

/** The shipped registry and examples, with one planted operation added. */
function plant(p: Plant): { registry: Registry; examples: ContractSource[] } {
  const planted = {
    ...contract("invoice.get"),
    id: p.id,
    authorization: { permission: p.permission ?? "invoice:read" },
    input: { schema: p.input?.name ?? "InvoiceGetRequest" },
    output: { schema: p.output ?? "Invoice" },
  };
  const inputs =
    p.input === undefined
      ? shippedInputs
      : [...shippedInputs, source(p.input.schema, `${p.input.name}.schema.json`)];
  const code = p.handler === undefined ? handlers : { ...handlers, [p.id]: p.handler };
  return {
    registry: buildRegistry(
      [...shipped, source(planted, `${p.id}.json`)],
      code,
      shippedRoles,
      inputs,
    ),
    examples:
      p.example === undefined ? examples : [...examples, { file: `${p.id}.json`, text: p.example }],
  };
}

/** The suite's report over a registry and its examples, with a log of its own. */
function suiteOver(
  target: { registry: Registry; examples: ContractSource[] },
  send?: Send,
): Promise<Report> {
  return crossTenantSuite(target.registry, createLog(), target.examples, send);
}

/** An input schema whose fields each take a canonical URI. */
function uriFields(required: string[], optional: string[] = []): object {
  const uri = { $ref: "urn:dsor:schema:1.3:common#/$defs/resourceUri" };
  const fields = [...required, ...optional].map((field) => [field, uri]);
  return {
    type: "object",
    properties: Object.fromEntries(fields),
    required,
    additionalProperties: false,
  };
}

describe("C1: every operation in the registry is attacked with foreign URIs, and refused", () => {
  it("DSOR-TEN-02b: the shipped registry: every operation attacked from both companies, 27 swaps, no findings", async () => {
    const report = await crossTenantSuite(registry, createLog(), examples);
    expect(report.findings).toStrictEqual([]);
    // Typed out, and the registry's own list: nothing skipped. invoice.list
    // has no URI to swap. Its rows are checked instead, and it adds no swap below.
    expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue", "invoice.list"]);
    expect(report.attacked).toStrictEqual([...registry.contracts.keys()]);
    // In org_456: invoice.get has 4 callers, invoice.issue 1. In org_789: 2 and 2.
    // Each example has 1 URI, sent 3 ways: (4 + 1 + 2 + 2) × 3 = 27.
    expect(report.attacks).toHaveLength(27);
    expect(new Set(report.attacks.map((attack) => attack.request_id)).size).toBe(27);
    expect(report.attacks.filter((attack) => attack.home === "org_789")).toHaveLength(12);
  });

  // As if step 10's URI check were gone (break W1): the fake answers every request with
  // the invoice of the company the call works in. Found by the review: with the suite's
  // call to its judge deleted, every test stayed green.
  it("DSOR-TEN-02b: handed a fake DSoR with no URI check, the suite names every one of the 27 attacks", async () => {
    // A list has no URI to check, so its calls go to DSoR itself.
    const noUriCheck: Send = async (reg, log, request, name, input) =>
      name === "invoice.list"
        ? call(reg, log, request, name, input)
        : {
            data: { tenant_id: request.tenant, id: "INV-1008" },
            correlation: { request_id: `req_${randomUUID()}` },
          };
    const report = await crossTenantSuite(registry, createLog(), examples, noUriCheck);
    expect(report.findings).toHaveLength(27);
    for (const finding of report.findings) {
      expect(finding).toMatch(/: answered with data, not TENANT_MISMATCH$/);
    }
    // The wording is part of the test (decision 5), so the first caller's three are typed
    // out. Found by the sweep: a finding that named the wrong way passed every test.
    const first = "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008";
    const said = "answered with data, not TENANT_MISMATCH";
    expect(report.findings.slice(0, 3)).toStrictEqual([
      `${first} sent to org_789, with the same id: ${said}`,
      `${first} sent to org_789, with an id it does not have: ${said}`,
      `${first} sent to org_999, which does not exist: ${said}`,
    ]);
  });

  it("DSOR-TEN-02b: an example with two URIs is attacked one URI at a time, three ways each", () => {
    const invoice = "dsor://org_456/invoice/INV-1008";
    const vendor = "dsor://org_456/vendor/VENDOR-44";
    expect(swaps({ invoice, vendor }, "org_456")).toStrictEqual([
      {
        uri: invoice,
        requests: [
          { invoice: "dsor://org_789/invoice/INV-1008", vendor },
          { invoice: "dsor://org_789/invoice/NOPE", vendor },
          { invoice: "dsor://org_999/invoice/INV-1008", vendor },
        ],
      },
      {
        uri: vendor,
        requests: [
          { invoice, vendor: "dsor://org_789/vendor/VENDOR-44" },
          { invoice, vendor: "dsor://org_789/vendor/NOPE" },
          { invoice, vendor: "dsor://org_999/vendor/VENDOR-44" },
        ],
      },
    ]);
  });

  // Found by the review: with only the first URI of each example attacked, every test
  // stayed green, because swaps() was tested and the suite's use of it was not.
  it("DSOR-TEN-02b: the suite sends all six swaps of a two-URI example, after the same-company call", async () => {
    const invoice = "dsor://org_456/invoice/INV-1008";
    const vendor = "dsor://org_456/vendor/VENDOR-44";
    const target = plant({
      id: "invoice.match",
      input: { name: "InvoiceMatchRequest", schema: uriFields(["invoice", "vendor"]) },
      // invoice.get's code, which reads the invoice, so a same-company call answers with
      // data, as a query's must (step 12's README, decision 8).
      handler: handlers["invoice.get"]!,
      example: JSON.stringify({ invoice, vendor }),
    });
    const sent: unknown[] = [];
    const recording: Send = (reg, log, request, name, input) => {
      if (name === "invoice.match" && request.token === "tok_7f3a") sent.push(input);
      return call(reg, log, request, name, input);
    };
    const report = await suiteOver(target, recording);
    expect(report.findings).toStrictEqual([]);
    expect(sent).toStrictEqual([
      { invoice, vendor },
      { invoice: "dsor://org_789/invoice/INV-1008", vendor },
      { invoice: "dsor://org_789/invoice/NOPE", vendor },
      { invoice: "dsor://org_999/invoice/INV-1008", vendor },
      { invoice, vendor: "dsor://org_789/vendor/VENDOR-44" },
      { invoice, vendor: "dsor://org_789/vendor/NOPE" },
      { invoice, vendor: "dsor://org_999/vendor/VENDOR-44" },
    ]);
  });

  it("DSOR-TEN-02b: working in org_789, the swaps go to org_456 and org_999", () => {
    expect(swaps({ invoice: "dsor://org_789/invoice/INV-1008" }, "org_789")).toStrictEqual([
      {
        uri: "dsor://org_789/invoice/INV-1008",
        requests: [
          { invoice: "dsor://org_456/invoice/INV-1008" },
          { invoice: "dsor://org_456/invoice/NOPE" },
          { invoice: "dsor://org_999/invoice/INV-1008" },
        ],
      },
    ]);
  });

  it("DSOR-TEN-02b: a URI inside a list is found and swapped too, and the example is left as it was", () => {
    const example = { lines: [{ invoice: "dsor://org_456/invoice/INV-1008" }], note: "rush" };
    const requests = swaps(example, "org_456").flatMap((swap) => swap.requests);
    expect(requests).toStrictEqual([
      { lines: [{ invoice: "dsor://org_789/invoice/INV-1008" }], note: "rush" },
      { lines: [{ invoice: "dsor://org_789/invoice/NOPE" }], note: "rush" },
      { lines: [{ invoice: "dsor://org_999/invoice/INV-1008" }], note: "rush" },
    ]);
    expect(example).toStrictEqual({
      lines: [{ invoice: "dsor://org_456/invoice/INV-1008" }],
      note: "rush",
    });
  });

  // Found by the review and the sweep: without the "^", the "$", or with any text allowed as
  // the kind, the suite's pattern swapped these, and every test stayed green.
  it.each([
    ["a text that only contains a URI", "see dsor://org_456/invoice/INV-1008"],
    ["a URI with a fourth part", "dsor://org_456/invoice/INV-1008/x"],
    ["a kind with a slash in it", "dsor://org_456/a/b/c"],
  ])("DSOR-TEN-02b: %s is not a URI, and is not swapped", (_what, text) => {
    expect(swaps({ note: text }, "org_456")).toStrictEqual([]);
  });

  // Found by the sweep: a search that stopped at the first text that is not a URI passed,
  // because every example put its URI first.
  it("DSOR-TEN-02b: a text before a URI does not stop the search", () => {
    const own = "dsor://org_456/invoice/INV-1008";
    const found = swaps({ note: "rush", invoice: own }, "org_456");
    expect(found.map((swap) => swap.uri)).toStrictEqual([own]);
  });

  it("DSOR-TEN-02b: an example that is a bare URI is swapped as a whole", () => {
    const own = "dsor://org_456/invoice/INV-1008";
    expect(swaps(own, "org_456")).toStrictEqual([
      {
        uri: own,
        requests: [
          "dsor://org_789/invoice/INV-1008",
          "dsor://org_789/invoice/NOPE",
          "dsor://org_999/invoice/INV-1008",
        ],
      },
    ]);
  });
});

describe("C2: the three foreign answers are the same, apart from the request id", () => {
  function refused(request_id: string, message: string = FOREIGN_URI): Answer {
    const correlation = { request_id, principal_id: "user_123" };
    return { code: "TENANT_MISMATCH", message, retry: "never", correlation };
  }

  it("DSOR-ERR-01b: three answers that differ only in their request ids are the same", () => {
    expect(compare([refused("req_1"), refused("req_2"), refused("req_3")])).toBeUndefined();
  });

  // Wherever the answer that differs stands. Found by the sweep: a comparer that skipped
  // the first answer, or the last, passed when the one that differed stood in the middle.
  it.each([[0], [1], [2]])(
    "DSOR-ERR-01b: three answers where answer %i differs are a finding",
    (odd) => {
      const answers = [0, 1, 2].map((i) =>
        refused(`req_${i}`, i === odd ? "org_789 has no invoice NOPE" : FOREIGN_URI),
      );
      expect(compare(answers)).toBe("the three answers differ");
    },
  );

  // A fake DSoR that tells the three apart: each refusal names what was sent. Found by the
  // review: with the suite's call to its comparer deleted, every test stayed green.
  it("DSOR-ERR-01b: handed a fake DSoR whose three answers differ, the suite names each caller and URI", async () => {
    const tells: Send = async (reg, log, request, name, input) => {
      const answer = await call(reg, log, request, name, input);
      if (!("code" in answer) || answer.code !== "TENANT_MISMATCH") return answer;
      return { ...answer, message: `${answer.message}: ${JSON.stringify(input)}` };
    };
    const report = await crossTenantSuite(registry, createLog(), examples, tells);
    // One for each caller and URI: 4 + 1 in org_456, and 2 + 2 in org_789.
    expect(report.findings).toHaveLength(9);
    for (const finding of report.findings) expect(finding).toMatch(/: the three answers differ$/);
  });
});

describe("C3: every principal who may call the operation attacks it, from each company", () => {
  it("DSOR-IDN-03b: in org_456, invoice.get is attacked by all four readers, the firm's agent included", () => {
    const ids = attackersOf(registry, "invoice.get", "org_456").map((attacker) => attacker.id);
    expect(ids).toStrictEqual(READERS_456);
  });

  // The firm's agent may issue in org_789, and not in org_456, so it is no attacker here.
  it("DSOR-IDN-03b: in org_456, invoice.issue is attacked by user_123 alone", () => {
    const ids = attackersOf(registry, "invoice.issue", "org_456").map((attacker) => attacker.id);
    expect(ids).toStrictEqual(["user_123"]);
  });

  // Found by the review: the suite worked in org_456 only, the firm's first company.
  it.each([["invoice.get"], ["invoice.issue"]])(
    "DSOR-IDN-03b: in org_789, %s is attacked by the firm's agent and user_700",
    (operation) => {
      const ids = attackersOf(registry, operation, "org_789").map((attacker) => attacker.id);
      expect(ids).toStrictEqual(READERS_789);
    },
  );
});

describe("C4: nothing is skipped: every gap is a finding", () => {
  const nobody = (home: string): string =>
    `invoice.void: nobody in ${home} holds invoice:void, so nobody can attack it there`;

  it.each([
    [
      "no example file",
      plant({ id: "invoice.approve" }),
      ["invoice.approve: no example request in examples/invoice.approve.json"],
    ],
    [
      "an example that is not JSON",
      plant({ id: "invoice.approve", example: "{ invoice: " }),
      ["invoice.approve: its example is not valid JSON"],
    ],
    [
      "an example whose only URI is org_789's",
      plant({
        id: "invoice.approve",
        example: JSON.stringify({ invoice: "dsor://org_789/invoice/INV-1008" }),
      }),
      ["invoice.approve: no URI of org_456 in its example"],
    ],
    [
      "an example that fails its own input schema",
      plant({ id: "invoice.approve", example: JSON.stringify({ ...GOOD, note: "rush" }) }),
      ["invoice.approve: its example does not pass its input schema"],
    ],
    // Found by the review: a field the example leaves out is never attacked.
    [
      "an example that leaves out a field its input schema lists",
      plant({
        id: "invoice.note",
        input: { name: "InvoiceNoteRequest", schema: uriFields(["invoice"], ["related"]) },
        example: JSON.stringify(GOOD),
      }),
      ['invoice.note: its example leaves out "related", which its input schema lists'],
    ],
    [
      "a permission that no role grants",
      plant({ id: "invoice.void", permission: "invoice:void", example: JSON.stringify(GOOD) }),
      [nobody("org_456"), nobody("org_789")],
    ],
    // Found by the review: a spelling mistake in an example's name went unseen.
    [
      "an example file that no operation names",
      { registry, examples: [...examples, { file: "invoice.gett.json", text: "{}" }] },
      ["examples/invoice.gett.json: no operation has this name"],
    ],
  ])(
    "DSOR-TEN-02b: %s is named, and the rest is still attacked",
    async (_gap, target, findings) => {
      const report = await suiteOver(target);
      expect(report.findings).toStrictEqual(findings);
      // invoice.list.
      expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue", "invoice.list"]);
    },
  );

  // Found by the sweep: an example found by a name that only starts with the operation's
  // passed every test.
  it("DSOR-TEN-02b: an example whose name only starts with the operation's is not its example", async () => {
    const others = examples.filter(({ file }) => file !== "invoice.get.json");
    const lookalike = { file: "invoice.get_all.json", text: JSON.stringify(GOOD) };
    const report = await suiteOver({ registry, examples: [...others, lookalike] });
    expect(report.findings).toStrictEqual([
      "examples/invoice.get_all.json: no operation has this name",
      "invoice.get: no example request in examples/invoice.get.json",
    ]);
    // invoice.list.
    expect(report.attacked).toStrictEqual(["invoice.issue", "invoice.list"]);
  });

  function refusal(code: ErrorCode): Answer {
    const correlation = { request_id: "req_1", principal_id: "user_123" };
    return { code, message: "refused", retry: "never", correlation };
  }

  it.each([
    ["AUTHORIZATION_DENIED", refusal("AUTHORIZATION_DENIED")],
    ["VALIDATION_FAILED", refusal("VALIDATION_FAILED")],
    ["RESOURCE_NOT_FOUND", refusal("RESOURCE_NOT_FOUND")],
    ["with data", { data: INV_1008_OF_456, correlation: { request_id: "req_1" } }],
  ])("DSOR-TEN-02b: the judge names an answer %s as a finding", (what, answer) => {
    expect(judge(answer)).toBe(`answered ${what}, not TENANT_MISMATCH`);
  });

  it("DSOR-TEN-02b: the judge passes TENANT_MISMATCH, with no data", () => {
    expect(judge(refusal("TENANT_MISMATCH"))).toBeUndefined();
  });
});

describe("C5: the suite notices an operation that takes a bare id", () => {
  it("DSOR-TEN-02b: invoice.peek, which takes a bare { id }, is a finding: there is no URI to swap", async () => {
    const peek = plant({
      id: "invoice.peek",
      input: {
        name: "InvoicePeekRequest",
        schema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
      },
      // It ignores the company it is given, the leak of "Why it matters".
      handler: async (input) => invoices.find(({ id }) => id === (input as { id: string }).id),
      example: JSON.stringify({ id: "INV-1008" }),
    });
    const report = await suiteOver(peek);
    expect(report.findings).toStrictEqual(["invoice.peek: no URI of org_456 in its example"]);
  });
});

describe("C7: the refusal is for the company, and for nothing else", () => {
  it("DSOR-TEN-02b: code that refuses every request as foreign, its own company's too, is a finding", async () => {
    const refusesAll = plant({
      id: "invoice.refuse_all",
      handler: () => {
        throw new Refusal("TENANT_MISMATCH", "refused on purpose");
      },
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(refusesAll);
    // One finding for each caller, in each company.
    const said = "its same-company call is answered TENANT_MISMATCH";
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => `invoice.refuse_all as ${who} in org_456: ${said}`),
      ...READERS_789.map((who) => `invoice.refuse_all as ${who} in org_789: ${said}`),
    ]);
  });

  // Found by the sweep: with invoice.get's example changed to INV-2001 or INV-9999, every
  // test stayed green, and C2 compared "not found" with "not found" (decision 8).
  it.each([
    ["INV-2001, which only org_789 has", "INV-2001", READERS_456.map((who) => ["org_456", who])],
    [
      "INV-9999, which nobody has",
      "INV-9999",
      [
        ...READERS_456.map((who) => ["org_456", who]),
        ...READERS_789.map((who) => ["org_789", who]),
      ],
    ],
  ])(
    "DSOR-TEN-02b: a query whose example names %s is a finding where it is missing",
    async (_what, id, where) => {
      const lookup = plant({
        id: "invoice.lookup",
        handler: handlers["invoice.get"]!,
        example: JSON.stringify({ invoice: `dsor://org_456/invoice/${id}` }),
      });
      const report = await suiteOver(lookup);
      const said = "its same-company call is not answered with data: RESOURCE_NOT_FOUND";
      expect(report.findings).toStrictEqual(
        where.map(([home, who]) => `invoice.lookup as ${who} in ${home}: ${said}`),
      );
    },
  );
});

describe("C6: every attack leaves its record in the caller's company", () => {
  // Found by the sweep: a suite that wrote to a log of its own passed every unit test, and
  // only the database tier looked at the records.
  it("DSOR-EXE-02: the suite's log holds one record for each attack, in the company it worked in", async () => {
    const fresh = createLog();
    const report = await crossTenantSuite(registry, fresh, examples);
    expect(report.attacks).toHaveLength(27);
    const records = await fresh.records();
    for (const { home, operation, request_id } of report.attacks) {
      const its = records.filter((record) => record.correlation.request_id === request_id);
      expect(its).toMatchObject([
        {
          operation: `${operation}@1`,
          authorization: "DENY",
          result: "TENANT_MISMATCH",
          reason: FOREIGN_URI,
          tenant: home,
        },
      ]);
    }
  });
});

// Found by the review: these three leak, and each passed the suite with no finding. A
// foreign URI never reaches an operation's code, so only a same-company call can show it.
describe("C8: an operation's own code answers a same-company call with nothing of another company", () => {
  /** The finding for a caller whose same-company call answered with another company's data. */
  function leaked(operation: string, who: string, home: string, what: string): string {
    const said = "its same-company call answered with another company's data";
    return `${operation} as ${who} in ${home}: ${said}: ${what}`;
  }

  it("DSOR-IDN-03b: invoice.dump, which answers with every company's invoices, is a finding", async () => {
    // NEW IN STEP 14: a page of them, as its contract says. A bare list is not a record of
    // any kind, so an agent would be refused it, and the leak would hide behind the refusal
    // (step 14's README, decision 3). Masking leaves tenant_id, so the leak still shows.
    const dump = plant({
      id: "invoice.dump",
      output: "InvoicePage",
      handler: async () => ({ items: invoices }),
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(dump);
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => leaked("invoice.dump", who, "org_456", 'tenant_id "org_789"')),
      ...READERS_789.map((who) => leaked("invoice.dump", who, "org_789", 'tenant_id "org_456"')),
    ]);
  });

  it("DSOR-IDN-03b: invoice.theirs, which answers with the other company's invoice, is a finding", async () => {
    const theirs = plant({
      id: "invoice.theirs",
      handler: async (input, tenant) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        return invoices.find((invoice) => invoice.id === id && invoice.tenant_id !== tenant);
      },
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(theirs);
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => leaked("invoice.theirs", who, "org_456", 'tenant_id "org_789"')),
      ...READERS_789.map((who) => leaked("invoice.theirs", who, "org_789", 'tenant_id "org_456"')),
    ]);
  });

  // The cache is filled in org_456, so only the suite's second company can see it.
  it("DSOR-IDN-03b: invoice.cached, which keeps invoices by id alone, is a finding from org_789", async () => {
    const cache = new Map<string, Invoice | undefined>();
    const store = memoryInvoices();
    const cached = plant({
      id: "invoice.cached",
      handler: async (input, tenant) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        if (!cache.has(id)) cache.set(id, await store.get(tenant, id));
        return cache.get(id);
      },
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(cached);
    expect(report.findings).toStrictEqual(
      READERS_789.map((who) => leaked("invoice.cached", who, "org_789", 'tenant_id "org_456"')),
    );
  });

  it.each([
    ["a tenant_id of another company", [{ tenant_id: "org_789" }], 'tenant_id "org_789"'],
    [
      "another company's URI, deep inside",
      { a: [{ b: "text" }, { c: ["dsor://org_789/invoice/INV-1008"] }] },
      '"dsor://org_789/invoice/INV-1008"',
    ],
    ["a URI in capitals", { see: "DSOR://org_999/invoice/X" }, '"DSOR://org_999/invoice/X"'],
  ])("DSOR-IDN-03b: the data search names %s", (_what, data, found) => {
    expect(foreignIn(data, "org_456")).toBe(found);
  });

  it("DSOR-IDN-03b: the data search passes data that holds only its own company", () => {
    const own = { ...INV_1008_OF_456, link: "dsor://org_456/invoice/INV-1008", note: "org_789" };
    expect(foreignIn(own, "org_456")).toBeUndefined();
  });
});
