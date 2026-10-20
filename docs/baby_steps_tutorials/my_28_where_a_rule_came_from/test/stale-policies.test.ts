// NEW IN STEP 28: a control whose policy changed is marked stale, and its owner is told (decision 165).
//
// The CFO's control came from version 4 of org_456's payment approval policy. When KSoR publishes
// version 5, the sweep DSoR runs notices, marks the control `stale_authority`, writes a record in
// the company's log and tells the control's owner. The control is never switched off: a payment
// above its line still waits for the CFO.
//
// Rule DSOR-CTL-03a: DSoR MUST detect, within the bound of §44, that the authority a control cites
// has been superseded, and then mark the control `stale_authority` and notify its owner.
// Rule DSOR-CTL-03b: A stale control MUST NOT be dropped or skipped.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { aPolicySource, usePolicySource, type PolicyVersion } from "../src/ksor.ts";
import { emptyTheInboxes, inboxOf } from "../src/notices.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { controlsOf, noticeStalePolicies, switchOn } from "../src/policy-controls.ts";
import { theDatabase } from "../src/store.ts";
import { aDatabase, resetTheStory } from "./support/database.ts";

const POLICY = "ksor://org_456/finance/payment-approval-policy";
const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };

/** Version 5 of the policy: the line moves to 20,000 USD. */
const VERSION_5: PolicyVersion = Object.freeze({
  uri: POLICY,
  version: 5,
  content_hash: "sha256:5e5e5e5e5e5e",
  text: "Payments above 20,000 USD or equivalent require CFO approval.",
});

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  emptyTheInboxes();
  expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
});

afterEach(() => {
  usePolicySource("org_456", undefined);
});

const statusOfTheCfosControl = async (): Promise<string | undefined> =>
  (await controlsOf("org_456")).find((c) => c.id === "high-value-payment" && c.version === 8)
    ?.status;

const pay = (value: string): Promise<OperationAnswer> =>
  callOperation(
    SUPERVISOR,
    "payment.create",
    { invoice: "dsor://org_456/invoice/INV-1008", amount: { value, currency: "USD" } },
    { idempotencyKey: `stale-${Math.random()}` },
  );

describe("noticing a policy that changed", () => {
  it("DSOR-CTL-03a: KSoR publishes version 5, and the sweep marks the CFO's control stale", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));

    const noticed = await noticeStalePolicies("org_456");

    expect(noticed.marked).toStrictEqual([
      { id: "high-value-payment", version: 8, cites: 4, inForce: 5 },
    ]);
    expect(await statusOfTheCfosControl()).toBe("stale_authority");
  });

  it("DSOR-CTL-03a: and tells its owner, cfo_100, what changed and what to do", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));

    await noticeStalePolicies("org_456");

    const [notice] = inboxOf("org_456", "cfo_100");

    expect(notice?.text).toMatch(/high-value-payment v8.*version 4.*version 5.*review/);
    expect(inboxOf("org_456", "user_123")).toStrictEqual([]);
  });

  it("DSOR-CTL-03a: and writes a control_change record in the company's log", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));

    await noticeStalePolicies("org_456");

    const change = (await theLog("org_456")).find((r) => r.kind === "control_change");

    expect(change).toMatchObject({ result: "STALE_AUTHORITY" });
    expect(change?.reason).toMatch(/high-value-payment v8/);
  });

  it("DSOR-CTL-03b: a stale control is still enforced: 31,400.00 USD still waits for the CFO", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));
    await noticeStalePolicies("org_456");

    const answer = await pay("31400.00");

    expect(answer.kind === "result" && answer.envelope.outcome).toBe("PENDING_APPROVAL");
  });

  it("DSOR-CTL-03a: the same version with other words marks it stale too", async () => {
    usePolicySource(
      "org_456",
      aPolicySource("org_456", {
        policies: { [POLICY]: { ...VERSION_5, version: 4, content_hash: "sha256:0ther0ther0" } },
      }),
    );

    expect((await noticeStalePolicies("org_456")).marked).toHaveLength(1);
  });

  it("DSOR-CTL-03a: a policy KSoR no longer has marks it stale", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: null } }));

    expect((await noticeStalePolicies("org_456")).marked).toHaveLength(1);
    expect(await statusOfTheCfosControl()).toBe("stale_authority");
  });

  it("DSOR-CTL-03a: an unchanged policy marks nothing, and tells nobody", async () => {
    const noticed = await noticeStalePolicies("org_456");

    expect(noticed.marked).toStrictEqual([]);
    expect(await statusOfTheCfosControl()).toBe("active");
    expect(inboxOf("org_456", "cfo_100")).toStrictEqual([]);
  });

  it("DSOR-CTL-03a: KSoR down marks nothing, and the sweep says it could not ask", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { down: true }));

    const noticed = await noticeStalePolicies("org_456");

    expect(noticed.marked).toStrictEqual([]);
    expect(noticed.couldNotAsk).toMatch(/did not answer/);
    expect(await statusOfTheCfosControl()).toBe("active");
  });

  it("DSOR-CTL-03a: a control already stale is not marked or told twice", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));
    await noticeStalePolicies("org_456");

    expect((await noticeStalePolicies("org_456")).marked).toStrictEqual([]);
    expect(inboxOf("org_456", "cfo_100")).toHaveLength(1);
  });

  it("DSOR-CTL-03b: the program may mark a control stale, and still may not retire it", async () => {
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));
    await noticeStalePolicies("org_456");

    // Stale is final for the program: the second lock lets nothing change it again.
    const { rows } = await theDatabase("org_456").query(
      "UPDATE dsor.controls SET status = 'retired' WHERE tenant = $1 AND id = 'high-value-payment' RETURNING id",
      ["org_456"],
    );

    expect(rows).toStrictEqual([]);
    expect(await statusOfTheCfosControl()).toBe("stale_authority");
  });
});
