// STEP 28: what the review of step 28 found, each case measured first (decision 166).
//
// Rule DSOR-CTL-02a: A control MUST be activated only by its human control owner.
// Rule DSOR-CTL-03a: DSoR MUST detect that the authority a control cites has been superseded, and
// then mark the control `stale_authority` and notify its owner.
// Rule DSOR-EXE-02: The decision MUST be durably recorded before the response is returned.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { aPolicySource, usePolicySource, type PolicyVersion } from "../src/ksor.ts";
import { emptyTheInboxes, inboxOf } from "../src/notices.ts";
import { callOperation, PIPELINE } from "../src/operations.ts";
import type { Stage } from "../src/pipeline.ts";
import { controlsOf, noticeStalePolicies, switchOn } from "../src/policy-controls.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { makeDoor } from "./support/door.ts";

const POLICY = "ksor://org_456/finance/payment-approval-policy";
const VENDOR_POLICY = "ksor://org_456/finance/vendor-policy";
const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };

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
});

afterEach(() => {
  usePolicySource("org_456", undefined);
});

const statusOf = async (tenant: string, id: string): Promise<string | undefined> =>
  (await controlsOf(tenant)).find((c) => c.id === id)?.status;

describe("the sweep (high and medium)", () => {
  it("DSOR-CTL-03a: a log that refuses the record leaves the control active, unrecorded and untold, for the next sweep", async () => {
    // Measured by the review when the mark and its record were two statements: the control was
    // stale with no record, nobody was told, and the next sweep skipped it as stale already.
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
    usePolicySource("org_456", aPolicySource("org_456", { policies: { [POLICY]: VERSION_5 } }));
    await asTheOwner(() =>
      db.exec(
        "ALTER TABLE dsor.audit ADD CONSTRAINT no_stale_records CHECK (result <> 'STALE_AUTHORITY') NOT VALID",
      ),
    );

    try {
      await expect(noticeStalePolicies("org_456")).rejects.toThrow();
    } finally {
      await asTheOwner(() => db.exec("ALTER TABLE dsor.audit DROP CONSTRAINT no_stale_records"));
    }

    expect(await statusOf("org_456", "high-value-payment")).toBe("active");
    expect(inboxOf("org_456", "cfo_100")).toStrictEqual([]);

    // The next sweep, with the log taking records again, marks it, records it and tells its owner.
    expect((await noticeStalePolicies("org_456")).marked).toHaveLength(1);
    expect((await theLog("org_456")).filter((r) => r.kind === "control_change")).toHaveLength(1);
    expect(inboxOf("org_456", "cfo_100")).toHaveLength(1);
  });

  it("DSOR-CTL-03a: one policy KSoR will not answer for does not stop the sweep", async () => {
    // A second control, citing another policy, sorted after the CFO's.
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
               SELECT tenant, 'vendor-limit', 1, operation, 'active',
                      record || jsonb_build_object('id', 'vendor-limit', 'version', 1,
                        'authority', (record->'authority') || '{"uri": "${VENDOR_POLICY}", "version": 1}'::jsonb),
                      now()
                 FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`),
    );
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
    usePolicySource("org_456", {
      current: (uri) => {
        if (uri === POLICY) {
          throw new Error(`KSoR would not answer for ${uri}`);
        }

        return { uri, version: 2, content_hash: "sha256:2e2e2e2e2e2e", text: "Vendors change." };
      },
    });

    const noticed = await noticeStalePolicies("org_456");

    expect(noticed.marked.map((m) => m.id)).toStrictEqual(["vendor-limit"]);
    expect(noticed.couldNotAsk).toMatch(
      /would not answer for ksor:\/\/org_456\/finance\/payment-approval-policy/,
    );
    expect(await statusOf("org_456", "high-value-payment")).toBe("active");
  });

  it("DSOR-CTL-03a: org_789's control is not marked stale: its KSoR knows its own policy", async () => {
    expect((await switchOn("org_789", "high-value-payment", 8)).kind).toBe("switched_on");

    expect((await noticeStalePolicies("org_789")).marked).toStrictEqual([]);
    expect(await statusOf("org_789", "high-value-payment")).toBe("active");
  });
});

describe("switching on (medium)", () => {
  it("DSOR-CTL-02a: a door built without §21.9's question still cannot let user_123 switch on the CFO's control", async () => {
    // Measured by the review: with the stage a no-op, user_123 switched it on, COMMITTED.
    const list: readonly Stage[] = PIPELINE.map((stage) =>
      stage.name === "check the target"
        ? Object.freeze({
            ...stage,
            run: (context: Parameters<Stage["run"]>[0]) => ({ kind: "carry_on" as const, context }),
          })
        : stage,
    );
    const answer = await makeDoor(list)(
      SUPERVISOR,
      "control.activate",
      { control: "dsor://org_456/control/high-value-payment", version: 8 },
      { idempotencyKey: "review-no-target-check" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(await statusOf("org_456", "high-value-payment")).toBe("in_review");
  });

  for (const version of ["8", -1, 1e21]) {
    it(`DSOR-EXE-02: user_123 sending version ${String(version)} is refused at §21.6, and recorded DENY, not ALLOW`, async () => {
      // Measured by the review: §21.9 could not look the control up, carried on, and the log said
      // ALLOW for a person who was not its owner, before the handler refused.
      const answer = await callOperation(
        SUPERVISOR,
        "control.activate",
        { control: "dsor://org_456/control/high-value-payment", version },
        { idempotencyKey: `review-version-${String(version)}` },
      );
      const id = answer.kind === "error" ? answer.envelope.correlation.request_id : "";
      const decision = (await theLog("org_456")).find(
        (r) => r.kind === "decision" && r.correlation.request_id === id,
      );

      expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
      expect(decision?.authorization).toBe("DENY");
    });
  }
});
