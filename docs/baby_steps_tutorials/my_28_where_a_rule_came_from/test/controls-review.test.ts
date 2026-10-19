// STEP 27: what the review of step 27 found, each case measured first (decision 164).
//
// Rule DSOR-CTL-07: When a control condition fails to evaluate, the control's effect MUST apply.
// Rule DSOR-CTL-03b: A stale control MUST NOT be dropped or skipped.
// Rule DSOR-EXE-02: The decision — outcome, controls evaluated, and the reason for any `DENY` — MUST
// be durably recorded before the response is returned.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog, verifyChain } from "../src/audit.ts";
import { pullTheBrake } from "../src/controls.ts";
import { overPGlite, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { callOperation, type OperationAnswer, PIPELINE } from "../src/operations.ts";
import type { Context } from "../src/pipeline.ts";
import { switchOn } from "../src/policy-controls.ts";
import { proposalsOf } from "../src/proposal.ts";
import { usedToday } from "../src/reservation.ts";
import { theDatabase, useDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { makeDoor } from "./support/door.ts";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };
const CFO = { loggedInAs: "cfo_100", tenant: "org_456" };
const INV_1008 = "dsor://org_456/invoice/INV-1008";

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

afterEach(() => {
  useDatabase(overPGlite(db));
});

const pay = (
  login: { loggedInAs: string; tenant: string },
  amount: unknown,
  more: Record<string, unknown> = {},
): Promise<OperationAnswer> =>
  callOperation(
    login,
    "payment.create",
    { invoice: INV_1008, amount },
    { idempotencyKey: `review-${Math.random()}`, ...more },
  );

const codeOf = (answer: OperationAnswer): string =>
  answer.kind === "error"
    ? answer.envelope.code
    : answer.kind === "result"
      ? answer.envelope.outcome
      : answer.kind;

/** The CFO's control's record, as migration 029 wrote it, with these changes. */
async function theCfosRecordWith(changes: Record<string, unknown>): Promise<string> {
  return asTheOwner(async () => {
    const { rows } = await db.query<{ record: Record<string, unknown> }>(
      "SELECT record FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8",
    );

    return JSON.stringify({ ...rows[0]?.record, ...changes });
  });
}

/** A control written straight into force by the owner, as a careless administrator might. */
async function inForce(
  id: string,
  version: number,
  changes: Record<string, unknown>,
): Promise<void> {
  const record = await theCfosRecordWith({ ...changes, id, version });

  await asTheOwner(() =>
    db.query(
      `INSERT INTO dsor.controls (tenant, id, version, operation, status, record, switched_on_at)
       VALUES ('org_456', $1, $2, 'payment.create', 'active', $3::jsonb, now())`,
      [id, version, record],
    ),
  );
}

describe("a malformed amount (high)", () => {
  beforeEach(async () => {
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
  });

  for (const [what, amount] of [
    ["three decimal places", { value: "60000.001", currency: "USD" }],
    ["a bare number", 31400],
    ["no amount at all", undefined],
  ] as const) {
    for (const mode of ["execute", "propose_only", "validate_only"]) {
      it(`DSOR-DEL-02: ${what}, sent ${mode}, is refused at §21.6, and nothing waits for the CFO`, async () => {
        // Measured by the review: each waited at PENDING_APPROVAL, recorded ALLOW, every limit
        // skipped, because the control could not read the amount and applied (decision 164).
        const answer = await pay(AGENT, amount, { mode });

        expect(codeOf(answer)).toBe("VALIDATION_FAILED");
        expect(
          (await proposalsOf("org_456")).filter((p) => p.state === "PENDING_APPROVAL"),
        ).toStrictEqual([]);
      });
    }
  }
});

describe("a control the program may not switch off (medium)", () => {
  it("DSOR-CTL-03b: a control marked stale is still in force, and a payment above the line still waits", async () => {
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.controls SET status = 'stale_authority' WHERE tenant = 'org_456' AND id = 'high-value-payment'",
      ),
    );

    expect(codeOf(await pay(SUPERVISOR, { value: "31400.00", currency: "USD" }))).toBe(
      "PENDING_APPROVAL",
    );
  });

  it("DSOR-CTL-03b: the program cannot retire the CFO's control: the second lock refuses it", async () => {
    // Measured by the review: one UPDATE, and user_123's 31,400.00 USD was made with no CFO.
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");

    // A control in force is not one the policy lets change: the statement touches no row.
    const { rows } = await theDatabase("org_456").query(
      "UPDATE dsor.controls SET status = 'retired' WHERE tenant = $1 AND id = 'high-value-payment' RETURNING id",
      ["org_456"],
    );

    expect(rows).toStrictEqual([]);
    expect(codeOf(await pay(SUPERVISOR, { value: "31400.00", currency: "USD" }))).toBe(
      "PENDING_APPROVAL",
    );
  });

  it("DSOR-CTL-03b: start-up refuses the controls without that policy", async () => {
    await asTheOwner(() => db.exec("DROP POLICY only_switched_on ON dsor.controls"));

    try {
      await expect(refuseIfItCanRewriteHistory(overPGlite(db))).rejects.toThrow(
        /second lock is not on/,
      );
    } finally {
      await asTheOwner(() =>
        db.exec(`CREATE POLICY only_switched_on ON dsor.controls AS RESTRICTIVE FOR UPDATE
                   USING (status IN ('draft', 'in_review'))
                   WITH CHECK (status = 'active' AND switched_on_at IS NOT NULL)`),
      );
    }
  });
});

describe("a control in force that cannot be read (medium and missing tests)", () => {
  // The fresh login's control applies only above the line, where its effect cannot be carried out;
  // the others cannot be read at all, so they refuse whatever the amount.
  for (const [what, changes, value] of [
    ["with no owner", { owner: undefined }, "2500.00"],
    ["with an authority the record cannot name", { authority: { system: "ksor" } }, "2500.00"],
    [
      "asking for a fresh login, which this program cannot do",
      { effect: { require_step_up: { acr: "mfa" } } },
      "31400.00",
    ],
    [
      "whose condition gives an amount, not true or false",
      { condition: "input.amount" },
      "2500.00",
    ],
    [
      "whose condition uses matches",
      { condition: 'input.memo.matches("^([a-z0-9]+\\\\s?)*$")' },
      "2500.00",
    ],
  ] as const) {
    it(`DSOR-CTL-07: a control ${what} refuses the payment POLICY_DENIED, and the decision is recorded`, async () => {
      await inForce("unreadable", 1, changes);

      const answer = await pay(SUPERVISOR, { value, currency: "USD" });

      expect(codeOf(answer)).toBe("POLICY_DENIED");

      const id = answer.kind === "error" ? answer.envelope.correlation.request_id : "";
      const decision = (await theLog("org_456")).find(
        (r) => r.kind === "decision" && r.correlation.request_id === id,
      );

      expect(decision?.controls?.[0]).toMatchObject({ id: "unreadable", outcome: "DENY" });
      // The refusal says which control, and why it stood in for what it could not do.
      expect(answer.kind === "error" && answer.envelope.message).toMatch(
        /unreadable v1 (cannot be read|asks for what this program cannot do)/,
      );
    });
  }
});

describe("the brake, with the controls unreadable (medium)", () => {
  it("DSOR-OPS-01a: the brake is pulled though the controls cannot be read: no control governs it", async () => {
    // Measured by the review: control.suspend was refused EVIDENCE_STORE_UNAVAILABLE.
    await asTheOwner(() => db.exec("REVOKE SELECT ON dsor.controls FROM dsor_runtime"));

    try {
      const answer = await callOperation(
        CFO,
        "control.suspend",
        {
          target: "dsor://org_456/agent/accounts-payable-fte",
          suspended: true,
          reason: "checking the controls",
        },
        { idempotencyKey: "review-brake" },
      );

      expect(codeOf(answer)).toBe("COMMITTED");
    } finally {
      await asTheOwner(() => db.exec("GRANT SELECT ON dsor.controls TO dsor_runtime"));
    }
  });

  it("DSOR-OPS-01a: no control is switched on for one of DSoR's own commands", async () => {
    await asTheOwner(async () => {
      const record = await theCfosRecordWith({
        id: "stop-the-brake",
        version: 1,
        operation: "control.suspend",
      });

      await db.query(
        `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
         VALUES ('org_456', 'stop-the-brake', 1, 'control.suspend', 'in_review', $1::jsonb)`,
        [record],
      );
    });

    const switched = await switchOn("org_456", "stop-the-brake", 1);

    expect(switched.kind === "refused" && switched.why).toMatch(/DSoR's own commands/);
  });
});

describe("what the cases prove (missing tests and low)", () => {
  it("DSOR-CTL-02e: a case's own pinned rate is the one used: 6,000,000.00 PKR at 100 needs the CFO", async () => {
    // At 280 it is 21,428.57 USD and ALLOW; at the 100 this case pins, 60,000.00 USD.
    const record = await theCfosRecordWith({
      version: 14,
      tests: [
        {
          input: { amount: { value: "6000000.00", currency: "PKR" } },
          rates: { PKR: "100" },
          expect: "REQUIRE_APPROVAL",
        },
      ],
    });

    await asTheOwner(() =>
      db.query(
        `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
         VALUES ('org_456', 'high-value-payment', 14, 'payment.create', 'in_review', $1::jsonb)`,
        [record],
      ),
    );

    expect((await switchOn("org_456", "high-value-payment", 14)).kind).toBe("switched_on");
  });

  it("DSOR-CTL-02c: a case that passes only because its condition could not be evaluated fails", async () => {
    // `input.amout`, misspelled, is never there: every case expecting approval passed, and then
    // every payment waited for the CFO. Only a case in XXX, no currency, may pass that way.
    const record = await theCfosRecordWith({
      version: 15,
      condition: 'dsor_exceeds(input.amout, dsor_money("25000", "USD"))',
      tests: [
        { input: { amount: { value: "25000.01", currency: "USD" } }, expect: "REQUIRE_APPROVAL" },
      ],
    });

    await asTheOwner(() =>
      db.query(
        `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
         VALUES ('org_456', 'high-value-payment', 15, 'payment.create', 'in_review', $1::jsonb)`,
        [record],
      ),
    );

    const switched = await switchOn("org_456", "high-value-payment", 15);

    expect(switched.kind === "refused" && switched.why).toMatch(
      /only because it could not be evaluated/,
    );
  });

  it("DSOR-CTL-05: the door hands a condition the eight variables as DSoR established them", async () => {
    // A control on who is asking, written in force: it refuses the agent under del_100, and
    // not user_123, who has no slip.
    await inForce("who-is-asking", 1, {
      condition:
        'principal.type == "agent" && principal.roles == ["ap_worker"] && ' +
        'actor_chain == ["accounts-payable-fte"] && delegation.id == "del_100" && ' +
        'delegation.delegator == "user_123" && tenant.id == "org_456" && risk == "medium" && ' +
        'state == {} && now > timestamp("2026-01-01T00:00:00Z")',
      effect: { deny: { reason: "agents pay nothing this week" } },
    });

    expect(codeOf(await pay(AGENT, { value: "2500.00", currency: "USD" }))).toBe("POLICY_DENIED");
    expect(codeOf(await pay(SUPERVISOR, { value: "2500.00", currency: "USD" }))).toBe("COMMITTED");
  });

  it("DSOR-EXE-02: the controls are inside the record's hash", async () => {
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
    await pay(SUPERVISOR, { value: "31400.00", currency: "USD" });
    expect(verifyChain(await theLog("org_456"))).toBe(true);

    await asTheOwner(() =>
      db.exec(
        `UPDATE dsor.audit SET controls = jsonb_set(controls, '{0,outcome}', '"ALLOW"')
          WHERE tenant = 'org_456' AND controls IS NOT NULL`,
      ),
    );

    expect(verifyChain(await theLog("org_456"))).toBe(false);
  });
});

describe("the move to PENDING_APPROVAL (missing tests)", () => {
  beforeEach(async () => {
    expect((await switchOn("org_456", "high-value-payment", 8)).kind).toBe("switched_on");
  });

  it("DSOR-OPS-01a: a brake pulled after the decision stops the move to PENDING_APPROVAL, and books nothing", async () => {
    const list = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: async (context: Context) => {
              const done = await stage.run(context);

              await pullTheBrake(
                "org_456",
                "accounts-payable-fte",
                "user_123",
                "pulled mid-flight",
              );

              return done;
            },
          })
        : stage,
    );
    const answer = await makeDoor(list)(
      AGENT,
      "payment.create",
      { invoice: INV_1008, amount: { value: "31400.00", currency: "USD" } },
      { idempotencyKey: "review-mid-flight" },
    );

    expect(codeOf(answer)).toBe("AGENT_SUSPENDED");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });

  for (const readsFail of [false, true]) {
    it(`DSOR-IDM-01c: a move to PENDING_APPROVAL whose reply is lost ${readsFail ? "and cannot be read back is OUTCOME_UNKNOWN, its key kept" : "is read back, and the payment waits"}`, async () => {
      const connection = overPGlite(db);
      let lost = false;

      useDatabase({
        async query<T>(sql: string, params?: unknown[], tenant?: string) {
          if (
            !lost &&
            sql.includes("INSERT INTO dsor.proposal_moves") &&
            params?.includes("PENDING_APPROVAL")
          ) {
            lost = true;
            await connection.query(sql, params, tenant);

            throw Object.assign(new Error("the reply was lost"), { code: "ECONNRESET" });
          }

          if (
            lost &&
            ((readsFail && sql.includes("SELECT m.to_state FROM dsor.proposal_moves")) ||
              sql.includes("SELECT record_hash FROM dsor.audit WHERE record_id"))
          ) {
            throw Object.assign(new Error("the store went away"), { code: "ECONNRESET" });
          }

          return connection.query<T>(sql, params, tenant);
        },
      });

      const request = { idempotencyKey: `review-lost-${readsFail}` };
      let answer: OperationAnswer;

      try {
        answer = await pay(SUPERVISOR, { value: "31400.00", currency: "USD" }, request);
      } finally {
        useDatabase(connection);
      }

      expect(codeOf(answer)).toBe(readsFail ? "OUTCOME_UNKNOWN" : "PENDING_APPROVAL");
      expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual([
        "PENDING_APPROVAL",
      ]);

      // Sent again with its key: the same answer, and no second proposal.
      const again = await pay(SUPERVISOR, { value: "31400.00", currency: "USD" }, request);

      expect(codeOf(again)).toBe(codeOf(answer));
      expect(await proposalsOf("org_456")).toHaveLength(1);
    });
  }
});
