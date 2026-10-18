// What step 34's review found, each fix red first, and a test for each break that left every test
// green (step 34's README, "Think it through", F2 to F6).
import { describe, expect, it } from "vitest";
import { needsOf, readConnectors, type ConnectorsSource } from "../src/connectors.ts";
import { call } from "../src/pipeline.ts";
import type { Contract, Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, FIRM_IN_789, keyed, SUPERVISOR, USER_700 } from "./helpers.ts";
import { heard, ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const none = undefined;

/** The shipped accounting connector, as a plain object a test may change. */
function accounting(): Record<string, unknown> {
  const file = JSON.parse(readConnectors().text) as { connectors: Record<string, unknown>[] };
  return structuredClone(file.connectors[0]!);
}

/** A connectors file with these connectors and these companies. */
function file(connectors: unknown[], companies: Record<string, unknown>): ConnectorsSource {
  return { file: "connectors.json", text: JSON.stringify({ connectors, companies }) };
}

/** A connector of this company's own, which cannot undo a half-finished job. */
function cannotUndo(id: string): Record<string, unknown> {
  const declaration = accounting();
  const capabilities = { ...(declaration["capabilities"] as object), transactions: false };
  return { ...declaration, id, capabilities };
}

/** A world in which this company's records sit behind this connector of its own. */
function worldWith(tenant: string, own: Record<string, unknown>): Promise<RuleWorld> {
  const connectors = file([accounting(), own], { "*": "accounting", [tenant]: own["id"] });
  return ruleWorldOnTuesday(none, none, none, none, none, none, none, connectors);
}

/** Start-up's refusal for this connectors file, or "" when it starts. */
async function startUp(connectors: ConnectorsSource): Promise<string> {
  try {
    await ruleWorldOnTuesday(none, none, none, none, none, none, none, connectors);
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

/** The same stores, after a restart with a connectors file that puts org_456 out of service. */
async function restartedOut(w: RuleWorld): Promise<Registry> {
  const out = await worldWith("org_456", cannotUndo("accounting-456"));
  return { ...w.registry, plugs: out.registry.plugs };
}

describe("F2: proposal.approve reads the company's records, so line ④ looks at their connector", () => {
  it("DSOR-CNR-01b: cfo_100's approval of INV-1008 is refused while org_456's connector is out of service, and INV-1008 still waits", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.draft("INV-1008");
    const address = String("proposal" in drafted ? drafted.proposal : "");
    const id = address.split("/").at(-1)!;
    const kept = (await w.proposals.get("org_456", id))!;
    const after = await restartedOut(w);
    const input = { proposal: kept.uri, payload_hash: kept.payload_hash };
    const answer = await call(after, w.log, keyed(CFO), "proposal.approve", input);
    expect(answer).toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    expect((await w.proposals.get("org_456", id))?.state).toBe("PENDING_APPROVAL");
  });
});

describe("F3: the caller hears fixed words, and the reason goes to start-up", () => {
  const planted = "postgresql://dsor_runtime:s3cret@db.example/dsor";

  it("DSOR-CNR-02: a key planted in org_789's declaration reaches neither user_700's answer nor the record", async () => {
    const own: Record<string, unknown> = { ...accounting(), id: "accounting-789", [planted]: true };
    const w = await worldWith("org_789", own);
    const answer = await w.ask(USER_700, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-2002",
    });
    expect(answer).toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
      message: "invoice.get: org_789's connector is out of service",
    });
    expect(JSON.stringify(answer)).not.toContain("s3cret");
    expect(JSON.stringify(await w.log.records())).not.toContain("s3cret");
    expect(JSON.stringify(w.registry.plugs.warnings)).not.toContain("s3cret");
  });

  it("DSOR-CNR-01a: start-up names a broken connector that serves org_789 only, as a warning, and goes on", async () => {
    const w = await worldWith("org_789", cannotUndo("accounting-789"));
    expect(w.registry.plugs.warnings).toStrictEqual([
      'connectors.json: connector "accounting-789", which serves org_789, is out of service: connector "accounting-789" cannot serve: payment.cancel needs transactions; proposal.approve needs transactions; proposal.execute needs transactions',
    ]);
  });
});

describe("F4: no field of a declaration can carry a key", () => {
  const url = "postgresql://dsor_runtime:s3cret@db.example/dsor";

  it("DSOR-CNR-02: change_detection may hold only its method and its lag", async () => {
    const declaration = {
      ...accounting(),
      write_exclusivity: "shared",
      change_detection: { method: "polling", max_detection_lag_seconds: 60, url },
    };
    const message = await startUp(file([declaration], { "*": "accounting" }));
    expect(message).toContain(
      "its change_detection may hold only method and max_detection_lag_seconds",
    );
    expect(message).not.toContain("s3cret");
  });

  it("DSOR-CNR-02: field_fidelity names entities and fields only by short lowercase names", async () => {
    const declaration = { ...accounting(), field_fidelity: { [url]: {} } };
    const message = await startUp(file([declaration], { "*": "accounting" }));
    expect(message).toContain(
      "its field_fidelity names an entity or a field that is not a short lowercase name",
    );
    expect(message).not.toContain("s3cret");
  });

  it("DSOR-CNR-02: the shares_dsor_transaction flag is true or false, never text", async () => {
    const declaration = {
      ...accounting(),
      extensions: { "org.panaversity.steps": { shares_dsor_transaction: url } },
    };
    const message = await startUp(file([declaration], { "*": "accounting" }));
    expect(message).toContain("its shares_dsor_transaction must be true or false");
    expect(message).not.toContain("s3cret");
  });

  it("DSOR-CNR-01b: a flag that says false shares nothing: every command needs a connector that shares DSoR's transaction", async () => {
    const declaration = {
      ...accounting(),
      extensions: { "org.panaversity.steps": { shares_dsor_transaction: false } },
    };
    expect(await startUp(file([declaration], { "*": "accounting" }))).toContain(
      "payment.create needs shares_dsor_transaction",
    );
  });

  it("DSOR-CNR-02: an extra field's name is not echoed, so a URL written as a key stays out of the output", async () => {
    const declaration = { ...accounting(), [url]: true };
    const message = await startUp(file([declaration], { "*": "accounting" }));
    expect(message).toContain("must NOT have additional properties");
    expect(message).not.toContain("s3cret");
  });

  it("DSOR-CNR-02: an id that is not a short lowercase name stops start-up", async () => {
    expect(
      await startUp(file([{ ...accounting(), id: "Accounting" }], { "*": "Accounting" })),
    ).toContain("its id must be a short lowercase name");
  });

  it("DSOR-CNR-02: extensions of another namespace are refused, and so is an empty one of ours", async () => {
    const vendor = {
      ...accounting(),
      extensions: {
        "org.panaversity.steps": { shares_dsor_transaction: true },
        "com.vendor": { api_key: "k" },
      },
    };
    const empty = { ...accounting(), extensions: { "org.panaversity.steps": {} } };
    for (const declaration of [vendor, empty]) {
      expect(await startUp(file([declaration], { "*": "accounting" }))).toContain(
        "its extensions may hold only org.panaversity.steps.shares_dsor_transaction",
      );
    }
  });

  it("DSOR-CNR-01a: a capability written twice is a problem: keeping one would be a guess", async () => {
    const text = readConnectors().text.replace(
      '"transactions": true,',
      '"transactions": false, "transactions": true,',
    );
    expect(await startUp({ file: "connectors.json", text })).toContain(
      '"transactions" is written twice in one object',
    );
  });
});

describe("F5: what an operation needs, read exactly", () => {
  const base: Contract = { id: "x.y", kind: "query" };

  it("DSOR-CNR-01b: a requirement set to false asks for nothing", () => {
    expect(needsOf({ ...base, connector_requirements: { outcome_lookup: false } })).toStrictEqual({
      needs: [],
      problems: [],
    });
  });

  it("DSOR-CNR-01b: freshness is a list, never a requirement a contract may name", () => {
    expect(
      needsOf({ ...base, connector_requirements: { freshness: true } }).problems,
    ).toStrictEqual(['x.y: connector_requirements names "freshness", which no connector declares']);
  });

  it("DSOR-CNR-01b: a bounded_staleness precondition is met by bounded_staleness or by current", () => {
    const contract = { ...base, preconditions: { freshness: "bounded_staleness" } };
    expect(needsOf(contract).needs).toStrictEqual([
      ["freshness:bounded_staleness", "freshness:current"],
    ]);
  });
});

describe("F6: line ④ refuses only what goes to the connector, after the brake, in every mode", () => {
  it("DSOR-CNR-01b: while org_456's connector is out, DSoR's own commands still run: user_123 pulls the brake on the agent, and the agent then hears AGENT_SUSPENDED, not CONNECTOR_UNAVAILABLE", async () => {
    const w = await worldWith("org_456", cannotUndo("accounting-456"));
    const pull = await w.ask(keyed(SUPERVISOR), "control.suspend", {
      target: "dsor://org_456/agent/accounts-payable-fte",
      reason: "the connector is out, and the agent must wait",
    });
    expect(heard(pull)).toBe("COMMITTED");
    expect(await w.draft("INV-1008")).toMatchObject({ code: "AGENT_SUSPENDED" });
  });

  it.each([["validate_only"], ["propose_only"], ["execute"]])(
    "DSOR-CNR-01b: firm-ap-fte's draft in org_789, in %s mode, is refused at line ④ while org_789's connector is out",
    async (mode) => {
      const w = await worldWith("org_789", cannotUndo("accounting-789"));
      // A dry run carries no key (step 23's README, decision 3).
      const caller = mode === "validate_only" ? FIRM_IN_789 : keyed(FIRM_IN_789);
      const envelope = { ...caller, mode } as RequestEnvelope;
      const input = { invoice: "dsor://org_789/invoice/INV-2002", expected_version: 1 };
      expect(await w.ask(envelope, "payment.create", input)).toMatchObject({
        code: "CONNECTOR_UNAVAILABLE",
      });
    },
  );

  it("DSOR-CNR-01b: the release of an approved payment is refused while the connector is out, and the payment stays APPROVED", async () => {
    const w = await ruleWorldOnTuesday();
    const drafted = await w.draft("INV-1008");
    const id = String("proposal" in drafted ? drafted.proposal : "")
      .split("/")
      .at(-1)!;
    const kept = (await w.proposals.get("org_456", id))!;
    const yes = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: kept.uri,
      payload_hash: kept.payload_hash,
    });
    expect(heard(yes)).toBe("COMMITTED");
    const after = await restartedOut(w);
    const release = await call(after, w.log, keyed(AGENT), "proposal.execute", {
      proposal: kept.uri,
    });
    expect(release).toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
  });

  it("DSOR-CNR-01b: a replay during an outage is refused at line ④ too, before line ⑦ could give it back", async () => {
    const w = await ruleWorldOnTuesday();
    const envelope = keyed(AGENT);
    const input = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    expect(heard(await w.ask(envelope, "payment.create", input))).toBe("PENDING_APPROVAL");
    const after = await restartedOut(w);
    expect(await call(after, w.log, envelope, "payment.create", input)).toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
    });
  });
});
