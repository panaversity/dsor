// proposal.execute, the release of a waiting proposal: who may release, and what (step 31's
// README, claims C1 and C2, decisions D2, D7, D9, D12, and D13). The agent drafts INV-1008,
// 31,400.00 USD, which waits for the CFO, and cfo_100 approves it, as in step 29.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  CFO,
  contract,
  DEL_100,
  FIRM_IN_456,
  FOREIGN_URI,
  keyed,
  shipped,
  shippedWith,
  SUPERVISOR,
} from "./helpers.ts";
import { ruleWorldOnTuesday, refusalAtStart, startWith, type RuleWorld } from "./rule-world.ts";
import { readControls } from "../src/controls.ts";

const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The agent drafts INV-1008, and it waits for the CFO. */
async function waiting(w: RuleWorld) {
  const answer = await w.draft("INV-1008");
  expect(answer).toMatchObject({ outcome: "PENDING_APPROVAL" });
  const id = idOf(answer);
  const kept = (await w.proposals.get("org_456", id))!;
  return { id, uri: kept.uri, payload_hash: kept.payload_hash };
}

/** The agent drafts INV-1008, and cfo_100 approves it: it waits APPROVED for its release. */
async function approved(w: RuleWorld) {
  const found = await waiting(w);
  const approval = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: found.uri,
    payload_hash: found.payload_hash,
  });
  expect(approval).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return found;
}

/** One release, with a fresh key, and whatever else the caller sends. */
function release(w: RuleWorld, who: RequestEnvelope, uri: string, more: object = {}) {
  return w.ask(keyed(who), "proposal.execute", { proposal: uri, ...more });
}

/** The proposal's state, as DSoR keeps it. */
async function stateOf(w: RuleWorld, id: string) {
  return (await w.proposals.get("org_456", id))?.state;
}

describe("C1: the release takes the proposal's address and nothing else (step 31's README, decision D9)", () => {
  it.each([
    ["another invoice", { invoice: "dsor://org_456/invoice/INV-1002" }],
    ["a new amount", { amount: { value: "900.00", currency: "USD" } }],
    ["a whole request", { payload: { invoice: "dsor://org_456/invoice/INV-1002" } }],
    ["a version", { expected_version: 2 }],
  ])(
    "DSOR-APR-13: a release that sends %s beside the proposal is refused at line ⑥, VALIDATION_FAILED, and INV-1008 still waits APPROVED",
    async (_what, more) => {
      const w = await ruleWorldOnTuesday();
      const { id, uri } = await approved(w);
      expect(await release(w, AGENT, uri, more)).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(await stateOf(w, id)).toBe("APPROVED");
    },
  );
});

describe("C2: what may be released (step 31's README, decision D7)", () => {
  it("Step 31: a proposal that still waits for its approval hears APPROVAL_REQUIRED, and still waits", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await waiting(w);
    expect(await release(w, AGENT, uri)).toMatchObject({
      code: "APPROVAL_REQUIRED",
      message: `proposal ${id} still waits for an approval`,
    });
    expect(await stateOf(w, id)).toBe("PENDING_APPROVAL");
  });

  it("Step 31: a proposal that ended hears CONFLICT: INV-1012's payment, COMMITTED at once, and a draft over the slip's limit, DENIED", async () => {
    const w = await ruleWorldOnTuesday();
    const committed = await w.draft("INV-1012");
    expect(committed).toMatchObject({ outcome: "COMMITTED" });
    const denied = await w.draft("INV-2003");
    expect(denied).toMatchObject({ code: "LIMIT_EXCEEDED" });
    for (const [answer, state] of [
      [committed, "COMMITTED"],
      [denied, "DENIED"],
    ] as const) {
      const uri = String("proposal" in answer ? answer.proposal : "");
      expect(await release(w, AGENT, uri)).toMatchObject({
        code: "CONFLICT",
        message: `proposal ${idOf(answer)} is ${state}, and only an APPROVED or a READY proposal is released`,
      });
    }
  });

  it("Step 31: a proposal that is not there is RESOURCE_NOT_FOUND, and one of org_789's is refused at line ②", async () => {
    const w = await ruleWorldOnTuesday();
    const none = "dsor://org_456/proposal/prop_00000000-0000-4000-8000-000000000031";
    expect(await release(w, AGENT, none)).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const theirs = "dsor://org_789/proposal/prop_00000000-0000-4000-8000-000000000031";
    expect(await release(w, AGENT, theirs)).toMatchObject({
      code: "TENANT_MISMATCH",
      message: FOREIGN_URI,
    });
  });
});

describe("C2: who may release (step 31's README, decisions D2 and D12)", () => {
  it("DSOR-APR-11: firm-ap-fte, an agent under del_101, cannot release accounts-payable-fte's approved INV-1008, asked for under del_100", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    expect(await release(w, FIRM_IN_456, uri)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      // Changed by step 31's review, finding L1: the words named the slip that asked.
      message: `firm-ap-fte may not release proposal ${id}: it was not asked for under firm-ap-fte's own slip`,
    });
    expect(await stateOf(w, id)).toBe("APPROVED");
  });

  it("Step 31: an agent whose slip lists only payment:create.propose prepares INV-1009, and cannot release it: only a person may", async () => {
    const preparing = { ...DEL_100, permissions: ["invoice:read", "payment:create.propose"] };
    const w = await ruleWorldOnTuesday(undefined, [preparing]);
    const prepared = await w.ask({ ...keyed(AGENT), mode: "propose_only" }, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1009",
      expected_version: 1,
    });
    expect(prepared).toMatchObject({ outcome: "READY" });
    const id = idOf(prepared);
    const uri = String("proposal" in prepared ? prepared.proposal : "");
    expect(await release(w, AGENT, uri)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `accounts-payable-fte may not release proposal ${id}: its slip allows payment:create.propose only, and a release needs payment:create`,
    });
    expect(await stateOf(w, id)).toBe("READY");
  });

  it("Step 31: cfo_100, a person without payment:create, cannot release the approved INV-1008", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    expect(await release(w, CFO, uri)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `cfo_100 may not release proposal ${id}: it needs payment:create`,
    });
  });

  it("Step 31: dsor-scheduler, a system login, cannot release: only the agent that asked, or a person", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    expect(await release(w, SCHEDULER, uri)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: `dsor-scheduler may not release proposal ${id}: only the agent that asked, or a person, releases`,
    });
  });

  it("Step 31: line ⑤ checks no permission of its own: user_123, whose role does not list proposal:execute, reaches line ⑨, which says the proposal still waits", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await waiting(w);
    expect(await release(w, SUPERVISOR, uri)).toMatchObject({
      code: "APPROVAL_REQUIRED",
      message: `proposal ${id} still waits for an approval`,
    });
  });

  it("Step 31: start-up refuses the release's extension on any other command, and proposal.execute without it", async () => {
    const issue = contract("invoice.issue");
    const marked = {
      ...issue,
      extensions: { "org.panaversity.steps": { release: true } },
    };
    expect(await refusalAtStart(() => startWith(readControls(), shippedWith(marked)))).toContain(
      'invoice.issue: only proposal.execute is a release, so its "release" extension is refused',
    );
    const { extensions: _gone, ...bare } = contract("proposal.execute");
    expect(await refusalAtStart(() => startWith(readControls(), shippedWith(bare)))).toContain(
      'proposal.execute: a release, whose caller line ⑨ decides, must say so with the "release" extension',
    );
    expect(await refusalAtStart(() => startWith(readControls(), shipped))).toBe("");
  });
});

describe("C2: the release's modes (step 31's README, decision D13)", () => {
  it("Step 31: proposal.execute takes no propose_only mode: VALIDATION_FAILED, and INV-1008 still waits APPROVED", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const prepare = { ...keyed(AGENT), mode: "propose_only" as const };
    expect(await w.ask(prepare, "proposal.execute", { proposal: uri })).toMatchObject({
      code: "VALIDATION_FAILED",
      message: '"proposal.execute" releases now, so it takes no propose_only mode',
    });
    expect(await stateOf(w, id)).toBe("APPROVED");
  });

  it("Step 31: a dry run of a release that may not run hears what the real call hears, and nothing moves", async () => {
    const w = await ruleWorldOnTuesday();
    const { id, uri } = await approved(w);
    const dry = { ...CFO, mode: "validate_only" as const };
    const answer = await w.ask(dry, "proposal.execute", { proposal: uri });
    const real = await release(w, CFO, uri);
    expect("code" in answer && answer.message).toBe("code" in real && real.message);
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await stateOf(w, id)).toBe("APPROVED");
  });
});
