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

  // The schema asks for more fields when a command cannot be undone. A hand-written list
  // of the 16 field names would miss these, so they prove the real schema is used (C2).
  const APPROVER = { permission: "invoice:issue", approve_permission: "invoice:approve" };
  const IN_FLIGHT = { exclusive_over: ["invoice"] };

  it("DSOR-OPR-02a: a command that can never be undone, without in_flight, is refused", () => {
    const bad = {
      ...contract("invoice.issue"),
      execution: { semantics: "non_compensatable" },
      authorization: APPROVER,
    };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      "must have required property 'in_flight'",
    );
  });

  it("DSOR-OPR-02a: a command that can never be undone, without an approver, is refused", () => {
    const bad = {
      ...contract("invoice.issue"),
      execution: { semantics: "non_compensatable" },
      in_flight: IN_FLIGHT,
    };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      "/authorization must have required property 'approve_permission'",
    );
  });

  it.each([["compensatable"], ["saga"]])(
    "DSOR-OPR-02a: a %s command without compensated_by is refused",
    (semantics) => {
      const bad = { ...contract("invoice.issue"), execution: { semantics } };
      expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
        "/execution must have required property 'compensated_by'",
      );
    },
  );

  // The same contracts with the missing field put back are accepted. So the refusals
  // above are for that field, not for something else.
  it("DSOR-OPR-02a: the same commands, with those fields, are accepted", () => {
    const neverUndone = {
      ...contract("invoice.issue"),
      execution: { semantics: "non_compensatable" },
      authorization: APPROVER,
      in_flight: IN_FLIGHT,
    };
    const undoable = {
      ...contract("invoice.issue"),
      execution: { semantics: "compensatable", compensated_by: ["invoice.cancel"] },
    };
    for (const good of [neverUndone, undoable]) {
      expect(buildRegistry([source(good)], {}).contracts.has("invoice.issue")).toBe(true);
    }
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

// The four fields DSOR-OPR-02b names. Each is missing inside an object that is there,
// which is where code is most tempted to guess: `contract.risk.level ?? "low"`.
describe("C6: nothing is filled in for the four fields the rule names", () => {
  it.each([
    ["risk level", { risk: {} }, "/risk must have required property 'level'"],
    ["execution semantics", { execution: {} }, "/execution must have required property 'semantics'"],
    ["idempotency", { idempotency: {} }, "/idempotency must have required property 'required'"],
  ])("DSOR-OPR-02b: a command with no %s is refused, not given one", (_why, change, problem) => {
    const bad = { ...contract("invoice.issue"), ...change };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(problem);
  });

  it("DSOR-OPR-02b: a contract with no effect is refused, not given one", () => {
    const bad = without(contract("invoice.get"), "effect");
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      "must have required property 'effect'",
    );
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
