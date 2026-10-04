// NEW IN STEP 18: permission slips in the database. The unit tests prove line ③ and line ⑤
// in memory. These prove the table: the story's slips are there, each company sees only its
// own, dsor_runtime only reads them, one slip per agent and company, the database's clock
// decides a slip's date, and the record names the slip (step 18's README, C1, C7, C8, and
// decisions 7, 8, 12, and 13).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { call } from "../src/pipeline.ts";
import { createDbLog } from "../src/postgres.ts";
import type { Principal } from "../src/principals.ts";
import { AGENT, DEL_100, withPlanted } from "./helpers.ts";
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
    return await withPlanted(`tok_${id}`, agent, () => run({ token: `tok_${id}`, tenant: "org_456" }));
  } finally {
    ownerSlips("remove", "org_456", `del_${id}`);
  }
}

describe("the slips, on the database", () => {
  it("DSOR-DEL-01a: the agent drafts a payment under del_100, and its record names the slip and the person", async () => {
    const request_id = requestId("s18-draft");
    const answer = await call(registry, log, { ...AGENT, request_id }, "payment.create", INV_1008);
    expect(answer).toMatchObject({ data: { status: "draft" }, semantics: "compensatable" });
    const sql = `SELECT result, delegation, identity FROM dsor.audit
                  WHERE correlation->>'request_id' = $1`;
    const { rows } = await tryThenRollBack(observer, sql, "org_456", [request_id]);
    expect(rows).toStrictEqual([
      {
        result: "ok",
        delegation: "del_100",
        identity: { mode: "unattended", subject: "user_123", actor_chain: ["accounts-payable-fte"] },
      },
    ]);
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
    ["INSERT", "INSERT INTO dsor.delegations (tenant_id, id, delegator, delegate, modes, permissions, constraints, subdelegation, status, expires_at) VALUES ('org_456', 'del_196', 'user_123', 'accounts-payable-fte', '{unattended}', '{invoice:read}', '{}', '{\"allowed\": false}', 'active', '2099-12-31T23:59:59Z')"],
    ["UPDATE", "UPDATE dsor.delegations SET permissions = '{invoice:read,payment:create,payment:cancel}' WHERE id = 'del_100'"],
    ["DELETE", "DELETE FROM dsor.delegations WHERE id = 'del_100'"],
  ])("step 18's decision 3: dsor_runtime may not %s a slip", async (_, sql) => {
    await expect(tryThenRollBack(observer, sql, "org_456")).rejects.toMatchObject(NO_PRIVILEGE);
  });

  it("step 18's decision 7: the database refuses a second slip for one agent and company, torn up or not", () => {
    expect(ownerSlips("second")).toStrictEqual({ refused: true, code: "23505" });
  });

  // The owner holds BYPASSRLS, so only DSoR's own WHERE can keep the companies apart here.
  it("DSOR-TEN-01b: DSoR's own filter: the owner, whom no policy stops, gets each company's own slip of firm-ap-fte", () => {
    expect(ownerSlips("store", "org_456", "firm-ap-fte")).toStrictEqual({ id: "del_101", tenant: "org_456" });
    expect(ownerSlips("store", "org_789", "firm-ap-fte")).toStrictEqual({ id: "del_102", tenant: "org_789" });
  });

  it("step 18's decision 12: the database's clock decides that a slip is past its date", async () => {
    const answer = await withOwnSlip({ expires_at: "2001-01-01T00:00:00Z" }, (who) =>
      call(registry, log, who, "invoice.get", INV_1008),
    );
    expect(answer).toMatchObject({ code: "DELEGATION_EXPIRED" });
  });

  it("step 18's decision 13: a slip the database holds with a status the schema does not know gets INTERNAL_ERROR", async () => {
    const answer = await withOwnSlip({ status: "paused" }, (who) =>
      call(registry, log, who, "invoice.get", INV_1008),
    );
    expect(answer).toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
