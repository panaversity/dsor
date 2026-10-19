// NEW IN STEP 28: only a control's owner, a person, may switch it on (decision 165).
//
// Switching a control on is a command now, `control.activate`, through the whole pipeline: the
// caller logs in, holds `control:activate`, and the decision is recorded. Both people in the story
// hold the permission; what decides is §21.9, which asks whether the caller is the person the
// control names as its owner. The CFO owns the CFO's control. user_123 does not, and the agent never
// may.
//
// Rule DSOR-CTL-02a: A control MUST be activated, modified, suspended, or retired only by its human
// control owner.
// Rule DSOR-CTL-02b: An agent principal MUST NOT activate a control.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { controlsInForce, controlsOf } from "../src/policy-controls.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";

const CFO = { loggedInAs: "cfo_100", tenant: "org_456" };
const SUPERVISOR = { loggedInAs: "user_123", tenant: "org_456" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const THE_CFOS_CONTROL = "dsor://org_456/control/high-value-payment";

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

const activate = (
  login: { loggedInAs: string; tenant: string },
  control: string,
  version: unknown,
): Promise<OperationAnswer> =>
  callOperation(
    login,
    "control.activate",
    { control, version },
    { idempotencyKey: `activate-${Math.random()}` },
  );

const seen = (answer: OperationAnswer): string =>
  answer.kind === "error"
    ? `${answer.envelope.code}: ${answer.envelope.message}`
    : answer.kind === "result"
      ? answer.envelope.outcome
      : answer.kind;

const statusOf = async (version: number): Promise<string | undefined> =>
  (await controlsOf("org_456")).find((c) => c.id === "high-value-payment" && c.version === version)
    ?.status;

describe("who may switch a control on", () => {
  it("DSOR-CTL-02a: cfo_100, the control's owner, switches the CFO's control on", async () => {
    const answer = await activate(CFO, THE_CFOS_CONTROL, 8);

    expect(seen(answer)).toBe("COMMITTED");
    expect(answer.kind === "result" && answer.envelope.data).toMatchObject({
      uri: THE_CFOS_CONTROL,
      version: 8,
      status: "active",
    });
    expect(
      (await controlsInForce("org_456", "payment.create")).map((c) => c.version),
    ).toStrictEqual([8]);
  });

  it("DSOR-CTL-02a: user_123 holds control:activate, is not its owner, and is refused", async () => {
    expect(seen(await activate(SUPERVISOR, THE_CFOS_CONTROL, 8))).toMatch(
      /^AUTHORIZATION_DENIED: only the owner of high-value-payment may switch it on/,
    );
    expect(await statusOf(8)).toBe("in_review");
  });

  it("DSOR-CTL-02b: the agent may not switch a control on", async () => {
    expect(seen(await activate(AGENT, THE_CFOS_CONTROL, 8))).toMatch(/^AUTHORIZATION_DENIED/);
    expect(await statusOf(8)).toBe("in_review");
  });

  it("DSOR-CTL-02b: not even under a slip that grants control:activate: an agent never switches one on", async () => {
    // §21.5 would let it through: del_100 grants the permission, and its signer holds it. §21.9
    // refuses an agent whatever its slip says, so no slip can be written that lets one.
    await asTheOwner(() =>
      db.exec(
        "UPDATE dsor.delegations SET permissions = permissions || ARRAY['control:activate'] WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    );

    expect(seen(await activate(AGENT, THE_CFOS_CONTROL, 8))).toMatch(
      /^AUTHORIZATION_DENIED: .*an agent never switches a control on/,
    );
    expect(await statusOf(8)).toBe("in_review");
  });

  it("DSOR-ERR-01b: a control that does not exist is refused in the same words as one someone else owns", async () => {
    const none = seen(await activate(CFO, "dsor://org_456/control/no-such-control", 1));
    const notTheirs = seen(await activate(SUPERVISOR, THE_CFOS_CONTROL, 8));

    expect(none.replace("no-such-control", "X").replace(/cfo_100|user_123/, "Y")).toBe(
      notTheirs.replace("high-value-payment", "X").replace(/cfo_100|user_123/, "Y"),
    );
  });

  it("DSOR-EXE-02: switching a control on is a decision, recorded before the answer", async () => {
    const answer = await activate(CFO, THE_CFOS_CONTROL, 8);
    const id = answer.kind === "result" ? answer.envelope.correlation.request_id : "";
    const decision = (await theLog("org_456")).find(
      (r) => r.kind === "decision" && r.correlation.request_id === id,
    );

    expect(decision).toMatchObject({ authorization: "ALLOW", operation: "control.activate@1" });
  });
});

describe("what switching on still asks", () => {
  it("DSOR-CTL-02c: the owner's own control whose cases fail is refused VALIDATION_FAILED", async () => {
    await asTheOwner(() =>
      db.exec(
        `INSERT INTO dsor.controls (tenant, id, version, operation, status, record)
         SELECT tenant, id, 9, operation, 'in_review',
                record || '{"version": 9, "condition": "double(input.amount.value) > 25000.0 && input.amount.currency == \\"USD\\""}'::jsonb
           FROM dsor.controls WHERE tenant = 'org_456' AND id = 'high-value-payment' AND version = 8`,
      ),
    );

    expect(seen(await activate(CFO, THE_CFOS_CONTROL, 9))).toMatch(
      /^VALIDATION_FAILED: high-value-payment v9 failed its own test cases/,
    );
    expect(await statusOf(9)).toBe("in_review");
  });

  it("DSOR-CTL-02c: a control switched on already is a CONFLICT", async () => {
    expect(seen(await activate(CFO, THE_CFOS_CONTROL, 8))).toBe("COMMITTED");
    expect(seen(await activate(CFO, THE_CFOS_CONTROL, 8))).toMatch(/^CONFLICT/);
  });

  for (const version of ["8", 0, 8.5, undefined]) {
    it(`a version that is not a whole number above zero, ${String(version)}, is refused VALIDATION_FAILED`, async () => {
      expect(seen(await activate(CFO, THE_CFOS_CONTROL, version))).toMatch(/^VALIDATION_FAILED/);
    });
  }
});
