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
import { PIPELINE } from "../src/operations.ts";
import type { Context } from "../src/pipeline.ts";
import { movesOf, proposalsOf } from "../src/proposal.ts";
import { theDatabase } from "../src/store.ts";
import { aDatabase, resetTheStory } from "./support/database.ts";
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
