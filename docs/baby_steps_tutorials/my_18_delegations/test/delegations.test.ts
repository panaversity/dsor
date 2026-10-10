// NEW IN STEP 18: the permission slip.
//
// The agent's own role reads; every command it sends runs under a slip a person signed, found by DSoR
// from the company and the agent, and its power for that command is the slip's permissions, cut down
// to what the signer holds right now and to what the login's scopes allow (decision 127).
//
// Rule DSOR-DEL-01a: a state-changing command from an agent principal MUST be evaluated under an
// active delegation held in the DSoR control-plane store.
// Rule DSOR-DEL-01b: token claims and scopes MUST NOT widen a delegation.
// Rule DSOR-DEL-02: effective authority MUST be computed at decision time as the intersection of the
// delegator's current authority, the delegation's grants and constraints, and the token scopes.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

let db: PGlite;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await resetTheStory();
  await forgetTheLog("org_456");
});

const owner = (sql: string): Promise<unknown> => asTheOwner(() => db.exec(sql));

/** What a statement as the application did, with org_456 said: "allowed", or PostgreSQL's refusal. */
async function asTheApplication(sql: string): Promise<string> {
  try {
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dsor.tenant_id', 'org_456', true)");
      await tx.query(sql);
    });

    return "allowed";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("the slip, in DSoR's own store", () => {
  it("DSOR-DEL-01a: del_100 is in dsor.delegations: user_123 for the agent, three permissions, 50,000.00 USD a payment", async () => {
    const rows = await asTheOwner(
      async () =>
        (
          await db.query(
            `SELECT tenant, id, delegator, delegate, permissions,
                    per_transaction_limit_value::text AS limit, per_transaction_limit_currency AS currency,
                    status FROM dsor.delegations`,
          )
        ).rows,
    );

    expect(rows).toStrictEqual([
      {
        tenant: "org_456",
        id: "del_100",
        delegator: "user_123",
        delegate: "accounts-payable-fte",
        permissions: ["invoice:issue", "payment:create", "payment:cancel"],
        limit: "50000.00",
        currency: "USD",
        status: "active",
      },
    ]);
  });

  it("DSOR-DEL-01a: one active slip per agent per company, made sure by the database", async () => {
    const second = await asTheOwner(async () => {
      try {
        await db.exec(
          `INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status, expires_at)
           VALUES ('org_456', 'del_101', 'user_123', 'accounts-payable-fte', ARRAY['invoice:issue'],
                   'active', '2099-01-01T00:00:00Z')`,
        );

        return "allowed";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(second).toMatch(/one_active_slip_per_agent/);
  });

  it("DSOR-RP-01b: the slips are under the second lock, forced, and a statement with no company sees none", async () => {
    const { rows } = await db.query<{ on: boolean; forced: boolean }>(
      "SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'dsor.delegations'::regclass",
    );

    expect(rows[0]).toStrictEqual({ on: true, forced: true });
    expect((await db.query("SELECT id FROM dsor.delegations")).rows).toStrictEqual([]);
  });

  it("the application reads the slips and writes none", async () => {
    expect(await asTheApplication("SELECT id FROM dsor.delegations")).toBe("allowed");

    for (const sql of [
      `INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status, expires_at)
       VALUES ('org_456', 'del_999', 'user_123', 'accounts-payable-fte', ARRAY['payment:create'],
               'suspended', '2099-01-01T00:00:00Z')`,
      "UPDATE dsor.delegations SET permissions = ARRAY['payment:approve']",
      "DELETE FROM dsor.delegations",
    ]) {
      expect(await asTheApplication(sql), sql).toMatch(/permission denied for table delegations/);
    }

    // Not testing nothing: the owner may, and the slip is still there afterwards for the others.
    await owner("UPDATE dsor.delegations SET status = 'active' WHERE id = 'del_100'");
  });
});
