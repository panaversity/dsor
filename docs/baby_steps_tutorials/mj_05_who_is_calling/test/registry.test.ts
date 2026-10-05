// The registry at start-up, and calls by name, by step 03's claims (C1 to C7 in step 03's
// README). From step 04, call answers with an envelope instead of throwing.
import { describe, expect, it, vi } from "vitest";
import type { ErrorEnvelope } from "../src/envelope.ts";
import { handlers } from "../src/operations.ts";
import { buildRegistry, call, type Handler } from "../src/registry.ts";
import { AGENT, contract, refusal, shipped, shippedWith, source, without } from "./helpers.ts";

// NEW IN STEP 05: every call carries the agent's login token (step 05's README, decision 1).

describe("C1: nothing can be called without a contract", () => {
  const registry = buildRegistry(shipped, handlers);

  // The invoice comes back as the envelope's data.
  it("DSOR-OPR-01: invoice.get runs by its name", () => {
    expect(call(registry, AGENT, "invoice.get", { id: "INV-1008" })).toMatchObject({
      data: { id: "INV-1008" },
    });
  });

  // Found by the review: with one invoice, code that ignored the caller's input and
  // always read INV-1008 passed the test above.
  // INV-9999 is refused with a code, not answered with undefined.
  it("DSOR-OPR-01: invoice.get passes the caller's input to its code", () => {
    expect(call(registry, AGENT, "invoice.get", { id: "INV-9999" })).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  // No rule id: checking an operation's input is not step 03's rule.
  // The refusal is an envelope, not a thrown TypeError.
  it("invoice.get without an id is refused", () => {
    expect(call(registry, AGENT, "invoice.get", {})).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  // "toString" and "constructor" are on every JavaScript object. A registry that looks
  // names up in a plain object would find code for them.
  // The refusal is an envelope, not a throw.
  it.each([["invoice.delete"], ["toString"], ["constructor"]])(
    "DSOR-OPR-01: an operation with no contract is refused: %s",
    (name) => {
      expect(call(registry, AGENT, name, {})).toMatchObject({
        code: "UNSUPPORTED_CAPABILITY",
        message: `no operation named "${name}"`,
      });
    },
  );

  it("DSOR-OPR-01: code for an operation with no contract stops start-up", () => {
    const withExtra = { ...handlers, "invoice.delete": () => "deleted" };
    expect(refusal(() => buildRegistry(shipped, withExtra))).toMatch(
      /invoice\.delete has code but no contract/,
    );
  });

  // Found by the review: the test above sees a refusal only by its words. Here the code
  // table holds a name with no contract, which buildRegistry never allows. The code must
  // still never run.
  it("DSOR-OPR-01: code with no contract is never run, even in a registry built by hand", () => {
    const spy = vi.fn<Handler>(() => "deleted");
    const handMade = { contracts: new Map(), handlers: new Map([["invoice.delete", spy]]) };
    // The refusal is an envelope, not a throw.
    expect(call(handMade, AGENT, "invoice.delete", {})).toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // The refusal is an envelope, not a throw.
  it("DSOR-OPR-01: invoice.issue has a contract and no code yet, so a call is refused", () => {
    expect(registry.contracts.has("invoice.issue")).toBe(true);
    expect(call(registry, AGENT, "invoice.issue", {})).toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
      message: '"invoice.issue" is not built yet',
    });
  });
});

describe("C5: the refusal happens at start-up, and names every problem", () => {
  it("DSOR-OPR-02a: a broken contract is rejected, and with it the whole registry", () => {
    const bad = without(contract("invoice.get"), "risk");
    const message = refusal(() => buildRegistry(shippedWith(bad), handlers));
    expect(message).toMatch("invoice.get.json: must have required property 'risk'");
    // Found by the review: the contract is broken, not missing. Its code must not also
    // be reported as "no contract", which would send the author to the wrong file.
    expect(message).not.toMatch("has code but no contract");
  });

  it("DSOR-OPR-02a: a contract with two problems gets both named", () => {
    const bad = without(without(contract("invoice.issue"), "risk"), "audit");
    const message = refusal(() => buildRegistry([source(bad, "invoice.issue.json")], {}));
    expect(message).toMatch("invoice.issue.json");
    expect(message).toMatch("must have required property 'risk'");
    expect(message).toMatch("must have required property 'audit'");
  });

  it("DSOR-OPR-02a: problems in two files, and code with no contract, are named together", () => {
    const noRisk = without(contract("invoice.get"), "risk");
    const noAudit = without(contract("invoice.issue"), "audit");
    const message = refusal(() =>
      buildRegistry(
        [source(noRisk, "invoice.get.json"), source(noAudit, "invoice.issue.json"), source(0)],
        { ...handlers, "invoice.delete": () => "deleted" },
      ),
    );
    expect(message).toMatch("invoice.get.json: must have required property 'risk'");
    expect(message).toMatch("invoice.issue.json: must have required property 'audit'");
    expect(message).toMatch("test.json: must be object");
    expect(message).toMatch("invoice.delete has code but no contract");
  });

  it("DSOR-OPR-02a: a file that is not JSON is named with the others", () => {
    const broken = { file: "broken.json", text: '{ "id": "invoice.get",' };
    const noRisk = without(contract("invoice.issue"), "risk");
    const message = refusal(() => buildRegistry([broken, source(noRisk)], {}));
    expect(message).toMatch("broken.json: not valid JSON");
    expect(message).toMatch("test.json: must have required property 'risk'");
  });

  // Found by step 04's review: without the `continue` after a contract's problems, a file
  // that holds null crashed start-up with a TypeError, and the other problem went unnamed.
  it("DSOR-OPR-02a: a file that holds null is named with the others", () => {
    const noRisk = without(contract("invoice.issue"), "risk");
    const message = refusal(() => buildRegistry([source(noRisk), source(null, "null.json")], {}));
    expect(message).toMatch("test.json: must have required property 'risk'");
    expect(message).toMatch("null.json: must be object");
  });
});

describe("C7: a loaded contract is exactly what was written", () => {
  it("DSOR-OPR-02b: each loaded contract equals its file", () => {
    const registry = buildRegistry(shipped, handlers);
    // An empty list would make the loop below prove nothing.
    expect(shipped).toHaveLength(2);
    for (const s of shipped) {
      const written = JSON.parse(s.text) as { id: string };
      expect(registry.contracts.get(written.id)).toStrictEqual(written);
    }
  });

  it('DSOR-OPR-02b: version "1", text instead of a number, is refused', () => {
    const bad = { ...contract("invoice.get"), version: "1" };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(/\/version must be integer/);
  });

  it("DSOR-OPR-02b: an unknown extra field is refused, not deleted", () => {
    const bad = { ...contract("invoice.get"), owner: "user_123" };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      'must NOT have additional properties: "owner"',
    );
  });

  // No rule id: refusing both is step 03's decision 7. Keeping one would be a guess.
  it("two contracts with one id are refused, not one picked", () => {
    const a = source(contract("invoice.get"), "a.json");
    const b = source({ ...contract("invoice.get"), risk: { level: "high" } }, "b.json");
    expect(refusal(() => buildRegistry([a, b], {}))).toMatch(
      '"invoice.get" has two contracts: a.json and b.json',
    );
  });

  // Found by the review: when the second file was also broken, only its schema problem
  // was named. The two files were found only after a fix and a restart.
  it("two contracts with one id are named even when one is broken", () => {
    const a = source(contract("invoice.get"), "a.json");
    const b = source(without(contract("invoice.get"), "risk"), "b.json");
    const message = refusal(() => buildRegistry([a, b], {}));
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
    (_where, from, to, key) => {
      const text = JSON.stringify(contract("invoice.get")).replace(from, to);
      expect(refusal(() => buildRegistry([{ file: "invoice.get.json", text }], {}))).toMatch(
        `invoice.get.json: "${key}" is written twice in one object`,
      );
    },
  );

  it("a value that repeats its own key's name is not a key written twice", () => {
    const text = JSON.stringify({ ...contract("invoice.get"), input: { schema: "schema" } });
    expect(refusal(() => buildRegistry([{ file: "invoice.get.json", text }], {}))).toBe("");
  });
});

// No rule id: this is about the refusal's message, as in steps 01 and 02. The name comes
// from the caller, so it may be anything, even something huge.
describe("a refusal of a huge name", () => {
  // The message is in the envelope.
  it("shows only a short piece of it", () => {
    const registry = buildRegistry(shipped, handlers);
    const huge = "invoice." + "a".repeat(100_000);
    const { message } = call(registry, AGENT, huge, {}) as ErrorEnvelope;
    expect(message).toMatch("no operation named");
    expect(message.length).toBeLessThan(200);
  });
});
