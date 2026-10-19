// Step 34: the company's records sit behind a connector, whose declaration says what its system can
// do. Start-up checks every declaration and what each operation needs from it, and line ④ refuses a
// company's calls while its own connector is out of service (step 34's README, claims C1 to C4).
import { describe, expect, it } from "vitest";
import { checkConnectors, readConnectors, type ConnectorsSource } from "../src/connectors.ts";
import { keyed, refusal, shippedWith, contract, AGENT, FIRM_IN_789, USER_700 } from "./helpers.ts";
import { heard, ruleWorldOnTuesday } from "./rule-world.ts";

type File = { connectors: Record<string, unknown>[]; companies: Record<string, unknown> };

/** The shipped connectors file, as a plain object a test may change. */
function shippedFile(): File {
  return JSON.parse(readConnectors().text) as File;
}

/** The shipped accounting connector, as a plain object a test may change. */
function accounting(): Record<string, unknown> {
  return structuredClone(shippedFile().connectors[0]!);
}

/** A connectors file with these connectors and these companies. */
// Changed in step 35: each company names its bank too. The tests of step 34 name a records
// connector for each company, and this gives each the shipped fake bank, declared beside them.
function file(connectors: unknown[], companies: Record<string, unknown>): ConnectorsSource {
  const shipped = JSON.parse(readConnectors().text) as { connectors: { id: string }[] };
  const bank = shipped.connectors.find((one) => one.id === "fake-bank")!;
  const both = Object.fromEntries(
    Object.entries(companies).map(([company, records]) => [
      company,
      { records, bank: "fake-bank" },
    ]),
  );
  const all = [...connectors, bank];
  return { file: "connectors.json", text: JSON.stringify({ connectors: all, companies: both }) };
}

/** The accounting connector with these capabilities changed. */
function withCapabilities(
  changes: Record<string, unknown>,
  id = "accounting",
): Record<string, unknown> {
  const declaration = accounting();
  const capabilities = declaration["capabilities"] as Record<string, unknown>;
  return { ...declaration, id, capabilities: { ...capabilities, ...changes } };
}

/** A world whose org_789 keeps its records behind a connector of its own: this one. */
async function worldWith789(own: Record<string, unknown>) {
  const connectors = file([accounting(), own], { "*": "accounting", org_789: own["id"] });
  const none = undefined;
  return ruleWorldOnTuesday(none, none, none, none, none, none, none, connectors);
}

/** Start-up's refusal for this connectors file, or "" when it starts. */
async function startUp(
  connectors: ConnectorsSource,
  contracts?: Parameters<typeof ruleWorldOnTuesday>[3],
) {
  const none = undefined;
  try {
    await ruleWorldOnTuesday(none, none, none, contracts, none, none, none, connectors);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

describe("C1: every connector publishes a declaration that passes connector.schema.json", () => {
  it("DSOR-CNR-01a: the shipped accounting connector passes, and holds every company's records", async () => {
    const w = await ruleWorldOnTuesday();
    // Changed in step 35: a company names its records and its bank.
    const both = { records: "accounting", bank: "fake-bank" };
    expect(w.registry.plugs.connectorOf("org_456")).toStrictEqual(both);
    expect(w.registry.plugs.connectorOf("org_789")).toStrictEqual(both);
    expect(w.registry.plugs.outOfService("org_456", "invoice.get")).toBeUndefined();
  });

  it("DSOR-CNR-03a: a default connector that does not say whether it is the only writer stops start-up", async () => {
    const declaration = accounting();
    delete declaration["write_exclusivity"];
    const message = await startUp(file([declaration], { "*": "accounting" }));
    expect(message).toContain(
      "connectors.json: the default records connector is broken: connector 1:",
    );
    expect(message).toContain("connector 1: must have required property 'write_exclusivity'");
  });

  it("DSOR-CNR-01a: a capability left out is a problem, never taken as false", async () => {
    const declaration = accounting();
    delete (declaration["capabilities"] as Record<string, unknown>)["transactions"];
    expect(await startUp(file([declaration], { "*": "accounting" }))).toContain(
      "connector 1: /capabilities must have required property 'transactions'",
    );
  });

  it("DSOR-CNR-01a: a shared connector must say how it learns of other writers' changes", async () => {
    const declaration = { ...accounting(), write_exclusivity: "shared" };
    expect(await startUp(file([declaration], { "*": "accounting" }))).toContain(
      "must have required property 'change_detection'",
    );
  });

  it("DSOR-CNR-01a: a file with no default connector, or naming a connector it does not declare, stops start-up", async () => {
    expect(await startUp(file([accounting()], { org_456: "accounting" }))).toContain(
      'names no default connectors, "*"',
    );
    expect(await startUp(file([accounting()], { "*": "accounting", org_789: "xero" }))).toContain(
      'org_789\'s records names "xero", which no connector declares',
    );
    expect(
      await startUp(file([accounting()], { "*": "accounting", acme: "accounting" })),
    ).toContain('"acme" is not a company id');
  });

  it("DSOR-CNR-01a: two connectors with one id stop start-up: keeping one would be a guess", async () => {
    expect(await startUp(file([accounting(), accounting()], { "*": "accounting" }))).toContain(
      'two connectors have the id "accounting"',
    );
  });

  it("DSOR-CNR-01a: a broken connector that serves org_789 only puts org_789 out of service, and start-up goes on", async () => {
    const own: Record<string, unknown> = { ...accounting(), id: "accounting-789" };
    delete own["write_exclusivity"];
    const w = await worldWith789(own);
    expect(w.registry.plugs.outOfService("org_456", "invoice.get")).toBeUndefined();
    expect(w.registry.plugs.outOfService("org_789", "invoice.get")).toContain(
      "must have required property 'write_exclusivity'",
    );
  });
});

describe("C2: an operation goes only to a connector that has what it needs", () => {
  it("DSOR-CNR-01b: what each operation on the company's records needs, worked out from its contract", async () => {
    const w = await ruleWorldOnTuesday();
    expect(Object.fromEntries(w.registry.plugs.needs)).toStrictEqual({
      "invoice.get": [],
      "invoice.list": [],
      "payment.cancel": [
        ["transactions"],
        ["optimistic_concurrency"],
        ["freshness:current"],
        ["shares_dsor_transaction"],
      ],
      // Changed in step 35: payment.execute, what it needs of the records; the bank's needs are apart.
      "payment.execute": [
        ["optimistic_concurrency"],
        ["freshness:current"],
        ["shares_dsor_transaction"],
      ],
      "payment.create": [
        ["optimistic_concurrency"],
        ["freshness:current"],
        ["shares_dsor_transaction"],
      ],
      // Step 38: and payment.reconcile, which marks a payment paid (step 38's README, D2).
      "payment.reconcile": [["transactions"], ["freshness:current"], ["shares_dsor_transaction"]],
      "proposal.approve": [["transactions"], ["freshness:current"], ["shares_dsor_transaction"]],
      "proposal.execute": [["transactions"], ["freshness:current"], ["shares_dsor_transaction"]],
    });
  });

  it("DSOR-CNR-01b: DSoR's own commands are routed to no connector: they work on DSoR's own store", async () => {
    const w = await ruleWorldOnTuesday();
    for (const own of ["rule.draft", "rate.load", "control.suspend", "delegation.revoke"]) {
      expect(w.registry.plugs.needs.has(own)).toBe(false);
    }
  });

  it("DSOR-CNR-01b: a default connector that cannot undo a half-finished job stops start-up, naming each operation", async () => {
    const message = await startUp(
      file([withCapabilities({ transactions: false })], { "*": "accounting" }),
    );
    expect(message).toContain(
      'connector "accounting" cannot serve as the records: payment.cancel needs transactions',
    );
    expect(message).toContain("proposal.execute needs transactions");
  });

  it("DSOR-CNR-01b: a default connector that reads no current state stops start-up", async () => {
    const message = await startUp(
      file([withCapabilities({ freshness: ["bounded_staleness"] })], { "*": "accounting" }),
    );
    expect(message).toContain("payment.create needs freshness:current");
  });

  it("DSOR-CNR-01b: a command needs a connector that shares DSoR's transaction, until step 36", async () => {
    const declaration = accounting();
    delete declaration["extensions"];
    expect(await startUp(file([declaration], { "*": "accounting" }))).toContain(
      "payment.create needs shares_dsor_transaction",
    );
  });

  it("DSOR-CNR-01b: a contract's own connector_requirements is read: either of two, as §7's example asks", async () => {
    const changed = {
      ...contract("payment.create"),
      connector_requirements: { downstream_idempotency_or_outcome_lookup: true },
    };
    const message = await startUp(
      file([accounting()], { "*": "accounting" }),
      shippedWith(changed),
    );
    expect(message).toContain("payment.create needs downstream_idempotency or outcome_lookup");
    const either = file([withCapabilities({ outcome_lookup: true })], { "*": "accounting" });
    expect(await startUp(either, shippedWith(changed))).toBe("");
  });

  it("DSOR-CNR-01b: a requirement that names no capability stops start-up, never skipped", async () => {
    const changed = { ...contract("payment.create"), connector_requirements: { teleport: true } };
    expect(
      await startUp(file([accounting()], { "*": "accounting" }), shippedWith(changed)),
    ).toContain(
      'payment.create: connector_requirements names "teleport", which no connector declares',
    );
  });

  it("DSOR-CNR-01b: org_789's connector cannot undo a job: the agent's draft in org_789 is refused at line ④, and org_456's INV-1008 still waits for the CFO", async () => {
    const w = await worldWith789(withCapabilities({ transactions: false }, "accounting-789"));
    const refused = await w.ask(keyed(FIRM_IN_789), "payment.create", {
      invoice: "dsor://org_789/invoice/INV-2002",
      expected_version: 1,
    });
    expect(refused).toMatchObject({ code: "CONNECTOR_UNAVAILABLE", retry: "safe_same_key" });
    // Fixed words: the caller hears that the connector is out, never why (step 34's review, F2).
    expect((refused as { message: string }).message).toBe(
      "payment.create: org_789's connector is out of service",
    );
    // Before line ⑦: no claim, no proposal, nothing drafted.
    expect((await w.proposals.all()).filter((p) => p.tenant === "org_789")).toStrictEqual([]);
    expect(w.drafted).toStrictEqual([]);
    expect(heard(await w.draft("INV-1008"))).toBe("PENDING_APPROVAL");
  });

  it("DSOR-CNR-01b: a query of org_789's records is refused too, and the record says line ④ refused it", async () => {
    const w = await worldWith789(withCapabilities({ transactions: false }, "accounting-789"));
    const answer = await w.ask(USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-2002",
    });
    expect(answer).toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    const last = (await w.log.records()).at(-1)!;
    expect(last).toMatchObject({
      operation: "invoice.get@1",
      authorization: "DENY",
      result: "CONNECTOR_UNAVAILABLE",
      tenant: "org_789",
    });
  });

  it("DSOR-CNR-01b: org_456's connector is not org_789's: an agent of org_456 is not refused by it", async () => {
    const w = await worldWith789(withCapabilities({ transactions: false }, "accounting-789"));
    expect(
      await w.ask(AGENT, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }),
    ).toHaveProperty("data");
  });
});

describe("C3: a connector's credentials are never published", () => {
  it("DSOR-CNR-02: a declaration whose region carries a database URL stops start-up", async () => {
    const declaration = {
      ...accounting(),
      region: "postgresql://dsor_runtime:s3cret@db.example/dsor",
    };
    const message = await startUp(file([declaration], { "*": "accounting" }));
    expect(message).toContain("its region must be a short lowercase name");
  });

  it("DSOR-CNR-02: extensions may hold only this step's one flag, so no key or URL travels in them", async () => {
    const declaration = accounting();
    const ours = (declaration["extensions"] as Record<string, Record<string, unknown>>)[
      "org.panaversity.steps"
    ]!;
    ours["url"] = "postgresql://dsor_runtime:s3cret@db.example/dsor";
    expect(await startUp(file([declaration], { "*": "accounting" }))).toContain(
      "its extensions may hold only org.panaversity.steps.shares_dsor_transaction",
    );
  });

  it("DSOR-CNR-02: the shipped declaration holds no URL, password, or token", () => {
    const text = readConnectors().text;
    expect(text).not.toMatch(/postgres(ql)?:\/\/|password|secret|token/i);
  });

  it("DSOR-CNR-02: checkConnectors names a broken file without echoing its content", () => {
    const { problems } = checkConnectors(
      { file: "connectors.json", text: '{"connectors": "postgresql://u:s3cret@h/db"' },
      [],
      () => false,
    );
    expect(problems.join("\n")).not.toContain("s3cret");
  });
});

describe("C4: the refusal is the breaker's, so a retry is safe", () => {
  it("DSOR-CNR-01b: start-up names a broken default connector with the rest of its problems", () => {
    expect(refusal(() => checkConnectors(file([], { "*": "accounting" }), [], () => false))).toBe(
      "",
    );
    const { problems } = checkConnectors(file([], { "*": "accounting" }), [], () => false);
    expect(problems).toContain(
      'connectors.json: *\'s records names "accounting", which no connector declares',
    );
  });
});
