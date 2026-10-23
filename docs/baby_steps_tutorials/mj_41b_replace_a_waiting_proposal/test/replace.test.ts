// NEW IN STEP 41b: a new proposal replaces a waiting one. The new command names the old one in
//   `supersedes`, in its request envelope; in one transaction the old one and its lines move to
//   CANCELLED with their booking, and the new one is checked from the start, or nothing changes
//   (DSOR-APR-12; step 41b's README, claims C1 to C10).
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { payloadHash } from "../src/canonical.ts";
import type { Answer } from "../src/envelope.ts";
import type { Invoice } from "../src/invoice.ts";
import { money } from "../src/money.ts";
import { handlersFor } from "../src/operations.ts";
import { proposalUri, urisIn, type Requester, type State } from "../src/proposals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, FIRM_IN_456, keyed, shippedRoles, SUPERVISOR } from "./helpers.ts";
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
    // Found by step 41b's review, L2: an invoice's address whose id has a proposal's form.
    [
      "an invoice's address with a proposal's id",
      "dsor://org_456/invoice/prop_00000000-0000-4000-8000-000000000000",
    ],
  ])(
    "step 41b's decision D9: C1: a supersedes that is %s is refused at line ①, and no proposal is made",
    async (_what, sent) => {
      const w = ruleWorld();
      const answer = await w.ask(replacing(AGENT, sent), "payment.create", draftOf("INV-1002"));
      expect(answer).toMatchObject({
        code: "VALIDATION_FAILED",
        message:
          "supersedes must be the address of a proposal, such as dsor://org_456/proposal/prop_…",
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
    const answer = await w.ask({ ...AGENT, supersedes: old } as RequestEnvelope, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
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
    mover: {
      mode: "direct" as const,
      subject: "dsor",
      actor_chain: [],
      subject_authority: agentAsker().subject_authority,
    },
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
        ? [
            {
              control: "high-value-payment",
              control_version: 8,
              approval: { role: "CFO", quorum: 1 },
            },
          ]
        : undefined;
    expect(await w.proposals.move("org_456", id, from, to, by, requires as never)).toBe(true);
    from = to;
  }
  return proposalUri("org_456", id);
}

/** The agent's new draft of INV-1002, which names the proposal at `old` in supersedes. */
function replaceWithDraft(
  w: RuleWorld,
  old: string,
  who: RequestEnvelope = AGENT,
): Promise<Answer> {
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
    const line = (await w.proposals.all()).find(
      (p) => p.run === run && p.state === "PENDING_APPROVAL",
    )!;
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

/** A run's input: one line for each of these bills of org_456, each decided on version 1. */
function linesOf(...ids: string[]): { lines: { invoice: string; expected_version: number }[] } {
  return { lines: ids.map(draftOf) };
}

/** A bill of org_456, issued, version 1, added to the world's invoices. */
function bill(w: RuleWorld, id: string, vendor: string, value: string): void {
  const amount = money(value, "USD");
  const fields = { vendor_id: vendor, amount, open_amount: amount, status: "issued" };
  w.bills.push({ tenant_id: "org_456", id, ...fields, version: 1 } as Invoice);
}

/** The run's lines, each with its state and the cause of its last move, in the order of their ids. */
async function linesAt(w: RuleWorld, run: string) {
  const all = (await w.proposals.all()).filter((p) => p.run === run);
  return all.map((p) => ({ state: p.state, cause: p.transitions.at(-1)!.cause }));
}

/** The booking of one proposal, by its address. */
async function bookingOf(w: RuleWorld, uri: string) {
  return (await w.reservations.all()).find((r) => r.proposal === uri.split("/").at(-1));
}

// The story's run that waits for cfo_100: INV-1002 8,900.50, INV-1008 31,400.00, and INV-1006
//   640.00 USD, 40,940.50 in all.
const RUN_A = linesOf("INV-1002", "INV-1008", "INV-1006");
// Run A without INV-1006, which turned out to be wrong: 40,300.50 USD.
const RUN_A2 = linesOf("INV-1002", "INV-1008");

/** The agent's run A, waiting for cfo_100: its address. */
async function waitingRun(w: RuleWorld, input = RUN_A): Promise<string> {
  const answer = await w.ask(keyed(AGENT), "payment.run", input);
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  return proposalOf(answer);
}

describe("C4: the replacement, in one transaction", () => {
  it("DSOR-APR-12: C4: a waiting run replaced by a new run: the old run and every line CANCELLED, each move naming the new run, and the new run waits", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const answer = await w.ask(replacing(AGENT, old), "payment.run", RUN_A2);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    const made = proposalOf(answer);
    const kept = (await proposalAt(w, old))!;
    expect(kept.state).toBe("CANCELLED");
    expect(kept.transitions.at(-1)).toMatchObject({
      from: "PENDING_APPROVAL",
      to: "CANCELLED",
      actor: "accounts-payable-fte",
      cause: `replaced by proposal ${made}`,
    });
    expect(await linesAt(w, old)).toStrictEqual(
      Array(3).fill({ state: "CANCELLED", cause: `its run was replaced by proposal ${made}` }),
    );
    expect((await proposalAt(w, made))!.supersedes).toBe(old);
    expect((await linesAt(w, made)).map((l) => l.state).sort()).toStrictEqual([
      "PENDING_APPROVAL",
      "READY",
    ]);
  });

  it("step 41b's decision D7: C4: the old run's booking is given back, and the new run's total is booked", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const made = proposalOf(await w.ask(replacing(AGENT, old), "payment.run", RUN_A2));
    expect(await bookingOf(w, old)).toMatchObject({ state: "released" });
    expect(await bookingOf(w, made)).toMatchObject({
      state: "held",
      amount: { value: "40300.50", currency: "USD" },
    });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("40300.50");
  });

  it("step 41b's decision D2: C4: a waiting draft replaced by a draft of the same bill: the old one CANCELLED, the new one waits, and one booking is held", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1008"));
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("31400.00");
  });

  it("step 41b's decision D2: C4: a waiting draft replaced by a run that holds its bill", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await w.ask(replacing(AGENT, old), "payment.run", RUN_A2);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("40300.50");
  });

  it("step 41b's decision D2: C4: a waiting run replaced by one draft that needs no one: the draft is made at once, and the run and its lines are CANCELLED", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const answer = await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1002"));
    expect(answer).toMatchObject({ outcome: "COMMITTED" });
    expect(w.drafted.map((p) => p.invoice_id)).toStrictEqual(["INV-1002"]);
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
    expect((await linesAt(w, old)).map((l) => l.state)).toStrictEqual(Array(3).fill("CANCELLED"));
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("8900.50");
  });

  it("step 41b's decision D3: C4: an APPROVED run is replaced too: its approval is cancelled with it, and the new run waits for cfo_100 again", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const run = (await proposalAt(w, old))!;
    const shown = {
      proposal: old,
      payload_hash: run.payload_hash,
      manifest_hash: run.manifest_hash,
      totals: run.totals,
      vendor_totals: run.vendor_totals,
    };
    expect(await w.ask(keyed(CFO), "proposal.approve", shown)).toMatchObject({
      data: { state: "APPROVED" },
    });
    const answer = await w.ask(replacing(AGENT, old), "payment.run", RUN_A2);
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
    expect((await linesAt(w, old)).map((l) => l.state)).toStrictEqual(Array(3).fill("CANCELLED"));
    expect((await proposalAt(w, proposalOf(answer)))!.approvals).toBeUndefined();
  });

  it("step 41b's decision D3: C4: a READY proposal, made in propose_only mode, is replaced by another that waits READY", async () => {
    const w = ruleWorld();
    const first = await w.ask(
      { ...keyed(AGENT), mode: "propose_only" } as RequestEnvelope,
      "payment.create",
      draftOf("INV-1002"),
    );
    expect(first).toMatchObject({ outcome: "READY" });
    const old = proposalOf(first);
    const answer = await w.ask(
      { ...replacing(AGENT, old), mode: "propose_only" } as RequestEnvelope,
      "payment.create",
      draftOf("INV-1009"),
    );
    expect(answer).toMatchObject({ outcome: "READY" });
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
    expect(await bookingOf(w, old)).toMatchObject({ state: "released" });
  });
});

describe("C5: a refused replacement changes nothing of the old proposal", () => {
  it("step 41b's decision D6: C5: a new run with a suspended vendor is refused: the old run still waits with its lines and its booking, the new run and its lines end DENIED, and the refusal is recorded", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const before = await linesAt(w, old);
    w.vendors.find((v) => v.id === "VENDOR-31")!.status = "suspended";
    const answer = await w.ask(
      replacing(AGENT, old),
      "payment.run",
      linesOf("INV-1002", "INV-1006"),
    );
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/^line 2 of "payment\.run": /),
    });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
    expect(await linesAt(w, old)).toStrictEqual(before);
    expect(await bookingOf(w, old)).toMatchObject({ state: "held" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("40940.50");
    const made = proposalOf(answer);
    expect((await proposalAt(w, made))!).toMatchObject({ state: "DENIED", supersedes: old });
    expect((await linesAt(w, made)).map((l) => l.state)).toStrictEqual(["DENIED", "DENIED"]);
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "payment.run@1",
      authorization: "DENY",
      result: "CONFLICT",
      extensions: { "org.panaversity.steps": { proposal: made } },
    });
  });

  it("step 41b's decision D7: C5: a new run over the day's limit, once the old booking is given back, is refused: the old booking is held again", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    for (const id of ["INV-3201", "INV-3202", "INV-3203"]) {
      bill(w, id, "VENDOR-12", "42500.00");
      expect(await w.draft(id)).toMatchObject({ outcome: "PENDING_APPROVAL" });
    }
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("168440.50");
    bill(w, "INV-3204", "VENDOR-12", "45000.00");
    const answer = await w.ask(
      replacing(AGENT, old),
      "payment.run",
      linesOf("INV-1008", "INV-3204"),
    );
    expect(answer).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
    expect(await bookingOf(w, old)).toMatchObject({ state: "held" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("168440.50");
  });

  it("step 41b's decision D6: C5: a refused new draft leaves the old draft waiting, and a later draft of its bill alone still hears CONFLICT", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    w.vendors.find((v) => v.id === "VENDOR-44")!.status = "suspended";
    const answer = await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1002"));
    expect(answer).toMatchObject({ code: "CONFLICT" });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
    w.vendors.find((v) => v.id === "VENDOR-44")!.status = "approved";
    expect(await w.draft("INV-1008", SUPERVISOR)).toMatchObject({ code: "CONFLICT" });
  });
});

describe("C5: an accident keeps nothing of a replacement", () => {
  // Memory has no transaction, so its claim undoes what an accident left, as the database's
  //   rollback does: the old run's moves, and its booking, given back a moment before.
  it("step 41b's decision D6: C5: an accident in the new draft's work leaves the old run waiting, with its lines and its booking", async () => {
    const broken = {
      ...handlersFor(),
      "payment.create": async (): Promise<never> => {
        throw new Error("a bug in the company's code");
      },
    };
    const u = undefined;
    const w = ruleWorld(u, u, u, u, u, u, u, u, u, broken);
    const old = await waitingRun(w);
    const before = await linesAt(w, old);
    const answer = await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1009"));
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
    expect(await linesAt(w, old)).toStrictEqual(before);
    expect(await bookingOf(w, old)).toMatchObject({ state: "held" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("40940.50");
    expect((await w.proposals.all()).filter((p) => p.supersedes !== undefined)).toStrictEqual([]);
  });
});

describe("C6: the booking given back, used once", () => {
  it("step 41b's decision D7: C6: a run of 150,000 waits; its replacement of 135,000 fits only because the old booking is given back first", async () => {
    const w = ruleWorld();
    for (const id of ["INV-3301", "INV-3302", "INV-3303"]) bill(w, id, "VENDOR-12", "45000.00");
    bill(w, "INV-3304", "VENDOR-12", "15000.00");
    const old = await waitingRun(w, linesOf("INV-3301", "INV-3302", "INV-3303", "INV-3304"));
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("150000.00");
    const answer = await w.ask(
      replacing(AGENT, old),
      "payment.run",
      linesOf("INV-3301", "INV-3302", "INV-3303"),
    );
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("135000.00");
  });

  it("step 41b's decision D7: C6: two replacements of one run at once: one wins, the other hears CONFLICT, and the day holds one booking", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    // Changed by step 41b's review, M3: the two new runs share no bill, so only the lock keeps
    //   them apart, and the loser's words say it found the run CANCELLED, not that it moved.
    const both = await Promise.all([
      w.ask(replacing(AGENT, old), "payment.run", linesOf("INV-1002")),
      w.ask(replacing(AGENT, old), "payment.run", linesOf("INV-1006")),
    ]);
    const said = both.map(saidOf).sort();
    expect(said).toStrictEqual(["COMMITTED", "CONFLICT"]);
    const lost = both.find((a) => "code" in a)!;
    expect(lost).toMatchObject({
      message: `proposal ${old.split("/").at(-1)} is CANCELLED, and only a READY, PENDING_APPROVAL, or APPROVED proposal is replaced`,
    });
    const counted = (await w.reservations.all()).filter((r) => r.state !== "released");
    expect(counted).toHaveLength(1);
  });
});

/** What cfo_100's screen shows of a waiting run, from DSoR's own store. */
async function shownOf(w: RuleWorld, uri: string) {
  const run = (await proposalAt(w, uri))!;
  return {
    proposal: uri,
    payload_hash: run.payload_hash,
    manifest_hash: run.manifest_hash,
    totals: run.totals,
    vendor_totals: run.vendor_totals,
  };
}

describe("C7: the refusal tells", () => {
  it("step 41b's decision D8: C7: cfo_100 approves a replaced run with its fingerprint and its totals: CONFLICT, naming the new run, and the old run stays CANCELLED", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const shown = await shownOf(w, old);
    const made = proposalOf(await w.ask(replacing(AGENT, old), "payment.run", RUN_A2));
    const answer = await w.ask(keyed(CFO), "proposal.approve", shown);
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${old.split("/").at(-1)} was replaced by proposal ${made}, so it is not approved`,
    });
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
    expect((await proposalAt(w, old))!.approvals).toBeUndefined();
  });

  it("step 41b's decision D8: C7: the agent releases a replaced APPROVED draft: CONFLICT, naming the new one, and nothing is drafted", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const kept = (await proposalAt(w, old))!;
    const approval = { proposal: old, payload_hash: kept.payload_hash };
    expect(await w.ask(keyed(CFO), "proposal.approve", approval)).toMatchObject({
      data: { state: "APPROVED" },
    });
    const made = proposalOf(
      await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1008")),
    );
    const answer = await w.ask(keyed(AGENT), "proposal.execute", { proposal: old });
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${old.split("/").at(-1)} was replaced by proposal ${made}, so it is not released`,
    });
    expect(w.drafted).toStrictEqual([]);
  });

  it("step 41b's decision D8: C7: a proposal cancelled by a tear-up names no replacement, and a refused replacement names none either", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    w.vendors.find((v) => v.id === "VENDOR-44")!.status = "suspended";
    expect(await replaceWithDraft(w, old)).toMatchObject({ code: "CONFLICT" });
    w.vendors.find((v) => v.id === "VENDOR-44")!.status = "approved";
    const tearUp = {
      slip: "dsor://org_456/delegation/del_100",
      reason: "VENDOR-44's bank changed",
    };
    expect(await w.ask(keyed(SUPERVISOR), "delegation.revoke", tearUp)).toMatchObject({
      outcome: "COMMITTED",
    });
    const kept = (await proposalAt(w, old))!;
    const answer = await w.ask(keyed(CFO), "proposal.approve", {
      proposal: old,
      payload_hash: kept.payload_hash,
    });
    expect(answer).toMatchObject({
      code: "CONFLICT",
      message: `proposal ${old.split("/").at(-1)} is CANCELLED, and only a PENDING_APPROVAL proposal is approved`,
    });
  });

  it("step 41b's decision D8: C7: a replacement writes no event: the outbox holds none for the old proposal", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    await w.ask(replacing(AGENT, old), "payment.create", draftOf("INV-1008"));
    expect(await w.outbox.events("org_456")).toStrictEqual([]);
  });
});

/** This caller's dry run, with no key, that replaces the proposal at `uri`. */
function dryReplacing(who: RequestEnvelope, uri: string): RequestEnvelope {
  return { ...who, mode: "validate_only", supersedes: uri } as RequestEnvelope;
}

describe("C9: a dry run of a replacement answers as the real call would", () => {
  it("DSOR-OPR-05: C9: a dry run of a replacement the real call allows says so, as if the old run were cancelled, and changes nothing", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    const before = await w.proposals.all();
    const bookings = await w.reservations.all();
    const answer = await w.ask(dryReplacing(AGENT, old), "payment.run", RUN_A2);
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "REQUIRE_APPROVAL" });
    expect(await w.proposals.all()).toStrictEqual(before);
    expect(await w.reservations.all()).toStrictEqual(bookings);
    // Without supersedes, the same dry run hears the old run's hold on its bills.
    const plain = await w.ask(
      { ...AGENT, mode: "validate_only" } as RequestEnvelope,
      "payment.run",
      RUN_A2,
    );
    expect(plain).toMatchObject({ code: "CONFLICT" });
  });

  it("DSOR-OPR-05: C9: a dry run of one draft that replaces a waiting draft of its bill says so", async () => {
    const w = ruleWorld();
    const old = await waitingDraft(w);
    const answer = await w.ask(dryReplacing(AGENT, old), "payment.create", draftOf("INV-1008"));
    expect(answer).toMatchObject({ outcome: "VALIDATED", decision: "REQUIRE_APPROVAL" });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
  });

  it("step 41b's decision D7: C9: the dry run counts the old booking as given back: 135,000 of other bills fits where 150,000 waits", async () => {
    const w = ruleWorld();
    for (const id of ["INV-3301", "INV-3302", "INV-3303"]) bill(w, id, "VENDOR-12", "45000.00");
    bill(w, "INV-3304", "VENDOR-12", "15000.00");
    const old = await waitingRun(w, linesOf("INV-3301", "INV-3302", "INV-3303", "INV-3304"));
    for (const id of ["INV-3311", "INV-3312", "INV-3313"]) bill(w, id, "VENDOR-12", "45000.00");
    const others = linesOf("INV-3311", "INV-3312", "INV-3313");
    const answer = await w.ask(dryReplacing(AGENT, old), "payment.run", others);
    expect(answer).toMatchObject({ outcome: "VALIDATED" });
    const plain = await w.ask(
      { ...AGENT, mode: "validate_only" } as RequestEnvelope,
      "payment.run",
      others,
    );
    expect(plain).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await w.reservations.used("org_456", "del_100", "USD")).toBe("150000.00");
  });

  it.each([
    ["user_123, for the agent's run", SUPERVISOR, "PENDING_APPROVAL", "AUTHORIZATION_DENIED"],
    ["the agent, for an EXECUTING draft", AGENT, "EXECUTING", "CONFLICT"],
  ])(
    "DSOR-OPR-05: C9: a dry run of a replacement the real call refuses is refused with the same code: %s",
    async (_who, who, state, code) => {
      const w = ruleWorld();
      const old = await planted(w, state);
      const answer = await w.ask(dryReplacing(who, old), "payment.create", draftOf("INV-1002"));
      expect(answer).toMatchObject({ code });
      expect((await proposalAt(w, old))!.state).toBe(state);
    },
  );
});

// Found by step 41b's review, M5: the person's side of D5 had no test either way.
describe("step 41b's review, M5: a person replaces her own direct request only", () => {
  it("step 41b's decision D5: M5: user_123 replaces her own direct draft", async () => {
    const w = ruleWorld();
    const old = proposalOf(await w.draft("INV-1008", SUPERVISOR));
    const answer = await w.ask(replacing(SUPERVISOR, old), "payment.create", draftOf("INV-1008"));
    expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect((await proposalAt(w, old))!.state).toBe("CANCELLED");
  });

  it("step 41b's decision D5: M5: another person who may draft cannot replace user_123's direct draft", async () => {
    const roles = JSON.parse(shippedRoles.text) as Record<string, string[]>;
    const table = {
      ...shippedRoles,
      text: JSON.stringify({ ...roles, CFO: [...roles["CFO"]!, "payment:create"] }),
    };
    const u = undefined;
    const w = ruleWorld(u, u, u, u, u, table);
    const old = proposalOf(await w.draft("INV-1008", SUPERVISOR));
    const answer = await w.ask(replacing(CFO, old), "payment.create", draftOf("INV-1002"));
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `cfo_100 may not replace proposal ${old.split("/").at(-1)}: cfo_100 did not ask for it`,
    });
    expect((await proposalAt(w, old))!.state).toBe("PENDING_APPROVAL");
  });
});

// Found by step 41b's review, L3: the database's test of the tear-up's order passed the old order
//   one time in 18. Here a run's id comes after its lines' ids, always.
describe("step 41b's review, L3: a tear-up cancels a run before its lines", () => {
  it("step 41b's decision D11: L3: the run's move to CANCELLED is recorded before each line's, though its id comes after theirs", async () => {
    const w = ruleWorld();
    const run = "prop_ffffffff-ffff-4fff-bfff-ffffffffffff";
    const lines = [
      "prop_00000000-0000-4000-8000-000000000001",
      "prop_00000000-0000-4000-8000-000000000002",
    ];
    const by = {
      mover: {
        mode: "direct" as const,
        subject: "dsor",
        actor_chain: [],
        subject_authority: agentAsker().subject_authority,
      },
      cause: "planted by the test",
      correlation: { request_id: `req_${randomUUID()}` },
    };
    const base = {
      operation: "payment.create@1",
      mode: "execute" as const,
      requester: agentAsker(),
    };
    const runPayload = linesOf("INV-1002", "INV-1006");
    await w.proposals.create(
      "org_456",
      run,
      {
        ...base,
        operation: "payment.run@1",
        payload: runPayload,
        payload_hash: payloadHash(runPayload),
        resources: urisIn(runPayload),
        idempotency_key: "k-planted-run",
        manifest_hash: payloadHash(runPayload.lines),
      },
      by,
      "P7D",
    );
    for (const [index, id] of lines.entries()) {
      const line = runPayload.lines[index]!;
      await w.proposals.create(
        "org_456",
        id,
        {
          ...base,
          payload: line,
          payload_hash: payloadHash(line),
          resources: urisIn(line),
          idempotency_key: `k-planted-line-${index}`,
          run: proposalUri("org_456", run),
        },
        by,
        "P7D",
      );
      expect(await w.proposals.move("org_456", id, "PROPOSED", "READY", by)).toBe(true);
    }
    const totals = { totals: [], vendor_totals: [] };
    expect(await w.proposals.move("org_456", run, "PROPOSED", "READY", by, undefined, totals)).toBe(
      true,
    );
    const tearUp = {
      slip: "dsor://org_456/delegation/del_100",
      reason: "the agent's run is wrong",
    };
    expect(await w.ask(keyed(SUPERVISOR), "delegation.revoke", tearUp)).toMatchObject({
      outcome: "COMMITTED",
    });
    const cancelled = (await w.proposals.transitions())
      .filter((t) => t.result === "CANCELLED")
      .map((t) => t.resources[0]!.split("/").at(-1));
    expect(cancelled).toStrictEqual([run, ...lines]);
  });
});

// Found by step 41b's review, L5: a few branches had no test.
describe("step 41b's review, L5: the smaller gaps", () => {
  it("step 41b's decision D6: L5: a refused replacement run's lines each name the line that refused", async () => {
    const w = ruleWorld();
    const old = await waitingRun(w);
    w.vendors.find((v) => v.id === "VENDOR-31")!.status = "suspended";
    const answer = await w.ask(
      replacing(AGENT, old),
      "payment.run",
      linesOf("INV-1002", "INV-1006"),
    );
    expect((await linesAt(w, proposalOf(answer))).map((l) => l.cause)).toStrictEqual(
      Array(2).fill("line 2 of its run was refused: CONFLICT"),
    );
  });

  it("DSOR-OPR-05: L5: a dry run that would replace DSoR's own work is refused, as the real call is", async () => {
    const w = ruleWorld();
    const old = await planted(w, "READY", { operation: "control.suspend@1" });
    const answer = await w.ask(dryReplacing(AGENT, old), "payment.create", draftOf("INV-1002"));
    expect(answer).toMatchObject({ code: "CONFLICT" });
  });
});
