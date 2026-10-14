// Proposals and their states (DSOR-APR-01a, DSOR-APR-01b, DSOR-APR-01c in
// specs/dsor/03-execution.md, section 26.2, and DSOR-IDM-04, section 22). In memory. The
// database's own guard is tested in proposals.db.test.ts (step 22's README, decision 3).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { Refusal } from "../src/envelope.ts";
import { invoices, memoryInvoices } from "../src/invoice.ts";
import { handlersFor } from "../src/operations.ts";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import {
  actorOf,
  canMove,
  closeProposal,
  isFinal,
  memoryProposals,
  openProposal,
  transitionFrom,
  urisIn,
  STATES,
  type MoveBy,
  type ProposalDraft,
  type State,
} from "../src/proposals.ts";
import {
  AGENT,
  keyed,
  OUR_EXTENSIONS,
  proposalRegistry,
  REQUEST_ID,
  SUPERVISOR,
  THE_AGENT,
  THE_SUPERVISOR,
  correlationFor,
  withPlanted,
} from "./helpers.ts";

// The picture of §26.2, typed out again here from the specification, not imported from src, so
// a mistake in src is not copied into the test (step 04's README, decision 2). The picture's last
// line starts with COMMITTED or FAILED to COMPENSATING. Both are final in this step, so that move
// is not here (step 22's README, decision 1).
const DRAWN: readonly (readonly [State, State])[] = [
  ["PROPOSED", "DENIED"],
  ["PROPOSED", "READY"],
  ["PROPOSED", "PENDING_APPROVAL"],
  ["READY", "EXECUTING"],
  ["PENDING_APPROVAL", "APPROVED"],
  ["PENDING_APPROVAL", "REJECTED"],
  ["PENDING_APPROVAL", "EXPIRED"],
  ["PENDING_APPROVAL", "CANCELLED"],
  ["APPROVED", "EXECUTING"],
  ["APPROVED", "EXPIRED"],
  ["APPROVED", "REVOKED"],
  ["APPROVED", "INVALIDATED"],
  ["APPROVED", "CANCELLED"],
  ["EXECUTING", "COMMITTED"],
  ["EXECUTING", "FAILED"],
  ["EXECUTING", "OUTCOME_UNKNOWN"],
  ["OUTCOME_UNKNOWN", "COMMITTED"],
  ["OUTCOME_UNKNOWN", "FAILED"],
  ["COMPENSATING", "COMPENSATED"],
  ["COMPENSATING", "COMPENSATION_FAILED"],
];

// The states on the picture's right-hand edge, which §26.2 calls final.
const FINAL: readonly State[] = [
  "DENIED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
  "REVOKED",
  "INVALIDATED",
  "COMMITTED",
  "FAILED",
  "COMPENSATED",
  "COMPENSATION_FAILED",
];

const drawn = (from: State, to: State): boolean => DRAWN.some(([f, t]) => f === from && t === to);

// The specification's own list of states, from the copy of common.schema.json.
const COMMON = JSON.parse(
  readFileSync(new URL("../schemas/common.schema.json", import.meta.url), "utf8"),
) as { $defs: { proposalState: { enum: string[] } } };

// A proposal the store tests write by hand: the story's draft of PAY-901, asked by the agent.
const ID = "prop_00000000-0000-4000-8000-000000000001";
const URI = `dsor://org_456/proposal/${ID}`;
const DRAFT: ProposalDraft = {
  operation: "payment.create@1",
  mode: "execute",
  payload: { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 },
  payload_hash: `sha256:${"a".repeat(64)}`,
  resources: ["dsor://org_456/invoice/INV-1008"],
  requester: {
    identity_mode: "unattended",
    subject: "user_123",
    subject_type: "human",
    actor_chain: ["accounts-payable-fte"],
    active_tenant: "org_456",
    delegation: "del_100",
    subject_authority: { source: "role_source", as_of: "2026-10-07T02:05:00.000Z" },
  },
  idempotency_key: "pay-INV-1008-a",
};
const AUTHORITY = { source: "role_source" as const, as_of: "2026-10-07T02:05:00.000Z" };
const BY_AGENT: MoveBy = {
  mover: {
    mode: "unattended",
    subject: "user_123",
    actor_chain: ["accounts-payable-fte"],
    subject_authority: AUTHORITY,
  },
  cause: "payment.create called",
  correlation: { request_id: "req_test", agent_id: "accounts-payable-fte" },
};
const BY_DSOR: MoveBy = {
  mover: { mode: "direct", subject: "dsor", actor_chain: [], subject_authority: AUTHORITY },
  cause: "a test moves it",
  correlation: { request_id: "req_test", agent_id: "accounts-payable-fte" },
};

/** A store holding the hand-made proposal, moved along these states, one move after another. */
async function storeAt(...path: State[]) {
  const store = memoryProposals();
  await store.create("org_456", ID, DRAFT, BY_AGENT);
  let at: State = "PROPOSED";
  for (const next of path) {
    expect(await store.move("org_456", ID, at, next, BY_DSOR)).toBe(true);
    at = next;
  }
  return store;
}

// The story's call: the agent drafts a payment for INV-1008, decided on version 1.
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };

/** A registry whose proposals and payments the test can look at, over a copy of the invoices. */
function story() {
  const proposals = memoryProposals();
  const rows: Payment[] = [];
  const ledger = structuredClone(invoices);
  const registry = proposalRegistry(rows, proposals, memoryInvoices(ledger));
  return { proposals, rows, ledger, registry, log: createLog() };
}

// The id at the end of a proposal's URI.
function idOf(uri: unknown): string {
  const match = /^dsor:\/\/org_456\/proposal\/(prop_[0-9a-f-]{36})$/.exec(String(uri));
  if (match === null) throw new Error(`not a proposal of org_456: ${String(uri)}`);
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

describe("the picture of §26.2", () => {
  it("DSOR-APR-01a: the states are the 17 that the specification's schema lists", () => {
    expect([...STATES].sort()).toStrictEqual([...COMMON.$defs.proposalState.enum].sort());
  });

  it("DSOR-APR-01a: a proposal may make every move the picture draws, and no other", () => {
    for (const from of STATES) {
      for (const to of STATES) {
        expect([from, to, canMove(from, to)]).toStrictEqual([from, to, drawn(from, to)]);
      }
    }
  });

  it("DSOR-APR-01c: no move leaves a final state, and every other state has a way out", () => {
    for (const state of STATES) {
      expect([state, isFinal(state)]).toStrictEqual([state, FINAL.includes(state)]);
      if (FINAL.includes(state)) {
        for (const to of STATES)
          expect([state, to, canMove(state, to)]).toStrictEqual([state, to, false]);
      }
    }
  });

  // Titled by the decision, not by DSOR-APR-01c: §26.2's last line draws a move out of COMMITTED
  // and FAILED for commands that can be undone, and this step does not build it (open question
  // 89). Found by the review.
  it("Step 22: COMMITTED and FAILED are final, so nothing moves them to COMPENSATING (step 22's README, decision 1)", () => {
    expect(canMove("COMMITTED", "COMPENSATING")).toBe(false);
    expect(canMove("FAILED", "COMPENSATING")).toBe(false);
  });

  it("DSOR-APR-01a: a word that is not a state moves nowhere, even a name every object has", () => {
    for (const word of ["constructor", "toString", "__proto__", "committed", ""]) {
      expect(canMove(word as State, "READY")).toBe(false);
      expect(canMove("PROPOSED", word as State)).toBe(false);
    }
  });
});

describe("the store of proposals, in memory", () => {
  it("DSOR-APR-01a: a new proposal starts as PROPOSED, with the record of its first move", async () => {
    const store = await storeAt();
    const proposal = await store.get("org_456", ID);
    expect(proposal?.state).toBe("PROPOSED");
    expect(proposal?.transitions).toStrictEqual([
      {
        to: "PROPOSED",
        at: expect.any(String),
        actor: "accounts-payable-fte",
        cause: "payment.create called",
      },
    ]);
  });

  it("DSOR-APR-01a: the store refuses a move the picture does not draw, and changes nothing", async () => {
    const store = await storeAt();
    await expect(store.move("org_456", ID, "PROPOSED", "COMMITTED", BY_DSOR)).rejects.toThrow(
      "no move from PROPOSED to COMMITTED in the picture of section 26.2",
    );
    const proposal = await store.get("org_456", ID);
    expect(proposal?.state).toBe("PROPOSED");
    expect(proposal?.transitions).toHaveLength(1);
  });

  it("DSOR-APR-01c: the store refuses every move out of COMMITTED, and the proposal stays COMMITTED", async () => {
    const store = await storeAt("READY", "EXECUTING", "COMMITTED");
    for (const to of STATES) {
      await expect(store.move("org_456", ID, "COMMITTED", to, BY_DSOR)).rejects.toThrow(
        `no move from COMMITTED to ${to}`,
      );
    }
    const proposal = await store.get("org_456", ID);
    expect(proposal?.state).toBe("COMMITTED");
    expect(proposal?.transitions).toHaveLength(4);
  });

  it("DSOR-APR-01c: the store refuses every move out of FAILED", async () => {
    const store = await storeAt("READY", "EXECUTING", "FAILED");
    for (const to of STATES) {
      await expect(store.move("org_456", ID, "FAILED", to, BY_DSOR)).rejects.toThrow();
    }
    expect((await store.get("org_456", ID))?.state).toBe("FAILED");
  });

  it("DSOR-IDM-04: a move from a state the proposal has already left changes nothing", async () => {
    const store = await storeAt("READY", "EXECUTING");
    // A second start of the same proposal: it is EXECUTING, not READY, so nothing moves.
    expect(await store.move("org_456", ID, "READY", "EXECUTING", BY_DSOR)).toBe(false);
    const proposal = await store.get("org_456", ID);
    expect(proposal?.state).toBe("EXECUTING");
    expect(proposal?.transitions.filter((t) => t.to === "EXECUTING")).toHaveLength(1);
  });

  it("DSOR-APR-01b: each move leaves one record, with its actor and its cause", async () => {
    const store = await storeAt("READY");
    expect(await store.transitions()).toStrictEqual([
      {
        record_id: expect.stringMatching(/^aud_/),
        sequence: 1,
        at: expect.any(String),
        kind: "proposal_transition",
        operation: "payment.create@1",
        result: "PROPOSED",
        reason: "payment.create called",
        correlation: { request_id: "req_test", agent_id: "accounts-payable-fte" },
        tenant: "org_456",
        identity: BY_AGENT.mover,
        resources: [URI],
      },
      {
        record_id: expect.stringMatching(/^aud_/),
        sequence: 2,
        at: expect.any(String),
        kind: "proposal_transition",
        operation: "payment.create@1",
        result: "READY",
        reason: "a test moves it",
        correlation: { request_id: "req_test", agent_id: "accounts-payable-fte" },
        tenant: "org_456",
        identity: BY_DSOR.mover,
        resources: [URI],
        extensions: { [OUR_EXTENSIONS]: { from: "PROPOSED" } },
      },
    ]);
  });

  it("DSOR-APR-01b: a move the store refuses leaves no record", async () => {
    const store = await storeAt();
    await expect(store.move("org_456", ID, "PROPOSED", "FAILED", BY_DSOR)).rejects.toThrow();
    expect(await store.transitions()).toHaveLength(1);
  });

  it("DSOR-APR-01b: a move with no cause, or no actor, is refused, so no record is empty", async () => {
    const store = await storeAt();
    await expect(
      store.move("org_456", ID, "PROPOSED", "READY", { ...BY_DSOR, cause: "" }),
    ).rejects.toThrow("a move needs a cause");
    const nobody = { ...BY_DSOR, mover: { ...BY_DSOR.mover, subject: "" } };
    await expect(store.move("org_456", ID, "PROPOSED", "READY", nobody)).rejects.toThrow(
      "a move needs an actor",
    );
    expect((await store.get("org_456", ID))?.state).toBe("PROPOSED");
  });

  it("DSOR-TEN-01b: a proposal of one company is not found, and does not move, in another", async () => {
    const store = await storeAt();
    expect(await store.get("org_789", ID)).toBeUndefined();
    expect(await store.move("org_789", ID, "PROPOSED", "READY", BY_DSOR)).toBe(false);
    expect((await store.get("org_456", ID))?.state).toBe("PROPOSED");
  });

  it("Step 22: the store keeps a copy, so a caller that changes its draft afterwards changes nothing", async () => {
    const store = memoryProposals();
    const draft = structuredClone(DRAFT);
    await store.create("org_456", ID, draft, BY_AGENT);
    (draft.payload as { expected_version: number }).expected_version = 9;
    draft.requester.subject = "cfo_100";
    const kept = await store.get("org_456", ID);
    expect(kept?.payload).toStrictEqual(DRAFT.payload);
    expect(kept?.requester).toStrictEqual(DRAFT.requester);
  });
});

describe("a command's proposal, through the checklist", () => {
  it("DSOR-APR-01a: the agent's draft moves PROPOSED, READY, EXECUTING, and COMMITTED in one call", async () => {
    const { proposals, registry, log, rows } = story();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    expect("outcome" in answer && answer.outcome).toBe("COMMITTED");
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.state).toBe("COMMITTED");
    expect(proposal?.transitions.map(({ from, to, actor }) => [from, to, actor])).toStrictEqual([
      [undefined, "PROPOSED", "accounts-payable-fte"],
      ["PROPOSED", "READY", "dsor"],
      ["READY", "EXECUTING", "dsor"],
      ["EXECUTING", "COMMITTED", "dsor"],
    ]);
    expect(rows.map((row) => row.id)).toStrictEqual(["PAY-901"]);
  });

  it("DSOR-APR-01a: a refusal from the code ends the proposal FAILED, and the answer names it (step 22's README, decision 2)", async () => {
    const { proposals, registry, log, rows } = story();
    // Decided on version 2, and INV-1008 is at version 1: the code refuses at line ⑨.
    const answer = await call(registry, log, keyed(AGENT), "payment.create", {
      ...INV_1008,
      expected_version: 2,
    });
    expect("code" in answer && answer.code).toBe("STALE_STATE");
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.state).toBe("FAILED");
    expect(proposal?.transitions.at(-1)).toStrictEqual({
      from: "EXECUTING",
      to: "FAILED",
      at: expect.any(String),
      actor: "dsor",
      cause: "the code refused: STALE_STATE",
    });
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-APR-01a: a business rule's refusal ends FAILED too, until step 32 moves the rule before the work", async () => {
    const { proposals, registry, log } = story();
    // INV-1001 is paid, so no payment is drafted for it.
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1001",
      expected_version: 1,
    });
    expect("code" in answer && answer.code).toBe("CONFLICT");
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.state).toBe("FAILED");
    expect(proposal?.transitions.at(-1)?.cause).toBe("the code refused: CONFLICT");
  });

  it("DSOR-APR-01b: every move of the call is recorded, with its actor, its cause, and the call's correlation", async () => {
    const { proposals, registry, log } = story();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    const uri = "proposal" in answer ? answer.proposal : undefined;
    const records = (await proposals.transitions()).filter((record) => record.resources[0] === uri);
    expect(
      records.map(({ result, reason, identity }) => [result, reason, identity.subject]),
    ).toStrictEqual([
      ["PROPOSED", "payment.create called", "user_123"],
      ["READY", "no control asks for an approval: controls are not built yet", "dsor"],
      ["EXECUTING", "execute mode: the work starts", "dsor"],
      ["COMMITTED", "the work ended", "dsor"],
    ]);
    for (const record of records) {
      expect(record.correlation).toStrictEqual(answer.correlation);
      expect(record.operation).toBe("payment.create@1");
    }
    // The agent asked, under the slip user_123 signed: the first record names both.
    expect(records[0]?.identity).toStrictEqual({
      mode: "unattended",
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      subject_authority: { source: "role_source", as_of: expect.any(String) },
    });
  });

  it("DSOR-APR-01b: a person's own call names the person as the first actor, with no agent", async () => {
    const { proposals, registry, log } = story();
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", INV_1008);
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.transitions[0]?.actor).toBe("user_123");
    expect(proposal?.requester).toStrictEqual({
      identity_mode: "direct",
      subject: "user_123",
      subject_type: "human",
      actor_chain: [],
      active_tenant: "org_456",
      subject_authority: { source: "token", as_of: expect.any(String) },
    });
  });

  it("DSOR-IDM-04: a replay with the same key names the same proposal, and makes no second one", async () => {
    const { proposals, registry, log, rows } = story();
    const envelope = keyed(AGENT);
    const first = await call(registry, log, envelope, "payment.create", INV_1008);
    const again = await call(registry, log, envelope, "payment.create", INV_1008);
    expect("proposal" in again && again.proposal).toBe("proposal" in first && first.proposal);
    expect(await proposals.all()).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it("DSOR-IDM-04: a replay of a refusal names the same FAILED proposal", async () => {
    const { proposals, registry, log } = story();
    const envelope = keyed(AGENT);
    const stale = { ...INV_1008, expected_version: 2 };
    const first = await call(registry, log, envelope, "payment.create", stale);
    const again = await call(registry, log, envelope, "payment.create", stale);
    expect("code" in again && again.code).toBe("STALE_STATE");
    expect("proposal" in again && again.proposal).toBe("proposal" in first && first.proposal);
    expect(await proposals.all()).toHaveLength(1);
  });

  it("DSOR-IDM-04: a new key is a new attempt, with a proposal of its own", async () => {
    const { proposals, registry, log, rows } = story();
    const first = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    const second = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    expect("proposal" in second && second.proposal).not.toBe("proposal" in first && first.proposal);
    expect(await proposals.all()).toHaveLength(2);
    expect(rows).toHaveLength(2);
  });

  it("DSOR-EXE-01a: a command runs lines 1, 2, 3, 5, 6, 7, 8, 9, and 11, and a replay stops at line 7", async () => {
    const { registry, log } = story();
    const envelope = keyed(AGENT);
    const first: number[] = [];
    await call(registry, log, envelope, "payment.create", INV_1008, (n) => first.push(n));
    const again: number[] = [];
    await call(registry, log, envelope, "payment.create", INV_1008, (n) => again.push(n));
    expect(first).toStrictEqual([1, 2, 3, 5, 6, 7, 8, 9, 11]);
    expect(again).toStrictEqual([1, 2, 3, 5, 6, 7, 11]);
  });

  it("Step 22: a query makes no proposal (step 22's README, decision 7)", async () => {
    const { proposals, registry, log } = story();
    const lines: number[] = [];
    const answer = await call(
      registry,
      log,
      AGENT,
      "invoice.get",
      { invoice: INV_1008.invoice },
      (n) => lines.push(n),
    );
    expect("data" in answer).toBe(true);
    expect(lines).not.toContain(8);
    expect(await proposals.all()).toStrictEqual([]);
  });

  it("Step 22: a call refused before line ⑧ makes no proposal (step 22's README, decision 7)", async () => {
    const { proposals, registry, log } = story();
    const envelope = keyed(AGENT);
    // Refused at line ⑥: no expected_version.
    const invalid = await call(registry, log, envelope, "payment.create", {
      invoice: INV_1008.invoice,
    });
    expect("code" in invalid && invalid.code).toBe("VALIDATION_FAILED");
    // Refused at line ⑦: a command with no key.
    const keyless = await call(registry, log, AGENT, "payment.create", INV_1008);
    expect("code" in keyless && keyless.code).toBe("VALIDATION_FAILED");
    // The CFO may not draft a payment: refused at line ⑤.
    const cfo = await call(
      registry,
      log,
      keyed({ token: "tok_d4e8", tenant: "org_456" }),
      "payment.create",
      INV_1008,
    );
    expect("code" in cfo && cfo.code).toBe("AUTHORIZATION_DENIED");
    for (const answer of [invalid, keyless, cfo]) expect("proposal" in answer).toBe(false);
    expect(await proposals.all()).toStrictEqual([]);
  });

  it("Step 22: the same key with another request is refused at line ⑦, and makes no second proposal", async () => {
    const { proposals, registry, log } = story();
    const envelope = keyed(AGENT);
    await call(registry, log, envelope, "payment.create", INV_1008);
    const other = await call(registry, log, envelope, "payment.create", {
      ...INV_1008,
      expected_version: 2,
    });
    expect("code" in other && other.code).toBe("IDEMPOTENCY_CONFLICT");
    expect("proposal" in other).toBe(false);
    expect(await proposals.all()).toHaveLength(1);
  });
});

describe("what the answer and the proposal say", () => {
  it("DSOR-SCH-01: a command's answer names its proposal and its payload hash, and passes result-envelope.schema.json", async () => {
    const { proposals, registry, log } = story();
    const answer = await call(registry, log, keyed(SUPERVISOR), "payment.create", INV_1008);
    const passes = schemaCheck("result-envelope");
    expect([passes(answer), passes.errors]).toStrictEqual([true, null]);
    expect(answer).toStrictEqual({
      outcome: "COMMITTED",
      proposal: expect.stringMatching(/^dsor:\/\/org_456\/proposal\/prop_[0-9a-f-]{36}$/),
      payload_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      data: expect.objectContaining({ id: "PAY-901" }),
      classification: "confidential",
      semantics: "compensatable",
      correlation: correlationFor(THE_SUPERVISOR),
    });
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect("payload_hash" in answer && answer.payload_hash).toBe(proposal?.payload_hash);
  });

  it("DSOR-SCH-01: a refused command's error envelope names its proposal, and passes error-envelope.schema.json", async () => {
    const { registry, log } = story();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", {
      ...INV_1008,
      expected_version: 2,
    });
    const passes = schemaCheck("error-envelope");
    expect([passes(answer), passes.errors]).toStrictEqual([true, null]);
    expect(answer).toStrictEqual({
      code: "STALE_STATE",
      message: expect.any(String),
      retry: "after_state_refresh",
      proposal: expect.stringMatching(/^dsor:\/\/org_456\/proposal\/prop_/),
      correlation: correlationFor(THE_AGENT),
    });
  });

  it("DSOR-APR-01a: the proposal as DSoR keeps it passes proposal.schema.json", async () => {
    const { proposals, registry, log } = story();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    const passes = schemaCheck("proposal");
    expect([passes(proposal), passes.errors]).toStrictEqual([true, null]);
  });

  it("Step 22: the proposal keeps the request as line ⑥ checked it, the URIs it names, and who asked", async () => {
    const { proposals, registry, log } = story();
    const answer = await call(
      registry,
      log,
      keyed(AGENT, "pay-INV-1008-z"),
      "payment.create",
      INV_1008,
    );
    const uri = "proposal" in answer ? answer.proposal : "";
    const proposal = await proposals.get("org_456", idOf(uri));
    expect(proposal).toStrictEqual({
      uri,
      tenant: "org_456",
      operation: "payment.create@1",
      mode: "execute",
      state: "COMMITTED",
      payload: INV_1008,
      payload_hash: "payload_hash" in answer ? answer.payload_hash : "",
      resources: ["dsor://org_456/invoice/INV-1008"],
      requester: {
        identity_mode: "unattended",
        subject: "user_123",
        subject_type: "human",
        actor_chain: ["accounts-payable-fte"],
        active_tenant: "org_456",
        delegation: "del_100",
        subject_authority: { source: "role_source", as_of: expect.any(String) },
      },
      idempotency_key: "pay-INV-1008-z",
      created_at: expect.any(String),
      transitions: expect.any(Array),
    });
  });

  // Not titled DSOR-AUD-01: the tutorial's records do not yet pass audit-record.schema.json.
  it("Step 22: the call's decision record names its proposal, so the decision and its moves are found together (step 22's README, decision 5)", async () => {
    const { registry, log } = story();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    const [record] = await log.records();
    expect(record?.extensions?.[OUR_EXTENSIONS]).toMatchObject({
      proposal: "proposal" in answer ? answer.proposal : "none",
    });
    expect(record?.correlation.request_id).toMatch(REQUEST_ID);
  });
});

describe("from the sweep", () => {
  // An input that reads differently the second time: line ① copies it once, and every check, and
  // the proposal, read that copy. Found by the sweep: a proposal that kept the input as sent
  // passed every test, because the story's inputs read the same every time.
  it("Step 22: the proposal keeps the copy that line ⑥ checked, never the input read again (step 22's README, decision 13)", async () => {
    const { proposals, registry, log } = story();
    let versions = 0;
    let invoices = 0;
    const shifty = {
      get invoice(): string {
        invoices += 1;
        return invoices === 1 ? INV_1008.invoice : "dsor://org_456/invoice/INV-1009";
      },
      get expected_version(): number {
        versions += 1;
        return versions === 1 ? 1 : 2;
      },
    };
    const answer = await call(registry, log, keyed(AGENT), "payment.create", shifty);
    expect("outcome" in answer && answer.outcome).toBe("COMMITTED");
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.payload).toStrictEqual(INV_1008);
    // And the URIs it names, from the same copy.
    expect(proposal?.resources).toStrictEqual([INV_1008.invoice]);
  });

  // Code whose refusal is above the agent's clearance: masking withholds the message, and the
  // proposal is still named. Found by the sweep: no refusal of the shipped code is above the
  // agent's clearance, so a masked refusal that lost its proposal passed every test.
  it("Step 22: a refusal masked for the agent still names its proposal, which ended FAILED (step 22's README, decision 5)", async () => {
    const proposals = memoryProposals();
    const registry = proposalRegistry([], proposals, memoryInvoices(), {
      ...handlersFor(),
      "payment.create": async () => {
        // Confidential, as a Refusal is unless its code says otherwise.
        throw new Refusal("CONFLICT", "VENDOR-44's bank account 12-3456 is closed");
      },
    });
    const answer = await call(registry, createLog(), keyed(AGENT), "payment.create", INV_1008);
    expect(answer).toStrictEqual({
      code: "CONFLICT",
      message: "the operation refused the call, and its reason is above the caller's clearance",
      retry: "never",
      proposal: expect.stringMatching(/^dsor:\/\/org_456\/proposal\/prop_/),
      correlation: correlationFor(THE_AGENT),
    });
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.state).toBe("FAILED");
  });
});

describe("from the review", () => {
  // Every record names its mover in full. The agent asks under user_123's slip, with the time of
  // the directory's answer that line ③ used; DSoR makes the other moves, on that same authority.
  // The directory's answer is kept from a read a moment before, so its time is not the time of
  // the draft. Found by the review: a mover's mode, or an authority's time, could change unseen.
  it("DSOR-APR-01b: every record names its mover in full: the agent under its slip first, then DSoR itself, on the authority the call carried", async () => {
    const { proposals, registry, log } = story();
    await call(registry, log, AGENT, "invoice.get", { invoice: INV_1008.invoice });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const answer = await call(registry, log, keyed(AGENT), "payment.create", INV_1008);
    const uri = "proposal" in answer ? answer.proposal : undefined;
    const records = (await proposals.transitions()).filter((record) => record.resources[0] === uri);
    const decision = (await log.records()).find(
      (record) => record.operation === "payment.create@1",
    );
    const authority = decision?.identity?.subject_authority;
    expect(authority).toMatchObject({ source: "role_source" });
    const dsor = { mode: "direct", subject: "dsor", actor_chain: [], subject_authority: authority };
    expect(records.map((record) => record.identity)).toStrictEqual([
      {
        mode: "unattended",
        subject: "user_123",
        actor_chain: ["accounts-payable-fte"],
        subject_authority: authority,
      },
      dsor,
      dsor,
      dsor,
    ]);
    const proposal = await proposals.get("org_456", idOf(uri));
    expect(proposal?.requester.subject_authority).toStrictEqual(authority);
  });

  it("Step 22: in memory, an accident leaves its proposal EXECUTING, where the database rolls it back (step 22's README, decision 9)", async () => {
    const proposals = memoryProposals();
    const registry = proposalRegistry([], proposals, memoryInvoices(), {
      ...handlersFor(),
      "payment.create": async () => {
        throw new TypeError("the code broke");
      },
    });
    const answer = await call(registry, createLog(), keyed(AGENT), "payment.create", INV_1008);
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect("proposal" in answer).toBe(false);
    expect((await proposals.all()).map((proposal) => proposal.state)).toStrictEqual(["EXECUTING"]);
  });

  it("Step 22: the store in memory refuses a second proposal with one id, as the database's key does", async () => {
    const store = await storeAt();
    await expect(store.create("org_456", ID, DRAFT, BY_AGENT)).rejects.toThrow(
      `a second proposal with the id ${ID}`,
    );
    expect(await store.all()).toHaveLength(1);
  });

  it("DSOR-APR-01b: a proposal made with no cause, or no actor, is refused, so its first record is never empty", async () => {
    const store = memoryProposals();
    await expect(store.create("org_456", ID, DRAFT, { ...BY_AGENT, cause: " " })).rejects.toThrow(
      "a move needs a cause",
    );
    const nobody = { ...BY_AGENT, mover: { ...BY_AGENT.mover, subject: "" } };
    await expect(store.create("org_456", ID, DRAFT, nobody)).rejects.toThrow(
      "a move needs an actor",
    );
    expect(await store.all()).toStrictEqual([]);
    expect(await store.transitions()).toStrictEqual([]);
  });

  it("Step 22: a refused call's decision record names its proposal too (step 22's README, decision 5)", async () => {
    const { registry, log } = story();
    const answer = await call(registry, log, keyed(AGENT), "payment.create", {
      ...INV_1008,
      expected_version: 2,
    });
    expect("code" in answer && answer.code).toBe("STALE_STATE");
    const [record] = await log.records();
    expect(record?.extensions?.[OUR_EXTENSIONS]?.proposal).toBe(
      "proposal" in answer ? answer.proposal : "none",
    );
  });

  // Code that throws a refusal carrying a proposal of its own, here another company's: the envelope
  // names only what the claim gave back, and a query has no claim. Found by the review: a Refusal
  // could carry any proposal, and the envelope sent it.
  it("Step 22: code cannot name a proposal in a refusal of its own: the envelope names only the claim's (step 22's README, decision 5)", async () => {
    const planted = `dsor://org_789/proposal/prop_${randomUUID()}`;
    const registry = proposalRegistry([], memoryProposals(), memoryInvoices(), {
      ...handlersFor(),
      "invoice.get": async () => {
        throw Object.assign(new Refusal("RESOURCE_NOT_FOUND", "no invoice", "public"), {
          proposal: planted,
        });
      },
    });
    const answer = await call(registry, createLog(), AGENT, "invoice.get", {
      invoice: INV_1008.invoice,
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect("proposal" in answer).toBe(false);
  });

  // A caller that is neither a person nor an agent, such as a billing application with a login of
  // its own: its proposal names what it is. Found by the review: every caller in the story is a
  // person, so a requester always named "human" passed every test.
  it("Step 22: an application's own call names it as an application, not as a person (step 22's README, decision 11)", async () => {
    const { proposals, registry, log } = story();
    const app = {
      id: "billing-app",
      type: "application" as const,
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    };
    const answer = await withPlanted("tok_app1", app, () =>
      call(
        registry,
        log,
        keyed({ token: "tok_app1", tenant: "org_456" }),
        "payment.create",
        INV_1008,
      ),
    );
    const proposal = await proposals.get("org_456", idOf("proposal" in answer && answer.proposal));
    expect(proposal?.requester).toMatchObject({
      identity_mode: "direct",
      subject: "billing-app",
      subject_type: "application",
      actor_chain: [],
    });
  });
});

// The parts that no call of the story can reach, each tried alone. Found by the second sweep:
// each break stayed green, because every story call gives these parts one shape only.
describe("the parts, alone", () => {
  it("Step 22: a URI the request names twice is one resource of the proposal", () => {
    const uri = "dsor://org_456/invoice/INV-1008";
    expect(
      urisIn({ invoice: uri, also: [uri, { again: uri }], note: "dsor is no URI" }),
    ).toStrictEqual([uri]);
  });

  it("Step 22: the actor of a move is the last of its actor chain, the one that acted", () => {
    const mover = { ...BY_AGENT.mover, actor_chain: ["firm-ap-fte", "accounts-payable-fte"] };
    expect(actorOf(mover)).toBe("accounts-payable-fte");
    expect(actorOf(BY_DSOR.mover)).toBe("dsor");
  });

  it("Step 22: a record's state left is read from this tutorial's own namespace, never the first one there", () => {
    const record = {
      result: "READY",
      reason: "a test",
      identity: BY_DSOR.mover,
      extensions: {
        "org.example.other": { from: "COMMITTED" },
        [OUR_EXTENSIONS]: { from: "PROPOSED" },
      },
      at: "2026-10-07T02:05:00.000Z",
    };
    expect(transitionFrom(record).from).toBe("PROPOSED");
  });

  // A store whose move to EXECUTING finds the proposal moved already, as a second mover would.
  it("DSOR-IDM-04: line ⑧ fails when its move to EXECUTING finds the proposal moved, and runs no code", async () => {
    const store = memoryProposals();
    const losing = {
      ...store,
      move: async (tenant: string, id: string, from: State, to: State, by: MoveBy) =>
        to === "EXECUTING" ? false : store.move(tenant, id, from, to, by),
    };
    const opening = { tenant: "org_456", draft: DRAFT, correlation: BY_DSOR.correlation };
    await expect(openProposal(losing, opening)).rejects.toThrow("was no longer READY");
  });

  it("Step 22: the last move refuses a proposal URI of another company, or one that is no proposal", async () => {
    const store = memoryProposals();
    const opening = { tenant: "org_456", draft: DRAFT, correlation: BY_DSOR.correlation };
    for (const uri of [
      `dsor://org_789/proposal/prop_${randomUUID()}`,
      "dsor://org_456/payment/PAY-901",
      "dsor://org_456/proposal/prop_1",
    ]) {
      await expect(closeProposal(store, opening, uri, { value: {} })).rejects.toThrow(
        "a claim's proposal is not one of its company's",
      );
    }
  });
});
