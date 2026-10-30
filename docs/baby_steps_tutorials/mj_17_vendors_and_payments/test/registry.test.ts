// The registry at start-up, and calls by name, by step 03's claims (C1 to C7 in step 03's
// README). From step 04, call answers with an envelope instead of throwing.
import { describe, expect, it, vi } from "vitest";
import type { ErrorEnvelope } from "../src/envelope.ts";
import { memoryInvoices, NO_STORE } from "../src/invoice.ts";
import { NO_PAYMENTS } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import {
  AGENT,
  GOOD_ISSUE,
  SUPERVISOR,
  contract,
  handlers,
  log,
  refusal,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  shippedWith,
  source,
  without,
} from "./helpers.ts";

// Every call carries the agent's login token (step 05's README, decision 1).
// Every registry is built with the role table too (step 06's README,
// decision 1).

describe("C1: nothing can be called without a contract", () => {
  // With the invoices in memory: the registry holds the store (step 10's README, decision 13).
  const registry = buildRegistry(
    shipped,
    handlers,
    shippedRoles,
    shippedInputs,
    shippedLabels,
    memoryInvoices(),
  );

  // The invoice comes back as the envelope's data.
  it("DSOR-OPR-01: invoice.get runs by its name", async () => {
    expect(
      await call(registry, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-1008",
      }),
    ).toMatchObject({
      data: { id: "INV-1008" },
    });
  });

  // Found by the review: with one invoice, code that ignored the caller's input and
  // always read INV-1008 passed the test above.
  // INV-9999 is refused with a code, not answered with undefined.
  it("DSOR-OPR-01: invoice.get passes the caller's input to its code", async () => {
    expect(
      await call(registry, log, AGENT, "invoice.get", {
        invoice: "dsor://org_456/invoice/INV-9999",
      }),
    ).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  // No rule id: checking an operation's input is not step 03's rule.
  // The refusal is an envelope, not a thrown TypeError.
  it("invoice.get without an invoice is refused", async () => {
    expect(await call(registry, log, AGENT, "invoice.get", {})).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  // "toString" and "constructor" are on every JavaScript object. A registry that looks
  // names up in a plain object would find code for them.
  // The refusal is an envelope, not a throw.
  it.each([["invoice.delete"], ["toString"], ["constructor"]])(
    "DSOR-OPR-01: an operation with no contract is refused: %s",
    async (name) => {
      expect(await call(registry, log, AGENT, name, {})).toMatchObject({
        code: "UNSUPPORTED_CAPABILITY",
        message: `no operation named "${name}"`,
      });
    },
  );

  it("DSOR-OPR-01: code for an operation with no contract stops start-up", async () => {
    const withExtra = { ...handlers, "invoice.delete": () => "deleted" };
    expect(refusal(() => buildRegistry(shipped, withExtra, shippedRoles))).toMatch(
      /invoice\.delete has code but no contract/,
    );
  });

  // Found by the review: the test above sees a refusal only by its words. Here the code
  // table holds a name with no contract, which buildRegistry never allows. The code must
  // still never run.
  it("DSOR-OPR-01: code with no contract is never run, even in a registry built by hand", async () => {
    const spy = vi.fn<Handler>(() => "deleted");
    // A registry holds a role table too. This one grants nothing.
    const handMade = {
      contracts: new Map(),
      handlers: new Map([["invoice.delete", spy]]),
      roles: new Map(),
      // A registry holds the check for each input too. This one has none.
      inputs: new Map(),
      // And the labels. This one has none.
      classifications: new Map(),
      // And the store its operations read. This one reads nothing (step 10's README,
      // decision 13).
      invoices: NO_STORE,
      // And the store its commands write. This one writes nothing (step 17's README,
      // outcome 1).
      payments: NO_PAYMENTS,
    };
    // The refusal is an envelope, not a throw.
    expect(await call(handMade, log, AGENT, "invoice.delete", {})).toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // The refusal is an envelope, not a throw. user_123 calls, because only a
  // caller who holds invoice:issue gets as far as "not built yet" (step 06's README, C5).
  it("DSOR-OPR-01: invoice.issue has a contract and no code yet, so a call is refused", async () => {
    expect(registry.contracts.has("invoice.issue")).toBe(true);
    // A good input, so line ⑥ is not what refuses the call.
    expect(await call(registry, log, SUPERVISOR, "invoice.issue", GOOD_ISSUE)).toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
      message: '"invoice.issue" is not built yet',
    });
  });
});

describe("C5: the refusal happens at start-up, and names every problem", () => {
  it("DSOR-OPR-02a: a broken contract is rejected, and with it the whole registry", async () => {
    const bad = without(contract("invoice.get"), "risk");
    const message = refusal(() => buildRegistry(shippedWith(bad), handlers, shippedRoles));
    expect(message).toMatch("invoice.get.json: must have required property 'risk'");
    // Found by the review: the contract is broken, not missing. Its code must not also
    // be reported as "no contract", which would send the author to the wrong file.
    expect(message).not.toMatch("has code but no contract");
  });

  it("DSOR-OPR-02a: a contract with two problems gets both named", async () => {
    const bad = without(without(contract("invoice.issue"), "risk"), "audit");
    const message = refusal(() =>
      buildRegistry([source(bad, "invoice.issue.json")], {}, shippedRoles),
    );
    expect(message).toMatch("invoice.issue.json");
    expect(message).toMatch("must have required property 'risk'");
    expect(message).toMatch("must have required property 'audit'");
  });

  it("DSOR-OPR-02a: problems in two files, and code with no contract, are named together", async () => {
    const noRisk = without(contract("invoice.get"), "risk");
    const noAudit = without(contract("invoice.issue"), "audit");
    const message = refusal(() =>
      buildRegistry(
        [source(noRisk, "invoice.get.json"), source(noAudit, "invoice.issue.json"), source(0)],
        { ...handlers, "invoice.delete": () => "deleted" },
        shippedRoles,
      ),
    );
    expect(message).toMatch("invoice.get.json: must have required property 'risk'");
    expect(message).toMatch("invoice.issue.json: must have required property 'audit'");
    expect(message).toMatch("test.json: must be object");
    expect(message).toMatch("invoice.delete has code but no contract");
  });

  it("DSOR-OPR-02a: a file that is not JSON is named with the others", async () => {
    const broken = { file: "broken.json", text: '{ "id": "invoice.get",' };
    const noRisk = without(contract("invoice.issue"), "risk");
    const message = refusal(() => buildRegistry([broken, source(noRisk)], {}, shippedRoles));
    expect(message).toMatch("broken.json: not valid JSON");
    expect(message).toMatch("test.json: must have required property 'risk'");
  });

  // Found by step 04's review: without the `continue` after a contract's problems, a file
  // that holds null crashed start-up with a TypeError, and the other problem went unnamed.
  it("DSOR-OPR-02a: a file that holds null is named with the others", async () => {
    const noRisk = without(contract("invoice.issue"), "risk");
    const message = refusal(() =>
      buildRegistry([source(noRisk), source(null, "null.json")], {}, shippedRoles),
    );
    expect(message).toMatch("test.json: must have required property 'risk'");
    expect(message).toMatch("null.json: must be object");
  });
});

describe("C7: a loaded contract is exactly what was written", () => {
  it("DSOR-OPR-02b: each loaded contract equals its file", async () => {
    const registry = buildRegistry(shipped, handlers, shippedRoles);
    // An empty list would make the loop below prove nothing.
    // invoice.list is the third, and step 17's two commands the fourth and fifth.
    expect(shipped).toHaveLength(5);
    for (const s of shipped) {
      const written = JSON.parse(s.text) as { id: string };
      expect(registry.contracts.get(written.id)).toStrictEqual(written);
    }
  });

  it('DSOR-OPR-02b: version "1", text instead of a number, is refused', async () => {
    const bad = { ...contract("invoice.get"), version: "1" };
    expect(refusal(() => buildRegistry([source(bad)], {}, shippedRoles))).toMatch(
      /\/version must be integer/,
    );
  });

  it("DSOR-OPR-02b: an unknown extra field is refused, not deleted", async () => {
    const bad = { ...contract("invoice.get"), owner: "user_123" };
    expect(refusal(() => buildRegistry([source(bad)], {}, shippedRoles))).toMatch(
      'must NOT have additional properties: "owner"',
    );
  });

  // No rule id: refusing both is step 03's decision 7. Keeping one would be a guess.
  it("two contracts with one id are refused, not one picked", async () => {
    const a = source(contract("invoice.get"), "a.json");
    const b = source({ ...contract("invoice.get"), risk: { level: "high" } }, "b.json");
    expect(refusal(() => buildRegistry([a, b], {}, shippedRoles))).toMatch(
      '"invoice.get" has two contracts: a.json and b.json',
    );
  });

  // Found by the review: when the second file was also broken, only its schema problem
  // was named. The two files were found only after a fix and a restart.
  it("two contracts with one id are named even when one is broken", async () => {
    const a = source(contract("invoice.get"), "a.json");
    const b = source(without(contract("invoice.get"), "risk"), "b.json");
    const message = refusal(() => buildRegistry([a, b], {}, shippedRoles));
    expect(message).toMatch('"invoice.get" has two contracts: a.json and b.json');
    expect(message).toMatch("b.json: must have required property 'risk'");
  });

  // No rule id: JSON.parse keeps the last of two values for one key, and says nothing.
  // Keeping one would be a guess, as with two contracts for one id (step 03's README,
  // decision 7). Found by step 06's review, and fixed from step 03 on. JSON.stringify
  // never writes a key twice, so each text is changed by hand.
  it.each([
    ["at the top", '"risk":', '"risk":{"level":"high"},"risk":', "risk"],
    [
      "inside another object",
      '"permission":',
      '"permission":"invoice:issue","permission":',
      "permission",
    ],
    [
      "once plainly and once with a \\u escape",
      '"risk":',
      '"risk":{"level":"high"},"\\u0072isk":',
      "risk",
    ],
  ])(
    "a key written twice, %s, is refused, not one of its values picked",
    async (_where, from, to, key) => {
      const text = JSON.stringify(contract("invoice.get")).replace(from, to);
      expect(
        refusal(() => buildRegistry([{ file: "invoice.get.json", text }], {}, shippedRoles)),
      ).toMatch(`invoice.get.json: "${key}" is written twice in one object`);
    },
  );

  it("a value that repeats its own key's name is not a key written twice", async () => {
    const text = JSON.stringify({ ...contract("invoice.get"), input: { schema: "schema" } });
    // The input schema that contract names must have a file too.
    // It is the only contract, so it is given the only input schema.
    const inputs = [
      { file: "schema.schema.json", text: '{ "type": "object", "additionalProperties": false }' },
    ];
    expect(
      refusal(() => buildRegistry([{ file: "invoice.get.json", text }], {}, shippedRoles, inputs)),
    ).toBe("");
  });
});

// No rule id: this is about the refusal's message, as in steps 01 and 02. The name comes
// from the caller, so it may be anything, even something huge.
describe("a refusal of a huge name", () => {
  // The message is in the envelope.
  it("shows only a short piece of it", async () => {
    const registry = buildRegistry(shipped, handlers, shippedRoles);
    const huge = "invoice." + "a".repeat(100_000);
    const { message } = (await call(registry, log, AGENT, huge, {})) as ErrorEnvelope;
    expect(message).toMatch("no operation named");
    expect(message.length).toBeLessThan(200);
  });
});
