// An agent runs no command without a person's delegation, and none exists
// until step 18, so line ③ refuses every command an agent calls (DSOR-DEL-01a in
// specs/dsor/02-security.md, section 13; step 17's README, C4 and decision 5).
import { describe, expect, it, vi } from "vitest";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Principal, PrincipalType } from "../src/principals.ts";
import type { Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  FIRM_IN_789,
  SUPERVISOR,
  THE_AGENT,
  THE_FIRM,
  correlationFor,
  handlers,
  needsDelegation,
  paymentRegistry,
  shipped,
  withPlanted,
} from "./helpers.ts";

const CREATE = { invoice: "dsor://org_456/invoice/INV-1008" };
const CANCEL = { payment: "dsor://org_456/payment/PAY-901" };

/** The refusal line ③ gives an agent for this command. */
function delegationRequired(name: string, caller: object): unknown {
  return {
    code: "DELEGATION_REQUIRED",
    message: needsDelegation(name),
    retry: "never",
    correlation: correlationFor(caller),
  };
}

/** A caller of this type, in org_456, holding every permission of ap_supervisor. */
function plantedOfType(id: string, type: string): Principal {
  return {
    id,
    type: type as PrincipalType,
    clearance: "internal",
    memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
  };
}

describe("C4: an agent's command never runs without an active delegation", () => {
  // Its role grants payment:create, so the permission alone would let it through line ⑤.
  it("DSOR-DEL-01a: the agent calling payment.create is refused, though its role holds payment:create", async () => {
    const rows: Payment[] = [];
    const answer = await call(paymentRegistry(rows), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toStrictEqual(delegationRequired("payment.create", THE_AGENT));
    expect(rows).toStrictEqual([]);
  });

  // Its role does not grant payment:cancel. Line ③ answers before line ⑤ looks.
  it("DSOR-DEL-01a: the agent calling payment.cancel is refused at line ③, before line ⑤ looks at its role", async () => {
    const answer = await call(paymentRegistry([]), createLog(), AGENT, "payment.cancel", CANCEL);
    expect(answer).toStrictEqual(delegationRequired("payment.cancel", THE_AGENT));
  });

  it("DSOR-DEL-01a: the refusal is recorded, with the agent and the operation", async () => {
    const log = createLog();
    const answer = await call(paymentRegistry([]), log, AGENT, "payment.create", CREATE);
    expect(await log.records()).toMatchObject([
      {
        operation: "payment.create@1",
        authorization: "DENY",
        result: "DELEGATION_REQUIRED",
        reason: needsDelegation("payment.create"),
        tenant: "org_456",
        correlation: answer.correlation,
      },
    ]);
  });

  it("DSOR-DEL-01a: line ③ runs after line ②, its code never runs, and nothing after it but the record", async () => {
    const spy = vi.fn<Handler>(() => ({}));
    const on = paymentRegistry([], shipped, { ...handlers, "payment.create": spy });
    const lines: number[] = [];
    await call(on, createLog(), AGENT, "payment.create", CREATE, (line) => lines.push(line));
    expect(lines).toStrictEqual([1, 2, 3, 11]);
    expect(spy).not.toHaveBeenCalled();
  });

  // In org_789 the firm's agent holds ap_supervisor, every payment permission there.
  it("DSOR-DEL-01a: the firm's agent, a supervisor in org_789, is refused there too", async () => {
    const cancel = { payment: "dsor://org_789/payment/PAY-901" };
    const answer = await call(
      paymentRegistry([]),
      createLog(),
      FIRM_IN_789,
      "payment.cancel",
      cancel,
    );
    expect(answer).toStrictEqual(delegationRequired("payment.cancel", THE_FIRM));
  });

  // Step 14's rule: a type DSoR does not know acts as an agent, and is never given more.
  it("DSOR-DEL-01a: a caller whose type DSoR does not know, such as Agent, is refused as an agent", async () => {
    const odd: RequestEnvelope = { token: "tok_planted", tenant: "org_456" };
    const rows: Payment[] = [];
    // Built before the caller is planted: start-up refuses a table of logins that holds a
    // type DSoR does not know (step 14's README, decision 5).
    const on = paymentRegistry(rows);
    const answer = await withPlanted("tok_planted", plantedOfType("odd-fte", "Agent"), () =>
      call(on, createLog(), odd, "payment.create", CREATE),
    );
    expect(answer).toStrictEqual(delegationRequired("payment.create", { agent_id: "odd-fte" }));
    expect(rows).toStrictEqual([]);
  });

  // Decision 5: one rule decides who is an agent. An application is not one, so it runs
  // the command in its own name, as user_123 does.
  it("step 17's decision 5: an application runs a command in its own name", async () => {
    const app: RequestEnvelope = { token: "tok_planted", tenant: "org_456" };
    const rows: Payment[] = [];
    const answer = await withPlanted("tok_planted", plantedOfType("ap-batch", "application"), () =>
      call(paymentRegistry(rows), createLog(), app, "payment.create", CREATE),
    );
    expect(answer).toMatchObject({ semantics: "compensatable", data: { id: "PAY-901" } });
    expect(rows).toHaveLength(1);
  });

  it("step 17's decision 5: user_123, a person, runs payment.create through every line a command reaches", async () => {
    const lines: number[] = [];
    const on = paymentRegistry([]);
    const answer = await call(on, createLog(), SUPERVISOR, "payment.create", CREATE, (line) =>
      lines.push(line),
    );
    expect(answer).toHaveProperty("data");
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 9, 11]);
  });

  // DSOR-DEL-01a is about commands. A query passes line ③ for the agent, as before.
  it("step 17's decision 5: the agent's query passes line ③", async () => {
    const lines: number[] = [];
    const answer = await call(
      paymentRegistry([]),
      createLog(),
      AGENT,
      "invoice.get",
      CREATE,
      (line) => lines.push(line),
    );
    expect(answer).toHaveProperty("data");
    expect(lines).toStrictEqual([1, 2, 3, 5, 6, 9, 11]);
  });
});
