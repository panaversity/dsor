// NEW IN STEP 03: the registry refuses a bad contract before anything runs.
//
// "At start-up" is the point. A contract that is wrong must stop the program while it
// is loading, not on the first request that happens to use it.

import { describe, expect, it } from "vitest";
import { contractsFromDisk, loadRegistry, validateContract } from "../src/registry.ts";

/** A fresh copy of one contract as it sits on disk, safe to break in a test. */
function contractCopy(id: string): Record<string, unknown> {
  const found = contractsFromDisk().find((c) => c.where.endsWith(`${id}.json`));

  if (found === undefined) {
    throw new Error(`no contract file for ${id}`);
  }

  return structuredClone(found.document) as Record<string, unknown>;
}

describe("the operation registry", () => {
  it("DSOR-OPR-01: every contract this step ships validates against operation-contract.schema.json", () => {
    const registry = loadRegistry(contractsFromDisk());

    expect([...registry.keys()].sort()).toEqual(["invoice.get", "invoice.issue"]);
  });

  // The map's "done when" for this step, word for word.
  it("DSOR-OPR-02a: a contract with no risk level is refused at start-up", () => {
    const broken = contractCopy("invoice.issue");
    delete broken["risk"];

    expect(() => loadRegistry([{ where: "invoice.issue.json", document: broken }])).toThrow(
      TypeError,
    );
  });

  it("DSOR-OPR-02a: the refusal names the contract and the missing field", () => {
    const broken = contractCopy("invoice.issue");
    delete broken["risk"];

    expect(() => loadRegistry([{ where: "invoice.issue.json", document: broken }])).toThrow(
      /invoice\.issue\.json/,
    );
    expect(() => loadRegistry([{ where: "invoice.issue.json", document: broken }])).toThrow(/risk/);
  });

  // DSOR-OPR-02b is not something a schema can prove. A `required` list shows a field
  // was missing from the document; it cannot show that the registry did not quietly
  // fill the value in itself. So this test does two things: it refuses each of the
  // four fields the rule names, and it checks the loaded contract still holds exactly
  // what the file says, with nothing added.
  it("DSOR-OPR-02b: the registry supplies no default for risk, effect, idempotency, or execution", () => {
    // Deleting the whole object is the easy half. The rule names the VALUES — "risk
    // level", "execution semantics" — so the leaves are what matter. A registry that
    // filled in `risk.level` while leaving `risk` in place would break the rule and
    // pass a test that only deleted `risk`.
    const leaves: readonly (readonly string[])[] = [
      ["effect"],
      ["risk"],
      ["risk", "level"],
      ["idempotency"],
      ["idempotency", "required"],
      ["execution"],
      ["execution", "semantics"],
    ];

    for (const path of leaves) {
      const broken = contractCopy("invoice.issue");
      let at: Record<string, unknown> = broken;

      for (const key of path.slice(0, -1)) {
        at = at[key] as Record<string, unknown>;
      }

      delete at[path[path.length - 1] as string];

      expect(() =>
        loadRegistry([{ where: `missing-${path.join(".")}.json`, document: broken }]),
      ).toThrow(TypeError);
    }
  });

  it("DSOR-OPR-02b: the loaded contract is exactly what the file says, with nothing added", () => {
    const onDisk = contractCopy("invoice.issue");
    const loaded = loadRegistry(contractsFromDisk()).get("invoice.issue");

    if (loaded === undefined) {
      throw new Error("invoice.issue is missing from the registry");
    }

    // The whole document, not four chosen fields. Any key the registry adds at any
    // depth turns this red.
    expect(loaded).toEqual(onDisk);

    // And the declared values are the honest ones: nothing in this step reads
    // delegation or idempotency, so both say false rather than making a promise.
    expect(loaded.idempotency).toEqual({ required: false });
    expect(loaded.execution).toEqual({ semantics: "atomic" });
  });

  // ajv can be told to rewrite the document it is checking. Both options are off, and
  // this test is what keeps them off: `coerceTypes` would turn the string "1" into the
  // number 1 rather than refusing it.
  it("DSOR-OPR-02b: a version written as text is refused, not quietly converted", () => {
    const broken = contractCopy("invoice.issue");
    broken["version"] = "1";

    expect(() => loadRegistry([{ where: "text-version.json", document: broken }])).toThrow(
      /version/,
    );
  });

  it("DSOR-OPR-02a: a query whose effect is not read is refused", () => {
    const broken = contractCopy("invoice.get");
    broken["effect"] = "mutating";

    expect(() => loadRegistry([{ where: "invoice.get.json", document: broken }])).toThrow(/effect/);
  });

  // Not a rule of the specification: an operation id is a name, and two operations
  // answering to one name would make the registry ambiguous.
  it("two contracts with the same id are refused", () => {
    const one = contractCopy("invoice.get");

    expect(() =>
      loadRegistry([
        { where: "a.json", document: one },
        { where: "b.json", document: structuredClone(one) },
      ]),
    ).toThrow(/invoice\.get/);
  });

  // Freezing the top level is not enough. `risk`, `audit` and `authorization` are
  // objects of their own, and a handler is handed the whole contract — so a shallow
  // freeze would let anything downstream permanently lower the risk level or blank the
  // audit level for the life of the process.
  it("what the registry hands back cannot be changed, all the way down", () => {
    const registry = loadRegistry(contractsFromDisk());
    const contract = registry.get("invoice.get");

    if (contract === undefined) {
      throw new Error("invoice.get is missing from the registry");
    }

    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.risk)).toBe(true);
    expect(Object.isFrozen(contract.audit)).toBe(true);
    expect(Object.isFrozen(contract.authorization)).toBe(true);

    expect(() => {
      // @ts-expect-error the fields are readonly, so this assignment must not compile
      contract.effect = "destructive";
    }).toThrow(TypeError);

    expect(() => {
      // @ts-expect-error risk.level is readonly too
      contract.risk.level = "low";
    }).toThrow(TypeError);

    expect(() => {
      // @ts-expect-error and so is the permission
      contract.authorization.permission = "nothing:atall";
    }).toThrow(TypeError);

    expect(registry.get("invoice.get")?.risk.level).toBe("low");
  });

  // F4: a contract file must declare the operation it is named for. Without this, two
  // files could swap ids and every handler would run against the wrong spec sheet.
  it("DSOR-OPR-01: a contract whose id does not match its file is refused", () => {
    const wrong = contractCopy("invoice.get");
    wrong["id"] = "invoice.issue";

    expect(() =>
      loadRegistry([
        { where: "src/contracts/invoice.get.json", expectedId: "invoice.get", document: wrong },
      ]),
    ).toThrow(/invoice\.get/);
  });
});

describe("validateContract", () => {
  it("DSOR-OPR-02a: a document that is not an object at all is refused", () => {
    expect(() => validateContract("invoice.get", "a-string.json")).toThrow(TypeError);
    expect(() => validateContract(null, "null.json")).toThrow(TypeError);
  });

  // The schema says a contract may not carry fields it does not know about, so a
  // friendly "description" has to go under `extensions` with a reverse-DNS key
  // (DSOR-SCH-02). Worth meeting once, because the urge to add one is strong.
  it("DSOR-OPR-02a: a helpful extra field is refused, and extensions is the way in", () => {
    const extra = contractCopy("invoice.get");
    extra["description"] = "Reads one invoice";

    expect(() => validateContract(extra, "extra.json")).toThrow(TypeError);

    const proper = contractCopy("invoice.get");
    proper["extensions"] = { "com.example.notes": { description: "Reads one invoice" } };

    expect(() => validateContract(proper, "proper.json")).not.toThrow();
  });
});
