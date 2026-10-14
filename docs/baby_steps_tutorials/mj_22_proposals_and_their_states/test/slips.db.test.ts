// Permission slips in the database. The unit tests prove line ③ and line ⑤
// in memory. These prove the table: the story's slips are there, each company sees only its
// own, dsor_runtime only reads them, one slip per agent and company, the database's clock
// decides a slip's date, and the record names the slip (step 18's README, C1, C7, C8, and
// decisions 7, 8, 12, and 13).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import {
  AGENT,
  DEL_100,
  FIRM_IN_789,
  SUPERVISOR,
  UNDER_DEL_100,
  keyed,
  withPlanted,
} from "./helpers.ts";
import { NO_PRIVILEGE, dbRegistry, newPool, ownerSlips, requestId, tryThenRollBack } from "./db.ts";

// The program's own pool, and the test's window into the database, both dsor_runtime.
const pool = newPool();
const observer = newPool();
afterAll(async () => {
  await pool.end();
  await observer.end();
});
const registry = dbRegistry(pool);
const log = createDbLog(pool);

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** An agent of org_456 that only this test knows, with a slip of the owner's making. */
async function withOwnSlip<T>(
  changed: Record<string, unknown>,
  run: (who: { token: string; tenant: string }) => Promise<T>,
): Promise<T> {
  const id = `t18-${randomUUID().slice(0, 8)}`;
  const agent: Principal = {
    id,
    type: "agent",
    clearance: "internal",
    memberships: [{ tenant_id: "org_456", roles: [] }],
  };
  const slip = { ...DEL_100, id: `del_${id}`, delegate: id, ...changed };
  ownerSlips("add", JSON.stringify(slip));
  try {
    return await withPlanted(`tok_${id}`, agent, () =>
      run({ token: `tok_${id}`, tenant: "org_456" }),
    );
  } finally {
    ownerSlips("remove", "org_456", `del_${id}`);
  }
}

describe("the slips, on the database", () => {
  it("DSOR-DEL-01a: the agent drafts a payment under del_100, and its record names the slip and the person", async () => {
    const request_id = requestId("s18-draft");
    const answer = await call(registry, log, keyed({ ...AGENT, request_id }), "payment.create", {
      ...INV_1008,
      expected_version: 1,
    });
    expect(answer).toMatchObject({ data: { status: "draft" }, semantics: "compensatable" });
    // The decision's record. Since step 22 the draft's proposal has records of its own (step
    // 22's README, decision 4).
    const sql = `SELECT result, delegation, identity FROM dsor.audit
                  WHERE correlation->>'request_id' = $1 AND kind = 'decision'`;
    const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
    expect(rows).toStrictEqual([{ result: "ok", ...UNDER_DEL_100 }]);
  });

  it("DSOR-TEN-01b: as dsor_runtime in org_456, org_789's slip is invisible", async () => {
    const sql = `SELECT id, tenant_id FROM dsor.delegations
                  WHERE id IN ('del_100', 'del_101', 'del_102') ORDER BY id`;
    const { rows } = await tryThenRollBack(observer, sql, "org_456");
    expect(rows).toStrictEqual([
      { id: "del_100", tenant_id: "org_456" },
      { id: "del_101", tenant_id: "org_456" },
    ]);
  });

  it("DSOR-TEN-01b: with no company set, dsor_runtime reads no slip at all", async () => {
    const { rows } = await tryThenRollBack(observer, "SELECT id FROM dsor.delegations");
    expect(rows).toStrictEqual([]);
  });

  it.each([
    [
      "INSERT",
      "INSERT INTO dsor.delegations (tenant_id, id, delegator, delegate, modes, permissions, constraints, subdelegation, status, expires_at) VALUES ('org_456', 'del_196', 'user_123', 'accounts-payable-fte', '{unattended}', '{invoice:read}', '{}', '{\"allowed\": false}', 'active', '2099-12-31T23:59:59Z')",
    ],
    [
      "UPDATE",
      "UPDATE dsor.delegations SET permissions = '{invoice:read,payment:create,payment:cancel}' WHERE id = 'del_100'",
    ],
    ["DELETE", "DELETE FROM dsor.delegations WHERE id = 'del_100'"],
  ])("step 18's decision 3: dsor_runtime may not %s a slip", async (_, sql) => {
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("step 18's decision 7: the database refuses a second slip for one agent and company, torn up or not", () => {
    expect(ownerSlips("second")).toStrictEqual({ refused: true, code: "23505" });
  });

  // The owner holds BYPASSRLS, so only DSoR's own WHERE can keep the companies apart here.
  it("DSOR-TEN-01b: DSoR's own filter: the owner, whom no policy stops, gets each company's own slip of firm-ap-fte", () => {
    expect(ownerSlips("store", "org_456", "firm-ap-fte")).toStrictEqual({
      id: "del_101",
      tenant: "org_456",
    });
    expect(ownerSlips("store", "org_789", "firm-ap-fte")).toStrictEqual({
      id: "del_102",
      tenant: "org_789",
    });
  });

  it("step 18's decision 12: the database's clock decides that a slip is past its date", async () => {
    const answer = await withOwnSlip({ expires_at: "2001-01-01T00:00:00Z" }, (who) =>
      call(registry, log, who, "invoice.get", INV_1008),
    );
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });

  // The test above passes with either clock: both call 2001 past. Here the program's clock
  // says 2100, past del_100's 2099, and the database's says today. Found by step 18's review,
  // which made the store read the program's clock and saw every test pass.
  it("step 18's decision 12: in the program's 2100, del_100 still works, because the database's clock decides", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2100-01-01T00:00:00Z"));
    try {
      const answer = await call(registry, log, AGENT, "invoice.get", INV_1008);
      expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    } finally {
      vi.useRealTimers();
    }
  });

  // PostgreSQL keeps times that JavaScript cannot write. Found by step 18's review: these
  // failed with DSoR's message for a bug, by accident, inside slipOf (step 18's README,
  // decision 13).
  it.each(["infinity", "-infinity"])(
    "step 18's decision 13: a slip the database holds with the time %s is not a valid slip",
    async (expires_at) => {
      const answer = await withOwnSlip({ expires_at }, (who) =>
        call(registry, log, who, "invoice.get", INV_1008),
      );
      expect(answer).toMatchObject({
        code: "INTERNAL_ERROR",
        message: "the slip DSoR holds for this agent is not a valid slip",
      });
    },
  );

  // The unit tests prove these rules with slips in memory. A slip from the database reaches
  // line ③ through slipOf, so each rule is proved on that path too. Found by step 18's sweep:
  // slipOf could drop a constraint, a parent, or a mode, with every test green.
  it.each([
    [
      "a per_transaction_limit",
      { constraints: { per_transaction_limit: { value: "100.00", currency: "USD" } } },
      "carries per_transaction_limit",
    ],
    ["a parent, as a sub-slip", { parent: "del_100" }, "is a sub-slip of del_100"],
  ])(
    "DSOR-DEL-02: a slip the database holds with %s gets DELEGATION_REQUIRED",
    async (_, changed, why) => {
      const answer = await withOwnSlip(changed, (who) =>
        call(registry, log, who, "invoice.get", INV_1008),
      );
      expect(answer).toMatchObject({ code: "DELEGATION_REQUIRED" });
      expect((answer as { message: string }).message).toContain(why);
    },
  );

  it("DSOR-DEL-07: a slip the database holds for on_behalf_of only gets DELEGATION_REQUIRED", async () => {
    const answer = await withOwnSlip({ modes: ["on_behalf_of"] }, (who) =>
      call(registry, log, who, "invoice.get", INV_1008),
    );
    expect(answer).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect((answer as { message: string }).message).toContain("does not allow unattended calls");
  });

  it("step 18's decision 13: a slip the database holds whose subdelegation breaks the schema gets INTERNAL_ERROR", async () => {
    const answer = await withOwnSlip({ subdelegation: { allowed: true } }, (who) =>
      call(registry, log, who, "invoice.get", INV_1008),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
  });

  // DSoR's own log must read back what it wrote. Found by step 18's sweep: the raw SQL above
  // proved the row, and DSoR's own reader could drop both fields with every test green.
  it("DSOR-DEL-08: DSoR's own log reads back the agent's record with its slip and its person", async () => {
    const request_id = requestId("s18-read-back");
    await call(registry, log, { ...AGENT, request_id }, "invoice.get", INV_1008);
    const mine = (await log.records("org_456")).filter(
      (record) => record.correlation.request_id === request_id,
    );
    expect(mine).toMatchObject([{ result: "ok", ...UNDER_DEL_100 }]);
  });

  it("step 18's decision 8: DSoR's own log reads back user_123's record with neither field", async () => {
    const request_id = requestId("s18-person");
    await call(registry, log, { ...SUPERVISOR, request_id }, "invoice.get", INV_1008);
    const [record] = (await log.records("org_456")).filter(
      (r) => r.correlation.request_id === request_id,
    );
    expect(record).toBeDefined();
    expect(record).not.toHaveProperty("delegation");
    expect(record).not.toHaveProperty("identity");
  });

  it("step 18's decision 3: the database refuses a slip whose company is not a company id, such as ORG_456", () => {
    const bad = { ...DEL_100, id: "del_bad", tenant: "ORG_456", delegate: "bad-fte" };
    try {
      expect(() => ownerSlips("add", JSON.stringify(bad))).toThrow(/violates check constraint/);
    } finally {
      ownerSlips("remove", "ORG_456", "del_bad");
    }
  });

  // The record's person comes from the slip found, on the database too (DSOR-DEL-08).
  it("DSOR-DEL-08: firm-ap-fte's read in org_789 is recorded under del_102, with user_700 and firm-ap-fte", async () => {
    const request_id = requestId("s18-del-102");
    const answer = await call(registry, log, { ...FIRM_IN_789, request_id }, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toMatchObject({ data: { id: "INV-1008" } });
    const sql = `SELECT result, delegation, identity FROM dsor.audit
                  WHERE correlation->>'request_id' = $1`;
    const { rows } = await tryThenRollBack(observer, sql, "org_789", [request_id]);
    expect(rows).toStrictEqual([
      {
        result: "ok",
        delegation: "del_102",
        identity: {
          mode: "unattended",
          subject: "user_700",
          actor_chain: ["firm-ap-fte"],
          // Where user_700's authority came from, and as of when (step 19's
          // README, decision 7).
          subject_authority: { source: "role_source", as_of: expect.any(String) },
        },
      },
    ]);
  });

  it("step 18's decision 13: a slip the database holds with a status the schema does not know gets INTERNAL_ERROR", async () => {
    const answer = await withOwnSlip({ status: "paused" }, (who) =>
      call(registry, log, who, "invoice.get", INV_1008),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
