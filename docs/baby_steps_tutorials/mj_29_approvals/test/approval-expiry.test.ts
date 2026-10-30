// An approval expires with its proposal (step 29's README, claim C6, decision D11). An approval's
// expires_at is its proposal's own, which step 25c caps at 30 days, §44's longest life at L2. An
// APPROVED proposal waits for step 31's proposal.execute, and the sweep expires it at that time,
// and gives back its booking, as it expires a READY or a PENDING_APPROVAL one.
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { CFO, keyed } from "./helpers.ts";
import { ruleWorldOnTuesday, T0, type RuleWorld } from "./rule-world.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
// dsor-scheduler, the system login that may call DSoR's own sweep (step 25c's README, decision
// D11).
const SCHEDULER: RequestEnvelope = { token: "tok_5c4e", tenant: "org_456" };

/** The id of the proposal an answer names. */
function idOf(answer: Answer): string {
  return String("proposal" in answer ? answer.proposal : "")
    .split("/")
    .at(-1)!;
}

/** The agent drafts INV-1008, 31,400.00 USD, and cfo_100 approves it at once. */
async function approved(w: RuleWorld): Promise<string> {
  const id = idOf(await w.draft("INV-1008"));
  const kept = await w.proposals.get("org_456", id);
  const answer = await w.ask(keyed(CFO), "proposal.approve", {
    proposal: kept!.uri,
    payload_hash: kept!.payload_hash,
  });
  expect(answer).toMatchObject({ outcome: "COMMITTED", data: { state: "APPROVED" } });
  return id;
}

/** dsor-scheduler sweeps org_456. */
function sweep(w: RuleWorld): Promise<Answer> {
  return w.ask(keyed(SCHEDULER), "proposal.expire_due", {
    company: "dsor://org_456/tenant/org_456",
  });
}

describe("C6: an approval expires with its proposal (step 29's README, decision D11)", () => {
  it("DSOR-APR-04a: cfo_100's approval of INV-1008 expires when its proposal does, seven days after the draft, within §44's 30 days", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await approved(w);
    const [approval] = await w.proposals.approvals("org_456", id);
    const proposal = await w.proposals.get("org_456", id);
    expect(approval?.expires_at).toBe(proposal?.expires_at);
    expect(approval?.expires_at).toBe(new Date(T0 + 7 * DAY_MS).toISOString());
  });

  it("DSOR-DEL-06d: INV-1008's payment, APPROVED, waits past org_456's seven days for a release that never comes: dsor-scheduler's sweep moves it from APPROVED to EXPIRED, and its 31,400.00 USD goes back to the day", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await approved(w);
    expect((await w.reservations.get("org_456", id))?.state).toBe("held");
    w.clock.now = T0 + 7 * DAY_MS;
    expect(await sweep(w)).toMatchObject({
      outcome: "COMMITTED",
      data: { tenant_id: "org_456", expired: 1 },
    });
    const ended = await w.proposals.get("org_456", id);
    expect(ended?.state).toBe("EXPIRED");
    expect(ended?.transitions.at(-1)).toMatchObject({
      from: "APPROVED",
      to: "EXPIRED",
      actor: "dsor-scheduler",
      cause: "waited past its lifetime",
    });
    expect((await w.reservations.get("org_456", id))?.state).toBe("released");
  });

  it("Step 29: one millisecond before its expires_at, the sweep leaves the APPROVED payment approved, and its booking held", async () => {
    const w = await ruleWorldOnTuesday();
    const id = await approved(w);
    w.clock.now = T0 + 7 * DAY_MS - 1;
    expect(await sweep(w)).toMatchObject({ data: { expired: 0 } });
    expect((await w.proposals.get("org_456", id))?.state).toBe("APPROVED");
    expect((await w.reservations.get("org_456", id))?.state).toBe("held");
  });
});
