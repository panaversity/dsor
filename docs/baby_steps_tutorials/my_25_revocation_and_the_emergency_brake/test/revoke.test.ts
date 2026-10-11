// NEW IN STEP 25: tearing up a permission slip (decision 142).
//
// Rule DSOR-DEL-04a: a delegation MUST be revocable by its delegator and by a tenant administrator.
// Rule DSOR-DEL-04c: on revocation or expiry, every proposal created under the delegation that is
// PENDING_APPROVAL or APPROVED MUST move to CANCELLED.
// Rule DSOR-DEL-06d: a reservation MUST be released when its proposal reaches FAILED, REJECTED,
// EXPIRED, CANCELLED, REVOKED, or INVALIDATED.

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { theLog } from "../src/audit.ts";
import { money } from "../src/money.ts";
import {
  moveProposalThrough,
  movesOf,
  propose,
  type ProposalState,
  stateOf,
} from "../src/proposal.ts";
import { reserve, usedToday } from "../src/reservation.ts";
import { theDatabase } from "../src/store.ts";
import { aDatabase, asTheOwner, resetTheStory } from "./support/database.ts";
import { callOperation } from "./support/door.ts";

const SUPERVISOR = { loggedInAs: "user_123" };
const CFO = { loggedInAs: "cfo_100" };
const AGENT = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };
const DEL_100 = "dsor://org_456/delegation/del_100";
const PAY = {
  invoice: "dsor://org_456/invoice/INV-1009",
  amount: { value: "2500.00", currency: "USD" },
};

/** del_100's status, read as the application. */
const statusOfDel100 = async (): Promise<string | undefined> => {
  const { rows } = await theDatabase("org_456").query<{ status: string }>(
    "SELECT status FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_100'",
  );

  return rows[0]?.status;
};

/** A proposal the agent made under del_100, walked to a state, as approvals one day will. */
async function underDel100(path: readonly ProposalState[]): Promise<string> {
  const id = await propose({
    tenant: "org_456",
    operation: "payment.create@1",
    mode: "execute",
    payload: "{}",
    payloadHash: "sha256:0",
    requester: JSON.stringify({
      mode: "unattended",
      subject: "user_123",
      actor_chain: ["accounts-payable-fte"],
      delegation: "del_100",
    }),
    idempotencyKey: `revoke-${Math.random()}`,
    actor: "accounts-payable-fte",
    cause: "payment.create@1 invoked",
  });
  const steps = path.slice(1).map((to, i) => [path[i] as ProposalState, to, `to ${to}`] as const);

  if (steps.length > 0) {
    await moveProposalThrough("org_456", id, steps, "dsor");
  }

  return id;
}

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

describe("delegation.revoke: the person who signed a slip tears it up", () => {
  it("DSOR-DEL-04a: user_123 revokes del_100, and the agent's next command is refused", async () => {
    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "the agent is paying the wrong invoices",
    });

    expect(answer.kind === "result" && answer.envelope.data?.["status"]).toBe("revoked");
    expect(await statusOfDel100()).toBe("revoked");

    // With no active slip, the agent's command runs under nobody's authority, and is refused at §21.3.
    const refused = await callOperation(AGENT, "payment.create", PAY);

    expect(refused.kind === "error" && refused.envelope.code).toBe("DELEGATION_REQUIRED");
  });

  it("DSOR-DEL-04a: the record says who revoked it, and why", async () => {
    await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "the agent is paying the wrong invoices",
    });

    const { rows } = await theDatabase("org_456").query<{
      revoked_by: string;
      revoked_reason: string;
    }>(
      "SELECT revoked_by, revoked_reason FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_100'",
    );

    expect(rows).toStrictEqual([
      { revoked_by: "user_123", revoked_reason: "the agent is paying the wrong invoices" },
    ]);
  });

  it("DSOR-DEL-04a: cfo_100, who did not sign del_100, may not revoke it", async () => {
    const answer = await callOperation(CFO, "delegation.revoke", {
      target: DEL_100,
      reason: "not mine to revoke",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(await statusOfDel100()).toBe("active");
  });

  it("DSOR-DEL-04a: the agent may not revoke its own slip", async () => {
    const answer = await callOperation(AGENT, "delegation.revoke", {
      target: DEL_100,
      reason: "tearing up my own slip",
    });

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(await statusOfDel100()).toBe("active");
  });

  it("DSOR-DEL-04a: a slip revoked already, or one that does not exist, changes nothing and says so", async () => {
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "once" });

    const again = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: DEL_100,
      reason: "twice",
    });
    const nowhere = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_999",
      reason: "no such slip",
    });

    expect(again.kind === "error" && again.envelope.code).toBe("CONFLICT");
    expect(nowhere.kind === "error" && nowhere.envelope.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("DSOR-DEL-04a: a revocation without a reason is refused, and the slip stays active", async () => {
    const answer = await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100 });

    expect(answer.kind === "error" && answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(await statusOfDel100()).toBe("active");
  });
});

describe("what was waiting under the slip", () => {
  it("DSOR-DEL-04c: proposals waiting for approval or approved under del_100 move to CANCELLED, with the cause", async () => {
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);
    const approved = await underDel100(["PROPOSED", "PENDING_APPROVAL", "APPROVED"]);

    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    expect(await stateOf("org_456", waiting)).toBe("CANCELLED");
    expect(await stateOf("org_456", approved)).toBe("CANCELLED");
    expect((await movesOf("org_456", waiting)).at(-1)?.cause).toBe(
      "del_100 was revoked by user_123",
    );
  });

  it("DSOR-DEL-04c: a proposal already finished, or prepared and READY, is left as it is", async () => {
    const done = await underDel100(["PROPOSED", "READY", "EXECUTING", "COMMITTED"]);
    const prepared = await underDel100(["PROPOSED", "READY"]);

    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    expect(await stateOf("org_456", done)).toBe("COMMITTED");
    // §26.2 has no move from READY to CANCELLED; step 31's proposal.execute checks the slip again.
    expect(await stateOf("org_456", prepared)).toBe("READY");
  });

  it("DSOR-DEL-06d: a cancelled proposal's reservation is released, and its amount given back to the day", async () => {
    const waiting = await underDel100(["PROPOSED", "PENDING_APPROVAL"]);

    await reserve(
      "org_456",
      waiting,
      "del_100",
      money("40000.00", "USD"),
      money("200000.00", "USD"),
    );
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    expect(await usedToday("org_456", "del_100")).toBe("0.00");
  });
});

describe("what the application may do to a slip", () => {
  it("DSOR-DEL-04a: it may only change an active slip to revoked, even writing the SQL itself", async () => {
    // Not back to active, and not to anything else.
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "stop" });

    const { rows: back } = await theDatabase("org_456").query(
      "UPDATE dsor.delegations SET status = 'active' WHERE tenant = 'org_456' AND id = 'del_100' RETURNING id",
    );

    expect(back).toStrictEqual([]);
    expect(await statusOfDel100()).toBe("revoked");

    await resetTheStory();
    await expect(
      theDatabase("org_456").query(
        "UPDATE dsor.delegations SET status = 'suspended' WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      theDatabase("org_456").query(
        "UPDATE dsor.delegations SET permissions = ARRAY['payment:create'] WHERE tenant = 'org_456' AND id = 'del_100'",
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

// NEW IN STEP 25, decision 143: who may revoke is decided at §21.9, before the decision is recorded.

describe("§21.9: the target's own rules, decided and recorded", () => {
  /** A slip in org_456 that cfo_100 signed, for an agent of no one's, as an owner would add one. */
  async function aSlipSignedByCfo(): Promise<void> {
    await asTheOwner(() =>
      db.exec(`INSERT INTO dsor.delegations (tenant, id, delegator, delegate, permissions, status, expires_at)
               VALUES ('org_456', 'del_200', 'cfo_100', 'another-agent', ARRAY['invoice:read'],
                       'active', '2099-12-31T23:59:59Z')`),
    );
  }

  it("DSOR-DEL-04a: user_123, who may revoke slips, may not revoke one cfo_100 signed, and the log says DENY", async () => {
    // Decision 143: this was refused in the handler, after §21.11 had recorded ALLOW.
    await aSlipSignedByCfo();

    const answer = await callOperation(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_200",
      reason: "not mine",
    });
    const last = (await theLog("org_456")).at(-1);

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
    expect(last?.authorization).toBe("DENY");
    expect(last?.result).toBe("AUTHORIZATION_DENIED");

    const { rows } = await theDatabase("org_456").query<{ status: string }>(
      "SELECT status FROM dsor.delegations WHERE tenant = 'org_456' AND id = 'del_200'",
    );

    expect(rows).toStrictEqual([{ status: "active" }]);
  });

  it("DSOR-DEL-04a: a slip revoked already, or none, is refused and recorded as the DENY it is", async () => {
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "once" });
    await callOperation(SUPERVISOR, "delegation.revoke", { target: DEL_100, reason: "twice" });

    expect((await theLog("org_456")).at(-1)?.result).toBe("CONFLICT");

    await callOperation(SUPERVISOR, "delegation.revoke", {
      target: "dsor://org_456/delegation/del_999",
      reason: "no such slip",
    });

    expect((await theLog("org_456")).at(-1)?.result).toBe("RESOURCE_NOT_FOUND");
  });

  it("DSOR-DEL-04a: a dry run of a revocation by someone who did not sign the slip is refused too", async () => {
    await aSlipSignedByCfo();

    const answer = await callOperation(
      SUPERVISOR,
      "delegation.revoke",
      { target: "dsor://org_456/delegation/del_200", reason: "would I be allowed?" },
      { mode: "validate_only" },
    );

    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
  });
});
