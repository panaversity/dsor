// NEW IN STEP 41b: a new proposal replaces a waiting one. The new command names the old one in
//   `supersedes`, in its request envelope; in one transaction the old one and its lines move to
//   CANCELLED with their booking, and the new one is checked from the start, or nothing changes
//   (DSOR-APR-12; step 41b's README, claims C1 to C10).
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { payloadHash } from "../src/canonical.ts";
import type { Answer } from "../src/envelope.ts";
import { proposalUri, urisIn, type Requester, type State } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, FIRM_IN_456, keyed, SUPERVISOR } from "./helpers.ts";
import { ruleWorld, type RuleWorld } from "./rule-world.ts";

/** One draft's input, of one of org_456's bills, decided on version 1. */
function draftOf(id: string): { invoice: string; expected_version: number } {
  return { invoice: `dsor://org_456/invoice/${id}`, expected_version: 1 };
}

/** This caller's envelope, with a fresh key or this one, that replaces the proposal at `uri`. */
function replacing(who: RequestEnvelope, uri: unknown, key?: string): RequestEnvelope {
  return { ...keyed(who, key), supersedes: uri } as RequestEnvelope;
}

/** The proposal an answer names. */
function proposalOf(answer: Answer): string {
  return String((answer as { proposal?: unknown }).proposal);
}

/** The code of a refusal, or the outcome of anything else. */
function saidOf(answer: Answer): string {
  return "code" in answer ? answer.code : String((answer as { outcome?: unknown }).outcome);
}

/** One of the world's proposals, by its address. */
async function proposalAt(w: RuleWorld, uri: string) {
  return (await w.proposals.all()).find((p) => p.uri === uri);
}

/** The agent's draft of INV-1008, 31,400.00 USD, which waits for cfo_100: its address. */
async function waitingDraft(w: RuleWorld): Promise<string> {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  return proposalOf(answer);
}

describe("C1: supersedes travels in the request envelope", () => {
  it.each([
    ["a number", 42],
    ["a bill's id", "INV-1008"],
    ["an invoice's address", "dsor://org_456/invoice/INV-1008"],
    ["a proposal's address with an id of another form", "dsor://org_456/proposal/PAY-901"],
    ["an empty text", ""],
  ])(
    "step 41b's decision D9: C1: a supersedes that is %s is refused at line ①, and no proposal is made",
    async (_what, sent) => {
      const w = ruleWorld();
      const answer = await w.ask(replacing(AGENT, sent), "payment.create", draftOf("INV-1002"));
      expect(answer).toMatchObject({
        code: "VALIDATION_FAILED",
        message: "supersedes must be the address of a proposal, such as dsor://org_456/proposal/prop_…",
      });
      expect(await w.proposals.all()).toStrictEqual([]);
    },
  );

  it("step 41b's decision D9: C1: a supersedes of another company is refused as any address outside the company is, with TENANT_MISMATCH", async () => {
    const w = ruleWorld();
    const other = "dsor://org_789/proposal/prop_00000000-0000-4000-8000-000000000000";
    const answer = await w.ask(replacing(AGENT, other), "payment.create", draftOf("INV-1002"));
    expect(answer).toMatchObject({ code: "TENANT_MISMATCH" });
    expect(await w.proposals.all()).toStrictEqual([]);
  });

  it("step 41b's decision D9: C1: a query takes no supersedes", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await w.ask(
      { ...AGENT, supersedes: old } as RequestEnvelope,
      "invoice.get",
      { invoice: "dsor://org_456/invoice/INV-1008" },
    );
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"invoice.get" is a query, which takes no supersedes',
    });
  });

  it.each([
    ["a release", "proposal.execute", (old: string) => ({ proposal: old })],
    [
      "DSoR's own approval",
      "proposal.approve",
      (old: string) => ({ proposal: old, payload_hash: payloadHash(draftOf("INV-1008")) }),
    ],
  ])(
    "step 41b's decision D9: C1: %s takes no supersedes: it makes no new request of the company's code",
    async (_what, name, input) => {
      const w = ruleWorld();
      const old = await waitingDraft(w);
      const answer = await w.ask(replacing(CFO, old), name, input(old));
      expect(answer).toMatchObject({
        code: "VALIDATION_FAILED",
        message: `${JSON.stringify(name)} makes no new request of the company's code, so it takes no supersedes`,
      });
      expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
    },
  );

  it("DSOR-APR-12: C1: the new proposal keeps supersedes beside its payload, and its payload and payload hash are the bill's only", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1002"));
    const made = (await proposalAt(w, proposalOf(answer)))!;
    expect(made.supersedes).toBe(old);
    expect(made.payload).toStrictEqual(draftOf("INV-1002"));
    expect(made.payload_hash).toBe(payloadHash(draftOf("INV-1002")));
  });

  it("DSOR-APR-12: C1: a proposal made without supersedes names none", async () => {
    const w = ruleWorld();
    const made = (await proposalAt(w, await waitingDraft(w)))!;
    expect(made).not.toHaveProperty("supersedes");
  });
});

describe("C2: the claim compares supersedes", () => {
  it("step 41b's decision D9: C2: the same key with another supersedes is IDEMPOTENCY_CONFLICT, and nothing new is made", async () => {
    const w = ruleWorld();
    const first = await waitingDraft(w);
    const second = proposalOf(await w.draft("INV-1009"));
    await w.ask(replacing(AGENT, first, "k-replace-1"), "payment.create", draftOf("INV-1002"));
    const before = await w.proposals.all();
    const answer = await w.ask(
      replacing(AGENT, second, "k-replace-1"),
      "payment.create",
      draftOf("INV-1002"),
    );
    expect(answer).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message:
        'the idempotency_key was used for "payment.create" with another supersedes, and a key keeps what it replaces',
    });
    expect(await w.proposals.all()).toStrictEqual(before);
  });

  it("step 41b's decision D9: C2: the same key with no supersedes, after one with it, is IDEMPOTENCY_CONFLICT, and so is the other way round", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    await w.ask(replacing(AGENT, old, "k-replace-2"), "payment.create", draftOf("INV-1002"));
    const without = await w.ask(keyed(AGENT, "k-replace-2"), "payment.create", draftOf("INV-1002"));
    expect(without).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const plain = await w.ask(keyed(AGENT, "k-replace-3"), "payment.create", draftOf("INV-1009"));
    expect(plain).toMatchObject({ outcome: "COMMITTED" });
    const withIt = await w.ask(
      replacing(AGENT, old, "k-replace-3"),
      "payment.create",
      draftOf("INV-1009"),
    );
    expect(withIt).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("step 41b's decision D9: C2: the same key, input, and supersedes replays the first answer, and nothing new is made", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const sent = replacing(AGENT, old, "k-replace-4");
    const first = await w.ask(sent, "payment.create", draftOf("INV-1002"));
    const before = await w.proposals.all();
    const again = await w.ask(sent, "payment.create", draftOf("INV-1002"));
    expect(proposalOf(again)).toBe(proposalOf(first));
    expect(saidOf(again)).toBe(saidOf(first));
    expect(await w.proposals.all()).toStrictEqual(before);
  });

  it("step 41b's decision D9: C2: supersedes is one of the envelope's fields: a field it does not know is still refused", async () => {
    const w = ruleWorld();
    const answer = await w.ask(
      { ...keyed(AGENT), replaces: "x" } as RequestEnvelope,
      "payment.create",
      draftOf("INV-1002"),
    );
    expect(answer).toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        'the request envelope may carry only token, tenant, request_id, idempotency_key, mode, agent_asserted, and supersedes, not "replaces"',
    });
  });
});

// The agent's authority, as a proposal it asked for keeps it: user_123's slip del_100, unless a test
//   names another.
function agentAsker(delegation = "del_100"): Requester {
  return {
    identity_mode: "unattended",
    subject: "user_123",
    subject_type: "human",
    actor_chain: ["accounts-payable-fte"],
    active_tenant: "org_456",
    delegation,
    subject_authority: { source: "role_source", as_of: "2026-10-06T15:05:00.000Z" },
  };
}

// The moves that bring a new proposal to each state, along the picture of §26.2.
const PATHS: Record<string, State[]> = {
  READY: ["READY"],
  PENDING_APPROVAL: ["PENDING_APPROVAL"],
  APPROVED: ["PENDING_APPROVAL", "APPROVED"],
  DENIED: ["DENIED"],
  REJECTED: ["PENDING_APPROVAL", "REJECTED"],
  REVOKED: ["PENDING_APPROVAL", "APPROVED", "REVOKED"],
  EXPIRED: ["READY", "EXPIRED"],
  CANCELLED: ["READY", "CANCELLED"],
  INVALIDATED: ["READY", "INVALIDATED"],
  EXECUTING: ["READY", "EXECUTING"],
  COMMITTED: ["READY", "EXECUTING", "COMMITTED"],
  FAILED: ["READY", "EXECUTING", "FAILED"],
  OUTCOME_UNKNOWN: ["READY", "EXECUTING", "OUTCOME_UNKNOWN"],
};

/**
 * A proposal planted in the world's store, as DSoR would have kept it: the agent's draft of
 * INV-1006 under del_100, unless the test names another operation or slip, moved to this state.
 */
async function planted(
  w: RuleWorld,
  state: string,
  { operation = "payment.create@1", delegation = "del_100" } = {},
): Promise<string> {
  const id = `prop_${randomUUID()}`;
  const payload = draftOf("INV-1006");
  const by = {
    mover: { mode: "direct" as const, subject: "dsor", actor_chain: [], subject_authority: agentAsker().subject_authority },
    cause: "planted by the test",
    correlation: { request_id: `req_${randomUUID()}` },
  };
  await w.proposals.create(
    "org_456",
    id,
    {
      operation,
      mode: "execute",
      payload,
      payload_hash: payloadHash(payload),
      resources: urisIn(payload),
      requester: agentAsker(delegation),
      idempotency_key: `k-planted-${id}`,
    },
    by,
    "P7D",
  );
  let from: State = "PROPOSED";
  for (const to of PATHS[state]!) {
    const requires =
      to === "PENDING_APPROVAL"
        ? [{ control: "high-value-payment", control_version: 8, approval: { role: "CFO", quorum: 1 } }]
        : undefined;
    expect(await w.proposals.move("org_456", id, from, to, by, requires as never)).toBe(true);
    from = to;
  }
  return proposalUri("org_456", id);
}

/** The agent's new draft of INV-1002, which names the proposal at `old` in supersedes. */
function replaceWithDraft(w: RuleWorld, old: string, who: RequestEnvelope = AGENT): Promise<Answer> {
  return w.ask(replacing(who, old), "payment.create", draftOf("INV-1002"));
}

/** The answer's new proposal ended DENIED, and still names the one it tried to replace. */
async function deniedNaming(w: RuleWorld, answer: Answer, old: string): Promise<void> {
  const made = (await proposalAt(w, proposalOf(answer)))!;
  expect(made).toMatchObject({ state: "DENIED", supersedes: old });
}

describe("C3: who may replace a proposal, and when", () => {
  it("DSOR-APR-12: C3: an address of this company that names no proposal is RESOURCE_NOT_FOUND, and the new proposal ends DENIED", async () => {
    const w = ruleWorld();
    const nowhere = proposalUri("org_456", `prop_${randomUUID()}`);
    const answer = await replaceWithDraft(w, nowhere);
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    await deniedNaming(w, answer, nowhere);
    expect(w.drafted).toStrictEqual([]);
  });

  it("step 41b's decision D5: C3: user_123 may not replace the agent's proposal: AUTHORIZATION_DENIED, and it still waits", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await replaceWithDraft(w, old, SUPERVISOR);
    const id = old.split("/").at(-1);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `user_123 may not replace proposal ${id}: user_123 did not ask for it`,
    });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
    await deniedNaming(w, answer, old);
  });

  it("step 41b's decision D5: C3: the agent may not replace user_123's own proposal, though it acts under her slip", async () => {
    const w = ruleWorld();
    const old = proposalOf(await w.draft("INV-1008", SUPERVISOR));
    const answer = await replaceWithDraft(w, old);
    const id = old.split("/").at(-1);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `accounts-payable-fte may not replace proposal ${id}: it was not asked for under accounts-payable-fte's own slip`,
    });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
  });

  it("step 41b's decision D10: C3: another agent may not replace the agent's proposal", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await replaceWithDraft(w, old, FIRM_IN_456);
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
  });

  it("step 41b's decision D10: C3: the same agent may not replace work it asked for under another slip", async () => {
    const w = ruleWorld();
    const old = await planted(w, "PENDING_APPROVAL", { delegation: "del_099" });
    const answer = await replaceWithDraft(w, old);
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
  });

  it("step 41b's decision D10: C3: a line of a run is replaced only with its run: CONFLICT, and the run and the line still wait", async () => {
    const w = ruleWorld();
    const run = proposalOf(
      await w.ask(keyed(AGENT), "payment.run", {
        lines: [draftOf("INV-1009"), draftOf("INV-1008"), draftOf("INV-1006")],
      }),
    );
    const line = (await w.proposals.all()).find((p) => p.run === run && p.state === "PENDING_APPROVAL")!;
    const answer = await replaceWithDraft(w, line.uri);
    const id = line.uri.split("/").at(-1);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${id} is a line of run ${run.split("/").at(-1)}, and is replaced only with its run`,
    });
    expect((await proposalAt(w, line.uri))!.state).toBe("PENDING_APPROVAL");
    expect((await proposalAt(w, run))!.state).toBe("PENDING_APPROVAL");
  });

  it("step 41b's design: C3: a proposal of DSoR's own work is not replaced: CONFLICT", async () => {
    const w = ruleWorld();
    const old = await planted(w, "READY", { operation: "control.suspend@1" });
    const answer = await replaceWithDraft(w, old);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${old.split("/").at(-1)} is DSoR's own work, which is not replaced`,
    });
    expect((await proposalAt(w, old))!.state).toBe("READY");
  });

  it.each([
    "DENIED",
    "REJECTED",
    "REVOKED",
    "EXPIRED",
    "CANCELLED",
    "INVALIDATED",
    "EXECUTING",
    "COMMITTED",
    "FAILED",
    "OUTCOME_UNKNOWN",
  ])(
    "step 41b's decision D3: C3: a proposal that is %s is not replaced: CONFLICT, and it stays as it was",
    async (state) => {
      const w = ruleWorld();
      const old = await planted(w, state);
      const answer = await replaceWithDraft(w, old);
      expect(answer).toMatchObject({
        code: "CONFLICT",
        message: `proposal ${old.split("/").at(-1)} is ${state}, and only a READY, PENDING_APPROVAL, or APPROVED proposal is replaced`,
      });
      expect((await proposalAt(w, old))!.state).toBe(state);
      await deniedNaming(w, answer, old);
    },
  );
});
