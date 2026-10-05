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
import { canariesOf, foreignIn, swaps } from "./companies.ts";
import {
  attackersOf,
  compare,
  comparePair,
  crossTenantSuite,
  judge,
  readExamples,
  type Report,
  type Send,
} from "./cross-tenant.ts";
import {
  A_MEMORY_READ,
  afterARead,
  contract,
  FOREIGN_URI,
  handlers,
  INV_1008_OF_456,
  registry,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  source,
  testSlips,
  storyDirectories,
} from "./helpers.ts";

// The examples this step ships, one for each operation.
const examples = readExamples();

// A good example for a planted operation that takes invoice.get's input.
const GOOD = { invoice: "dsor://org_456/invoice/INV-1008" };

// The callers of each company who may read, in the order of DSoR's table of logins.
const READERS_456 = ["accounts-payable-fte", "user_123", "cfo_100", "firm-ap-fte"];
const READERS_789 = ["firm-ap-fte", "user_700"];
// The agents among them. An agent's answer is masked (step 14's README, decision 5).
const AGENTS: ReadonlySet<string> = new Set(["accounts-payable-fte", "firm-ap-fte"]);

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
  // The kind its answer is. An Invoice, as invoice.get's, unless the test
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
      shippedLabels,
      // The invoices in memory: the registry holds the store (step 10's README, decision 13).
      // Found by the Stage 2 review, and fixed from step 10 on.
      memoryInvoices(),
      undefined,
      // Step 18: and the slips, so the agents call under them (step 18's README, decision 2).
      testSlips(),
      // NEW IN STEP 19: and the story's directories (step 19's README, decision 2).
      storyDirectories(),
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

/** The other of the two companies, seen from inside this one. */
function otherOf(home: string): string {
  return home === "org_456" ? "org_789" : "org_456";
}

/** A copy of the other company's INV-1008: the invoice with this company's id, and not its own. */
function theirs1008(home: string): Invoice {
  return structuredClone(invoices.find((i) => i.id === "INV-1008" && i.tenant_id !== home)!);
}

// For each company, the id its in-company pair names: the first invoice in memory that only
// the other company holds. Typed out from step 13's README, decision 7. From step 13, each
// company has one, so the pair runs from both. Found by the Stage 2 review, and fixed from
// step 12 on.
const ONLY_THE_OTHER_HAS: Record<string, string> = { org_456: "INV-2001", org_789: "INV-1001" };

/** How a finding names the two requests of this company's in-company pair. */
function pairNames(home: string): [string, string] {
  const named = `dsor://${home}/invoice/${ONLY_THE_OTHER_HAS[home]}, which only ${otherOf(home)} has`;
  return [named, `dsor://${home}/invoice/NOPE, which nobody has`];
}

/** The two findings for a caller in this company whose pair answers both held this sign. */
function pairLeaks(operation: string, who: string, home: string, what: string): string[] {
  const said = `answered with another company's data: ${what}`;
  const [named, nobody] = pairNames(home);
  const where = `${operation} as ${who} in ${home}`;
  return [`${where}, ${named}: ${said}`, `${where}, ${nobody}: ${said}`];
}

/** The finding for a caller in this company whose in-company pair got two different answers. */
function pairDiffers(operation: string, who: string, home: string): string {
  const [named, nobody] = pairNames(home);
  return `${operation} as ${who} in ${home}, ${named}, and ${nobody}: the two answers differ`;
}

describe("C1: every operation in the registry is attacked with foreign URIs, and refused", () => {
  it("DSOR-TEN-02b: the shipped registry: every operation attacked from both companies, 51 swaps, no findings", async () => {
    const report = await crossTenantSuite(registry, createLog(), examples);
    expect(report.findings).toStrictEqual([]);
    // Typed out, and the registry's own list: nothing skipped. invoice.list
    // has no URI to swap. Its rows are checked instead, and it adds no swap below. Step 17's
    // two commands are attacked like any other operation.
    expect(report.attacked).toStrictEqual([
      "invoice.get",
      "invoice.issue",
      "invoice.list",
      "payment.cancel",
      "payment.create",
    ]);
    expect(report.attacked).toStrictEqual([...registry.contracts.keys()]);
    // Step 18: the agents attack commands too, under their slips. In org_456: invoice.get has
    // 4 callers, invoice.issue and payment.cancel 1, user_123, and payment.create 3, user_123
    // and both agents, whose slips list it. In org_789: invoice.get 2, and each command 2,
    // user_700 and the firm's agent, whose del_102 lists all three. Each example has 1 URI,
    // sent 3 ways: (4 + 1 + 1 + 3 + 2 + 2 + 2 + 2) × 3 = 51.
    expect(report.attacks).toHaveLength(51);
    expect(new Set(report.attacks.map((attack) => attack.request_id)).size).toBe(51);
    expect(report.attacks.filter((attack) => attack.home === "org_789")).toHaveLength(24);
  });

  // As if step 10's URI check were gone (break W1): the fake answers every request with
  // the invoice of the company the call works in. Found by the review: with the suite's
  // call to its judge deleted, every test stayed green.
  it("DSOR-TEN-02b: handed a fake DSoR with no URI check, the suite names every one of the 51 attacks", async () => {
    // A list has no URI to check, so its calls go to DSoR itself.
    const noUriCheck: Send = async (reg, log, request, name, input) =>
      name === "invoice.list"
        ? call(reg, log, request, name, input)
        : {
            data: { tenant_id: request.tenant, id: "INV-1008" },
            // Every answer carries its label.
            classification: "internal" as const,
            freshness: A_MEMORY_READ,
            correlation: { request_id: `req_${randomUUID()}` },
          };
    const report = await crossTenantSuite(registry, createLog(), examples, noUriCheck);
    expect(report.findings).toHaveLength(51);
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
  // stayed green, because swaps() was tested and the suite's use of it was not. Since the
  // Stage 2 review, the in-company pair follows, for the invoice's URI only: no company
  // holds a vendor row (step 12's README, decision 3).
  it("DSOR-TEN-02b: the suite sends all six swaps of a two-URI example, after the same-company call and before the in-company pair", async () => {
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
      { invoice: "dsor://org_456/invoice/INV-2001", vendor },
      { invoice: "dsor://org_456/invoice/NOPE", vendor },
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
    // One for each caller and URI: 4 + 1 + 1 + 3 in org_456, and 2 + 2 + 2 + 2 in org_789
    // (step 18: the agents attack commands under their slips).
    expect(report.findings).toHaveLength(17);
    for (const finding of report.findings) expect(finding).toMatch(/: the three answers differ$/);
  });

  // An answer may repeat the id it was sent, so each answer's own id is set aside too. Found
  // by the Stage 2 review, and fixed from step 12 on.
  it("DSOR-ERR-01b: two answers that differ only in their request ids and the ids they were sent are the same", () => {
    const notFound = (request_id: string, id: string, more = ""): Answer => {
      const correlation = { request_id, principal_id: "user_123" };
      const message = `no invoice "${id}"${more}`;
      return { code: "RESOURCE_NOT_FOUND", message, retry: "never", correlation };
    };
    const ids = ["INV-2001", "NOPE"];
    const same = [notFound("req_1", "INV-2001"), notFound("req_2", "NOPE")];
    expect(comparePair(same, ids)).toBeUndefined();
    const told = [notFound("req_1", "INV-2001", ": it exists in another company"), same[1]!];
    expect(comparePair(told, ids)).toBe("the two answers differ");
    // An answer cannot hide by writing the mask itself: it repeats the id only when another
    // company holds it. Found by a hostile pass on the Stage 2 review's fix.
    const masked = [notFound("req_1", "INV-2001"), notFound("req_2", "<id>")];
    expect(comparePair(masked, ids)).toBe("the two answers differ");
  });

  // The three answers above all come from the checklist, which refuses every foreign URI
  // before any code runs. An operation's own "not found" was never compared. So for a query,
  // each caller also sends the in-company pair: a URI of its own company naming an id only
  // the other company has, and one naming an id nobody has (step 12's README, C2). In step
  // 12, only org_789 held an id that the other company lacks, so the pair ran in org_456
  // only. From step 13, org_456 holds INV-1001 and org_789 does not, so it runs from both
  // companies. Found by the Stage 2 review, and fixed from step 12 on.
  it("DSOR-ERR-01b: in both companies, each reader also sends invoice.get the in-company pair", async () => {
    const report = await crossTenantSuite(registry, createLog(), examples);
    const pair = (home: string): Record<string, string> => ({
      home,
      operation: "invoice.get",
      uri: `dsor://${home}/invoice/INV-1008`,
    });
    expect(report.pairs).toStrictEqual([
      ...READERS_456.map(() => pair("org_456")),
      ...READERS_789.map(() => pair("org_789")),
    ]);
    expect(report.findings).toStrictEqual([]);
  });

  it("DSOR-ERR-01b: invoice.hint, whose 'not found' says the invoice exists in another company, is a finding in both companies", async () => {
    const hint = plant({
      id: "invoice.hint",
      // A "not found" that says too much: whether another company holds the id.
      handler: async (input, company) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        const own = await company.invoices.get(id);
        if (own !== undefined) return own;
        const elsewhere = invoices.some((invoice) => invoice.id === id);
        const why = elsewhere
          ? `no invoice "${id}": it exists in another company`
          : `no invoice "${id}"`;
        // Labelled internal, as invoice.get's own "not found" is: the code says it repeats
        // only the id it was sent, and here it says more. Left confidential, it would reach no
        // agent: masking would give the agents one fixed message for both, and only the
        // people's pairs would differ (step 14's README, decision 8).
        throw new Refusal("RESOURCE_NOT_FOUND", why, "internal");
      },
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(hint);
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => pairDiffers("invoice.hint", who, "org_456")),
      ...READERS_789.map((who) => pairDiffers("invoice.hint", who, "org_789")),
    ]);
  });

  // Both requests of the pair reach the code, so their answers are searched too, as the
  // same-company call's is. This fallback answers both alike, so comparing them shows
  // nothing. Found by a hostile pass on the Stage 2 review's fix.
  it("DSOR-IDN-03b: invoice.fallback, which answers an id it lacks with the other company's invoice, is a finding in both companies", async () => {
    const fallback = plant({
      id: "invoice.fallback",
      handler: async (input, company) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        const own = await company.invoices.get(id);
        return own ?? { ...theirs1008(company.tenant), tenant_id: company.tenant };
      },
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(fallback);
    expect(report.findings).toStrictEqual([
      ...READERS_456.flatMap((who) => pairLeaks("invoice.fallback", who, "org_456", '"VENDOR-77"')),
      ...READERS_789.flatMap((who) => pairLeaks("invoice.fallback", who, "org_789", '"VENDOR-44"')),
    ]);
  });
});

describe("C3: every principal who may call the operation attacks it, from each company", () => {
  it("DSOR-IDN-03b: in org_456, invoice.get is attacked by all four readers, the firm's agent included", async () => {
    const ids = (await attackersOf(registry, "invoice.get", "org_456")).map(
      (attacker) => attacker.id,
    );
    expect(ids).toStrictEqual(READERS_456);
  });

  // The firm's agent may issue in org_789, and not in org_456, so it is no attacker here.
  it("DSOR-IDN-03b: in org_456, invoice.issue is attacked by user_123 alone", async () => {
    const ids = (await attackersOf(registry, "invoice.issue", "org_456")).map(
      (attacker) => attacker.id,
    );
    expect(ids).toStrictEqual(["user_123"]);
  });

  // Found by the review: the suite worked in org_456 only, the firm's first company.
  it("DSOR-IDN-03b: in org_789, invoice.get is attacked by the firm's agent and user_700", async () => {
    const ids = (await attackersOf(registry, "invoice.get", "org_789")).map(
      (attacker) => attacker.id,
    );
    expect(ids).toStrictEqual(READERS_789);
  });

  // Step 18: the firm's agent issues in org_789 under del_102, which lists invoice:issue, and
  // user_700, who signed it, holds it.
  it("DSOR-IDN-03b: in org_789, invoice.issue is attacked by the firm's agent and user_700", async () => {
    const ids = (await attackersOf(registry, "invoice.issue", "org_789")).map(
      (attacker) => attacker.id,
    );
    expect(ids).toStrictEqual(["firm-ap-fte", "user_700"]);
  });

  // Step 18: the suite asks line ③'s own question with the registry's slips, so each agent
  // whose slip lists payment:create attacks it, in the company of its slip.
  it.each([
    ["org_456", ["accounts-payable-fte", "user_123", "firm-ap-fte"]],
    ["org_789", ["firm-ap-fte", "user_700"]],
  ])(
    "step 18's decision 2: in %s, payment.create is attacked by its people and the agents whose slips list it",
    async (home, callers) => {
      const ids = (await attackersOf(registry, "payment.create", home)).map(
        (attacker) => attacker.id,
      );
      expect(ids).toStrictEqual(callers);
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
      // invoice.list, and step 17's two commands.
      expect(report.attacked).toStrictEqual([
        "invoice.get",
        "invoice.issue",
        "invoice.list",
        "payment.cancel",
        "payment.create",
      ]);
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
    // invoice.list, and step 17's two commands.
    expect(report.attacked).toStrictEqual([
      "invoice.issue",
      "invoice.list",
      "payment.cancel",
      "payment.create",
    ]);
  });

  function refusal(code: ErrorCode): Answer {
    const correlation = { request_id: "req_1", principal_id: "user_123" };
    return { code, message: "refused", retry: "never", correlation };
  }

  it.each([
    ["AUTHORIZATION_DENIED", refusal("AUTHORIZATION_DENIED")],
    ["VALIDATION_FAILED", refusal("VALIDATION_FAILED")],
    ["RESOURCE_NOT_FOUND", refusal("RESOURCE_NOT_FOUND")],
    // Every answer carries its label.
    [
      "with data",
      {
        data: INV_1008_OF_456,
        classification: "confidential" as const,
        freshness: A_MEMORY_READ,
        correlation: { request_id: "req_1" },
      },
    ],
  ])("DSOR-TEN-02b: the judge names an answer %s as a finding", (what, answer) => {
    expect(judge(answer)).toBe(`answered ${what}, not TENANT_MISMATCH`);
  });

  it("DSOR-TEN-02b: the judge passes TENANT_MISMATCH, with no data", () => {
    expect(judge(refusal("TENANT_MISMATCH"))).toBeUndefined();
  });

  // The tests above hand the judge one answer at a time. Through the suite, it met only a
  // fake DSoR that answers with data, so a suite whose check flagged only data passed every
  // test. These fakes refuse every foreign request, but for the wrong reason: as if another
  // line of the checklist came before the URI check. One for each wrong code, so a suite
  // that lets any one of them pass fails here (step 12's README, decision 4). Found by the
  // Stage 2 review, and fixed from step 12 on.
  it.each<[ErrorCode, string]>([
    ["UNSUPPORTED_CAPABILITY", "is not built yet"],
    ["AUTHORIZATION_DENIED", "needs a permission the caller does not hold"],
    ["VALIDATION_FAILED", "has an input that is not valid"],
    ["RESOURCE_NOT_FOUND", "names nothing"],
  ])(
    "DSOR-TEN-02b: handed a fake DSoR that refuses every foreign request with %s, the suite names each of the 51 attacks",
    async (code, why) => {
      const wrongReason: Send = async (reg, log, request, name, input) => {
        const answer = await call(reg, log, request, name, input);
        if ("data" in answer || answer.code !== "TENANT_MISMATCH") return answer;
        return { ...answer, code, message: `"${name}" ${why}` };
      };
      const report = await crossTenantSuite(registry, createLog(), examples, wrongReason);
      expect(report.findings).toHaveLength(51);
      const said = `answered ${code}, not TENANT_MISMATCH`;
      for (const finding of report.findings) expect(finding.endsWith(`: ${said}`)).toBe(true);
      const first =
        "invoice.get as accounts-payable-fte in org_456, dsor://org_456/invoice/INV-1008";
      expect(report.findings.slice(0, 3)).toStrictEqual([
        `${first} sent to org_789, with the same id: ${said}`,
        `${first} sent to org_789, with an id it does not have: ${said}`,
        `${first} sent to org_999, which does not exist: ${said}`,
      ]);
    },
  );
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

// Data that holds nothing: none at all, or an empty object, list, or text. Found by the
// Stage 2 review, and fixed from step 12 on. Empty too, found by a hostile pass on that fix:
// `?? {}` passed.
const EMPTY: [string, unknown][] = [
  ["undefined", undefined],
  ["null", null],
  ["{}", {}],
  ["[]", []],
  ['""', ""],
];

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

  // An answer of { data: undefined } counted as data, so a query that finds nothing and
  // says so with an empty answer passed, and its example could name a thing that does not
  // exist (step 12's README, decision 8). Found by the Stage 2 review, and fixed from step 12
  // on.
  // In step 14, DSoR itself refuses each of these with INTERNAL_ERROR: none is a record of
  // its kind (step 14's README, decisions 3 and 7). So a fake DSoR answers with the empty
  // data where DSoR refused it, as a DSoR without that check would, and the suite's own
  // check must name it.
  it.each(EMPTY)(
    "DSOR-TEN-02b: a query whose code answers with data that is %s is a finding, in both companies",
    async (what, value) => {
      const empty = plant({
        id: "invoice.empty",
        handler: async () => value,
        example: JSON.stringify(GOOD),
      });
      const answersEmpty: Send = async (reg, log, request, name, input) => {
        const answer = await call(reg, log, request, name, input);
        if (name !== "invoice.empty" || "data" in answer || answer.code !== "INTERNAL_ERROR") {
          return answer;
        }
        const freshness = A_MEMORY_READ;
        return {
          data: value,
          classification: "public",
          freshness,
          correlation: answer.correlation,
        };
      };
      const report = await suiteOver(empty, answersEmpty);
      const said = `its same-company call is not answered with data: the data is ${what}`;
      expect(report.findings).toStrictEqual([
        ...READERS_456.map((who) => `invoice.empty as ${who} in org_456: ${said}`),
        ...READERS_789.map((who) => `invoice.empty as ${who} in org_789: ${said}`),
      ]);
    },
  );

  // Through DSoR itself, each is refused before the suite sees it, and is still a finding:
  // a query's same-company call must answer with data (step 12's README, decision 8). The
  // in-company pair's two answers are the same refusal, so they name nothing.
  it.each(EMPTY)(
    "DSOR-TEN-02b: a query whose code answers with %s is refused by DSoR itself, and is still a finding",
    async (_what, value) => {
      const empty = plant({
        id: "invoice.empty",
        handler: async () => value,
        example: JSON.stringify(GOOD),
      });
      const report = await suiteOver(empty);
      const said = "its same-company call is not answered with data: INTERNAL_ERROR";
      expect(report.findings).toStrictEqual([
        ...READERS_456.map((who) => `invoice.empty as ${who} in org_456: ${said}`),
        ...READERS_789.map((who) => `invoice.empty as ${who} in org_789: ${said}`),
      ]);
    },
  );
});

describe("C6: every attack leaves its record in the caller's company", () => {
  // Found by the sweep: a suite that wrote to a log of its own passed every unit test, and
  // only the database tier looked at the records.
  it("DSOR-EXE-02: the suite's log holds one record for each attack, in the company it worked in", async () => {
    const fresh = createLog();
    const report = await crossTenantSuite(registry, fresh, examples);
    expect(report.attacks).toHaveLength(51);
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

  // The three leaks below answer with a row whose tenant_id is another company's. Since the
  // Stage 2 review, the pipeline itself refuses such an answer with INTERNAL_ERROR, before
  // the caller sees it (step 10's README, decision 14). So the suite names them because a
  // query's same-company call must answer with data (step 12's README, decision 8), and the
  // leak never reaches its data search. Found by the Stage 2 review, and fixed from step 10
  // on.
  /** The finding for a caller whose same-company call the pipeline refused as a bug. */
  function refusedAsBug(operation: string, who: string, home: string): string {
    return `${operation} as ${who} in ${home}: its same-company call is not answered with data: INTERNAL_ERROR`;
  }

  it("DSOR-IDN-03b: invoice.dump, which answers with every company's invoices, is a finding", async () => {
    // A page of them, as its contract says. A bare list is not a record of
    // any kind, so an agent would be refused it, and the leak would hide behind the refusal
    // (step 14's README, decision 3). Masking leaves tenant_id, so the leak still shows.
    const dump = plant({
      id: "invoice.dump",
      output: "InvoicePage",
      // It reads its own company first, as the plants below do. A query that
      // reads nothing is refused anyway, and that refusal hid step 10's answer check: with that
      // check deleted, this test still passed. Found by the review (step 15's README, decision 6).
      handler: afterARead(async () => ({ items: invoices })),
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(dump);
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => refusedAsBug("invoice.dump", who, "org_456")),
      ...READERS_789.map((who) => refusedAsBug("invoice.dump", who, "org_789")),
    ]);
  });

  it("DSOR-IDN-03b: invoice.theirs, which answers with the other company's invoice, is a finding", async () => {
    const theirs = plant({
      id: "invoice.theirs",
      handler: afterARead(async (input, company) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        return invoices.find(
          (invoice) => invoice.id === id && invoice.tenant_id !== company.tenant,
        );
      }),
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(theirs);
    // The in-company pair names nothing here. The other company's INV-2001, or INV-1001,
    // fails as a bug. And NOPE, which nobody has, makes this code answer with nothing, which
    // step 14 refuses as not a record, also with INTERNAL_ERROR (step 14's README, decision
    // 3). So the pair's two answers are the same. In step 13 the second was answered with no
    // data, and the pair named the code too.
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => refusedAsBug("invoice.theirs", who, "org_456")),
      ...READERS_789.map((who) => refusedAsBug("invoice.theirs", who, "org_789")),
    ]);
  });

  // The cache is filled in org_456, so only the suite's second company can see it.
  // Every call reads first, so no call is refused for reading nothing, and the
  // cache's copy is labelled current. That is the review's finding F1, which step 15 records
  // and does not fix: the label covers the reads, not the data (step 15's README, the intent).
  it("DSOR-IDN-03b: invoice.cached, which keeps invoices by id alone, is a finding from org_789", async () => {
    const cache = new Map<string, Invoice | undefined>();
    const cached = plant({
      id: "invoice.cached",
      handler: afterARead(async (input, company) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        if (!cache.has(id)) cache.set(id, await company.invoices.get(id));
        return cache.get(id);
      }),
      example: JSON.stringify(GOOD),
    });
    const report = await suiteOver(cached);
    expect(report.findings).toStrictEqual(
      READERS_789.map((who) => refusedAsBug("invoice.cached", who, "org_789")),
    );
  });

  // Found by the Stage 2 review: each of these passed the suite with no finding. Its search
  // knew two signs of a company, a field named exactly tenant_id and a text that starts with
  // dsor://. The pipeline's own answer check passes them too: no tenant_id in them names
  // another company (step 10's README, decision 14). Now the search looks for every value
  // of the other company's rows that its own rows never hold, in every key and every text,
  // and for any key with "tenant" in its name (step 12's README, decision 8). Found by the
  // Stage 2 review, and fixed from step 12 on.
  // In step 14, each answer is a whole invoice of the caller's company with one sign of the
  // other company in it, so that DSoR's own checks let it through and only the suite's
  // search can name it. Step 14 refuses a row with no tenant_id or no id itself, as
  // invoice.projection below shows. And an agent's answer is masked: a key or a field with no
  // label never reaches it, so the sign shows only to the people, and the suite finds only
  // what each caller was given (step 14's README, decisions 5 and 7).
  it.each([
    [
      "invoice.rewritten",
      "the other company's invoice, its tenant_id rewritten to the caller's",
      // It reads its own company first. A query that reads nothing is refused
      // before the suite sees it (step 15's README, decision 6).
      (async (_input, company) => {
        await company.invoices.get("INV-1008");
        return { ...theirs1008(company.tenant), tenant_id: company.tenant };
      }) as Handler,
      // vendor_id is internal, so every caller gets the other company's vendor.
      (_who: string, home: string) => (home === "org_456" ? '"VENDOR-77"' : '"VENDOR-44"'),
    ],
    [
      "invoice.keyed",
      "the other company's URI as a key",
      (async (_input, company) => ({
        ...(await company.invoices.get("INV-1008")),
        [`dsor://${otherOf(company.tenant)}/invoice/INV-1008`]: "seen",
      })) as Handler,
      // A key with no label is withheld from an agent. Its redaction named it by the key
      // itself, so the agent got the URI there, until the Stage 2 review: a redaction now
      // names such a key <unlabelled> (step 14's README, decision 4). So only the people get
      // the URI. Found by the Stage 2 review, and fixed from step 14 on.
      (who: string, home: string) =>
        AGENTS.has(who) ? undefined : `the key "dsor://${otherOf(home)}/invoice/INV-1008"`,
    ],
    [
      "invoice.sentence",
      "the other company's URI inside a sentence",
      (async (_input, company) => ({
        ...(await company.invoices.get("INV-1008")),
        status: `see dsor://${otherOf(company.tenant)}/invoice/INV-1008`,
      })) as Handler,
      // In status, which is internal, so every caller gets the sentence.
      (_who: string, home: string) => `"see dsor://${otherOf(home)}/invoice/INV-1008"`,
    ],
    [
      "invoice.camel",
      "its own invoice, and tenantId naming the other company",
      (async (_input, company) => ({
        ...(await company.invoices.get("INV-1008")),
        tenantId: otherOf(company.tenant),
      })) as Handler,
      // tenantId has no label, so no agent gets it: only the people do.
      (who: string, home: string) => (AGENTS.has(who) ? undefined : `tenantId "${otherOf(home)}"`),
    ],
  ])(
    "DSOR-IDN-03b: %s, which answers with %s, is a finding in both companies",
    async (id, _what, handler, sign) => {
      const report = await suiteOver(plant({ id, handler, example: JSON.stringify(GOOD) }));
      // The pair's two answers leak alike, and each is named too. From step 13, in both
      // companies.
      const found = (home: string, readers: string[]): string[] =>
        readers.flatMap((who) => {
          const what = sign(who, home);
          if (what === undefined) return [];
          return [leaked(id, who, home, what), ...pairLeaks(id, who, home, what)];
        });
      expect(report.findings).toStrictEqual([
        ...found("org_456", READERS_456),
        ...found("org_789", READERS_789),
      ]);
    },
  );

  // In step 13 only the suite's search named this one. In step 14 DSoR refuses it itself: a
  // row with no tenant_id has no URI for the record of the read (step 14's README, decision
  // 7). Found by the Stage 2 review, and fixed from step 12 on.
  it("DSOR-IDN-03b: invoice.projection, which answers with the other company's id, vendor, and amount, with no tenant_id, is a finding in both companies", async () => {
    const projection: Handler = async (_input, company) => {
      const { id, vendor_id, amount } = theirs1008(company.tenant);
      return { id, vendor_id, amount };
    };
    const report = await suiteOver(
      plant({ id: "invoice.projection", handler: projection, example: JSON.stringify(GOOD) }),
    );
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => refusedAsBug("invoice.projection", who, "org_456")),
      ...READERS_789.map((who) => refusedAsBug("invoice.projection", who, "org_789")),
    ]);
  });

  // Only the ids the request names in its own URIs are excused. A canary anywhere else in
  // the request, such as in a note, still counts: one note that held them all switched the
  // search off. Found by a hostile pass on the Stage 2 review's fix.
  it("DSOR-IDN-03b: invoice.noted, whose example's note holds every canary, is still a finding in both companies", async () => {
    const noted = plant({
      id: "invoice.noted",
      input: {
        name: "InvoiceNotedRequest",
        schema: {
          type: "object",
          properties: {
            invoice: { $ref: "urn:dsor:schema:1.3:common#/$defs/resourceUri" },
            note: { type: "string" },
          },
          required: ["invoice"],
          additionalProperties: false,
        },
      },
      // For an invoice its company has, the other company's, its tenant_id rewritten.
      handler: async (input, company) => {
        const { id } = parseUri((input as { invoice: string }).invoice);
        if ((await company.invoices.get(id)) === undefined) {
          throw new Refusal("RESOURCE_NOT_FOUND", `no invoice "${id}"`);
        }
        return { ...theirs1008(company.tenant), tenant_id: company.tenant };
      },
      // Every canary of both companies, typed out in the test of canariesOf below.
      example: JSON.stringify({
        ...GOOD,
        note: [...canariesOf("org_456"), ...canariesOf("org_789")].join(" "),
      }),
    });
    const report = await suiteOver(noted);
    expect(report.findings).toStrictEqual([
      ...READERS_456.map((who) => leaked("invoice.noted", who, "org_456", '"VENDOR-77"')),
      ...READERS_789.map((who) => leaked("invoice.noted", who, "org_789", '"VENDOR-44"')),
    ]);
  });

  // The whole answer is searched, a refusal's message too. No shipped query refuses its
  // own same-company call, so a fake DSoR does: it adds the other company's vendor to
  // invoice.issue's "not built yet". Found by a hostile pass on the Stage 2 review's fix:
  // a search of the data alone passed every test.
  it("DSOR-IDN-03b: a same-company refusal that names another company's data is a finding", async () => {
    const vendorOf = (home: string): string => (home === "org_456" ? "VENDOR-77" : "VENDOR-44");
    const talks: Send = async (reg, log, request, name, input) => {
      const answer = await call(reg, log, request, name, input);
      if (name !== "invoice.issue" || "data" in answer || answer.code === "TENANT_MISMATCH") {
        return answer;
      }
      const message = `${answer.message}, and ${vendorOf(String(request.tenant))} is waiting`;
      return { ...answer, message };
    };
    const report = await crossTenantSuite(registry, createLog(), examples, talks);
    const what = (home: string): string => {
      const message = `"invoice.issue" is not built yet, and ${vendorOf(home)} is waiting`;
      return `${JSON.stringify(vendorOf(home))} in ${JSON.stringify(message)}`;
    };
    expect(report.findings).toStrictEqual([
      leaked("invoice.issue", "user_123", "org_456", what("org_456")),
      // Step 18: the firm's agent reaches "not built yet" under del_102, which lists
      // invoice:issue, and user_700 holds it.
      leaked("invoice.issue", "firm-ap-fte", "org_789", what("org_789")),
      leaked("invoice.issue", "user_700", "org_789", what("org_789")),
    ]);
  });

  it.each([
    ["a tenant_id of another company", [{ tenant_id: "org_789" }], 'tenant_id "org_789"'],
    [
      "another company's URI, deep inside",
      { a: [{ b: "text" }, { c: ["dsor://org_789/invoice/INV-1008"] }] },
      '"dsor://org_789/invoice/INV-1008"',
    ],
    ["a URI in capitals", { see: "DSOR://org_999/invoice/X" }, '"DSOR://org_999/invoice/X"'],
    // Each of these, one sign alone. Found by the Stage 2 review, and fixed from step 12 on.
    ["a value only the other company's rows hold", { vendor: "VENDOR-77" }, '"VENDOR-77"'],
    [
      "one inside a text, in small letters",
      { note: "paid to vendor-77 on time" },
      '"VENDOR-77" in "paid to vendor-77 on time"',
    ],
    ["one used as a key", { "INV-2001": true }, 'the key "INV-2001"'],
    ["the other company's id, alone in a text", { note: "org_789" }, '"org_789"'],
    [
      "a key named tenantId, naming a company with no rows",
      { tenantId: "org_999" },
      'tenantId "org_999"',
    ],
    ["a key with tenant in its name, naming no company", { tenant_name: null }, "tenant_name null"],
    [
      "a URI of a company with no rows, inside a sentence",
      { note: "see dsor://org_999/invoice/X" },
      '"see dsor://org_999/invoice/X"',
    ],
    [
      "a URI of a company with no rows, as a key",
      { "dsor://org_999/invoice/X": 1 },
      'the key "dsor://org_999/invoice/X"',
    ],
    // Each rule at its edge. Found by a hostile pass on the Stage 2 review's fix: a rule
    // for keys that start with tenant, or are written in small letters only, or hold text
    // only, passed every test, and so did a URI rule that read only the first URI, read a
    // company that only starts like this one's as this one, or skipped an empty company.
    ["a key named activeTenantId", { activeTenantId: "org_999" }, 'activeTenantId "org_999"'],
    ["a key named TENANT, in capitals", { TENANT: "org_999" }, 'TENANT "org_999"'],
    [
      "a key with tenant in its name, holding an object",
      { tenant: { id: "org_999" } },
      'tenant {"id":"org_999"}',
    ],
    [
      "a URI of a company whose id starts like this one's",
      { see: "dsor://org_4567/invoice/X" },
      '"dsor://org_4567/invoice/X"',
    ],
    [
      "a second URI in a text, of another company",
      { see: "dsor://org_456/invoice/INV-1008, then dsor://org_999/invoice/X" },
      '"dsor://org_456/invoice/INV-1008, then dsor://org_999/invoice/X"',
    ],
    ["a URI that names no company", { see: "dsor:///invoice/X" }, '"dsor:///invoice/X"'],
  ])("DSOR-IDN-03b: the data search names %s", (_what, data, found) => {
    expect(foreignIn(data, "org_456")).toBe(found);
  });

  // The canaries, typed out: every value of the other company's rows that this company's
  // rows never hold. Found by the Stage 2 review, and fixed from step 12 on. From step 13,
  // with the invoices of decision 7: org_456 has a cancelled invoice and org_789 has none,
  // so "cancelled" is one of org_789's. And 0.00 is no canary: both companies hold it.
  it("DSOR-IDN-03b: org_456's canaries are org_789's values it never holds, and org_789's the other way", () => {
    expect(canariesOf("org_456")).toStrictEqual([
      "12500.00",
      "3300.00",
      "480.25",
      "61000.00",
      "99000.00",
      "INV-2001",
      "INV-2002",
      "INV-2003",
      "INV-2004",
      "VENDOR-77",
      "org_789",
    ]);
    expect(canariesOf("org_789")).toStrictEqual([
      "1250.00",
      "15000.00",
      "1999.99",
      "22750.00",
      "27300.00",
      "312.40",
      "31400.00",
      "450.00",
      "5600.00",
      "640.00",
      "7425.00",
      "8900.50",
      "INV-1001",
      "INV-1002",
      "INV-1003",
      "INV-1004",
      "INV-1005",
      "INV-1006",
      "INV-1007",
      "INV-1009",
      "INV-1010",
      "INV-1011",
      "INV-1012",
      "VENDOR-12",
      "VENDOR-31",
      "VENDOR-44",
      "cancelled",
      "org_456",
    ]);
  });

  // A canary the caller sent itself is not counted. invoice.get's own "not found" repeats
  // the id it was asked for. Found by the Stage 2 review, and fixed from step 12 on.
  it("DSOR-IDN-03b: a canary the request itself holds is not counted", () => {
    const answer = { code: "RESOURCE_NOT_FOUND", message: 'no invoice "INV-2001"' };
    const sent = { invoice: "dsor://org_456/invoice/INV-2001" };
    expect(foreignIn(answer, "org_456", sent)).toBeUndefined();
    expect(foreignIn(answer, "org_456")).toBe('"INV-2001" in "no invoice \\"INV-2001\\""');
  });

  // The whole answer is searched, its correlation too, and the company's own data passes.
  // Found by the Stage 2 review: a note naming org_789 passed here before, and now names
  // the other company.
  it("DSOR-IDN-03b: the data search passes an answer that holds only its own company", () => {
    const own = {
      data: { ...INV_1008_OF_456, link: "dsor://org_456/invoice/INV-1008", note: "rush" },
      correlation: { request_id: "req_1", agent_id: "accounts-payable-fte", tenant: "org_456" },
    };
    expect(foreignIn(own, "org_456")).toBeUndefined();
  });
});
