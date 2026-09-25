// NEW IN STEP 03: the tests for contracts and the registry, by claim (see the README).
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handlers } from "../src/operations.ts";
import { buildRegistry, call, readContracts, type ContractSource } from "../src/registry.ts";

const CONTRACTS = fileURLToPath(new URL("../contracts", import.meta.url));

// The contracts this step ships, read from disk the way start-up reads them.
const shipped = readContracts(CONTRACTS);

/** The shipped contract with this id, as a plain object the test may change. */
function contract(id: string): Record<string, unknown> {
  const source = shipped.find((s) => (JSON.parse(s.text) as { id: string }).id === id);
  if (!source) throw new Error(`no shipped contract ${id}`);
  return JSON.parse(source.text) as Record<string, unknown>;
}

/** A contract as a file would hold it. */
function source(data: unknown, file = "test.json"): ContractSource {
  return { file, text: JSON.stringify(data) };
}

/** The shipped contracts, with one of them replaced. */
function shippedWith(changed: Record<string, unknown>): ContractSource[] {
  return shipped.map((s) =>
    (JSON.parse(s.text) as { id: string }).id === changed["id"] ? source(changed, s.file) : s,
  );
}

/** The message buildRegistry refused with, or "" when it did not refuse. */
function refusal(build: () => unknown): string {
  try {
    build();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

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

describe("C2: a contract passes the specification's own schema", () => {
  it("DSOR-OPR-01: both shipped contracts pass", () => {
    const registry = buildRegistry(shipped, handlers);
    expect([...registry.contracts.keys()].sort()).toEqual(["invoice.get", "invoice.issue"]);
  });

  it("DSOR-OPR-01: a risk level the schema does not list is refused", () => {
    const bad = { ...contract("invoice.get"), risk: { level: "extreme" } };
    expect(refusal(() => buildRegistry(shippedWith(bad), handlers))).toMatch(/\/risk\/level/);
  });
});

const ALWAYS_REQUIRED = [
  "id",
  "version",
  "kind",
  "effect",
  "input",
  "output",
  "authorization",
  "tenancy",
  "risk",
  "audit",
];
const COMMAND_ONLY = [
  "delegation",
  "idempotency",
  "concurrency",
  "execution",
  "preconditions",
  "controls",
];

/** A copy of the contract with one field removed. */
function without(data: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...data };
  delete copy[field];
  return copy;
}

describe("C3: a field every contract needs, left out, is refused", () => {
  it.each(ALWAYS_REQUIRED)("DSOR-OPR-02a: a contract without %s is refused", (field) => {
    const bad = without(contract("invoice.issue"), field);
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      `must have required property '${field}'`,
    );
  });
});

describe("C4: a command needs 6 more fields, and a query does not", () => {
  it.each(COMMAND_ONLY)("DSOR-OPR-02a: a command without %s is refused", (field) => {
    const bad = without(contract("invoice.issue"), field);
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      `must have required property '${field}'`,
    );
  });

  it("DSOR-OPR-02a: a query without the 6 command fields is accepted", () => {
    const query = contract("invoice.get");
    for (const field of COMMAND_ONLY) expect(query).not.toHaveProperty(field);
    expect(buildRegistry([source(query)], {}).contracts.has("invoice.get")).toBe(true);
  });

  it("DSOR-OPR-02a: a query whose effect is not read is refused", () => {
    const bad = { ...contract("invoice.get"), effect: "mutating" };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(/\/effect/);
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
});

describe("C6: a loaded contract is exactly what was written", () => {
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
      "must NOT have additional properties",
    );
  });
});
