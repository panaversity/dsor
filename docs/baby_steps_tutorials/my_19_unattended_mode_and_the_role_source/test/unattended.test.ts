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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog, verifyChain, type AuditRecord } from "../src/audit.ts";
import { aDirectory, useDirectory } from "../src/directory.ts";
import type { ErrorEnvelope } from "../src/envelopes.ts";
import { callOperation, type OperationAnswer } from "../src/operations.ts";
import { aDatabase, asTheOwner, forgetTheLog, resetTheStory } from "./support/database.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
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

afterEach(() => {
  useDirectory("org_456", undefined);
});

function refusalOf(answer: OperationAnswer): ErrorEnvelope {
  if (answer.kind !== "error") {
    throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  }

  return answer.envelope;
}

const cancel = (login: object, args: object = {}): Promise<OperationAnswer> =>
  callOperation(login as never, "payment.cancel", { payment: PAY_901, ...args });

const hoursAgo = (hours: number): string =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

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

describe("the company directory", () => {
  it("DSOR-IDN-06: with the directory switched off, the agent is refused, not waved through", async () => {
    // The map's "break it", as a test.
    useDirectory("org_456", aDirectory("org_456", { down: true }));

    const refusal = refusalOf(await cancel(AGENT));

    expect(refusal.code).toBe("DEPENDENCY_TIMEOUT");
    expect(refusal.retry).toBe("safe_same_key");
    expect(refusal.message).toMatch(/did not answer/);
  });

  it("DSOR-IDN-06: an answer older than 24 hours is no answer", async () => {
    useDirectory("org_456", aDirectory("org_456", { asOf: hoursAgo(25) }));

    expect(refusalOf(await cancel(AGENT)).code).toBe("DEPENDENCY_TIMEOUT");
  });

  it("DSOR-IDN-06: an answer from 23 hours ago still counts", async () => {
    useDirectory("org_456", aDirectory("org_456", { asOf: hoursAgo(23) }));

    expect((await cancel(AGENT)).kind).toBe("result");
  });

  it("DSOR-IDN-06: an answer whose time is not a time is no answer", async () => {
    useDirectory("org_456", aDirectory("org_456", { asOf: "yesterday" }));

    expect(refusalOf(await cancel(AGENT)).code).toBe("DEPENDENCY_TIMEOUT");
  });

  it("DSOR-IDN-05: a company with no directory is refused every agent command", async () => {
    useDirectory("org_456", null);

    expect(refusalOf(await cancel(AGENT)).code).toBe("DEPENDENCY_TIMEOUT");
  });

  it("DSOR-IDN-06: what the directory says now is what counts: user_123 moved, and the agent is refused", async () => {
    expect((await cancel(AGENT)).kind).toBe("result");

    await resetTheStory();
    useDirectory("org_456", aDirectory("org_456", { holds: { user_123: ["invoice:read"] } }));

    expect(refusalOf(await cancel(AGENT)).code).toBe("AUTHORIZATION_DENIED");
  });

  it("a person who is logged in needs no directory: the directory down, user_123 still cancels", async () => {
    useDirectory("org_456", aDirectory("org_456", { down: true }));

    expect((await cancel(SUPERVISOR)).kind).toBe("result");
  });
});

describe("whose authority the record says", () => {
  const decisions = async (): Promise<AuditRecord[]> =>
    (await theLog("org_456")).filter((r) => r.kind === "decision");

  it("DSOR-DEL-08: the subject is the slip's signer, the agent is in the actor chain, and the slip is named", async () => {
    const asOf = hoursAgo(1);

    useDirectory("org_456", aDirectory("org_456", { asOf }));
    await cancel(AGENT);

    const [decision] = await decisions();

    expect(decision?.identity).toStrictEqual({
      mode: "unattended",
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      subject_authority: { source: "role_source", as_of: asOf },
    });
    expect(decision?.delegation).toBe("del_100");
    // The agent logged in, and the correlation still says so.
    expect(decision?.correlation.principal_id).toBe("accounts-payable-fte");
  });

  it("DSOR-DEL-10: a refusal under the slip is recorded the same way", async () => {
    await callOperation(AGENT, "payment.create", {
      invoice: "dsor://org_456/invoice/INV-1008",
      amount: { value: "60000.00", currency: "USD" },
    });

    const [decision] = await decisions();

    expect(decision?.result).toBe("LIMIT_EXCEEDED");
    expect(decision?.identity.mode).toBe("unattended");
    expect(decision?.identity.subject).toBe("user_123");
    expect(decision?.delegation).toBe("del_100");
  });

  it("DSOR-DEL-08: never from the request: a planted subject changes nothing on the record", async () => {
    await cancel(AGENT, { subject: "cfo_100" });

    expect((await decisions())[0]?.identity.subject).toBe("user_123");
  });

  it("a person's decision stays direct, with nobody in the chain and no slip", async () => {
    await cancel(SUPERVISOR);

    const [decision] = await decisions();

    expect(decision?.identity.mode).toBe("direct");
    expect(decision?.identity.subject).toBe("user_123");
    expect(decision?.identity.actor_chain).toStrictEqual([]);
    expect(decision?.delegation).toBeUndefined();
  });

  it("an agent's command refused before its slip was in hand stays direct: no one's authority was used", async () => {
    await asTheOwner(() =>
      db.exec("UPDATE dsor.delegations SET status = 'revoked' WHERE id = 'del_100'"),
    );
    await cancel(AGENT);

    const [decision] = await decisions();

    expect(decision?.result).toBe("DELEGATION_REQUIRED");
    expect(decision?.identity.mode).toBe("direct");
    expect(decision?.identity.subject).toBe("accounts-payable-fte");
    expect(decision?.delegation).toBeUndefined();
  });

  it("DSOR-AUD-04b: the slip is inside the hash: the chain verifies, and a slip changed afterwards breaks it", async () => {
    await cancel(AGENT);

    expect(verifyChain(await theLog("org_456"))).toBe(true);

    await asTheOwner(() => db.exec("UPDATE dsor.audit SET delegation = 'del_999'"));

    expect(verifyChain(await theLog("org_456"))).toBe(false);
  });
});
