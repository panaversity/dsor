// NEW IN STEP 12: the cross-tenant suite, by claim (C1 to C7 in step 12's README). It runs
// over the shipped registry, and over registries with one gap planted in each. The
// invoices are in memory, so `pnpm check`, and CI, run it on every push.
// test/cross-tenant.db.test.ts runs it again on the database.
import { describe, expect, it } from "vitest";
import { Refusal, type Answer, type ErrorCode } from "../src/envelope.ts";
import { invoices } from "../src/invoice.ts";
import { createLog } from "../src/log.ts";
import {
  buildRegistry,
  type ContractSource,
  type Handler,
  type Registry,
} from "../src/registry.ts";
import {
  attackersOf,
  compare,
  crossTenantSuite,
  judge,
  readExamples,
  swaps,
  type Report,
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

/** One operation to plant beside the shipped ones. */
type Plant = {
  id: string;
  // invoice:read unless the test names another.
  permission?: string;
  // invoice.get's input schema unless the test gives one of its own.
  input?: { name: string; schema: object };
  handler?: Handler;
  // The text of its example file. None means the file is missing.
  example?: string;
};

/** The shipped registry and examples, with one planted operation added. */
function plant(p: Plant): { registry: Registry; examples: ContractSource[] } {
  const planted = {
    ...contract("invoice.get"),
    id: p.id,
    authorization: { permission: p.permission ?? "invoice:read" },
    input: { schema: p.input?.name ?? "InvoiceGetRequest" },
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
function suiteOver(target: { registry: Registry; examples: ContractSource[] }): Promise<Report> {
  return crossTenantSuite(target.registry, createLog(), target.examples);
}

describe("C1: every operation in the registry is attacked with foreign URIs, and refused", () => {
  it("DSOR-TEN-02b: the shipped registry: both operations attacked, 15 times, no findings", async () => {
    const report = await crossTenantSuite(registry, createLog(), examples);
    expect(report.findings).toStrictEqual([]);
    // Typed out, and the registry's own list: nothing skipped.
    expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue"]);
    expect(report.attacked).toStrictEqual([...registry.contracts.keys()]);
    // invoice.get: 4 callers, 1 URI, 3 ways. invoice.issue: 1 caller, 1 URI, 3 ways.
    expect(report.attacks).toHaveLength(15);
    expect(new Set(report.attacks).size).toBe(15);
  });

  it("DSOR-TEN-02b: an example with two URIs is attacked one URI at a time, three ways each", () => {
    const invoice = "dsor://org_456/invoice/INV-1008";
    const vendor = "dsor://org_456/vendor/VENDOR-44";
    expect(swaps({ invoice, vendor })).toStrictEqual([
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

  it("DSOR-TEN-02b: a URI inside a list is found and swapped too, and the example is left as it was", () => {
    const example = { lines: [{ invoice: "dsor://org_456/invoice/INV-1008" }], note: "rush" };
    const requests = swaps(example).flatMap((swap) => swap.requests);
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
});

describe("C2: the three foreign answers are the same, apart from the request id", () => {
  function refused(request_id: string, message: string = FOREIGN_URI): Answer {
    const correlation = { request_id, principal_id: "user_123" };
    return { code: "TENANT_MISMATCH", message, retry: "never", correlation };
  }

  it("DSOR-ERR-01b: three answers that differ only in their request ids are the same", () => {
    expect(compare([refused("req_1"), refused("req_2"), refused("req_3")])).toBeUndefined();
  });

  it("DSOR-ERR-01b: three answers whose messages differ are a finding", () => {
    const tells = refused("req_2", "org_789 has no invoice NOPE");
    expect(compare([refused("req_1"), tells, refused("req_3")])).toBe("the three answers differ");
  });
});

describe("C3: every principal who may call the operation in org_456 attacks it", () => {
  it("DSOR-IDN-03b: invoice.get is attacked by all four readers in org_456, the firm's agent included", () => {
    const ids = attackersOf(registry, "invoice.get").map((attacker) => attacker.id);
    expect(ids.toSorted()).toStrictEqual([
      "accounts-payable-fte",
      "cfo_100",
      "firm-ap-fte",
      "user_123",
    ]);
  });

  // The firm's agent may issue in org_789, and not in org_456, so it is no attacker here.
  it("DSOR-IDN-03b: invoice.issue is attacked by user_123 alone, who may issue in org_456", () => {
    const ids = attackersOf(registry, "invoice.issue").map((attacker) => attacker.id);
    expect(ids).toStrictEqual(["user_123"]);
  });
});

describe("C4: nothing is skipped: every gap is a finding", () => {
  it.each([
    [
      "no example file",
      plant({ id: "invoice.approve" }),
      "invoice.approve: no example request in examples/invoice.approve.json",
    ],
    [
      "an example that is not JSON",
      plant({ id: "invoice.approve", example: "{ invoice: " }),
      "invoice.approve: its example is not valid JSON",
    ],
    [
      "an example whose only URI is org_789's",
      plant({
        id: "invoice.approve",
        example: JSON.stringify({ invoice: "dsor://org_789/invoice/INV-1008" }),
      }),
      "invoice.approve: no URI of org_456 in its example",
    ],
    [
      "an example that fails its own input schema",
      plant({ id: "invoice.approve", example: JSON.stringify({ ...GOOD, note: "rush" }) }),
      "invoice.approve: its example does not pass its input schema",
    ],
    [
      "a permission that no role in org_456 grants",
      plant({ id: "invoice.void", permission: "invoice:void", example: JSON.stringify(GOOD) }),
      "invoice.void: nobody in org_456 holds invoice:void, so nobody can attack it",
    ],
  ])(
    "DSOR-TEN-02b: %s is one finding, and the rest is still attacked",
    async (_gap, target, finding) => {
      const report = await suiteOver(target);
      expect(report.findings).toStrictEqual([finding]);
      expect(report.attacked).toStrictEqual(["invoice.get", "invoice.issue"]);
    },
  );

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

describe("C5: the suite notices a door that takes a bare id", () => {
  it("DSOR-TEN-02b: invoice.peek, which takes { id } and reads any company's invoice, is a finding", async () => {
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
      // It ignores the company it is given: the door the suite must notice.
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
    // One finding for each reader in org_456, in the order of DSoR's table of logins.
    const said = "its own company's example is answered TENANT_MISMATCH";
    expect(report.findings).toStrictEqual([
      `invoice.refuse_all as accounts-payable-fte: ${said}`,
      `invoice.refuse_all as user_123: ${said}`,
      `invoice.refuse_all as cfo_100: ${said}`,
      `invoice.refuse_all as firm-ap-fte: ${said}`,
    ]);
  });
});
