// NEW IN STEP 03: the registry at start-up, and calls by name, by claim (see the README).
import { describe, expect, it } from "vitest";
import { handlers } from "../src/operations.ts";
import { buildRegistry, call } from "../src/registry.ts";
import { contract, refusal, shipped, shippedWith, source, without } from "./helpers.ts";

describe("C1: nothing can be called without a contract", () => {
  const registry = buildRegistry(shipped, handlers);

  it("DSOR-OPR-01: invoice.get runs by its name", () => {
    const invoice = call(registry, "invoice.get", { id: "INV-1008" }) as { id: string };
    expect(invoice.id).toBe("INV-1008");
  });

  // "toString" and "constructor" are on every JavaScript object. A registry that looks
  // names up in a plain object would find code for them.
  it.each([["invoice.delete"], ["toString"], ["constructor"]])(
    "DSOR-OPR-01: an operation with no contract is refused: %s",
    (name) => {
      expect(() => call(registry, name, {})).toThrow(`no operation named "${name}"`);
    },
  );

  it("DSOR-OPR-01: code for an operation with no contract stops start-up", () => {
    const withExtra = { ...handlers, "invoice.delete": () => "deleted" };
    expect(refusal(() => buildRegistry(shipped, withExtra))).toMatch(
      /invoice\.delete has code but no contract/,
    );
  });

  it("DSOR-OPR-01: invoice.issue has a contract and no code yet, so a call is refused", () => {
    expect(registry.contracts.has("invoice.issue")).toBe(true);
    expect(() => call(registry, "invoice.issue", {})).toThrow(/invoice\.issue is not built yet/);
  });
});

describe("C5: the refusal happens at start-up, and names every problem", () => {
  it("DSOR-OPR-02a: one broken contract stops the whole registry loading", () => {
    const bad = without(contract("invoice.get"), "risk");
    expect(() => buildRegistry(shippedWith(bad), handlers)).toThrow();
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

  it("DSOR-OPR-02b: two contracts with one id are refused, not one picked", () => {
    const a = source(contract("invoice.get"), "a.json");
    const b = source({ ...contract("invoice.get"), risk: { level: "high" } }, "b.json");
    expect(refusal(() => buildRegistry([a, b], {}))).toMatch(
      "invoice.get has two contracts: a.json and b.json",
    );
  });
});

// No rule id: this is about the refusal's message, as in steps 01 and 02. The name comes
// from the caller, so it may be anything, even something huge.
describe("a refusal of a huge name", () => {
  it("shows only a short piece of it", () => {
    const registry = buildRegistry(shipped, handlers);
    const huge = "invoice." + "a".repeat(100_000);
    expect(() => call(registry, huge, {})).toThrow("no operation named");
    expect(refusal(() => call(registry, huge, {})).length).toBeLessThan(200);
  });
});
