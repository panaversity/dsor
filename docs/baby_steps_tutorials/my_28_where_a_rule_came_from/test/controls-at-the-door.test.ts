// STEP 27: the company's controls, evaluated at §21.10 for every command (decision 162).
//
// With org_456's CFO control switched on, a payment above 25,000 USD, or its equivalent, stops at
// PENDING_APPROVAL: the decision is recorded with the control that asked for it, the proposal waits,
// its amount stays booked against the day, and the caller is told who must approve and until when.
// Nothing approves it until step 29.
//
// Rule DSOR-AUT-02a: Authorization and control evaluation MUST support at least the outcomes
// `ALLOW`, `DENY`, and `REQUIRE_APPROVAL`.
// Rule DSOR-AUT-02b: When several controls apply, the most restrictive outcome MUST win.
// Rule DSOR-EXE-02: The decision — outcome, controls evaluated, and the reason for any `DENY` — MUST
// be durably recorded before the response is returned.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { paymentsOf } from "../src/payment.ts";
import { controlsInForce, switchOn } from "../src/policy-controls.ts";
import { stateOf } from "../src/proposal.ts";
import { useRateService } from "../src/rates.ts";
import { usedToday } from "../src/reservation.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
/** 2,800,000.00 PKR, from migration 027: 10,000.00 USD at 280. */
const INV_1010 = "dsor://org_456/invoice/INV-1010";

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
  useRateService("org_456", undefined);
});

const pay = (
  login: { loggedInAs: string; tenant: string },
  invoice: string,
  value: string,
  currency: string,
  more: Record<string, unknown> = {},
): Promise<OperationAnswer> =>
  callOperation(
    login,
    "payment.create",
    { invoice, amount: { value, currency } },
    { idempotencyKey: `controls-${Math.random()}`, ...more },
  );

/** The receipt's fields, or the refusal's code and message. */
const seen = (answer: OperationAnswer): Readonly<Record<string, unknown>> | string =>
  answer.kind === "error"
    ? `${answer.envelope.code}: ${answer.envelope.message}`
    : answer.kind === "result"
      ? (answer.envelope as unknown as Readonly<Record<string, unknown>>)
      : answer.kind;

/** The request a command's answer is about, as its record names it. */
const requestIdOf = (answer: OperationAnswer): string | undefined =>
  answer.kind === "error" || answer.kind === "result"
    ? answer.envelope.correlation.request_id
    : undefined;

/** The proposal a receipt names, as `prop_1`. */
const proposalOf = (answer: OperationAnswer): string => {
  const seenAs = seen(answer);

  if (typeof seenAs === "string" || typeof seenAs.proposal !== "string") {
    throw new Error(`no proposal in ${JSON.stringify(seenAs)}`);
  }

  return seenAs.proposal.split("/").at(-1) ?? "";
};

describe("the CFO's control at the door", () => {
  it("DSOR-AUT-02a: the agent's 31,400.00 USD payment waits at PENDING_APPROVAL for the CFO, and nothing is paid", async () => {
    const answer = await pay(AGENT, INV_1008, "31400.00", "USD");
    const receipt = seen(answer);

    expect(receipt).toMatchObject({
      outcome: "PENDING_APPROVAL",
      requires: [{ control: "high-value-payment", version: 8, role: "CFO", quorum: 1 }],
    });
    expect(await stateOf("org_456", proposalOf(answer))).toBe("PENDING_APPROVAL");
    // The handler never ran: PAY-901 is still the story's only payment.
    expect((await paymentsOf("org_456")).map((p) => p.id)).toStrictEqual(["PAY-901"]);
    // And the amount stays booked against the day while it waits.
    expect(await usedToday("org_456", "del_100")).toBe("31400.00");
  });

  it("DSOR-AUT-02a: the receipt says until when it waits: 72 hours from the decision", async () => {
    const before = Date.now();
    const receipt = seen(await pay(AGENT, INV_1008, "31400.00", "USD"));
    const until = typeof receipt === "string" ? Number.NaN : Date.parse(String(receipt.expires_at));

    expect(until - before).toBeGreaterThanOrEqual(72 * 60 * 60 * 1000 - 1000);
    expect(until - before).toBeLessThanOrEqual(72 * 60 * 60 * 1000 + 60_000);
  });

  it("DSOR-AUT-02a: 2,500.00 USD is below 25,000 USD, and is paid", async () => {
    expect(seen(await pay(AGENT, INV_1008, "2500.00", "USD"))).toMatchObject({
      outcome: "COMMITTED",
    });
  });

  it("DSOR-AUT-02a: a person is checked too: user_123's 31,400.00 USD payment waits for the CFO", async () => {
    // A control is the company's policy, not the agent's leash (decision 162).
    expect(seen(await pay(SUPERVISOR, INV_1008, "31400.00", "USD"))).toMatchObject({
      outcome: "PENDING_APPROVAL",
    });
  });

  it("DSOR-MON-03: 2,800,000.00 PKR, which is 10,000.00 USD at the company's rate, is paid", async () => {
    expect(seen(await pay(AGENT, INV_1010, "2800000.00", "PKR"))).toMatchObject({
      outcome: "COMMITTED",
    });
  });

  it("DSOR-CTL-07: with the rate service down, user_123's rupees cannot be converted, and wait for the CFO", async () => {
    // A person has no slip, so no limit refuses first: only the control decides, and a condition
    // that cannot be evaluated applies the control.
    useRateService("org_456", null);

    expect(seen(await pay(SUPERVISOR, INV_1010, "2800000.00", "PKR"))).toMatchObject({
      outcome: "PENDING_APPROVAL",
    });
  });

  it("DSOR-EXE-02: the decision's record names the control, its version, its outcome and the policy it came from", async () => {
    const answer = await pay(AGENT, INV_1008, "31400.00", "USD");
    const decision = (await theLog("org_456")).find(
      (r) => r.kind === "decision" && r.correlation.request_id === requestIdOf(answer),
    );

    expect(decision).toMatchObject({
      authorization: "ALLOW",
      result: "PENDING_APPROVAL",
      controls: [
        {
          id: "high-value-payment",
          version: 8,
          outcome: "REQUIRE_APPROVAL",
          authority: {
            system: "ksor",
            uri: "ksor://org_456/finance/payment-approval-policy",
            version: 4,
          },
        },
      ],
    });
  });

  it("DSOR-EXE-02: why a control could not be evaluated is on the record too", async () => {
    useRateService("org_456", null);
    const answer = await pay(SUPERVISOR, INV_1010, "2800000.00", "PKR");
    const decision = (await theLog("org_456")).find(
      (r) => r.kind === "decision" && r.correlation.request_id === requestIdOf(answer),
    );

    expect(decision?.controls?.[0]?.evaluation_error).toMatch(/rate service/);
  });

  it("DSOR-OPR-05: a dry run of a payment that needs the CFO answers VALIDATED, REQUIRE_APPROVAL, and books nothing", async () => {
    expect(
      seen(await pay(AGENT, INV_1008, "31400.00", "USD", { mode: "validate_only" })),
    ).toMatchObject({
      outcome: "VALIDATED",
      decision: "REQUIRE_APPROVAL",
    });
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-OPR-05: one prepared with propose_only waits for the CFO too, not at READY", async () => {
    const answer = await pay(AGENT, INV_1008, "31400.00", "USD", { mode: "propose_only" });

    expect(seen(answer)).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(await stateOf("org_456", proposalOf(answer))).toBe("PENDING_APPROVAL");
  });

  it("DSOR-IDM-01c: sent again with its key, the same answer, and no second proposal", async () => {
    const more = { idempotencyKey: "controls-the-same-key" };
    const first = await pay(AGENT, INV_1008, "31400.00", "USD", more);
    const again = await pay(AGENT, INV_1008, "31400.00", "USD", more);

    expect(proposalOf(again)).toBe(proposalOf(first));
    expect(seen(again)).toMatchObject({ outcome: "PENDING_APPROVAL" });
    expect(await usedToday("org_456", "del_100")).toBe("31400.00");
  });

  it("DSOR-AUT-02a: a control governs its own operation only: issuing an invoice is not a payment", async () => {
    expect(
      seen(
        await callOperation(
          SUPERVISOR,
          "invoice.issue",
          { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 },
          { idempotencyKey: "controls-issue" },
        ),
      ),
    ).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-MOD-01: org_456's control is in force in org_456 only", async () => {
    // Nobody in org_789 can make a payment in this story, so this is asked of the store: switched
    // on in org_456, the control is in force on org_456's payments and on nobody else's.
    expect((await controlsInForce("org_456", "payment.create")).map((c) => c.id)).toStrictEqual([
      "high-value-payment",
    ]);
    expect(await controlsInForce("org_789", "payment.create")).toStrictEqual([]);
  });
});

describe("controls that cannot be read", () => {
  it("DSOR-AUT-02b: are not an ALLOW: the payment is refused, and nothing is booked", async () => {
    // The application loses its right to read the controls, as a careless administrator could
    // leave it. Read as "no controls", the CFO's line would be gone for everyone.
    await asTheOwner(() => db.exec("REVOKE SELECT ON dsor.controls FROM dsor_runtime"));

    try {
      expect(seen(await pay(AGENT, INV_1008, "31400.00", "USD"))).toMatch(
        /^EVIDENCE_STORE_UNAVAILABLE: the controls on payment\.create in org_456 could not be read/,
      );
      expect(await usedToday("org_456", "del_100")).toBe("0.00");
    } finally {
      await asTheOwner(() => db.exec("GRANT SELECT ON dsor.controls TO dsor_runtime"));
    }
  });
});

describe("two controls on one payment", () => {
  beforeEach(async () => {
    // A second control on payment.create, as an administrator would write it, switched on.
    await asTheOwner(() =>
      db.query(
        `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
         SELECT tenant, 'payments-frozen', 1, operation, 'in_review',
                (record - 'tests')
                || '{"id": "payments-frozen", "version": 1, "condition": "true",
                     "effect": {"deny": {"reason": "payments are frozen for the year-end audit"}},
                     "tests": [{"input": {}, "expect": "DENY"}]}'::jsonb
           FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`,
      ),
    );
    expect((await switchOn("org_456", "payments-frozen", 1)).kind).toBe("switched_on");
  });

  it("DSOR-AUT-02b: DENY beside REQUIRE_APPROVAL: the payment is refused POLICY_DENIED, and nothing is booked", async () => {
    expect(seen(await pay(AGENT, INV_1008, "31400.00", "USD"))).toMatch(
      /^POLICY_DENIED: .*payments-frozen.*year-end audit/,
    );
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  it("DSOR-EXE-02: the refusal's record names both controls, and why", async () => {
    const answer = await pay(AGENT, INV_1008, "31400.00", "USD");
    const decision = (await theLog("org_456")).find(
      (r) => r.kind === "decision" && r.correlation.request_id === requestIdOf(answer),
    );

    expect(decision?.authorization).toBe("DENY");
    expect(decision?.result).toBe("POLICY_DENIED");
    expect(decision?.controls?.map((c) => [c.id, c.outcome])).toStrictEqual([
      ["high-value-payment", "REQUIRE_APPROVAL"],
      ["payments-frozen", "DENY"],
    ]);
  });
});
