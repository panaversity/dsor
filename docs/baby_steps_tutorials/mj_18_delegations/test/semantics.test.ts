// Every command declares whether it can be undone, its answer says which
// label applied, and a declared undo is a real command that DSoR can run (DSOR-EXE-05a,
// DSOR-EXE-05b, DSOR-EXE-05c in specs/dsor/03-execution.md, section 24; step 17's README,
// C1 to C3).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLog } from "../src/log.ts";
import { call } from "../src/pipeline.ts";
import { buildRegistry, type Handler } from "../src/registry.ts";
import {
  STARTING_ROLES,
  SUPERVISOR,
  contract,
  handlers,
  paymentRegistry,
  refusal,
  rolesFile,
  shipped,
  shippedRoles,
  shippedWith,
  without,
} from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CREATE = { invoice: "dsor://org_456/invoice/INV-1008" };

/** payment.create's contract with its execution replaced. */
function createWith(execution: unknown): Record<string, unknown> {
  return { ...contract("payment.create"), execution };
}

/** What start-up says about the shipped contracts with one changed, and this code. */
function startWith(changed: Record<string, unknown>, code = handlers): string {
  return refusal(() => buildRegistry(shippedWith(changed), code, shippedRoles));
}

/** The refusal of a start-up that found these problems, and only these. */
function refusedWith(...problems: string[]): string {
  return `the registry refused to start:\n  ${problems.join("\n  ")}`;
}

// A contract that fails the schema is not loaded, so its input schema belongs to no contract,
// and start-up names that too.
const ORPHAN = "inputs/PaymentCreateRequest.schema.json: no contract names this input schema";

/**
 * Starts the program with the shipped contracts, one of them replaced, and gives back
 * what it printed and its exit code.
 */
function runWith(changed: Record<string, unknown>): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "dsor-contracts-"));
  try {
    for (const { file, text } of shipped) writeFileSync(join(dir, file), text);
    writeFileSync(join(dir, `${String(changed["id"])}.json`), JSON.stringify(changed));
    const run = spawnSync(process.execPath, [MAIN, dir], { encoding: "utf8", timeout: 25_000 });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(dir, { recursive: true });
  }
}

describe("C1: every command declares its semantics in its contract", () => {
  it("DSOR-EXE-05a: a command contract with no execution stops start-up, named", () => {
    expect(startWith(without(contract("payment.create"), "execution"))).toBe(
      refusedWith(
        "payment.create.json: must have required property 'execution'",
        'payment.create.json: must match "then" schema',
        ORPHAN,
      ),
    );
  });

  // DSOR-OPR-02b: the registry infers no default for the semantics.
  it("DSOR-EXE-05a: a command contract whose execution names no semantics stops start-up, named", () => {
    expect(startWith(createWith({ compensated_by: ["payment.cancel"] }))).toBe(
      refusedWith(
        "payment.create.json: /execution must have required property 'semantics'",
        ORPHAN,
      ),
    );
  });

  it("DSOR-EXE-05a: a label that is not one of the five stops start-up", () => {
    expect(startWith(createWith({ semantics: "reversible" }))).toMatch(
      /payment\.create\.json: \/execution\/semantics must be equal to one of the allowed values/,
    );
  });

  // Typed out from step 17's README, decision 7.
  it("DSOR-EXE-05a: every shipped command declares one of the five, as decision 7 chose", () => {
    const commands = shipped
      .map((s) => JSON.parse(s.text) as Record<string, any>)
      .filter((c) => c["kind"] === "command");
    expect(commands.map((c) => [c["id"], c["execution"]?.semantics])).toStrictEqual([
      ["invoice.issue", "atomic"],
      ["payment.cancel", "atomic"],
      ["payment.create", "compensatable"],
    ]);
  });

  it(
    "DSOR-EXE-05a: the program refuses to start with a command that declares no semantics: named, exit code 1",
    { timeout: 30_000 },
    () => {
      const run = runWith(without(contract("payment.create"), "execution"));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("payment.create.json: must have required property 'execution'");
      // Refused before it lists its operations, so no caller ever reaches it.
      expect(run.stdout).not.toContain("operations:");
    },
  );
});

describe("C2: every command's answer states the semantics that applied, from its contract", () => {
  it("DSOR-EXE-05b: payment.create answers compensatable", async () => {
    const answer = await call(
      paymentRegistry([]),
      createLog(),
      SUPERVISOR,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ semantics: "compensatable" });
  });

  it("DSOR-EXE-05b: payment.cancel answers atomic", async () => {
    const on = paymentRegistry([]);
    await call(on, createLog(), SUPERVISOR, "payment.create", CREATE);
    const answer = await call(on, createLog(), SUPERVISOR, "payment.cancel", {
      payment: "dsor://org_456/payment/PAY-901",
    });
    expect(answer).toMatchObject({ semantics: "atomic" });
  });

  // The code returns data, and nothing it returns can set the label.
  it("DSOR-EXE-05b: code that answers with a label of its own is overruled by the contract", async () => {
    const real = handlers["payment.create"];
    const planted: Handler = async (input, company) => ({
      ...((await real?.(input, company)) as object),
      semantics: "atomic",
    });
    const on = paymentRegistry([], shipped, { ...handlers, "payment.create": planted });
    const answer = await call(on, createLog(), SUPERVISOR, "payment.create", CREATE);
    expect(answer).toMatchObject({ semantics: "compensatable" });
  });

  // Found while writing the design: a label typed into the pipeline would pass both tests
  // above. The answer must follow the contract when the contract changes.
  it("DSOR-EXE-05b: a contract changed to atomic changes the answer to atomic", async () => {
    const changed = shippedWith(createWith({ semantics: "atomic" }));
    const answer = await call(
      paymentRegistry([], changed),
      createLog(),
      SUPERVISOR,
      "payment.create",
      CREATE,
    );
    expect(answer).toMatchObject({ semantics: "atomic" });
  });

  // DSOR-EXE-05b is about commands. A query changes nothing, so it has nothing to undo.
  it("step 17's decision 2: a query's answer carries no semantics", async () => {
    const answer = await call(paymentRegistry([]), createLog(), SUPERVISOR, "invoice.get", CREATE);
    expect(answer).toHaveProperty("data");
    expect(answer).not.toHaveProperty("semantics");
  });
});

describe("C3: a compensatable command names a real undo, checked at start-up", () => {
  it("DSOR-EXE-05c: the shipped payment.create names payment.cancel, a built command, and starts", () => {
    expect(contract("payment.create")["execution"]).toStrictEqual({
      semantics: "compensatable",
      compensated_by: ["payment.cancel"],
    });
    expect(startWith(contract("payment.create"))).toBe("");
  });

  // The schema accepts an empty list. Then the label says "can be undone", and nothing can
  // undo it (step 17's README, decision 8).
  it("DSOR-EXE-05c: an empty undo list stops start-up, named", () => {
    expect(startWith(createWith({ semantics: "compensatable", compensated_by: [] }))).toBe(
      refusedWith("payment.create: compensated_by is empty, so it names nothing that undoes it"),
    );
  });

  it.each([
    ["a name with no contract", "payment.cancle", "which has no contract"],
    ["a query", "invoice.get", "which is a query"],
    ["the operation itself", "payment.create", "which is the operation itself"],
  ])("DSOR-EXE-05c: an undo list that names %s stops start-up, named", (_what, name, why) => {
    expect(startWith(createWith({ semantics: "compensatable", compensated_by: [name] }))).toBe(
      refusedWith(`payment.create: compensated_by names "${name}", ${why}`),
    );
  });

  // A contract with no code cannot be run, so it cannot undo anything.
  it("DSOR-EXE-05c: an undo with a contract and no code stops start-up, named", () => {
    const { "payment.cancel": _gone, ...withoutCancel } = handlers;
    expect(startWith(contract("payment.create"), withoutCancel)).toBe(
      refusedWith('payment.create: compensated_by names "payment.cancel", which has no code'),
    );
  });

  it("DSOR-EXE-05c: a saga's undo list is checked too", () => {
    expect(startWith(createWith({ semantics: "saga", compensated_by: [] }))).toBe(
      refusedWith("payment.create: compensated_by is empty, so it names nothing that undoes it"),
    );
  });

  // Decision 8 checks every undo list a contract writes, whatever its label.
  it("step 17's decision 8: an atomic command's undo list is checked too", () => {
    const cancel = {
      ...contract("payment.cancel"),
      execution: { semantics: "atomic", compensated_by: ["x.y"] },
    };
    expect(startWith(cancel)).toBe(
      refusedWith('payment.cancel: compensated_by names "x.y", which has no contract'),
    );
  });

  it("DSOR-EXE-05c: every wrong name in one list is named at once", () => {
    const list = { semantics: "compensatable", compensated_by: ["payment.cancle", "invoice.get"] };
    expect(startWith(createWith(list))).toBe(
      refusedWith(
        'payment.create: compensated_by names "payment.cancle", which has no contract',
        'payment.create: compensated_by names "invoice.get", which is a query',
      ),
    );
  });

  // The success signal of step 17's README.
  it(
    "DSOR-EXE-05c: the program refuses to start with an empty undo list: named, exit code 1",
    { timeout: 30_000 },
    () => {
      const run = runWith(createWith({ semantics: "compensatable", compensated_by: [] }));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        "payment.create: compensated_by is empty, so it names nothing that undoes it",
      );
      expect(run.stdout).not.toContain("operations:");
    },
  );
});

// Finding B of the review. An undo that no role may run cannot undo anything,
// whoever asks: payment.create still said "compensatable", and every cancel was refused.
describe("the review: an undo must be one that some role may run", () => {
  it("DSOR-EXE-05c: an undo whose permission no role grants stops start-up, named", () => {
    const noCancel = rolesFile({
      ...STARTING_ROLES,
      ap_supervisor: ["invoice:read", "invoice:issue", "payment:create"],
    });
    expect(refusal(() => buildRegistry(shipped, handlers, noCancel))).toBe(
      refusedWith('payment.create: compensated_by names "payment.cancel", which no role may run'),
    );
  });

  // The CFO alone may cancel: one role is enough.
  it("DSOR-EXE-05c: one role that grants the undo's permission is enough", () => {
    const cfoCancels = rolesFile({
      ...STARTING_ROLES,
      ap_supervisor: ["invoice:read", "invoice:issue", "payment:create"],
      CFO: ["invoice:read", "payment:cancel"],
    });
    expect(refusal(() => buildRegistry(shipped, handlers, cfoCancels))).toBe("");
  });
});
