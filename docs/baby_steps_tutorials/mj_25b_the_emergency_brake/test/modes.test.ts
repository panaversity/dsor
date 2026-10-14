// Three ways to call a command: execute, propose_only, and validate_only (DSOR-OPR-05 and
// DSOR-OPR-06 in specs/dsor/01-model.md, section 7.3), the .propose form of a permission (the
// last sentence of §7.3), and the propose_only clause of DSOR-IDM-01a. In memory. The database's
// part is in modes.db.test.ts (step 23's README, decisions 1 to 14).
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { readRoleSettings } from "../src/authority.ts";
import { payloadHash } from "../src/canonical.ts";
import { memoryClaims } from "../src/claims.ts";
import type { Answer } from "../src/envelope.ts";
import { invoices, memoryInvoices } from "../src/invoice.ts";
import { createLog, type DecisionLog } from "../src/log.ts";
import { handlersFor } from "../src/operations.ts";
import { memoryPayments, type Payment } from "../src/payment.ts";
import type { RoleTableSource } from "../src/permissions.ts";
import { call } from "../src/pipeline.ts";
import { memoryProposals } from "../src/proposals.ts";
import { buildRegistry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { memorySlips } from "../src/slips.ts";
import { crossTenantSuite, readExamples, type Send } from "./cross-tenant.ts";
import {
  AGENT,
  A_PAYLOAD_HASH,
  A_PROPOSAL,
  CFO,
  contract,
  correlationFor,
  DEL_100,
  forComparing,
  INTAKE_SLIP,
  keyed,
  OUR_EXTENSIONS,
  registry as sharedRegistry,
  rolesFile,
  shipped,
  shippedInputs,
  shippedLabels,
  shippedRoles,
  shippedWith,
  STARTING_ROLES,
  STORY_SLIPS,
  storyDirectories,
  SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_SUPERVISOR,
  type StorySlip,
} from "./helpers.ts";

// The story's call: a draft of a payment for INV-1008, decided on version 1.
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };

/** The envelope, in this mode. */
function inMode<E extends object>(envelope: E, mode: unknown): E & { mode: unknown } {
  return { ...envelope, mode };
}

/**
 * A registry whose proposals, payments, and log the test can look at, over a copy of the
 * invoices, with the shipped role table and the story's slips, unless the test gives others.
 */
function story(options: { roles?: RoleTableSource; slips?: readonly StorySlip[] } = {}) {
  const proposals = memoryProposals();
  const rows: Payment[] = [];
  const ledger = structuredClone(invoices);
  const store = memoryInvoices(ledger);
  const payments = memoryPayments(rows);
  const directories = storyDirectories();
  const slips = memorySlips(options.slips ?? [...STORY_SLIPS, INTAKE_SLIP]);
  const registry = buildRegistry(
    shipped,
    handlersFor(),
    options.roles ?? shippedRoles,
    shippedInputs,
    shippedLabels,
    store,
    payments,
    slips,
    directories,
    readRoleSettings(),
    memoryClaims(store, payments, proposals),
  );
  return { proposals, rows, ledger, registry, directories, slips, log: createLog() };
}

/** Calls payment.create for INV-1008, and gives back the answer and the lines that ran. */
async function draft(
  world: ReturnType<typeof story>,
  envelope: RequestEnvelope,
  input: unknown = INV_1008,
  to: DecisionLog = world.log,
): Promise<{ answer: Answer; lines: number[] }> {
  const lines: number[] = [];
  const answer = await call(world.registry, to, envelope, "payment.create", input, (n) =>
    lines.push(n),
  );
  return { answer, lines };
}

// The id at the end of a proposal's URI.
function idOf(answer: Answer): string {
  const uri = "proposal" in answer ? String(answer.proposal) : "";
  const match = /^dsor:\/\/org_456\/proposal\/(prop_[0-9a-f-]{36})$/.exec(uri);
  if (match === null) throw new Error(`not a proposal of org_456: ${uri}`);
  return match[1]!;
}

// The step's copies of the specification's schemas, byte for byte (test/schemas.test.ts).
function schemaCheck(name: string) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const file of ["common", "security-context"]) {
    const url = new URL(`../schemas/${file}.schema.json`, import.meta.url);
    ajv.addSchema(JSON.parse(readFileSync(url, "utf8")) as object);
  }
  const url = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  return ajv.compile(JSON.parse(readFileSync(url, "utf8")) as object);
}

// Each command's own example request, as the cross-tenant suite reads it (step 12's README,
// decision 2).
const EXAMPLE: Record<string, unknown> = Object.fromEntries(
  ["payment.create", "payment.cancel", "invoice.issue"].map((name) => [
    name,
    JSON.parse(
      readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"),
    ) as unknown,
  ]),
);

// The messages of this step's refusals, typed out rather than imported.
const BAD_MODE = "a mode must be execute, propose_only, or validate_only";
const DRY_RUN_KEY = "a validate_only call takes no idempotency_key: a dry run claims nothing";
const ONLY_PROPOSE = "; payment:create.propose allows propose_only mode only";

describe("C1: execute, the default, as before", () => {
  it.each([
    ["no mode", keyed(AGENT)],
    ["mode execute", inMode(keyed(AGENT), "execute")],
  ])(
    "DSOR-OPR-05: a command with %s runs in execute mode: COMMITTED, and PAY-901 is drafted",
    async (_how, envelope) => {
      const world = story();
      const { answer, lines } = await draft(world, envelope);
      expect(answer).toMatchObject({ outcome: "COMMITTED", data: { id: "PAY-901" } });
      // Since step 24, line ⑩ too (step 24's README, decision 6).
      expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const proposal = await world.proposals.get("org_456", idOf(answer));
      expect([proposal?.mode, proposal?.state]).toStrictEqual(["execute", "COMMITTED"]);
      expect(world.rows.map((row) => row.id)).toStrictEqual(["PAY-901"]);
    },
  );
});

describe("C2: propose_only prepares, and nothing runs", () => {
  it("DSOR-OPR-05: in propose_only mode the proposal waits READY, and the answer says READY", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(keyed(AGENT), "propose_only"));
    expect(answer).toStrictEqual({
      outcome: "READY",
      proposal: A_PROPOSAL,
      payload_hash: A_PAYLOAD_HASH,
      semantics: "compensatable",
      correlation: correlationFor(THE_AGENT),
    });
    const proposal = await world.proposals.get("org_456", idOf(answer));
    expect([proposal?.mode, proposal?.state]).toStrictEqual(["propose_only", "READY"]);
    expect(proposal?.transitions.map(({ from, to, actor }) => [from, to, actor])).toStrictEqual([
      [undefined, "PROPOSED", "accounts-payable-fte"],
      ["PROPOSED", "READY", "dsor"],
    ]);
  });

  // Since step 24, lines ⑨ and ⑩ too: DSoR's own read, and the limits, checked without a
  // reservation. The code still never runs (step 24's README, decisions 6 and 9).
  it("DSOR-OPR-05: a propose_only call runs lines 1, 2, 3, 5, 6, 7, 8, 9, 10, and 11, and the code never runs", async () => {
    const world = story();
    const { lines } = await draft(world, inMode(keyed(AGENT), "propose_only"));
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // No draft is written, and INV-1008 is as it was.
    expect(world.rows).toStrictEqual([]);
    expect(world.ledger).toStrictEqual(invoices);
  });

  it("Step 23: a propose_only call runs no code, so it cannot see the code's refusals: a stale draft waits READY (step 23's README, decision 2)", async () => {
    const world = story();
    // Decided on version 2, and INV-1008 is at version 1. In execute mode the code refuses.
    const stale = { ...INV_1008, expected_version: 2 };
    const { answer } = await draft(world, inMode(keyed(AGENT), "propose_only"), stale);
    expect("outcome" in answer && answer.outcome).toBe("READY");
    const executed = await draft(world, keyed(AGENT), stale);
    expect("code" in executed.answer && executed.answer.code).toBe("STALE_STATE");
  });

  it("DSOR-IDM-01a: a propose_only call with no key is refused at line 7, and makes no proposal", async () => {
    const world = story();
    const { answer, lines } = await draft(world, inMode(AGENT, "propose_only"));
    expect(answer).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: '"payment.create" needs an idempotency_key in the request envelope',
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(lines.at(-2)).toBe(7);
    expect(await world.proposals.all()).toStrictEqual([]);
  });

  it("DSOR-IDM-01c: a replay of a propose_only call gives back the same READY answer, and makes no second proposal", async () => {
    const world = story();
    const envelope = inMode(keyed(AGENT), "propose_only");
    const first = await draft(world, envelope);
    const again = await draft(world, envelope);
    expect(forComparing(again.answer)).toStrictEqual(forComparing(first.answer));
    expect(again.lines).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 11]);
    expect(await world.proposals.all()).toHaveLength(1);
    // The replay's record names the first call (step 20's README, decision 8).
    const records = await world.log.records();
    expect(records[1]?.extensions?.[OUR_EXTENSIONS]?.idempotency).toStrictEqual({
      key: envelope.idempotency_key,
      replay_of: first.answer.correlation.request_id,
    });
  });
});

describe("C3 to C6: validate_only, a dry run", () => {
  it("DSOR-OPR-05: a dry run answers VALIDATED, with the decision ALLOW", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(AGENT, "validate_only"));
    expect(answer).toStrictEqual({
      outcome: "VALIDATED",
      decision: "ALLOW",
      correlation: correlationFor(THE_AGENT),
    });
  });

  it("DSOR-OPR-06: a dry run makes no proposal, writes no payment, and changes no invoice", async () => {
    const world = story();
    await draft(world, inMode(AGENT, "validate_only"));
    expect(await world.proposals.all()).toStrictEqual([]);
    expect(world.rows).toStrictEqual([]);
    expect(world.ledger).toStrictEqual(invoices);
  });

  // Since step 24, lines ⑨ and ⑩ too, which write nothing (step 24's README, decision 8).
  it("DSOR-OPR-06: a dry run runs lines 1, 2, 3, 5, 6, 9, 10, and 11: no claim at line 7, no proposal at line 8, and no code", async () => {
    const world = story();
    const { lines } = await draft(world, inMode(AGENT, "validate_only"));
    expect(lines).toStrictEqual([1, 2, 3, 4, 5, 6, 9, 10, 11]);
  });

  it("DSOR-OPR-06: a dry run's decision is still recorded, as ALLOW, with its mode, and no key or proposal", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(AGENT, "validate_only"));
    const records = await world.log.records();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "decision",
      operation: "payment.create@1",
      authorization: "ALLOW",
      result: "ok",
      correlation: answer.correlation,
      tenant: "org_456",
      delegation: "del_100",
    });
    expect(records[0]?.extensions).toStrictEqual({
      [OUR_EXTENSIONS]: { invocation_mode: "validate_only" },
    });
  });

  it.each([
    // cfo_100 holds invoice:read only: line ⑤.
    ["cfo_100, who may not create a payment", CFO, INV_1008],
    // No expected_version: line ⑥.
    ["an input with no expected_version", SUPERVISOR, { invoice: INV_1008.invoice }],
    // Another company's invoice: the check of the URIs.
    [
      "another company's invoice",
      SUPERVISOR,
      { invoice: "dsor://org_789/invoice/INV-1008", expected_version: 1 },
    ],
  ])(
    "DSOR-OPR-05: a dry run by %s hears the refusal the real call hears (step 23's README, decision 3)",
    async (_who, envelope, input) => {
      const world = story();
      const dry = await draft(world, inMode(envelope, "validate_only"), input);
      const real = await draft(world, keyed(envelope), input);
      expect("code" in dry.answer).toBe(true);
      expect(forComparing(dry.answer)).toStrictEqual(forComparing(real.answer));
    },
  );

  it("Step 23: a dry run's refusal is recorded as DENY, with its mode (step 23's README, decision 10)", async () => {
    const world = story();
    await draft(world, inMode(CFO, "validate_only"));
    const [record] = await world.log.records();
    expect(record).toMatchObject({ authorization: "DENY", result: "AUTHORIZATION_DENIED" });
    expect(record?.extensions).toStrictEqual({
      [OUR_EXTENSIONS]: { invocation_mode: "validate_only" },
    });
  });

  it("Step 23: a dry run runs no code, so it says ALLOW for a draft the code would refuse (step 23's README, decision 2)", async () => {
    const world = story();
    const stale = { ...INV_1008, expected_version: 2 };
    const dry = await draft(world, inMode(AGENT, "validate_only"), stale);
    expect(dry.answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
    const real = await draft(world, keyed(AGENT), stale);
    expect("code" in real.answer && real.answer.code).toBe("STALE_STATE");
  });

  it("DSOR-EXE-03b: a dry run whose record cannot be written answers EVIDENCE_STORE_UNAVAILABLE, never VALIDATED", async () => {
    const world = story();
    const full: DecisionLog = {
      add: async () => {
        throw new Error("disk full");
      },
    };
    const { answer } = await draft(world, inMode(AGENT, "validate_only"), INV_1008, full);
    expect(answer).toStrictEqual({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message: "DSoR could not record its decision, so it refuses the call",
      retry: "safe_same_key",
      correlation: correlationFor(THE_AGENT),
    });
  });
});

describe("C7: the .propose form of a permission", () => {
  // cfo_100 is a person, so what cfo_100 may do comes from the role table alone.
  const proposingCfo = rolesFile({
    ...STARTING_ROLES,
    CFO: ["invoice:read", "payment:create.propose"],
  });

  it("Step 23: a holder of payment:create.propose may prepare a payment in propose_only mode (§7.3)", async () => {
    const world = story({ roles: proposingCfo });
    const { answer } = await draft(world, inMode(keyed(CFO), "propose_only"));
    expect(answer).toMatchObject({ outcome: "READY", correlation: correlationFor(THE_CFO) });
  });

  it.each([
    ["execute", (envelope: RequestEnvelope) => keyed(envelope)],
    ["validate_only", (envelope: RequestEnvelope) => inMode(envelope, "validate_only")],
  ])(
    "DSOR-AUT-01b: payment:create.propose does not allow %s mode (§7.3: propose_only mode only)",
    async (_mode, envelopeOf) => {
      const world = story({ roles: proposingCfo });
      const { answer } = await draft(world, envelopeOf(CFO));
      expect(answer).toStrictEqual({
        code: "AUTHORIZATION_DENIED",
        message: `"payment.create" needs payment:create, which the caller does not hold${ONLY_PROPOSE}`,
        retry: "never",
        correlation: correlationFor(THE_CFO),
      });
      expect(world.rows).toStrictEqual([]);
      expect(await world.proposals.all()).toStrictEqual([]);
    },
  );

  it("Step 23: payment:create covers payment:create.propose, so user_123 may call in each of the three modes", async () => {
    const world = story();
    const ready = await draft(world, inMode(keyed(SUPERVISOR), "propose_only"));
    const dry = await draft(world, inMode(SUPERVISOR, "validate_only"));
    const done = await draft(world, keyed(SUPERVISOR));
    const outcomes = [ready, dry, done].map(({ answer }) => "outcome" in answer && answer.outcome);
    expect(outcomes).toStrictEqual(["READY", "VALIDATED", "COMMITTED"]);
  });

  it("DSOR-AUT-01b: in propose_only mode, a caller with neither payment:create nor its .propose form is refused", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(keyed(CFO), "propose_only"));
    expect(answer).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message:
        '"payment.create" in propose_only mode needs payment:create or payment:create.propose, which the caller does not hold',
      retry: "never",
      correlation: correlationFor(THE_CFO),
    });
  });

  it("DSOR-AUT-01b: the .propose form of one permission never stands in for another", async () => {
    const roles = rolesFile({ ...STARTING_ROLES, CFO: ["invoice:read", "payment:cancel.propose"] });
    const world = story({ roles });
    const { answer } = await draft(world, inMode(keyed(CFO), "propose_only"));
    expect("code" in answer && answer.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-AUT-01b: invoice:read.propose does not allow a read: a query has one way to run", async () => {
    const roles = rolesFile({ ...STARTING_ROLES, CFO: ["invoice:read.propose"] });
    const world = story({ roles });
    const answer = await call(world.registry, world.log, CFO, "invoice.get", {
      invoice: INV_1008.invoice,
    });
    expect("code" in answer && answer.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-DEL-02: user_123 moves to ap_clerk, which holds payment:create.propose: the agent under del_100 may prepare, and is refused execute mode", async () => {
    const world = story();
    world.directories.get("org_456")!.set("user_123", { status: "active", roles: ["ap_clerk"] });
    const ready = await draft(world, inMode(keyed(AGENT), "propose_only"));
    expect(ready.answer).toMatchObject({ outcome: "READY" });
    const refused = await draft(world, keyed(AGENT));
    expect(refused.answer).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: `"payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now${ONLY_PROPOSE}`,
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(world.rows).toStrictEqual([]);
  });

  it("DSOR-DEL-02: a slip that lists payment:create.propose lets its agent prepare, never execute, though user_123 holds payment:create", async () => {
    const preparing = { ...DEL_100, permissions: ["invoice:read", "payment:create.propose"] };
    const world = story({ slips: [preparing] });
    const ready = await draft(world, inMode(keyed(AGENT), "propose_only"));
    expect(ready.answer).toMatchObject({ outcome: "READY" });
    const refused = await draft(world, keyed(AGENT));
    expect("code" in refused.answer && refused.answer.message).toBe(
      `"payment.create" needs payment:create, which slip del_100 does not list${ONLY_PROPOSE}`,
    );
    const dry = await draft(world, inMode(AGENT, "validate_only"));
    expect("code" in dry.answer && dry.answer.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-DEL-02: in propose_only mode, the slip and its signer must both cover the permission", async () => {
    // The slip lists payment:create, and user_123 is a CFO now, who holds neither form.
    const world = story();
    world.directories.get("org_456")!.set("user_123", { status: "active", roles: ["CFO"] });
    const { answer } = await draft(world, inMode(keyed(AGENT), "propose_only"));
    expect("code" in answer && answer.message).toBe(
      '"payment.create" in propose_only mode needs payment:create or payment:create.propose, which user_123, who signed slip del_100, does not hold now',
    );
    // A slip that lists neither form: the slip is named.
    const reading = { ...DEL_100, permissions: ["invoice:read"] };
    const other = story({ slips: [reading] });
    const second = await draft(other, inMode(keyed(AGENT), "propose_only"));
    expect("code" in second.answer && second.answer.message).toBe(
      '"payment.create" in propose_only mode needs payment:create or payment:create.propose, which slip del_100 does not list',
    );
    // A slip that lists only the .propose form, and a signer who holds neither: the slip covers
    // what is wanted, so the signer is named. Found by step 23's review.
    const preparing = { ...DEL_100, permissions: ["invoice:read", "payment:create.propose"] };
    const third = story({ slips: [preparing] });
    third.directories.get("org_456")!.set("user_123", { status: "active", roles: ["CFO"] });
    const signerHoldsNeither = await draft(third, inMode(keyed(AGENT), "propose_only"));
    expect("code" in signerHoldsNeither.answer && signerHoldsNeither.answer.message).toBe(
      '"payment.create" in propose_only mode needs payment:create or payment:create.propose, which user_123, who signed slip del_100, does not hold now',
    );
  });

  it("Step 23: start-up refuses a contract that names a .propose permission (step 23's README, decision 14)", () => {
    const proposeOnly = {
      ...contract("payment.create"),
      authorization: { permission: "payment:create.propose" },
    };
    expect(() => buildRegistry(shippedWith(proposeOnly), handlersFor(), shippedRoles)).toThrow(
      "payment.create: a contract names the permission its operation needs, never its .propose form (step 23's README, decision 14)",
    );
  });
});

describe("C9: the mode, in the request envelope", () => {
  it.each([
    ["a word that is not a mode", "dry_run"],
    ["a mode in capitals", "EXECUTE"],
    ["empty text", ""],
    ["a number", 1],
    ["null", null],
    ["a list", ["execute"]],
    ["an object", { mode: "execute" }],
  ])(
    "Step 23: %s as the mode is refused at line 1 (step 23's README, decision 4)",
    async (_what, mode) => {
      const world = story();
      const { answer, lines } = await draft(world, inMode(keyed(AGENT), mode));
      expect(answer).toStrictEqual({
        code: "VALIDATION_FAILED",
        message: BAD_MODE,
        retry: "never",
        correlation: correlationFor(THE_AGENT),
      });
      expect(lines).toStrictEqual([1, 11]);
    },
  );

  it("Step 23: a dry run that carries an idempotency key is refused at line 1, and its key stays free (step 23's README, decision 6)", async () => {
    const world = story();
    const envelope = keyed(AGENT);
    const { answer, lines } = await draft(world, inMode(envelope, "validate_only"));
    expect(answer).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: DRY_RUN_KEY,
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(lines).toStrictEqual([1, 11]);
    // The key was never claimed: the real call with it drafts PAY-901.
    const real = await draft(world, envelope);
    expect(real.answer).toMatchObject({ outcome: "COMMITTED", data: { id: "PAY-901" } });
  });

  it.each(["execute", "propose_only", "validate_only"])(
    "Step 23: a query takes no mode, not even %s, and its code does not run (step 23's README, decision 7)",
    async (mode) => {
      const world = story();
      const lines: number[] = [];
      const answer = await call(
        world.registry,
        world.log,
        inMode(AGENT, mode),
        "invoice.get",
        { invoice: INV_1008.invoice },
        (n) => lines.push(n),
      );
      expect(answer).toStrictEqual({
        code: "VALIDATION_FAILED",
        message: '"invoice.get" is a query, which takes no mode',
        retry: "never",
        correlation: correlationFor(THE_AGENT),
      });
      expect(lines).toStrictEqual([1, 2, 11]);
    },
  );

  it("Step 23: a query with no mode is answered as before", async () => {
    const world = story();
    const answer = await call(world.registry, world.log, AGENT, "invoice.get", {
      invoice: INV_1008.invoice,
    });
    expect("data" in answer).toBe(true);
  });

  it("Step 23: a key keeps its mode: the same key and request, prepared and then executed, is refused, and nothing is drafted (step 23's README, decision 4)", async () => {
    const world = story();
    const envelope = keyed(AGENT);
    const ready = await draft(world, inMode(envelope, "propose_only"));
    expect(ready.answer).toMatchObject({ outcome: "READY" });
    const executed = await draft(world, envelope);
    expect(executed.answer).toStrictEqual({
      code: "IDEMPOTENCY_CONFLICT",
      message:
        'the idempotency_key was used for "payment.create" in propose_only mode, and a key keeps its mode',
      retry: "never",
      correlation: correlationFor(THE_AGENT),
    });
    expect(world.rows).toStrictEqual([]);
    expect(await world.proposals.all()).toHaveLength(1);
  });

  it("Step 23: a key keeps its mode the other way too: executed, then prepared, is refused, and makes no second proposal", async () => {
    const world = story();
    const envelope = keyed(AGENT);
    await draft(world, envelope);
    const prepared = await draft(world, inMode(envelope, "propose_only"));
    expect("code" in prepared.answer && prepared.answer.message).toBe(
      'the idempotency_key was used for "payment.create" in execute mode, and a key keeps its mode',
    );
    expect(await world.proposals.all()).toHaveLength(1);
  });

  it("Step 23: a key sent with no mode and then with mode execute is one call in one mode: the second is a replay", async () => {
    const world = story();
    const envelope = keyed(AGENT);
    const first = await draft(world, envelope);
    const again = await draft(world, inMode(envelope, "execute"));
    expect(forComparing(again.answer)).toStrictEqual(forComparing(first.answer));
    expect(world.rows).toHaveLength(1);
  });
});

describe("C5 and C12: what the answers, the proposals, and the records say", () => {
  it("DSOR-SCH-01: a READY answer passes result-envelope.schema.json", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(keyed(SUPERVISOR), "propose_only"));
    const passes = schemaCheck("result-envelope");
    expect([passes(answer), passes.errors]).toStrictEqual([true, null]);
  });

  it("DSOR-SCH-01: a VALIDATED answer passes result-envelope.schema.json", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(SUPERVISOR, "validate_only"));
    const passes = schemaCheck("result-envelope");
    expect([passes(answer), passes.errors]).toStrictEqual([true, null]);
    expect(answer).toStrictEqual({
      outcome: "VALIDATED",
      decision: "ALLOW",
      correlation: correlationFor(THE_SUPERVISOR),
    });
  });

  it("DSOR-SCH-01: a propose_only proposal, as DSoR stores it, passes proposal.schema.json", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(keyed(AGENT), "propose_only"));
    const proposal = await world.proposals.get("org_456", idOf(answer));
    const passes = schemaCheck("proposal");
    expect([passes(proposal), passes.errors]).toStrictEqual([true, null]);
    expect(proposal?.payload_hash).toBe("payload_hash" in answer && answer.payload_hash);
  });

  it("Step 23: every command's decision record names its mode (step 23's README, decision 10)", async () => {
    const world = story();
    const executed = await draft(world, keyed(AGENT));
    const prepared = await draft(world, inMode(keyed(AGENT), "propose_only"));
    const dry = await draft(world, inMode(AGENT, "validate_only"));
    const records = await world.log.records();
    const modes = records.map((record) => record.extensions?.[OUR_EXTENSIONS]?.invocation_mode);
    expect(modes).toStrictEqual(["execute", "propose_only", "validate_only"]);
    // The propose_only record names its key and its proposal, as an execute record does.
    expect(records[1]?.extensions?.[OUR_EXTENSIONS]).toStrictEqual({
      idempotency: { key: expect.any(String) },
      proposal: "proposal" in prepared.answer && prepared.answer.proposal,
      invocation_mode: "propose_only",
    });
    expect(records.map((record) => record.authorization)).toStrictEqual([
      "ALLOW",
      "ALLOW",
      "ALLOW",
    ]);
    expect([executed.answer, dry.answer].every((answer) => !("code" in answer))).toBe(true);
  });

  it("Step 23: a query's record names no mode", async () => {
    const world = story();
    await call(world.registry, world.log, AGENT, "invoice.get", { invoice: INV_1008.invoice });
    const [record] = await world.log.records();
    expect(record?.extensions?.[OUR_EXTENSIONS]).not.toHaveProperty("invocation_mode");
  });

  it("DSOR-EXE-03b: a propose_only call whose record cannot be written says a retry with the same key is safe, and the retry names the same proposal", async () => {
    const world = story();
    const full: DecisionLog = {
      add: async () => {
        throw new Error("disk full");
      },
    };
    const envelope = inMode(keyed(AGENT), "propose_only");
    const { answer } = await draft(world, envelope, INV_1008, full);
    expect(answer).toStrictEqual({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      message:
        "DSoR could not record its decision after the proposal was made, and a retry with the same idempotency_key cannot make a second one",
      retry: "safe_same_key",
      correlation: correlationFor(THE_AGENT),
    });
    const retried = await draft(world, envelope);
    expect(retried.answer).toMatchObject({ outcome: "READY" });
    expect(await world.proposals.all()).toHaveLength(1);
  });
});

// Found by step 23's review: only payment.create was tried in the two new modes. In propose_only
// mode no code runs, so the checks before line ⑦ are all that stand between a request and a
// proposal that waits, and every command must meet them.
describe("from the review: every command, in each mode", () => {
  it.each([
    ["payment.create", "compensatable"],
    ["payment.cancel", "atomic"],
  ])(
    "DSOR-OPR-05: %s in propose_only mode answers READY with its own contract's semantics, and changes no row",
    async (operation, semantics) => {
      const world = story();
      // PAY-901, the draft that payment.cancel's example names.
      await draft(world, keyed(SUPERVISOR));
      const before = structuredClone(world.rows);
      const envelope = inMode(keyed(SUPERVISOR), "propose_only");
      const answer = await call(world.registry, world.log, envelope, operation, EXAMPLE[operation]);
      expect(answer).toMatchObject({ outcome: "READY", semantics });
      const proposal = await world.proposals.get("org_456", idOf(answer));
      expect([proposal?.operation, proposal?.mode, proposal?.state]).toStrictEqual([
        `${operation}@1`,
        "propose_only",
        "READY",
      ]);
      expect(world.rows).toStrictEqual(before);
      expect(world.ledger).toStrictEqual(invoices);
    },
  );

  it.each(["payment.create", "payment.cancel"])(
    "DSOR-OPR-06: %s in validate_only mode answers VALIDATED, makes no proposal, and changes no row",
    async (operation) => {
      const world = story();
      await draft(world, keyed(SUPERVISOR));
      const before = structuredClone(world.rows);
      const proposals = (await world.proposals.all()).length;
      const envelope = inMode(SUPERVISOR, "validate_only");
      const answer = await call(world.registry, world.log, envelope, operation, EXAMPLE[operation]);
      expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "ALLOW" });
      expect(await world.proposals.all()).toHaveLength(proposals);
      expect(world.rows).toStrictEqual(before);
    },
  );

  it.each([
    ["no mode", (envelope: RequestEnvelope) => keyed(envelope)],
    ["mode execute", (envelope: RequestEnvelope) => inMode(keyed(envelope), "execute")],
    ["mode propose_only", (envelope: RequestEnvelope) => inMode(keyed(envelope), "propose_only")],
    ["mode validate_only", (envelope: RequestEnvelope) => inMode(envelope, "validate_only")],
  ])(
    "Step 23: invoice.issue, which has no code, is refused with %s, as the real call is, and makes no proposal (step 23's README, decision 3)",
    async (_mode, envelopeOf) => {
      const world = story();
      const answer = await call(
        world.registry,
        world.log,
        envelopeOf(SUPERVISOR),
        "invoice.issue",
        EXAMPLE["invoice.issue"],
      );
      expect(answer).toStrictEqual({
        code: "UNSUPPORTED_CAPABILITY",
        message: '"invoice.issue" is not built yet',
        retry: "never",
        correlation: correlationFor(THE_SUPERVISOR),
      });
      expect(await world.proposals.all()).toStrictEqual([]);
    },
  );

  it.each([
    ["an input with no expected_version", { invoice: INV_1008.invoice }],
    ["an input with a field its schema does not have", { ...INV_1008, amount: "999999.00" }],
    [
      "another company's invoice",
      { invoice: "dsor://org_789/invoice/INV-1008", expected_version: 1 },
    ],
  ])(
    "DSOR-OPR-05: a propose_only call with %s hears the refusal the real call hears, and claims nothing",
    async (_what, input) => {
      const world = story();
      const envelope = keyed(SUPERVISOR);
      const prepared = await draft(world, inMode(envelope, "propose_only"), input);
      const real = await draft(world, keyed(SUPERVISOR), input);
      expect("code" in prepared.answer).toBe(true);
      expect(forComparing(prepared.answer)).toStrictEqual(forComparing(real.answer));
      expect(await world.proposals.all()).toStrictEqual([]);
      // Its key was never claimed: a real call with it drafts PAY-901.
      const later = await draft(world, envelope);
      expect(later.answer).toMatchObject({ outcome: "COMMITTED", data: { id: "PAY-901" } });
    },
  );

  it.each(["propose_only", "validate_only"])(
    "DSOR-TEN-02b: every operation is attacked with foreign URIs in %s mode too, from both companies, and refused",
    async (mode) => {
      // Each command's call in this mode. A dry run carries no key (decision 6), and the suite
      // gives every command one, so the dry run's is taken out.
      const inThisMode: Send = (on, to, request, operation, ...rest) => {
        if (on.contracts.get(operation)?.["kind"] !== "command") {
          return call(on, to, request, operation, ...rest);
        }
        const { idempotency_key: _key, ...keyless } = request;
        const envelope = mode === "validate_only" ? { ...keyless, mode } : { ...request, mode };
        return call(on, to, envelope, operation, ...rest);
      };
      const report = await crossTenantSuite(
        sharedRegistry,
        createLog(),
        readExamples(),
        inThisMode,
      );
      expect(report.findings).toStrictEqual([]);
      expect(report.attacked).toStrictEqual([...sharedRegistry.contracts.keys()]);
      // Step 12's 51, and the tear-up's 12 since step 25: 3 callers in org_456 and 1 in org_789.
      // And the brake's 18 since step 25b: 2 callers for each command in org_456, and 1 in org_789.
      expect(report.attacks).toHaveLength(81);
    },
  );

  it("Step 23: a prepared proposal keeps the request as line ⑥ checked it, its fingerprint, the URIs it names, and who asked", async () => {
    const world = story();
    const { answer } = await draft(world, inMode(keyed(AGENT), "propose_only"));
    const proposal = await world.proposals.get("org_456", idOf(answer));
    expect(proposal?.payload).toStrictEqual(INV_1008);
    expect(proposal?.payload_hash).toBe(payloadHash(INV_1008));
    expect("payload_hash" in answer && answer.payload_hash).toBe(payloadHash(INV_1008));
    expect(proposal?.resources).toStrictEqual([INV_1008.invoice]);
    expect(proposal?.requester).toStrictEqual({
      identity_mode: "unattended",
      subject: "user_123",
      subject_type: "human",
      actor_chain: ["accounts-payable-fte"],
      active_tenant: "org_456",
      delegation: "del_100",
      subject_authority: { source: "role_source", as_of: expect.any(String) },
    });
  });

  it("Step 23: a key sent again with another request, in another mode, hears that the request differs: the fingerprint is compared first", async () => {
    const world = story();
    const envelope = keyed(AGENT);
    await draft(world, envelope);
    const other = await draft(world, inMode(envelope, "propose_only"), {
      ...INV_1008,
      expected_version: 2,
    });
    expect("code" in other.answer && other.answer.message).toBe(
      'the idempotency_key was used for a different request to "payment.create"',
    );
  });

  it("Step 23: a dry run that learns its signer is gone still suspends the signer's slips, as every call does (DSOR-IDN-07; open question 95)", async () => {
    const world = story();
    world.directories
      .get("org_456")!
      .set("user_123", { status: "suspended", roles: ["ap_supervisor"] });
    const { answer } = await draft(world, inMode(AGENT, "validate_only"));
    expect("code" in answer && answer.code).toBe("DELEGATION_REQUIRED");
    const changed = (await world.slips.changes()).map((change) => change.delegation).sort();
    expect(changed).toStrictEqual(["del_100", "del_101", "del_190"]);
    expect(await world.proposals.all()).toStrictEqual([]);
  });
});
