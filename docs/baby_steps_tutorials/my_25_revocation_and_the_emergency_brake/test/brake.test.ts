// NEW IN STEP 25: the emergency brake (decision 142).
//
// Rule DSOR-OPS-01a: DSoR MUST provide per-agent suspension and a tenant-wide agent freeze.
// Rule DSOR-OPS-01c: while a suspension or freeze is active, a proposal from an affected agent MUST
// NOT enter EXECUTING.
// Rule DSOR-OPS-01d: a suspension or freeze MUST be lifted only by a human holding control:suspend.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { liftTheBrake, pullTheBrake, whatStops } from "../src/controls.ts";
import { paymentsOf } from "../src/payment.ts";
import { mayReleaseABrake, PIPELINE } from "../src/operations.ts";
import type { Context } from "../src/pipeline.ts";
import {
  moveProposal,
  moveProposalThrough,
  movesOf,
  propose,
  proposalsOf,
  stateOf,
} from "../src/proposal.ts";
import { overPGlite, refuseIfItCanRewriteHistory } from "../src/database.ts";
import { theDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { callOperation, makeDoor } from "./support/door.ts";

const AGENT = "accounts-payable-fte";

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

describe("the brake, in DSoR's own store", () => {
  it("DSOR-OPS-01a: an agent suspended in one company is stopped there, and nowhere else", async () => {
    expect(await whatStops("org_456", AGENT)).toBeUndefined();

    const pulled = await pullTheBrake("org_456", AGENT, "user_123", "paying the wrong invoices");

    expect(pulled.kind).toBe("pulled");
    expect((await whatStops("org_456", AGENT))?.agent).toBe(AGENT);
    expect(await whatStops("org_789", AGENT)).toBeUndefined();
  });

  it("DSOR-OPS-01a: a freeze stops every agent in the company", async () => {
    await pullTheBrake("org_456", undefined, "cfo_100", "month-end close");

    const stops = await whatStops("org_456", AGENT);

    expect(stops?.agent).toBeUndefined();
    expect(stops?.imposedBy).toBe("cfo_100");
    expect(await whatStops("org_456", "another-agent")).toBeDefined();
  });

  it("DSOR-OPS-01a: pulling the brake twice is the same brake, not a second one", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "first");

    expect((await pullTheBrake("org_456", AGENT, "cfo_100", "second")).kind).toBe("already");

    const { rows } = await theDatabase("org_456").query(
      "SELECT id FROM dsor.agent_controls WHERE tenant = 'org_456' AND lifted_at IS NULL",
    );

    expect(rows).toHaveLength(1);
  });

  it("DSOR-OPS-01a: a lifted brake stops nothing, and stays on the record with who lifted it", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "checking");

    expect((await liftTheBrake("org_456", AGENT, "user_123")).kind).toBe("lifted");
    expect(await whatStops("org_456", AGENT)).toBeUndefined();

    const { rows } = await theDatabase("org_456").query<{ lifted_by: string }>(
      "SELECT lifted_by FROM dsor.agent_controls WHERE tenant = 'org_456'",
    );

    expect(rows).toStrictEqual([{ lifted_by: "user_123" }]);
  });

  it("DSOR-OPS-01a: lifting a brake that is not on lifts nothing", async () => {
    expect((await liftTheBrake("org_456", AGENT, "user_123")).kind).toBe("none");
  });

  it("DSOR-OPS-01a: a lift is final, even for the application writing the SQL itself", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "checking");
    await liftTheBrake("org_456", AGENT, "user_123");

    const { rows } = await theDatabase("org_456").query(
      "UPDATE dsor.agent_controls SET lifted_by = 'someone else' WHERE tenant = 'org_456' RETURNING id",
    );

    expect(rows).toStrictEqual([]);
  });

  it("DSOR-OPS-01a: the application may not delete a brake, rewrite who pulled it, or write one already lifted", async () => {
    const { rows } = await db.query<{ right: string }>(
      `SELECT r AS right FROM unnest(ARRAY['DELETE', 'TRUNCATE']) AS r
        WHERE has_table_privilege(current_user, 'dsor.agent_controls', r)
       UNION ALL
       SELECT c || ' ' || p FROM unnest(ARRAY['agent', 'imposed_by', 'imposed_at', 'reason']) AS c,
              unnest(ARRAY['UPDATE']) AS p
        WHERE has_column_privilege(current_user, 'dsor.agent_controls', c, p)
       UNION ALL
       SELECT c || ' INSERT' FROM unnest(ARRAY['id', 'imposed_at', 'lifted_by', 'lifted_at']) AS c
        WHERE has_column_privilege(current_user, 'dsor.agent_controls', c, 'INSERT')`,
    );

    expect(rows).toStrictEqual([]);
  });
});

// NEW IN STEP 25, piece 2: §21.4 asks the brake, for every command.

const AGENT_LOGIN = { loggedInAs: AGENT, tenant: "org_456" };
const SUPERVISOR = { loggedInAs: "user_123" };
const PAY = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "2500.00", currency: "USD" },
};

describe("§21.4: a stopped agent changes nothing", () => {
  it("DSOR-OPS-01a: a suspended agent's command is AGENT_SUSPENDED, recorded, and nothing is made", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "paying the wrong invoices");

    const before = await paymentsOf("org_456");
    const answer = await callOperation(AGENT_LOGIN, "payment.create", PAY);

    expect(answer.kind === "error" && answer.envelope.code).toBe("AGENT_SUSPENDED");
    expect(answer.kind === "error" && answer.envelope.retry).toBe("never");
    expect(await paymentsOf("org_456")).toStrictEqual(before);
    expect((await theLog("org_456")).at(-1)?.result).toBe("AGENT_SUSPENDED");
    // Before §21.8: there was nothing to propose.
    expect(await proposalsOf("org_456")).toStrictEqual([]);
  });

  it("DSOR-OPS-01a: a suspended agent can still read: reading changes nothing", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "paying the wrong invoices");

    const answer = await callOperation(AGENT_LOGIN, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });

    expect(answer.kind).toBe("data");
  });

  it("DSOR-OPS-01a: a freeze stops every agent's command, and no person's", async () => {
    await pullTheBrake("org_456", undefined, "cfo_100", "month-end close");

    const agents = await callOperation(AGENT_LOGIN, "payment.create", PAY);
    const supervisors = await callOperation(SUPERVISOR, "payment.create", PAY);

    expect(agents.kind === "error" && agents.envelope.code).toBe("AGENT_SUSPENDED");
    expect(supervisors.kind).toBe("result");
  });

  it("DSOR-OPS-01a: once the brake is lifted, the agent's command goes through", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "checking");
    await liftTheBrake("org_456", AGENT, "user_123");

    expect((await callOperation(AGENT_LOGIN, "payment.create", PAY)).kind).toBe("result");
  });

  it("DSOR-OPS-01a: the refusal says who pulled the brake, and never why", async () => {
    // The reason is a person's words about the agent, for people; the agent is told it is stopped.
    await pullTheBrake("org_456", AGENT, "user_123", "a secret about the agent");

    const answer = await callOperation(AGENT_LOGIN, "payment.create", PAY);

    expect(answer.kind === "error" && answer.envelope.message).toMatch(/user_123/);
    expect(answer.kind === "error" && answer.envelope.message).not.toMatch(/secret/);
  });
});

// NEW IN STEP 25, piece 3: and again as the proposal moves to EXECUTING.

describe("a brake pulled after §21.4 still stops the handler", () => {
  it("DSOR-OPS-01c: pulled between the decision and the handler, the handler never runs and the proposal never enters EXECUTING", async () => {
    // The brake is pulled by a stage after §21.4, as a person would pull it while the request is on
    // its way: §21.4 found nothing, and the move to EXECUTING must find it.
    const list = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: async (context: Context) => {
              const done = await stage.run(context);

              await pullTheBrake("org_456", AGENT, "user_123", "pulled mid-flight");

              return done;
            },
          })
        : stage,
    );
    let ran = 0;
    const door = makeDoor(list, {
      "payment.create": () => {
        ran += 1;

        throw new Error("the handler ran");
      },
    });
    const answer = await door(AGENT_LOGIN, "payment.create", PAY);

    expect(answer.kind === "error" && answer.envelope.code).toBe("AGENT_SUSPENDED");
    expect(ran).toBe(0);

    const [proposal] = await proposalsOf("org_456");

    expect(proposal?.state).toBe("DENIED");
    expect((await movesOf("org_456", proposal?.id ?? "")).map((m) => m.to)).not.toContain(
      "EXECUTING",
    );
  });

  it("DSOR-OPS-01c: a person's command is not stopped by a brake on the agent", async () => {
    await pullTheBrake("org_456", undefined, "cfo_100", "month-end close");

    expect(
      (
        await callOperation(SUPERVISOR, "invoice.issue", {
          invoice: "dsor://org_456/invoice/INV-1009",
          expected_version: 1,
        })
      ).kind,
    ).toBe("result");
  });
});

// NEW IN STEP 25, piece 4: control.suspend, the brake as a command for people.

const CFO = { loggedInAs: "cfo_100" };
const THE_AGENT = "dsor://org_456/agent/accounts-payable-fte";
const THE_COMPANY = "dsor://org_456/tenant/org_456";

describe("control.suspend: people pull the brake and release it", () => {
  it("DSOR-OPS-01a: user_123 suspends the agent, and the agent's next command is refused", async () => {
    const pulled = await callOperation(SUPERVISOR, "control.suspend", {
      target: THE_AGENT,
      suspended: true,
      reason: "paying the wrong invoices",
    });

    expect(pulled.kind === "result" && pulled.envelope.data?.["suspended"]).toBe(true);

    const refused = await callOperation(AGENT_LOGIN, "payment.create", PAY);

    expect(refused.kind === "error" && refused.envelope.code).toBe("AGENT_SUSPENDED");
  });

  it("DSOR-OPS-01a: cfo_100 freezes every agent in org_456 with the company's own address", async () => {
    await callOperation(CFO, "control.suspend", {
      target: THE_COMPANY,
      suspended: true,
      reason: "month-end close",
    });

    expect((await whatStops("org_456", AGENT))?.agent).toBeUndefined();
    expect((await whatStops("org_456", AGENT))?.imposedBy).toBe("cfo_100");
  });

  it("DSOR-OPS-01d: a person holding control:suspend lifts it, and the agent goes on", async () => {
    await pullTheBrake("org_456", AGENT, "cfo_100", "checking");

    const lifted = await callOperation(SUPERVISOR, "control.suspend", {
      target: THE_AGENT,
      suspended: false,
    });

    expect(lifted.kind === "result" && lifted.envelope.data?.["suspended"]).toBe(false);
    expect((await callOperation(AGENT_LOGIN, "payment.create", PAY)).kind).toBe("result");
  });

  it("DSOR-OPS-01d: the agent cannot pull or release the brake: its slip grants no control:suspend", async () => {
    const answer = await callOperation(AGENT_LOGIN, "control.suspend", {
      target: THE_AGENT,
      suspended: false,
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
  });

  it("DSOR-OPS-01d: an agent whose slip grants control:suspend still cannot release its own brake, even with §21.4 gone", async () => {
    // The slip is changed by its owner to grant the brake, and §21.4 is taken out of the door.
    // STEP 25, decision 143: §21.9 refuses it, a person's to release, and the refusal is on the
    // record as the DENY it is.
    await asTheOwner(() =>
      db.exec(`UPDATE dsor.delegations SET permissions = permissions || ARRAY['control:suspend']
                WHERE tenant = 'org_456' AND id = 'del_100'`),
    );
    await pullTheBrake("org_456", AGENT, "user_123", "checking");

    const withoutTheStage = PIPELINE.map((stage) =>
      stage.name === "check the operational status"
        ? Object.freeze({
            ...stage,
            run: (context: Context) => ({ kind: "carry_on" as const, context }),
          })
        : stage,
    );
    const answer = await makeDoor(withoutTheStage)(AGENT_LOGIN, "control.suspend", {
      target: THE_AGENT,
      suspended: false,
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(answer.kind === "error" && answer.envelope.message).toMatch(/only a person/);
    expect((await theLog("org_456")).at(-1)?.authorization).toBe("DENY");
    expect(await whatStops("org_456", AGENT)).toBeDefined();
  });

  it("DSOR-OPS-01d: only a person may release a brake: never an agent, never a name nobody knows", () => {
    expect(mayReleaseABrake("user_123")).toBe(true);
    expect(mayReleaseABrake("cfo_100")).toBe(true);
    expect(mayReleaseABrake(AGENT)).toBe(false);
    expect(mayReleaseABrake("nobody")).toBe(false);
  });

  it("DSOR-OPS-01a: pulling a brake that is on, or releasing one that is not, changes nothing and says so", async () => {
    await pullTheBrake("org_456", AGENT, "user_123", "checking");

    const again = await callOperation(SUPERVISOR, "control.suspend", {
      target: THE_AGENT,
      suspended: true,
      reason: "again",
    });

    expect(again.kind === "error" && again.envelope.code).toBe("CONFLICT");

    await liftTheBrake("org_456", AGENT, "user_123");

    const none = await callOperation(SUPERVISOR, "control.suspend", {
      target: THE_AGENT,
      suspended: false,
    });

    expect(none.kind === "error" && none.envelope.code).toBe("CONFLICT");
  });

  for (const [what, args, code] of [
    [
      "an invoice as the target",
      { target: "dsor://org_456/invoice/INV-1008", suspended: true, reason: "x" },
      "VALIDATION_FAILED",
    ],
    [
      "an agent nobody knows",
      { target: "dsor://org_456/agent/nobody", suspended: true, reason: "x" },
      "RESOURCE_NOT_FOUND",
    ],
    [
      "a person as the target",
      { target: "dsor://org_456/agent/user_123", suspended: true, reason: "x" },
      "RESOURCE_NOT_FOUND",
    ],
    [
      "another company's address inside its own",
      { target: "dsor://org_456/tenant/org_789", suspended: true, reason: "x" },
      "VALIDATION_FAILED",
    ],
    [
      "suspended that is not true or false",
      { target: THE_AGENT, suspended: "yes", reason: "x" },
      "VALIDATION_FAILED",
    ],
    ["no reason for pulling it", { target: THE_AGENT, suspended: true }, "VALIDATION_FAILED"],
  ] as const) {
    it(`DSOR-OPS-01a: ${what} is refused ${code}, and no brake is pulled`, async () => {
      const answer = await callOperation(SUPERVISOR, "control.suspend", args);

      expect(answer.kind === "error" && answer.envelope.code).toBe(code);
      expect(await whatStops("org_456", AGENT)).toBeUndefined();
    });
  }
});

// NEW IN STEP 25, decision 143: the brake on every way into EXECUTING, and on a prepared command.

describe("no way into EXECUTING forgets the brake", () => {
  /** A proposal of the agent's, at READY. */
  async function aReadyProposal(): Promise<string> {
    const id = await propose({
      tenant: "org_456",
      operation: "payment.create@1",
      mode: "execute",
      payload: "{}",
      payloadHash: "sha256:0",
      requester:
        '{"mode":"unattended","subject":"user_123","actor_chain":["accounts-payable-fte"]}',
      idempotencyKey: `ready-${Math.random()}`,
      actor: AGENT,
      cause: "payment.create@1 invoked",
    });

    await moveProposalThrough("org_456", id, [["PROPOSED", "READY", "allowed"]], "dsor", null);

    return id;
  }

  it("DSOR-OPS-01c: a single move into EXECUTING is refused: entering it asks the brake, and only the path that asks may", async () => {
    const id = await aReadyProposal();

    expect(
      await moveProposal("org_456", id, "READY", "EXECUTING", "dsor", "around the brake"),
    ).toStrictEqual({
      kind: "refused",
    });
    expect(await stateOf("org_456", id)).toBe("READY");
  });

  it("DSOR-OPS-01c: the path into EXECUTING is stopped by a brake on the agent it names, and moves for a person's", async () => {
    const stopped = await aReadyProposal();
    const persons = await aReadyProposal();

    await pullTheBrake("org_456", AGENT, "user_123", "checking");

    expect(
      await moveProposalThrough(
        "org_456",
        stopped,
        [["READY", "EXECUTING", "handed over"]],
        "dsor",
        AGENT,
      ),
    ).toStrictEqual({ kind: "stopped" });
    expect(
      await moveProposalThrough(
        "org_456",
        persons,
        [["READY", "EXECUTING", "handed over"]],
        "dsor",
        null,
      ),
    ).toStrictEqual({ kind: "moved" });
  });

  it("DSOR-OPS-01a: a brake pulled while a prepared command is on its way stops it before READY", async () => {
    // Decision 143: the agent was told READY, and a proposal of a stopped agent waited to be released.
    const list = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: async (context: Context) => {
              const done = await stage.run(context);

              await pullTheBrake("org_456", AGENT, "user_123", "pulled mid-flight");

              return done;
            },
          })
        : stage,
    );
    const answer = await makeDoor(list)(AGENT_LOGIN, "payment.create", PAY, {
      idempotencyKey: "prepared-mid-flight",
      mode: "propose_only",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AGENT_SUSPENDED");
    expect((await proposalsOf("org_456")).map((p) => p.state)).toStrictEqual(["DENIED"]);
  });

  for (const mode of ["propose_only", "validate_only"]) {
    it(`DSOR-OPS-01a: a stopped agent's ${mode} is refused as its execute is`, async () => {
      await pullTheBrake("org_456", AGENT, "user_123", "checking");

      const answer = await callOperation(AGENT_LOGIN, "payment.create", PAY, {
        idempotencyKey: `stopped-${mode}`,
        mode,
      });

      expect(answer.kind === "error" && answer.envelope.code).toBe("AGENT_SUSPENDED");
    });
  }

  it("DSOR-OPS-01d: a person whose login leaves out control:suspend may not pull or release the brake", async () => {
    const answer = await callOperation(
      { loggedInAs: "user_123", scopes: ["invoice:read"] },
      "control.suspend",
      {
        target: THE_AGENT,
        suspended: true,
        reason: "with a narrow login",
      },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
  });
});

describe("the brake's record, hardened", () => {
  it("DSOR-OPS-01a: no agent may be named '*', the freeze's sign", async () => {
    // Decision 143: a brake on '*' made the company's freeze answer "on already", and the agent paid.
    await expect(
      pullTheBrake("org_456", "*", "user_123", "a name that means everyone"),
    ).rejects.toThrow(/check constraint/);
  });

  it("DSOR-OPS-01a: a column added to the brake later, and granted to the application, is refused at start-up", async () => {
    const fresh = await aDatabase();

    await fresh.exec("RESET ROLE");
    await fresh.exec(
      "ALTER TABLE dsor.agent_controls ADD COLUMN note TEXT; GRANT UPDATE (note) ON dsor.agent_controls TO dsor_runtime",
    );
    await fresh.exec("SET ROLE dsor_runtime");

    await expect(refuseIfItCanRewriteHistory(overPGlite(fresh))).rejects.toThrow(
      /may delete a brake/,
    );

    await fresh.close();
  });
});
