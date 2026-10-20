// NEW IN STEP 29: what the review of approvals found (decision 168).
//
// An approval and the move it completes were two statements, though proposal.approve says it is
// atomic: an approval kept with the move never made left the proposal waiting for good. An approval
// could be kept for a proposal that had stopped waiting between §21.9's look and the handler's
// write. And four of §21.9's refusals were never asked by a test of their own.
//
// Rule DSOR-EXE-05b: Every command result MUST state the execution semantics that applied.
// Rule DSOR-AUT-02c: When several `REQUIRE_*` outcomes apply, all of them MUST be satisfied.
// Rule DSOR-APR-01c: A proposal MUST NOT leave a terminal state.
// Rule DSOR-APR-04a: An approval MUST expire no later than the ceiling of §44.
// Rule DSOR-APR-05a: `proposal.approve` MUST be accepted only in `direct` identity mode, from an
// approver authenticated to DSoR under their own credentials.
// Rule DSOR-ERR-01b: An error MUST NOT reveal the existence or attributes of a resource the caller is
// not authorized to read.
// Rule DSOR-TEN-02b: A request naming a resource of another tenant MUST be refused with
// `TENANT_MISMATCH`.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalsOf, keepApproval } from "../src/approvals.ts";
import { type AuditRecord, resetClock, setClock, theLog } from "../src/audit.ts";
import { callOperation, type OperationAnswer, PIPELINE } from "../src/operations.ts";
import type { Context } from "../src/pipeline.ts";
import { switchOn } from "../src/policy-controls.ts";
import { moveProposal, proposalsOf, stateOf } from "../src/proposal.ts";
import { aDatabase, asTheOwner, BY_A_TEST, resetTheStory } from "./support/database.ts";
import { makeDoor } from "./support/door.ts";

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

afterEach(() => {
  resetClock();
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

describe("an approval kept, and the move it completes", () => {
  it("DSOR-EXE-05b: proposal.approve says it is atomic, and is: a log that refuses the move's record keeps no approval either", async () => {
    // Measured by the review when they were two statements: the approval was kept, the move was
    // not, and the proposal waited for good with every requirement met.
    const waiting = await aWaitingPayment();

    await asTheOwner(() =>
      db.exec(
        "ALTER TABLE dsor.audit ADD CONSTRAINT no_approved_records CHECK (result <> 'APPROVED') NOT VALID",
      ),
    );

    try {
      expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toMatch(
        /^EVIDENCE_STORE_UNAVAILABLE: the approval of prop_\d+ could not be written, so nothing was approved/,
      );
    } finally {
      await asTheOwner(() => db.exec("ALTER TABLE dsor.audit DROP CONSTRAINT no_approved_records"));
    }

    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");

    // With the log taking records again, the CFO approves it, and it is APPROVED.
    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(await stateOf("org_456", waiting.id)).toBe("APPROVED");
    expect(await approvalsOf("org_456", waiting.id)).toHaveLength(1);
  });

  it("DSOR-AUT-02c: an approval that is not the last is kept, and the proposal waits, with no move and no record of one", async () => {
    await asTheOwner(() => db.exec(TREASURY_REVIEW));
    const waiting = await aWaitingPayment();
    // The log is kept from test to test, and proposal numbers start again after each reset, so an
    // earlier test's record can name this address: what is counted is what this approval adds.
    const recordsOfApproved = async (): Promise<number> =>
      (await theLog("org_456")).filter(
        (r) => r.result === "APPROVED" && r.resources?.includes(waiting.proposal) === true,
      ).length;
    const before = await recordsOfApproved();

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(await approvalsOf("org_456", waiting.id)).toHaveLength(1);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
    expect(await recordsOfApproved()).toBe(before);
  });

  it("DSOR-APR-01c: a proposal that stopped waiting keeps no approval: one cancelled a moment ago", async () => {
    // §21.9 looked, and the proposal waited; then, before the handler wrote, it was cancelled.
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

    const kept = await keepApproval(
      "org_456",
      second.id,
      "cfo_100",
      { ...record, proposal: second.proposal },
      BY_A_TEST,
    );

    expect(kept).toStrictEqual({ kind: "not_waiting", state: "CANCELLED" });
    expect(await approvalsOf("org_456", second.id)).toStrictEqual([]);
  });

  it("DSOR-APR-04a: nor does an approval whose time has passed: it is not kept, and the proposal waits", async () => {
    const first = await aWaitingPayment();

    await approve(CFO, first.proposal, first.hash);

    const [approval] = await approvalsOf("org_456", first.id);
    const { id: _id, status: _status, ...record } = approval ?? {};
    const second = await aWaitingPayment();
    const kept = await keepApproval(
      "org_456",
      second.id,
      "cfo_100",
      { ...record, proposal: second.proposal, expires_at: "2001-01-01T00:00:00.000Z" },
      BY_A_TEST,
    );

    expect(kept).toStrictEqual({ kind: "expired" });
    expect(await approvalsOf("org_456", second.id)).toStrictEqual([]);
    expect(await stateOf("org_456", second.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-APR-04a: 72 hours that end between §21.9's look and the handler's write are APPROVAL_EXPIRED, and the request did nothing", async () => {
    // A review measured this answered OUTCOME_UNKNOWN, retry after_reconciliation: the handler knew
    // nothing was kept, and the door, not counting APPROVAL_EXPIRED as nothing done, said unknown.
    const waiting = await aWaitingPayment();
    const list = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: async (context: Context) => {
              const done = await stage.run(context);

              // §21.9 has looked, and its 72 hours had not passed. Now they have.
              setClock(() => new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString());

              return done;
            },
          })
        : stage,
    );
    const answer = await makeDoor(list)(CFO, "proposal.approve", {
      proposal: waiting.proposal,
      payload_hash: waiting.hash,
    });

    expect(seen(answer)).toMatch(/^APPROVAL_EXPIRED: prop_\d+ waited for approval until/);
    expect(answer.kind === "error" && answer.envelope.retry).toBe("never");
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
    expect(
      (await proposalsOf("org_456")).find((p) => p.operation === "proposal.approve@1")?.state,
    ).toBe("FAILED");
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
      db.query(
        "UPDATE dsor.requirements SET role = 'Treasurer' WHERE tenant = 'org_456' AND proposal = $1",
        [waiting.id],
      ),
    );

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toMatch(
      /^AUTHORIZATION_DENIED: prop_\d+ waits for approval by Treasurer, and cfo_100 is none of them/,
    );
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-TEN-02b: the CFO approving org_789's proposal is refused TENANT_MISMATCH, and recorded DENY", async () => {
    expect(
      seen(await approve(CFO, "dsor://org_789/proposal/prop_1", `sha256:${"0".repeat(64)}`)),
    ).toMatch(/^TENANT_MISMATCH/);
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
    expect(
      seen(await approve(CFO, "dsor://org_456/proposal/prop_999", `sha256:${"0".repeat(64)}`)),
    ).toBe("RESOURCE_NOT_FOUND: there is no proposal prop_999 to approve in org_456");
  });
});
