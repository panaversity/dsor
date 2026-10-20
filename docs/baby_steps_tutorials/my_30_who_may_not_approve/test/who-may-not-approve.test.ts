// NEW IN STEP 30: who may not approve (decision 169).
//
// An approval exists so that a second person looks. The CFO may not approve a payment she asked for
// herself, nor one the agent asked for under a slip she signed; the agent never approves; and a
// control that asks for two approvals gets two people, not one person twice.
//
// Rule DSOR-SOD-01a: A principal of type `agent` MUST NOT act as an approver.
// Rule DSOR-SOD-02: Outside owner-approval mode (§16.2), an approver MUST NOT appear in the requesting
// chain of the proposal: not the subject, not the delegator of any acting agent, not any actor.
// Rule DSOR-SOD-04c: Where a control requires a quorum, the approvals MUST come from distinct
// principals.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalsOf, keepApproval } from "../src/approvals.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { switchOn } from "../src/policy-controls.ts";
import { stateOf } from "../src/proposal.ts";
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

/** A payment of 31,400.00 USD by this caller, held for the CFO: its address, fingerprint and id. */
async function heldForTheCfo(login: {
  loggedInAs: string;
  tenant: string;
}): Promise<{ proposal: string; hash: string; id: string }> {
  const answer = await callOperation(
    login,
    "payment.create",
    { invoice: "dsor://org_456/invoice/INV-1008", amount: { value: "31400.00", currency: "USD" } },
    { idempotencyKey: `sod-${Math.random()}` },
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
  waiting: { proposal: string; hash: string },
): Promise<OperationAnswer> =>
  callOperation(
    login,
    "proposal.approve",
    { proposal: waiting.proposal, payload_hash: waiting.hash },
    { idempotencyKey: `sod-approve-${Math.random()}` },
  );

const seen = (answer: OperationAnswer): string =>
  answer.kind === "error"
    ? `${answer.envelope.code}: ${answer.envelope.message}`
    : answer.kind === "result"
      ? answer.envelope.outcome
      : answer.kind;

describe("the requesting chain", () => {
  it("DSOR-SOD-02: the CFO may not approve a payment she asked for herself", async () => {
    const waiting = await heldForTheCfo(CFO);

    expect(seen(await approve(CFO, waiting))).toMatch(
      /^SOD_VIOLATION: cfo_100 asked for prop_\d+, and may not approve it/,
    );
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
  });

  it("DSOR-SOD-02: nor one the agent asked for under a slip she signed", async () => {
    // del_100, user_123's, torn up, and del_300 signed by the CFO for the agent in its place.
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations SET status = 'revoked', revoked_by = 'user_123',
                      revoked_at = now(), revoked_reason = 'replaced by del_300'
                WHERE tenant = 'org_456' AND id = 'del_100';
               INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status,
                                             expires_at, modes)
               VALUES ('org_456', 'del_300', 'cfo_100', 'accounts-payable-fte',
                       ARRAY['payment:create'], 'active', '2099-12-31T23:59:59Z', ARRAY['unattended'])`),
    );
    const waiting = await heldForTheCfo(AGENT);

    expect(seen(await approve(CFO, waiting))).toMatch(
      /^SOD_VIOLATION: cfo_100 signed del_300, under which accounts-payable-fte asked for prop_\d+/,
    );
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-02: a payment someone else asked for, the CFO approves", async () => {
    // Not testing nothing: the same CFO, the same control, and user_123 asked.
    const waiting = await heldForTheCfo(SUPERVISOR);

    expect(seen(await approve(CFO, waiting))).toBe("COMMITTED");
    expect(await stateOf("org_456", waiting.id)).toBe("APPROVED");
  });
});

describe("an agent", () => {
  it("DSOR-SOD-01a: the agent never approves, even when its slip names proposal:approve", async () => {
    // §21.5 lets it through: the slip names the permission, and user_123, who signed it, holds it.
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.delegations SET permissions = permissions || ARRAY['proposal:approve'] WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    );
    const waiting = await heldForTheCfo(SUPERVISOR);

    expect(seen(await approve(AGENT, waiting))).toMatch(
      /^AUTHORIZATION_DENIED: only a person, logged in as themselves, may approve/,
    );
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });
});

const TWO_SIGNATURES = `INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
  SELECT tenant, 'two-signatures', 1, operation, 'active',
         record || '{"id": "two-signatures", "version": 1,
                     "effect": {"require_approval": {"role": "CFO", "quorum": 2}}}'::jsonb,
         now()
    FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`;

/** Write what a proposal recorded as its requester, as the database's owner: a test's way to reach it. */
const recordedRequester = (proposalId: string, requester: string): Promise<unknown> =>
  asTheOwner(() =>
    db.query("UPDATE dsor.proposals SET requester = $1 WHERE tenant = 'org_456' AND id = $2", [
      requester,
      proposalId,
    ]),
  );

describe("the requesting chain, as the proposal recorded it (decision 170)", () => {
  it("DSOR-SOD-02: not any actor: a requester that names the CFO among its actors is refused to her", async () => {
    // No request can make this today, because only agents act, and agents never approve. The rule
    // says "not any actor", so the clause is asked through what the proposal recorded.
    const waiting = await heldForTheCfo(SUPERVISOR);

    await recordedRequester(
      waiting.id,
      JSON.stringify({ subject: "user_123", actor_chain: ["accounts-payable-fte", "cfo_100"] }),
    );

    expect(seen(await approve(CFO, waiting))).toMatch(
      /^SOD_VIOLATION: cfo_100 acted for user_123 in asking for prop_\d+, and may not approve it/,
    );
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
  });

  it("DSOR-SOD-02: the slip's signer is read from the slip: a recorded subject that is not its signer does not let the signer through", async () => {
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations SET status = 'revoked', revoked_by = 'user_123',
                      revoked_at = now(), revoked_reason = 'replaced by del_300'
                WHERE tenant = 'org_456' AND id = 'del_100';
               INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status,
                                             expires_at, modes)
               VALUES ('org_456', 'del_300', 'cfo_100', 'accounts-payable-fte',
                       ARRAY['payment:create'], 'active', '2099-12-31T23:59:59Z', ARRAY['unattended'])`),
    );
    const waiting = await heldForTheCfo(AGENT);

    // The subject beside the slip says user_123; the slip says the CFO signed it.
    await recordedRequester(
      waiting.id,
      JSON.stringify({
        subject: "user_123",
        actor_chain: ["accounts-payable-fte"],
        delegation: "del_300",
      }),
    );

    expect(seen(await approve(CFO, waiting))).toMatch(
      /^SOD_VIOLATION: cfo_100 signed del_300, under which accounts-payable-fte asked for prop_\d+/,
    );
  });

  for (const [what, requester] of [
    ["that is not JSON", "not a requester"],
    ["with an empty subject", JSON.stringify({ subject: "", actor_chain: [] })],
    ["with no actors", JSON.stringify({ subject: "user_123" })],
    [
      "naming a slip that does not exist",
      JSON.stringify({
        subject: "user_123",
        actor_chain: ["accounts-payable-fte"],
        delegation: "del_999",
      }),
    ],
  ] as const) {
    it(`DSOR-SOD-02: a requester ${what} is refused to everyone, SOD_VIOLATION, and a retry cannot help`, async () => {
      // Taken as nobody, an empty subject let the CFO approve her own payment, a review measured; and
      // one that could not be read was told as a store that could not be read, to be sent again.
      const waiting = await heldForTheCfo(SUPERVISOR);

      await recordedRequester(waiting.id, requester);

      const answer = await approve(CFO, waiting);

      expect(seen(answer)).toMatch(
        /^SOD_VIOLATION: prop_\d+ (recorded a requester|was asked for under del_999)/,
      );
      expect(answer.kind === "error" && answer.envelope.retry).toBe("never");
      expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
    });
  }
});

describe("a quorum", () => {
  it("DSOR-SOD-04c: two approvals by the CFO are one person, and a control asking for two keeps waiting", async () => {
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
               SELECT tenant, 'two-signatures', 1, operation, 'active',
                      record || '{"id": "two-signatures", "version": 1,
                                  "effect": {"require_approval": {"role": "CFO", "quorum": 2}}}'::jsonb,
                      now()
                 FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`),
    );
    const waiting = await heldForTheCfo(SUPERVISOR);

    expect(seen(await approve(CFO, waiting))).toBe("COMMITTED");
    expect(seen(await approve(CFO, waiting))).toMatch(
      /^CONFLICT: cfo_100 has approved prop_\d+ already/,
    );
    expect(await approvalsOf("org_456", waiting.id)).toHaveLength(1);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-04c: two approvals by the CFO sent at once are one person: one is kept, the other is CONFLICT, and it keeps waiting", async () => {
    // Decision 170: a review sent the two one after the other only; AGENTS.md asks for requests
    // sent at once.
    await asTheOwner(() => db.exec(TWO_SIGNATURES));
    const waiting = await heldForTheCfo(SUPERVISOR);
    const answers = await Promise.all([approve(CFO, waiting), approve(CFO, waiting)]);

    expect(answers.map(seen).sort()).toStrictEqual([
      "COMMITTED",
      `CONFLICT: cfo_100 has approved ${waiting.id} already`,
    ]);
    expect(await approvalsOf("org_456", waiting.id)).toHaveLength(1);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-SOD-04c: the count is of people: without the table's one-row-per-person rule, one person's two approvals still do not make two", async () => {
    // A review dropped the rule and measured a control asking for two going APPROVED on one CFO.
    // The statement counts approvers now, not rows; this breaks the first lock to show the second.
    await asTheOwner(() => db.exec(TWO_SIGNATURES));
    const waiting = await heldForTheCfo(SUPERVISOR);

    await approve(CFO, waiting);

    const [approval] = await approvalsOf("org_456", waiting.id);
    const { id: _id, status: _status, ...record } = approval ?? {};

    await asTheOwner(() =>
      db.exec("ALTER TABLE dsor.approvals DROP CONSTRAINT approvals_tenant_proposal_approver_key"),
    );

    try {
      const again = await keepApproval("org_456", waiting.id, "cfo_100", record, BY_A_TEST);

      expect(again).toMatchObject({ kind: "kept", approved: false });
      expect(await approvalsOf("org_456", waiting.id)).toHaveLength(2);
      expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
    } finally {
      await asTheOwner(() =>
        db.exec(`DELETE FROM dsor.approvals WHERE tenant = 'org_456';
                 ALTER TABLE dsor.approvals
                   ADD CONSTRAINT approvals_tenant_proposal_approver_key UNIQUE (tenant, proposal, approver)`),
      );
    }
  });
});

describe("the CFO's own payments", () => {
  it("DSOR-AUT-01a: the CFO may make a payment now, so the rules above have someone to refuse", async () => {
    const answer = await callOperation(
      CFO,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1008", amount: { value: "2500.00", currency: "USD" } },
      { idempotencyKey: "sod-cfo-pays" },
    );

    expect(seen(answer)).toBe("COMMITTED");
  });
});
