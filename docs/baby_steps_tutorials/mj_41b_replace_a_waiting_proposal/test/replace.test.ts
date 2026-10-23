// NEW IN STEP 41b: a new proposal replaces a waiting one. The new command names the old one in
//   `supersedes`, in its request envelope; in one transaction the old one and its lines move to
//   CANCELLED with their booking, and the new one is checked from the start, or nothing changes
//   (DSOR-APR-12; step 41b's README, claims C1 to C10).
import { describe, expect, it } from "vitest";
import { payloadHash } from "../src/canonical.ts";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed } from "./helpers.ts";
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
