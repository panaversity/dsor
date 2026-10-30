// An agent runs no command without a person's delegation (DSOR-DEL-01a in
// specs/dsor/02-security.md, section 13; step 17's README, C4 and decision 5). Step 17 had
// no slips, so line ③ refused every command an agent called. Since step 18 these tests give
// the agent no slip, the case line ③ still refuses (step 18's README, decision 2). The
// slips themselves are tested in slips.test.ts.
import { describe, expect, it, vi } from "vitest";
import { createLog } from "../src/log.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import type { Principal, PrincipalType } from "../src/principals.ts";
import type { Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { NO_SLIPS } from "../src/slips.ts";
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

/** The refusal line ③ gives an agent with no slip in this company. */
function delegationRequired(
  name: string,
  caller: object,
  agent = "accounts-payable-fte",
  tenant = "org_456",
): unknown {
  return {
    code: "DELEGATION_REQUIRED",
    message: needsDelegation(name, agent, tenant),
    retry: "never",
    correlation: correlationFor(caller),
  };
}

/** The shipped operations, writing into these rows, with no slip for any agent. */
function noSlips(rows: Payment[] = [], code: Record<string, Handler> = handlers) {
  return paymentRegistry(rows, shipped, code, NO_SLIPS);
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
  it("DSOR-DEL-01a: with no slip, the agent calling payment.create is refused at line ③", async () => {
    const rows: Payment[] = [];
    const answer = await call(noSlips(rows), createLog(), AGENT, "payment.create", CREATE);
    expect(answer).toStrictEqual(delegationRequired("payment.create", THE_AGENT));
    expect(rows).toStrictEqual([]);
  });

  it("DSOR-DEL-01a: with no slip, the agent calling payment.cancel is refused at line ③, before line ⑤ looks", async () => {
    const answer = await call(noSlips(), createLog(), AGENT, "payment.cancel", CANCEL);
    expect(answer).toStrictEqual(delegationRequired("payment.cancel", THE_AGENT));
  });

  it("DSOR-DEL-01a: the refusal is recorded, with the agent and the operation", async () => {
    const log = createLog();
    const answer = await call(noSlips(), log, AGENT, "payment.create", CREATE);
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
    const on = noSlips([], { ...handlers, "payment.create": spy });
    const lines: number[] = [];
    await call(on, createLog(), AGENT, "payment.create", CREATE, (line) => lines.push(line));
    expect(lines).toStrictEqual([1, 2, 3, 11]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("DSOR-DEL-01a: the firm's agent, with no slip in org_789, is refused there too", async () => {
    const cancel = { payment: "dsor://org_789/payment/PAY-901" };
    const answer = await call(noSlips(), createLog(), FIRM_IN_789, "payment.cancel", cancel);
    expect(answer).toStrictEqual(
      delegationRequired("payment.cancel", THE_FIRM, "firm-ap-fte", "org_789"),
    );
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
    // The shared slips hold none for odd-fte.
    expect(answer).toStrictEqual(
      delegationRequired("payment.create", { agent_id: "odd-fte" }, "odd-fte"),
    );
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

  // Since step 18 a query needs a slip too (DSOR-DEL-07). The shared slips give the agent
  // del_100, which lists invoice:read (step 18's README, decision 2).
  it("step 18's decision 2: the agent's query passes line ③ under its slip", async () => {
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
