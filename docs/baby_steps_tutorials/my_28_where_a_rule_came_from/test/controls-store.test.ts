// STEP 27: the company's controls, in DSoR's own store (decision 162).
//
// Rule DSOR-MOD-01: A DSoR implementation MUST durably own, in a control-plane store separate from
// agent context, its delegations, controls, proposals, approvals, idempotency records, intent
// records, cumulative-limit counters, holds, and audit evidence.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { overPGlite, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { controlsInForce, controlsOf } from "../src/policy-controls.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
});

describe("where controls live", () => {
  it("DSOR-MOD-01: org_456's CFO control is in DSoR's own store, waiting for review", async () => {
    const controls = await controlsOf("org_456");

    expect(controls.map((c) => [c.id, c.version, c.status, c.operation])).toStrictEqual([
      ["high-value-payment", 8, "in_review", "payment.create"],
    ]);
    expect(controls[0]?.record.condition).toBe(
      'dsor_exceeds(input.amount, dsor_money("25000", "USD"))',
    );
    // The record carries its status, as the schema says a control does, from the column.
    expect(controls[0]?.record.status).toBe("in_review");
  });

  it("DSOR-MOD-01: org_789 sees none of org_456's controls", async () => {
    expect(await controlsOf("org_789")).toStrictEqual([]);
  });

  it("DSOR-CTL-02c: a control waiting for review is in force nowhere", async () => {
    expect(await controlsInForce("org_456", "payment.create")).toStrictEqual([]);
  });

  it("DSOR-MOD-01: a control handed out cannot be changed by whoever holds it", async () => {
    const [control] = await controlsOf("org_456");

    expect(Object.isFrozen(control?.record)).toBe(true);
    expect(Object.isFrozen(control?.record.effect)).toBe(true);
  });
});

describe("what the application may do to a control", () => {
  for (const [grant, undo] of [
    [
      "GRANT INSERT ON dsor.controls TO dsor_runtime",
      "REVOKE INSERT ON dsor.controls FROM dsor_runtime",
    ],
    [
      "GRANT UPDATE (record) ON dsor.controls TO dsor_runtime",
      "REVOKE UPDATE (record) ON dsor.controls FROM dsor_runtime",
    ],
    [
      "GRANT UPDATE (operation) ON dsor.controls TO dsor_runtime",
      "REVOKE UPDATE (operation) ON dsor.controls FROM dsor_runtime",
    ],
    [
      "GRANT DELETE ON dsor.controls TO dsor_runtime",
      "REVOKE DELETE ON dsor.controls FROM dsor_runtime",
    ],
    [
      "CREATE ROLE drafter; GRANT UPDATE ON dsor.controls TO drafter; GRANT drafter TO dsor_runtime WITH INHERIT FALSE",
      "REVOKE drafter FROM dsor_runtime; REVOKE ALL ON dsor.controls FROM drafter; DROP ROLE drafter",
    ],
  ] as const) {
    it(`DSOR-MOD-01: start-up refuses: ${grant.slice(0, 60)}`, async () => {
      // A control the application could write is a policy it could rewrite: a condition changed
      // to `false`, or test cases nobody wrote.
      await asTheOwner(() => db.exec(grant));

      try {
        await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
          /may write a control/,
        );
      } finally {
        await asTheOwner(() => db.exec(undo));
      }
    });
  }

  it("DSOR-MOD-01: changing a control's status, which switching it on is, does not refuse start-up", async () => {
    await expect(refuseIfItCanRewriteHistory(overPGlite(db))).resolves.toBeUndefined();
    // Not testing nothing: the application may write the status, and the owner's lock still holds.
    await asTheOwner(async () => {
      const { rows } = await db.query<{ may: boolean }>(
        "SELECT has_column_privilege('dsor_runtime', 'dsor.controls', 'status', 'UPDATE') AS may",
      );
      expect(rows[0]?.may).toBe(true);
    });
  });
});
