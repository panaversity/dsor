// NEW IN STEP 19: unattended mode, and the role source.
//
// At 2 a.m. nobody is logged in. The agent logs in as itself, and DSoR reads whose authority it
// carries from the slip, never from the request; a company directory says whether that person still
// holds the job; and the record says all of it (decision 129).
//
// Rule DSOR-DEL-07: an unattended request MUST be accepted only under a delegation whose modes
// include unattended.
// Rule DSOR-DEL-08: in unattended mode DSoR MUST take the subject from the delegation record, never
// from the request.
// Rule DSOR-IDN-05: each tenant MUST configure a role source from which DSoR can read the current
// roles of a principal who is not present in the request.
// Rule DSOR-IDN-06: when the delegator's current authority cannot be established within the
// staleness bound, DSoR MUST deny the command.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ErrorEnvelope } from "../src/envelopes.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const PAY_901 = "dsor://org_456/payment/PAY-901";

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

function refusalOf(answer: OperationAnswer): ErrorEnvelope {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  }

  return answer.envelope;
}

const cancel = (login: object, args: object = {}): Promise<OperationAnswer> =>
  callOperation(login as never, "payment.cancel", { payment: PAY_901, ...args });

describe("a slip says in which modes it may be used", () => {
  it("DSOR-DEL-07: del_100 allows unattended, and the agent's command runs", async () => {
    expect((await cancel(AGENT)).kind).toBe("result");
  });

  it("DSOR-DEL-07: a slip that does not allow unattended is no slip for the agent alone at night", async () => {
    await asTheOwner(() =>
      db.exec("UPDATE dsor.delegations SET modes = ARRAY['on_behalf_of'] WHERE id = 'del_100'"),
    );

    const refusal = refusalOf(await cancel(AGENT));

    expect(refusal.code).toBe("DELEGATION_REQUIRED");
    expect(refusal.message).toMatch(/unattended/);
  });

  it("DSOR-DEL-07: a slip's modes are never empty, and only the two the specification names", async () => {
    for (const modes of ["ARRAY[]::text[]", "ARRAY['at_night']"]) {
      const answer = await asTheOwner(async () => {
        try {
          await db.exec(`UPDATE dsor.delegations SET modes = ${modes} WHERE id = 'del_100'`);

          return "allowed";
        } catch (error) {
          return (error as Error).message;
        }
      });

      expect(answer, modes).toMatch(/check constraint/);
    }
  });
});
