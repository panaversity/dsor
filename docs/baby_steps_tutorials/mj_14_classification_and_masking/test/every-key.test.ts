// Every key of an answer, at every depth, has a line in classifications.json (step 14's
// README, decisions 1, 3, and 4). Masking held at the top of an answer only: inside a field
// labelled internal, a key with no line went to the agent, and a redaction named a key by
// its own text. Found by the Stage 2 review, and fixed from step 14 on.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { call } from "../src/pipeline.ts";
import {
  AGENT,
  CFO,
  INV_1008_OF_456,
  MASKED_1008_OF_456,
  MASKED_REDACTIONS,
  SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  UNEXPECTED,
  correlationFor,
  labelsWith,
  log,
  omitted,
  registry,
  runAs,
} from "./helpers.ts";

const GET_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// The bank account the review planted, as a value and as a key.
const BANK = "PK36SCBL0000001123456702";

describe("decision 3: a field labelled as a plain value holds a plain value", () => {
  // The review's run: status, labelled internal, held an object, and the agent got the bank
  // account inside it. An object or a list where the file declares a plain value has keys
  // no line labels, so the answer is refused, for everyone.
  it.each([
    ["an object, where status is labelled internal", { status: { code: "issued", bank: BANK } }],
    ["a list, where status is labelled internal", { status: ["issued", BANK] }],
    ["an object, under a key with no line", { remit_to: { bank: BANK } }],
  ])(
    "DSOR-CLS-01: an answer holding %s is refused, for the agent and for user_123",
    async (_what, extra) => {
      const answer = { ...MASKED_1008_OF_456, ...extra };
      for (const who of [AGENT, SUPERVISOR]) {
        const heard = await runAs(who, async () => structuredClone(answer));
        expect(heard).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
        expect(JSON.stringify(heard)).not.toContain(BANK);
      }
    },
  );

  // A field that holds an object names its kind in the file, such as capped, a Capped that
  // is public. Inside it, a key with no line is confidential, as at the top, and its
  // redaction names where it sat.
  it("DSOR-CLS-01: inside capped, a key with no line is left out for the agent, at its path", async () => {
    const page = { items: [], capped: { asked: 1000, max: 10, note: BANK } };
    const answer = await runAs(AGENT, async () => page, "InvoicePage");
    expect(answer).toStrictEqual({
      data: { items: [], capped: { asked: 1000, max: 10 } },
      classification: "public",
      redactions: [omitted("capped.<unlabelled>")],
      correlation: correlationFor(THE_AGENT),
    });
  });
});

// Found by a hostile pass on the Stage 2 review's fix: each test below guards code that is
// right, and a one-line break of that code left every other test green. Fixed from step 14
// on.
describe("decision 3: a record line holds a record, and what a caller may not see is still checked", () => {
  // capped is "public Capped": an object of the kind Capped. Text or a list there is not.
  it.each([
    ["text", "31400.00"],
    ["a list", ["31400.00"]],
  ])(
    "DSOR-CLS-01: a page whose capped holds %s is refused, for the agent and for user_123",
    async (_what, capped) => {
      for (const who of [AGENT, SUPERVISOR]) {
        const heard = await runAs(who, async () => ({ items: [], capped }), "InvoicePage");
        expect(heard).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
      }
    },
  );

  // The agent may not see amount, so the walk goes on inside it only to check its shape. A
  // wrong shape there is refused for the agent as for a person: refused for everyone.
  it.each([
    [
      "an object inside amount's value",
      labelsWith({}),
      { amount: { value: { x: "31400.00" }, currency: "USD" } },
    ],
    [
      "an item that is not a record, in a list inside amount",
      labelsWith({ Money: { history: "Entry[]" }, Entry: { at: "confidential" } }),
      { amount: { value: "31400.00", currency: "USD", history: ["paid twice"] } },
    ],
    [
      "a row with no id, inside a field above the agent's clearance",
      labelsWith({ Invoice: { related: "restricted Invoice" } }),
      { related: { tenant_id: "org_456", status: "issued" } },
    ],
  ])(
    "DSOR-CLS-05: %s is refused for the agent, who may not see it, as for user_123",
    async (_what, labels, extra) => {
      const answer = { ...INV_1008_OF_456, ...extra };
      for (const who of [AGENT, SUPERVISOR]) {
        const heard = await runAs(who, async () => structuredClone(answer), "Invoice", labels);
        expect(heard).toMatchObject({ code: "INTERNAL_ERROR", message: UNEXPECTED });
      }
    },
  );
});

describe("decision 4: a redaction names only a field the file declares", () => {
  // A key is the code's own text. Named by it, a redaction carried a value, or a URI, to
  // the agent. A key the file does not declare is listed as <unlabelled>, at its place.
  it("DSOR-CLS-02b: a key the file does not declare is listed as <unlabelled>, so the key never reaches the agent", async () => {
    const answer = await runAs(AGENT, async () => ({ ...MASKED_1008_OF_456, [BANK]: true }));
    expect(JSON.stringify(answer)).not.toContain(BANK);
    expect(answer).toMatchObject({ data: MASKED_1008_OF_456 });
    expect((answer as { redactions?: unknown }).redactions).toStrictEqual([
      omitted("<unlabelled>"),
    ]);
  });

  // However many such keys, at one place, the list names that place once: it tells the
  // agent that something was withheld there, not how much.
  it("DSOR-CLS-02b: two keys the file does not declare, at one place, are listed once", async () => {
    const answer = await runAs(AGENT, async () => ({ ...MASKED_1008_OF_456, a: 1, b: 2 }));
    expect((answer as { redactions?: unknown }).redactions).toStrictEqual([
      omitted("<unlabelled>"),
    ]);
  });
});

describe("decision 3: every key a person may see is kept", () => {
  // A key named __proto__ vanished from a person's answer, and still made it confidential.
  // Found by a hostile pass on the Stage 2 review's fix, and fixed from step 14 on.
  it("DSOR-CLS-03: a key named __proto__ stays in a person's answer, as its own field", async () => {
    const answer = await runAs(SUPERVISOR, async () => ({
      ...MASKED_1008_OF_456,
      ["__proto__"]: "x",
    }));
    const data = (answer as { data: object }).data;
    expect(Object.keys(data)).toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(data, "__proto__")?.value).toBe("x");
    expect(answer).toMatchObject({ classification: "confidential" });
  });
});

describe("decision 3: today's answers for today's data are as they were", () => {
  /** The answer, as it was before the Stage 2 review. */
  function sameAs(answer: Answer, expected: object): void {
    expect(answer).toStrictEqual(expected);
  }

  // amount and open_amount are Money now, a kind with lines of its own, and keep their own
  // label, confidential. So the agent's answer, its redactions, and its label, and a
  // person's answer, are exactly as before. A guard: it passes before the change too.
  it("step 14's decision 3: the agent's INV-1008 and cfo_100's are unchanged by labels at every depth", async () => {
    sameAs(await call(registry, log, AGENT, "invoice.get", GET_1008), {
      data: MASKED_1008_OF_456,
      classification: "internal",
      redactions: MASKED_REDACTIONS,
      correlation: correlationFor(THE_AGENT),
    });
    sameAs(await call(registry, log, CFO, "invoice.get", GET_1008), {
      data: INV_1008_OF_456,
      classification: "confidential",
      correlation: correlationFor(THE_CFO),
    });
  });
});
