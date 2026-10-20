// NEW IN STEP 29: what the review of approvals found (decision 168).
//
// An approval kept with the proposal's move to APPROVED never made left it waiting for good; an
// approval could be kept for a proposal that had stopped waiting between §21.9's look and the
// handler's write; and four of §21.9's refusals were never asked by a test of their own.
//
// Rule DSOR-AUT-02c: When several `REQUIRE_*` outcomes apply, all of them MUST be satisfied.
// Rule DSOR-APR-05a: `proposal.approve` MUST be accepted only in `direct` identity mode, from an
// approver authenticated to DSoR under their own credentials.
// Rule DSOR-ERR-01b: An error MUST NOT reveal the existence or attributes of a resource the caller is
// not authorized to read.
// Rule DSOR-TEN-02b: A request naming a resource of another tenant MUST be refused with
// `TENANT_MISMATCH`.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalsOf, keepApproval } from "../src/approvals.ts";
import { type AuditRecord, theLog } from "../src/audit.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { switchOn } from "../src/policy-controls.ts";
import { moveProposal, stateOf } from "../src/proposal.ts";
import { aDatabase, asTheOwner, BY_A_TEST, resetTheStory } from "./support/database.ts";

const CFO = { loggedInAs: "cfo_100", tenant: "org_456" };
const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
});

/** user_123's 31,400.00 USD payment, held for the CFO: its proposal's address, fingerprint and id. */
async function aWaitingPayment(): Promise<{ proposal: string; hash: string; id: string }> {
  const answer = await callOperation(
    SUPERVISOR,
    "payment.create",
    { invoice: "dsor://org_456/invoice/INV-1008", amount: { value: "31400.00", currency: "USD" } },
    { idempotencyKey: `review-${Math.random()}` },
  );

  if (answer.kind !== "result" || answer.envelope.outcome !== "PENDING_APPROVAL") {
    throw new Error(`expected a payment waiting for the CFO, got ${JSON.stringify(answer)}`);
  }

  const proposal = answer.envelope.proposal ?? "";

  return {
    proposal,
    hash: answer.envelope.payload_hash ?? "",
    id: proposal.split("/").at(-1) ?? "",
  };
}

const approve = (
  login: { loggedInAs: string; tenant: string },
  proposal: string,
  payloadHash: string,
): Promise<OperationAnswer> =>
  callOperation(
    login,
    "proposal.approve",
    { proposal, payload_hash: payloadHash },
    { idempotencyKey: `review-approve-${Math.random()}` },
  );

const seen = (answer: OperationAnswer): string =>
  answer.kind === "error"
    ? `${answer.envelope.code}: ${answer.envelope.message}`
    : answer.kind === "result"
      ? answer.envelope.outcome
      : answer.kind;

const lastDecision = async (): Promise<AuditRecord | undefined> =>
  (await theLog("org_456")).filter((r) => r.kind === "decision").at(-1);

const TREASURY_REVIEW = `INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
  SELECT tenant, 'treasury-review', 1, operation, 'active',
         record || '{"id": "treasury-review", "version": 1,
                     "effect": {"require_approval": {"role": "Treasurer", "quorum": 1}}}'::jsonb,
         now()
    FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`;

describe("an approval kept, and the move it should have made", () => {
  it("DSOR-AUT-02c: an approval whose move to APPROVED was never made is finished by the approver asking again", async () => {
    // The state a crash between the two leaves: the CFO's approval kept, every requirement met, and
    // the proposal still waiting. Made here by a second requirement the CFO's approval left
    // waiting, then taken away.
    await asTheOwner(() => db.exec(TREASURY_REVIEW));
    const waiting = await aWaitingPayment();

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    await asTheOwner(() =>
      db.query("DELETE FROM dsor.requirements WHERE tenant = 'org_456' AND proposal = $1 AND role = 'Treasurer'", [
        waiting.id,
      ]),
    );
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(await stateOf("org_456", waiting.id)).toBe("APPROVED");
    expect(await approvalsOf("org_456", waiting.id)).toHaveLength(1);
  });

  it("DSOR-AUT-02c: an approval is kept only while its proposal waits: one cancelled a moment ago keeps none", async () => {
    // §21.9 looked, and the proposal waited; then, before the handler wrote, it stopped waiting.
    const first = await aWaitingPayment();

    await approve(CFO, first.proposal, first.hash);

    const [approval] = await approvalsOf("org_456", first.id);
    const { id: _id, status: _status, ...record } = approval ?? {};
    const second = await aWaitingPayment();

    expect(
      (
        await moveProposal(
          "org_456",
          second.id,
          "PENDING_APPROVAL",
          "CANCELLED",
          "user_123",
          "cancelled while the CFO approved",
          BY_A_TEST,
        )
      ).kind,
    ).toBe("moved");

    const kept = await keepApproval("org_456", second.id, "cfo_100", {
      ...record,
      proposal: second.proposal,
    });

    expect(kept).toStrictEqual({ kind: "not_waiting", state: "CANCELLED" });
    expect(await approvalsOf("org_456", second.id)).toStrictEqual([]);
  });
});

describe("§21.9's refusals, each asked", () => {
  it("DSOR-APR-05a: an agent whose slip names proposal:approve is refused all the same, by §21.9's own words", async () => {
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.delegations SET permissions = permissions || ARRAY['proposal:approve'] WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    );
    const waiting = await aWaitingPayment();

    expect(seen(await approve(AGENT, waiting.proposal, waiting.hash))).toMatch(
      /^AUTHORIZATION_DENIED: only a person, logged in as themselves, may approve/,
    );
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
  });

  it("DSOR-AUT-02c: a proposal waiting only for the Treasurer is refused to the CFO, and nothing is kept", async () => {
    const waiting = await aWaitingPayment();

    await asTheOwner(() =>
      db.query("UPDATE dsor.requirements SET role = 'Treasurer' WHERE tenant = 'org_456' AND proposal = $1", [
        waiting.id,
      ]),
    );

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toMatch(
      /^AUTHORIZATION_DENIED: prop_\d+ waits for approval by Treasurer, and cfo_100 is none of them/,
    );
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-TEN-02b: the CFO approving org_789's proposal is refused TENANT_MISMATCH, and recorded DENY", async () => {
    expect(seen(await approve(CFO, "dsor://org_789/proposal/prop_1", `sha256:${"0".repeat(64)}`))).toMatch(
      /^TENANT_MISMATCH/,
    );
    expect((await lastDecision())?.authorization).toBe("DENY");
  });

  it("DSOR-ERR-01b: user_123, who may approve nothing, hears the same for a proposal that exists and one that does not", async () => {
    const waiting = await aWaitingPayment();
    const there = await approve(SUPERVISOR, waiting.proposal, waiting.hash);
    const notThere = await approve(SUPERVISOR, "dsor://org_456/proposal/prop_999", waiting.hash);

    expect(seen(there)).toMatch(/^AUTHORIZATION_DENIED/);
    expect(seen(notThere)).toBe(seen(there).replace(waiting.id, "prop_999"));
  });

  it("DSOR-ERR-01b: the CFO, who may approve, is told a proposal that does not exist is not there", async () => {
    expect(seen(await approve(CFO, "dsor://org_456/proposal/prop_999", `sha256:${"0".repeat(64)}`))).toBe(
      "RESOURCE_NOT_FOUND: there is no proposal prop_999 to approve in org_456",
    );
  });
});
