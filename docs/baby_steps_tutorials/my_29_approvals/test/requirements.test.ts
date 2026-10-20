// NEW IN STEP 29: what a waiting proposal waits for, kept (decision 167).
//
// When a control holds a payment at PENDING_APPROVAL, the proposal waits for approvals: one by the
// CFO, for the CFO's control. That is written down when it starts waiting, and never changed, so an
// approval later can be checked against it, and the proposal moves on only when every requirement
// has its quorum.
//
// Rule DSOR-AUT-02c: When several `REQUIRE_*` outcomes apply, all of them MUST be satisfied.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { overPGlite, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { findPerson } from "../src/people.ts";
import { switchOn } from "../src/policy-controls.ts";
import { requirementsOf } from "../src/requirements.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };

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

const pay = (value: string): Promise<OperationAnswer> =>
  callOperation(
    SUPERVISOR,
    "payment.create",
    { invoice: "dsor://org_456/invoice/INV-1008", amount: { value, currency: "USD" } },
    { idempotencyKey: `requirements-${Math.random()}` },
  );

/** The proposal a receipt names, as `prop_1`. */
const proposalOf = (answer: OperationAnswer): string =>
  answer.kind === "result" ? (answer.envelope.proposal?.split("/").at(-1) ?? "") : "";

describe("what a waiting proposal waits for", () => {
  it("DSOR-AUT-02c: user_123's 31,400.00 USD payment waits for one approval by the CFO, and that is kept", async () => {
    const answer = await pay("31400.00");

    expect(await requirementsOf("org_456", proposalOf(answer))).toStrictEqual([
      { control: "high-value-payment", version: 8, role: "CFO", quorum: 1 },
    ]);
  });

  it("DSOR-AUT-02c: two controls asking: both are kept, each with its own role", async () => {
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
               SELECT tenant, 'treasury-review', 1, operation, 'active',
                      record || '{"id": "treasury-review", "version": 1,
                                  "effect": {"require_approval": {"role": "Treasurer", "quorum": 1}}}'::jsonb,
                      now()
                 FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`),
    );

    const answer = await pay("31400.00");

    expect(await requirementsOf("org_456", proposalOf(answer))).toStrictEqual([
      { control: "high-value-payment", version: 8, role: "CFO", quorum: 1 },
      { control: "treasury-review", version: 1, role: "Treasurer", quorum: 1 },
    ]);
  });

  it("DSOR-AUT-02c: a payment that waits for nobody keeps no requirement", async () => {
    const answer = await pay("2500.00");

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("COMMITTED");
    expect(await requirementsOf("org_456", proposalOf(answer))).toStrictEqual([]);
  });

  it("DSOR-MOD-01: org_789 cannot read what org_456's proposal waits for", async () => {
    const answer = await pay("31400.00");

    expect(await requirementsOf("org_789", proposalOf(answer))).toStrictEqual([]);
  });

  for (const [grant, undo] of [
    [
      "GRANT UPDATE (quorum) ON dsor.requirements TO dsor_runtime",
      "REVOKE UPDATE (quorum) ON dsor.requirements FROM dsor_runtime",
    ],
    [
      "GRANT DELETE ON dsor.requirements TO dsor_runtime",
      "REVOKE DELETE ON dsor.requirements FROM dsor_runtime",
    ],
  ] as const) {
    it(`DSOR-MOD-01: start-up refuses: ${grant}`, async () => {
      // What a proposal waits for, changed, is an approval asked of somebody else, or of nobody.
      await asTheOwner(() => db.exec(grant));

      try {
        await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
          /what a proposal waits for/,
        );
      } finally {
        await asTheOwner(() => db.exec(undo));
      }
    });
  }
});

describe("who holds which job", () => {
  it("DSOR-AUT-02c: the program's list of people gives each person a title: cfo_100 is the CFO", () => {
    expect(findPerson("cfo_100")?.title).toBe("CFO");
    expect(findPerson("user_123")?.title).toBe("AP supervisor");
    expect(findPerson("accounts-payable-fte")?.title).toBeUndefined();
  });
});
