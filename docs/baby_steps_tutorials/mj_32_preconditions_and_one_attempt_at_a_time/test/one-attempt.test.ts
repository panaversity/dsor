// One attempt at a time: while a proposal of payment.create over an invoice is in flight, a
// second one over the same invoice is refused with CONFLICT, naming the first (DSOR-EXC-01; step
// 32's README, claim C2, decisions D6 to D8). The company's CFO rule makes INV-1008, 31,400.00 USD,
// wait for the CFO.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { handlersFor } from "../src/operations.ts";
import { dsorMover, type Proposal, type State } from "../src/proposals.ts";
import {
  AGENT,
  CFO,
  contract,
  keyed,
  shippedRoles,
  shippedWith,
  SUPERVISOR,
  withoutControls,
} from "./helpers.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** What a second attempt hears while the first, at this address, is in this state. */
function inFlight(uri: string, state: State): string {
  return `invoice INV-1008 has an attempt in flight already: proposal ${uri}, ${state}`;
}

/** A move of one proposal by DSoR, as a test makes it, along the picture. */
function moveBy(proposal: Proposal) {
  const correlation = { request_id: "req_test" } as never;
  return { mover: dsorMover(proposal.requester), cause: "the test moves it", correlation };
}

/** The agent drafts INV-1008, and it waits for the CFO. */
async function waiting(w: RuleWorld) {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const kept = (await w.proposals.get("org_456", idOf(answer)))!;
  return { ...kept, id: idOf(answer) };
}

describe("C2: a second attempt over an invoice in flight is refused, naming the first (step 32's README, decisions D6 and D8)", () => {
  it("DSOR-EXC-01: while INV-1008 waits for the CFO, the agent's second draft, with a new key, hears CONFLICT naming the first, and its proposal ends DENIED", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await waiting(w);
    const second = await w.draft("INV-1008");
    expect(second).toMatchObject({
      code: "CONFLICT",
      message: inFlight(first.uri, "PENDING_APPROVAL"),
      retry: "never",
    });
    expect((await w.proposals.get("org_456", idOf(second)))?.state).toBe("DENIED");
    const record = (await w.log.records()).filter((r) => r.kind === "decision").at(-1);
    expect(record).toMatchObject({
      authorization: "DENY",
      result: "CONFLICT",
      reason: inFlight(first.uri, "PENDING_APPROVAL"),
    });
    // The second attempt books nothing, and the first still waits, with its booking.
    expect(await w.reservations.get("org_456", idOf(second))).toBeUndefined();
    expect((await w.proposals.get("org_456", first.id))?.state).toBe("PENDING_APPROVAL");
  });

  it("DSOR-EXC-01: user_123, a person, is refused the same way: one attempt at a time is about the invoice, not about who asks", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await waiting(w);
    expect(await w.draft("INV-1008", SUPERVISOR)).toMatchObject({
      code: "CONFLICT",
      message: inFlight(first.uri, "PENDING_APPROVAL"),
    });
  });

  it("DSOR-EXC-01: a prepared draft, READY, is in flight too: the agent's draft in execute mode is refused", async () => {
    const w = await ruleWorldOnTuesday();
    const prepared = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });
    expect(prepared).toMatchObject({ outcome: "READY" });
    const uri = String("proposal" in prepared ? prepared.proposal : "");
    expect(await w.draft("INV-1009")).toMatchObject({
      code: "CONFLICT",
      message: `invoice INV-1009 has an attempt in flight already: proposal ${uri}, READY`,
    });
  });

  it.each([
    ["APPROVED", ["APPROVED"]],
    ["EXECUTING", ["APPROVED", "EXECUTING"]],
    ["OUTCOME_UNKNOWN", ["APPROVED", "EXECUTING", "OUTCOME_UNKNOWN"]],
  ] as const)(
    "DSOR-EXC-01: a first attempt that is %s is in flight: the second is refused, naming it",
    async (state, path) => {
      const w = await ruleWorldOnTuesday();
      const first = await waiting(w);
      let from: State = "PENDING_APPROVAL";
      for (const to of path) {
        expect(await w.proposals.move("org_456", first.id, from, to, moveBy(first))).toBe(true);
        from = to;
      }
      expect(await w.draft("INV-1008")).toMatchObject({
        code: "CONFLICT",
        message: inFlight(first.uri, state),
      });
    },
  );

  it.each([["REJECTED"], ["EXPIRED"], ["CANCELLED"]] as const)(
    "DSOR-EXC-01: a first attempt that ended %s frees the invoice: the next draft waits for the CFO",
    async (end) => {
      const w = await ruleWorldOnTuesday();
      const first = await waiting(w);
      expect(
        await w.proposals.move("org_456", first.id, "PENDING_APPROVAL", end, moveBy(first)),
      ).toBe(true);
      expect(await w.draft("INV-1008")).toMatchObject({ outcome: "PENDING_APPROVAL" });
    },
  );

  it("DSOR-EXC-01: another invoice is not held: while INV-1008 waits, INV-1012 is drafted", async () => {
    const w = await ruleWorldOnTuesday();
    await waiting(w);
    expect(await w.draft("INV-1012")).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-OPR-06: a dry run of the second attempt hears the same CONFLICT, and keeps nothing", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await waiting(w);
    const before = (await w.proposals.all()).length;
    const dry = await w.ask({ ...AGENT, mode: "validate_only" }, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
      expected_version: 1,
    });
    expect(dry).toMatchObject({
      code: "CONFLICT",
      message: inFlight(first.uri, "PENDING_APPROVAL"),
    });
    expect((await w.proposals.all()).length).toBe(before);
  });

  it("DSOR-IDM-01c: the refused attempt's key gives its CONFLICT back, even after the first attempt ended", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await waiting(w);
    const envelope = keyed(AGENT);
    const input = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    const refused = await w.ask(envelope, "payment.create", input);
    await w.proposals.move("org_456", first.id, "PENDING_APPROVAL", "CANCELLED", moveBy(first));
    const replay = await w.ask(envelope, "payment.create", input);
    expect(replay).toMatchObject({
      code: "CONFLICT",
      message: (refused as { message: string }).message,
    });
  });

  it("DSOR-EXC-01: the release of the first attempt is not refused by its own flight: cfo_100 approves, and the agent's release drafts it", async () => {
    const w = await ruleWorldOnTuesday();
    const first = await waiting(w);
    await w.ask(keyed(CFO), "proposal.approve", {
      proposal: first.uri,
      payload_hash: first.payload_hash,
    });
    expect(await w.ask(keyed(AGENT), "proposal.execute", { proposal: first.uri })).toMatchObject({
      outcome: "COMMITTED",
    });
  });
});

describe("C2: start-up checks what is exclusive (step 32's README, decision D6)", () => {
  it("Step 32: payment.create is exclusive over its invoice", () => {
    expect(contract("payment.create")["in_flight"]).toStrictEqual({ exclusive_over: ["invoice"] });
  });

  it.each([
    ["two aliases", ["invoice", "vendor"]],
    ["an alias the bind does not name", ["bill"]],
    ["an alias bound through a link, not from the input", ["vendor"]],
  ])("Step 32: start-up refuses an exclusive_over of %s", (_what, exclusive_over) => {
    const changed = { ...contract("payment.create"), in_flight: { exclusive_over } };
    expect(() => withoutControls(shippedWith(changed), handlersFor(), shippedRoles)).toThrow(
      "payment.create: in_flight.exclusive_over",
    );
  });
});
