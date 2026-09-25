// What the specification's schema refuses, by step 03's claims (C1 to C7 in step 03's
// README).
import { describe, expect, it } from "vitest";
import { handlers } from "../src/operations.ts";
import { buildRegistry } from "../src/registry.ts";
import { contract, refusal, shipped, shippedWith, source, without } from "./helpers.ts";

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

// The four fields DSOR-OPR-02b names. Each is missing inside an object that is there,
// which is where code is most tempted to guess: `contract.risk.level ?? "low"`.
describe("C6: nothing is filled in for the four fields the rule names", () => {
  it.each([
    ["risk level", { risk: {} }, "/risk must have required property 'level'"],
    [
      "execution semantics",
      { execution: {} },
      "/execution must have required property 'semantics'",
    ],
    ["idempotency", { idempotency: {} }, "/idempotency must have required property 'required'"],
  ])("DSOR-OPR-02b: a command with no %s is refused, not given one", (_why, change, problem) => {
    const bad = { ...contract("invoice.issue"), ...change };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(problem);
  });

  // Found by the review: a guess made only for queries passed every test above.
  it("DSOR-OPR-02b: a query with no risk level is refused, not given one", () => {
    const bad = { ...contract("invoice.get"), risk: {} };
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      "/risk must have required property 'level'",
    );
  });

  it("DSOR-OPR-02b: a contract with no effect is refused, not given one", () => {
    const bad = without(contract("invoice.get"), "effect");
    expect(refusal(() => buildRegistry([source(bad)], {}))).toMatch(
      "must have required property 'effect'",
    );
  });
});
