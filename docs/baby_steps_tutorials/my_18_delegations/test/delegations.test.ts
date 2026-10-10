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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { rolesOfThisProgram, useRoleSource } from "../src/authority.ts";
import type { ErrorEnvelope } from "../src/envelopes.ts";
import { overPGlite } from "../src/database.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { useDatabase, type Database } from "../src/store.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";
const INV_1009 = "dsor://org_456/invoice/INV-1009";
const PAY_901 = "dsor://org_456/payment/PAY-901";
const AMOUNT = Object.freeze({ value: "31400.00", currency: "USD" });

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

afterEach(() => {
  useRoleSource(undefined);
});

function refusalOf(answer: OperationAnswer): ErrorEnvelope {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  }

  return answer.envelope;
}

const create = (login: object, amount: object = AMOUNT): Promise<OperationAnswer> =>
  callOperation(login as never, "payment.create", { invoice: INV_1008, amount });

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

  it("DSOR-DEL-01a: two active slips are refused, never chosen between", async () => {
    // Decision 128: the index made sure of one, and nothing asked again. With the index dropped and a
    // second slip with no limit beside del_100, a review's 60,000.00 USD payment was committed.
    await owner("DROP INDEX dsor.one_active_slip_per_agent");

    try {
      await owner(
        `INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status, expires_at)
         VALUES ('org_456', 'del_050', 'user_123', 'accounts-payable-fte', ARRAY['payment:create'],
                 'active', '2099-12-31T23:59:59Z')`,
      );

      const refusal = refusalOf(await create(AGENT, { value: "60000.00", currency: "USD" }));

      expect(refusal.code).toBe("DELEGATION_REQUIRED");
      expect(refusal.message).toMatch(/del_050, del_100/);
    } finally {
      await owner("DELETE FROM dsor.delegations WHERE id = 'del_050'");
      await owner(
        "CREATE UNIQUE INDEX one_active_slip_per_agent ON dsor.delegations (tenant, delegate) WHERE status = 'active'",
      );
    }
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

describe("an agent's command runs under its slip", () => {
  it("DSOR-DEL-01a: the agent makes a payment under del_100", async () => {
    expect((await create(AGENT)).kind).toBe("result");
  });

  it("DSOR-DEL-01a: with no active slip, the agent's command is refused, and the refusal is recorded", async () => {
    await owner("UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_100'");

    const refusal = refusalOf(await create(AGENT));

    expect(refusal.code).toBe("DELEGATION_REQUIRED");
    expect(refusal.retry).toBe("never");

    const decisions = (await theLog("org_456")).filter((r) => r.kind === "decision");

    expect(decisions.map((r) => `${r.operation} ${r.authorization} ${r.result}`)).toStrictEqual([
      "payment.create@1 DENY DELEGATION_REQUIRED",
    ]);
  });

  it("DSOR-DEL-01a: an expired slip is refused as expired", async () => {
    await owner(
      "UPDATE dsor.delegations SET expires_at = '2020-01-01T00:00:00Z' WHERE id = 'del_100'",
    );

    expect(refusalOf(await create(AGENT)).code).toBe("DELEGATION_EXPIRED");
  });

  it("DSOR-DEL-01a: an expiry this program cannot read is not in force: a year after 9999 is refused", async () => {
    // Decision 128: `NaN <= now` is false, so an expiry JavaScript cannot read passed as not
    // expired, and a review committed a payment under it.
    await owner(
      "UPDATE dsor.delegations SET expires_at = '10000-01-01T00:00:00Z' WHERE id = 'del_100'",
    );

    expect(refusalOf(await create(AGENT)).code).toBe("DELEGATION_EXPIRED");
  });

  it("DSOR-DEL-01a: the table refuses an expiry that is no time at all", async () => {
    // Decision 128: `-infinity` came back from the database as no time, and the slip passed.
    for (const never of ["infinity", "-infinity"]) {
      const answer = await asTheOwner(async () => {
        try {
          await db.exec(`UPDATE dsor.delegations SET expires_at = '${never}' WHERE id = 'del_100'`);

          return "allowed";
        } catch (error) {
          return (error as Error).message;
        }
      });

      expect(answer, never).toMatch(/check constraint/);
    }
  });

  it("the agent's reads need no slip: its own role reads", async () => {
    await owner("UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_100'");

    expect((await callOperation(AGENT, "invoice.get", { invoice: INV_1008 })).kind).toBe("data");
  });

  it("a person's command needs no slip: a person's power is their role's", async () => {
    await owner("UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_100'");

    expect((await create(SUPERVISOR)).kind).toBe("result");
  });
});

describe("when the slip, or what its signer holds, cannot be read", () => {
  // Decision 128: both left the door as a thrown error, with nothing recorded. Nothing has run at
  // §21.3, so the refusal is safe to send again, and §21.11 records it like any other.
  const decisions = async (): Promise<string[]> =>
    (await theLog("org_456")).filter((r) => r.kind === "decision").map((r) => r.result);

  /** The database, with one kind of statement failing, until `run` is done. */
  async function withTheStoreFailing<T>(
    fails: (sql: string) => boolean,
    run: () => Promise<T>,
  ): Promise<T> {
    const real = overPGlite(db);
    const failing: Database = {
      query: (sql, params, tenant) =>
        fails(sql)
          ? Promise.reject(new Error("connection terminated"))
          : real.query(sql, params, tenant),
    };

    useDatabase(failing);

    try {
      return await run();
    } finally {
      useDatabase(real);
    }
  }

  it("DSOR-IDN-06: what the signer holds cannot be read, so the command is refused, safe to send again, and recorded", async () => {
    useRoleSource(() => {
      throw new Error("the directory did not answer");
    });

    const refusal = refusalOf(await create(AGENT));

    expect(refusal.code).toBe("DEPENDENCY_TIMEOUT");
    expect(refusal.retry).toBe("safe_same_key");
    expect(await decisions()).toStrictEqual(["DEPENDENCY_TIMEOUT"]);
  });

  it("DSOR-EXE-02: the slip cannot be read, so the command is refused, and the refusal is recorded", async () => {
    const answer = await withTheStoreFailing(
      (sql) => sql.includes("dsor.delegations"),
      () => create(AGENT),
    );

    expect(refusalOf(answer).code).toBe("DEPENDENCY_TIMEOUT");
    expect(await decisions()).toStrictEqual(["DEPENDENCY_TIMEOUT"]);
  });

  it("DSOR-EXE-03b: with the database down, the agent is told what a person is told", async () => {
    for (const login of [SUPERVISOR, AGENT]) {
      const answer = await withTheStoreFailing(
        () => true,
        () => create(login),
      );

      expect(refusalOf(answer).code, login.loggedInAs).toBe("EVIDENCE_STORE_UNAVAILABLE");
    }

    expect(await decisions()).toStrictEqual([]);
  });
});

describe("the agent never has more power than the person who signed, right now", () => {
  it("DSOR-DEL-02: removing a permission from user_123 removes it from the agent on the next request", async () => {
    // The step's "done when". The same slip, the same agent, one request apart: only what user_123
    // holds changed in between.
    expect((await create(AGENT)).kind).toBe("result");

    useRoleSource((person, tenant) =>
      person === "user_123"
        ? ["invoice:read", "invoice:issue", "payment:cancel"]
        : rolesOfThisProgram(person, tenant),
    );

    const refusal = refusalOf(await create(AGENT));

    expect(refusal.code).toBe("AUTHORIZATION_DENIED");
    expect(refusal.message).toMatch(/payment:create/);
  });

  it("DSOR-DEL-02: a permission the slip does not grant is not the agent's, whatever the signer holds", async () => {
    await owner(
      "UPDATE dsor.delegations SET permissions = ARRAY['payment:create', 'payment:cancel'] WHERE id = 'del_100'",
    );

    // user_123 may issue invoices; the slip no longer lets the agent.
    expect(refusalOf(await callOperation(AGENT, "invoice.issue", { invoice: INV_1009 })).code).toBe(
      "AUTHORIZATION_DENIED",
    );
  });

  it("DSOR-DEL-01b: a scope the slip does not grant adds nothing", async () => {
    await owner(
      "UPDATE dsor.delegations SET permissions = ARRAY['payment:create', 'payment:cancel'] WHERE id = 'del_100'",
    );

    const scoped = { ...AGENT, scopes: ["invoice:issue", "payment:create"] };

    expect(
      refusalOf(await callOperation(scoped, "invoice.issue", { invoice: INV_1009 })).code,
    ).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-DEL-01b: scopes narrow: a slip permission the scopes leave out is not held", async () => {
    const scoped = { ...AGENT, scopes: ["payment:cancel"] };

    expect(refusalOf(await create(scoped)).code).toBe("AUTHORIZATION_DENIED");
    expect((await callOperation(scoped, "payment.cancel", { payment: PAY_901 })).kind).toBe(
      "result",
    );
  });
});

describe("a slip lends only what its signer holds in its own company", () => {
  it("DSOR-DEL-02: a slip in org_789, signed by user_123, who belongs to org_456, grants nothing", async () => {
    // Asked of the signer in the slip's company: user_123 holds invoice:issue in org_456 and
    // nothing in org_789, so the agent may not issue there however the slip reads.
    await owner(
      `INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status, expires_at)
       VALUES ('org_789', 'del_789', 'user_123', 'accounts-payable-fte', ARRAY['invoice:issue'],
               'active', '2099-12-31T23:59:59Z')`,
    );

    const answer = await callOperation(
      { loggedInAs: "accounts-payable-fte", tenant: "org_789" },
      "invoice.issue",
      { invoice: "dsor://org_789/invoice/INV-1009" },
    );

    expect(refusalOf(answer).code).toBe("AUTHORIZATION_DENIED");
  });
});

describe("up to a limit", () => {
  it("DSOR-DEL-02: 50,000.00 USD is within del_100's limit, and 50,000.01 is not", async () => {
    expect((await create(AGENT, { value: "50000.00", currency: "USD" })).kind).toBe("result");

    const refusal = refusalOf(await create(AGENT, { value: "50000.01", currency: "USD" }));

    // DSOR-DEL-06e's code for a command that would exceed a limit; decision 127 said
    // AUTHORIZATION_DENIED with no reason, and decision 128 found none.
    expect(refusal.code).toBe("LIMIT_EXCEEDED");
    expect(refusal.message).toMatch(/50000\.00 USD/);
  });

  it("DSOR-DEL-02: 100,000.00 is above the limit, though as text it sorts before 50,000.00", async () => {
    // Compared in cents, never as text: "100000.00" < "50000.00" as strings, because "1" < "5".
    // Nothing else here would notice a limit compared that way.
    expect(refusalOf(await create(AGENT, { value: "100000.00", currency: "USD" })).code).toBe(
      "LIMIT_EXCEEDED",
    );
  });

  it("DSOR-DEL-02: an amount in another currency cannot be compared with the limit, so it is refused", async () => {
    // DSOR-MON-04's rule for a comparison that cannot convert: the limit is treated as exceeded.
    expect(refusalOf(await create(AGENT, { value: "10.00", currency: "EUR" })).code).toBe(
      "LIMIT_EXCEEDED",
    );
  });

  it("the limit is the slip's, not the person's: user_123 may make a payment above it", async () => {
    expect((await create(SUPERVISOR, { value: "75000.00", currency: "USD" })).kind).toBe("result");
  });
});

describe("a slip named in the arguments", () => {
  // NEW IN STEP 18: DSOR-SRC-02b names a delegation identifier beside the company and the person.
  // DSoR finds the slip itself; a request that names one is making a claim, and a claim that
  // disagrees with the slip DSoR found is refused and recorded (decision 127).
  it("DSOR-SRC-02b: an agent's request that names another slip is refused, and naming its own changes nothing", async () => {
    const other = refusalOf(
      await callOperation(AGENT, "payment.cancel", { payment: PAY_901, delegation: "del_999" }),
    );

    expect(other.code).toBe("AUTHORIZATION_DENIED");
    expect(
      (await callOperation(AGENT, "payment.cancel", { payment: PAY_901, delegation: "del_100" }))
        .kind,
    ).toBe("result");
  });

  it("DSOR-SRC-02b: a person's request that names a slip is refused: a person acts under none", async () => {
    expect(
      refusalOf(
        await callOperation(SUPERVISOR, "payment.cancel", {
          payment: PAY_901,
          delegation: "del_100",
        }),
      ).code,
    ).toBe("AUTHORIZATION_DENIED");
  });
});
