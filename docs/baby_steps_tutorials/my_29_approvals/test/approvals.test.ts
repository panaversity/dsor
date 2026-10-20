// NEW IN STEP 29: a person approves a waiting proposal with proposal.approve (decision 167).
//
// The CFO logs in to DSoR herself and approves user_123's 31,400.00 USD payment, which the CFO's
// control holds at PENDING_APPROVAL. Her approval names the exact request by its fingerprint, the
// payload hash; it is kept whole, as approval.schema.json says it; and once every requirement has its
// quorum, the proposal moves to APPROVED. Nothing carries an approved proposal out until step 31.
//
// Rule DSOR-APR-02a: An approval MUST validate against `approval.schema.json`.
// Rule DSOR-APR-05a: `proposal.approve` MUST be accepted only in `direct` identity mode, from an
// approver authenticated to DSoR under their own credentials.
// Rule DSOR-APR-07: The permission checked for `proposal.approve` MUST be the `approve_permission` of
// the target operation's contract.
// Rule DSOR-APR-09: `proposal.approve` MUST be refused with `APPROVAL_MISMATCH` unless the
// `payload_hash` supplied by the approver equals the stored proposal's payload hash.

import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalsOf } from "../src/approvals.ts";
import { resetClock, setClock } from "../src/audit.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { switchOn } from "../src/policy-controls.ts";
import { stateOf } from "../src/proposal.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

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

/** user_123's 31,400.00 USD payment, held for the CFO: its proposal's address and fingerprint. */
async function aWaitingPayment(): Promise<{ proposal: string; hash: string; id: string }> {
  const answer = await callOperation(
    SUPERVISOR,
    "payment.create",
    { invoice: "dsor://org_456/invoice/INV-1008", amount: { value: "31400.00", currency: "USD" } },
    { idempotencyKey: `approvals-${Math.random()}` },
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
    { idempotencyKey: `approve-${Math.random()}` },
  );

const seen = (answer: OperationAnswer): string =>
  answer.kind === "error"
    ? `${answer.envelope.code}: ${answer.envelope.message}`
    : answer.kind === "result"
      ? answer.envelope.outcome
      : answer.kind;

describe("approving a payment the CFO's control holds", () => {
  it("DSOR-APR-09: the CFO approves the exact request, and the proposal is APPROVED", async () => {
    const waiting = await aWaitingPayment();

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(await stateOf("org_456", waiting.id)).toBe("APPROVED");
  });

  it("DSOR-APR-09: done when: approving with the wrong fingerprint is refused APPROVAL_MISMATCH", async () => {
    const waiting = await aWaitingPayment();
    const wrong = `sha256:${"0".repeat(64)}`;

    expect(seen(await approve(CFO, waiting.proposal, wrong))).toMatch(/^APPROVAL_MISMATCH/);
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
    expect(await approvalsOf("org_456", waiting.id)).toStrictEqual([]);
  });

  it("DSOR-APR-02a: the approval is kept whole, and validates against approval.schema.json", async () => {
    const waiting = await aWaitingPayment();

    await approve(CFO, waiting.proposal, waiting.hash);

    const [approval] = await approvalsOf("org_456", waiting.id);
    const addFormats = (addFormatsModule as unknown as { default: FormatsPlugin }).default;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const read = (name: string): object =>
      JSON.parse(
        readFileSync(new URL(`../src/schemas/${name}`, import.meta.url), "utf8"),
      ) as object;

    addFormats(ajv);
    ajv.addSchema(read("common.schema.json"));

    expect(ajv.validate(read("approval.schema.json"), approval), ajv.errorsText()).toBe(true);
    expect(approval).toMatchObject({
      proposal: waiting.proposal,
      operation: "payment.create@1",
      tenant: "org_456",
      payload_hash: waiting.hash,
      satisfies: [
        { control: "high-value-payment", version: 8, requirement: { role: "CFO", quorum: 1 } },
      ],
      approvers: [{ principal: "cfo_100", basis: "role:CFO" }],
      status: "active",
    });
  });

  it("DSOR-APR-02b: the fingerprint approved is the canonical one the proposal stored", async () => {
    const waiting = await aWaitingPayment();

    await approve(CFO, waiting.proposal, waiting.hash);

    expect(waiting.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await approvalsOf("org_456", waiting.id))[0]?.payload_hash).toBe(waiting.hash);
  });
});

describe("who may approve", () => {
  it("DSOR-APR-05a: the agent may never approve, not even its own payment", async () => {
    const waiting = await aWaitingPayment();

    expect(seen(await approve(AGENT, waiting.proposal, waiting.hash))).toMatch(
      /^AUTHORIZATION_DENIED/,
    );
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
  });

  it("DSOR-APR-07: user_123 does not hold payment:approve, the payment's approve_permission, and is refused", async () => {
    const waiting = await aWaitingPayment();

    expect(seen(await approve(SUPERVISOR, waiting.proposal, waiting.hash))).toMatch(
      /^AUTHORIZATION_DENIED: approving needs payment:approve, and user_123 holds none of them/,
    );
  });

  it("DSOR-APR-05a: a person approves a proposal once: the CFO's second, while it still waits, is a CONFLICT", async () => {
    // Two requirements, so the first approval leaves it waiting, and a second try is asked.
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
               SELECT tenant, 'treasury-review', 1, operation, 'active',
                      record || '{"id": "treasury-review", "version": 1,
                                  "effect": {"require_approval": {"role": "Treasurer", "quorum": 1}}}'::jsonb,
                      now()
                 FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`),
    );
    const waiting = await aWaitingPayment();

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toMatch(/^CONFLICT/);
  });
});

describe("when every requirement has its quorum", () => {
  it("DSOR-AUT-02c: two controls ask, the CFO's approval satisfies one, and the proposal still waits", async () => {
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
               SELECT tenant, 'treasury-review', 1, operation, 'active',
                      record || '{"id": "treasury-review", "version": 1,
                                  "effect": {"require_approval": {"role": "Treasurer", "quorum": 1}}}'::jsonb,
                      now()
                 FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`),
    );
    const waiting = await aWaitingPayment();

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(await stateOf("org_456", waiting.id)).toBe("PENDING_APPROVAL");
    expect((await approvalsOf("org_456", waiting.id))[0]?.satisfies).toStrictEqual([
      { control: "high-value-payment", version: 8, requirement: { role: "CFO", quorum: 1 } },
    ]);
  });

  it("DSOR-AUT-02c: two controls that both ask for the CFO are both satisfied by her one approval", async () => {
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
               SELECT tenant, 'second-look', 1, operation, 'active',
                      record || '{"id": "second-look", "version": 1}'::jsonb, now()
                 FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`),
    );
    const waiting = await aWaitingPayment();

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toBe("COMMITTED");
    expect(await stateOf("org_456", waiting.id)).toBe("APPROVED");
  });
});

describe("what may not be approved", () => {
  it("APPROVAL_EXPIRED: a proposal whose 72 hours have passed cannot be approved", async () => {
    const waiting = await aWaitingPayment();

    setClock(() => new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString());

    expect(seen(await approve(CFO, waiting.proposal, waiting.hash))).toMatch(/^APPROVAL_EXPIRED/);
  });

  it("CONFLICT: a proposal that does not wait for approval cannot be approved", async () => {
    const answer = await callOperation(
      SUPERVISOR,
      "payment.create",
      { invoice: "dsor://org_456/invoice/INV-1008", amount: { value: "2500.00", currency: "USD" } },
      { idempotencyKey: "approvals-small" },
    );
    const proposal = answer.kind === "result" ? (answer.envelope.proposal ?? "") : "";
    const hash = answer.kind === "result" ? (answer.envelope.payload_hash ?? "") : "";

    expect(seen(await approve(CFO, proposal, hash))).toMatch(
      /^CONFLICT: .* is COMMITTED, and only one waiting for approval/,
    );
  });

  it("DSOR-ERR-01b: the CFO is told a proposal that does not exist is not there", async () => {
    expect(
      seen(await approve(CFO, "dsor://org_456/proposal/prop_999", `sha256:${"0".repeat(64)}`)),
    ).toMatch(/^RESOURCE_NOT_FOUND: /);
  });

  for (const [what, args] of [
    ["no proposal address", { payload_hash: `sha256:${"0".repeat(64)}` }],
    [
      "an invoice's address",
      { proposal: "dsor://org_456/invoice/INV-1008", payload_hash: `sha256:${"0".repeat(64)}` },
    ],
    ["no fingerprint", { proposal: "dsor://org_456/proposal/prop_1" }],
  ] as const) {
    it(`VALIDATION_FAILED at §21.6: ${what}`, async () => {
      const answer = await callOperation(CFO, "proposal.approve", args, {
        idempotencyKey: `approve-bad-${what}`,
      });

      expect(seen(answer)).toMatch(/^VALIDATION_FAILED/);
    });
  }
});
