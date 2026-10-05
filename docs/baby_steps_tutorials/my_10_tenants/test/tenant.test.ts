// NEW IN STEP 10: which company a request is for.
//
// Decided from who is logged in, never from the address or the arguments. One membership means it
// is implied. Two means the login must say which, and it must be one of theirs. This is §21 step 2,
// "resolve tenant", and it runs before anything looks at an operation or an invoice — because every
// later question ("may you?", "does it exist?") is a question inside one company.
//
// Rule DSOR-IDN-03a: each request MUST resolve to exactly one active tenant in which the subject
// holds a membership.
// Rule DSOR-SRC-02a: the security context comes only from the authenticated envelope and the
// control-plane store — so a `tenant` inside the arguments changes nothing.

import { describe, expect, it } from "vitest";
import { tenantClaimed, type Login } from "../src/login.ts";
import { findPerson } from "../src/people.ts";
import { tenantFor } from "../src/tenant.ts";
import { callOperation } from "../src/operations.ts";
import { theLog } from "../src/audit.ts";
import { aDatabase } from "./support/database.ts";

const INV_1008 = "dsor://org_456/invoice/INV-1008";

function person(id: string) {
  const found = findPerson(id);

  if (found === undefined) {
    throw new Error(`${id} is missing from the people list`);
  }

  return found;
}

describe("who belongs where", () => {
  it("the agent works for both companies; the two people work for one", () => {
    expect(person("accounts-payable-fte").memberships.map((m) => m.tenantId)).toEqual([
      "org_456",
      "org_789",
    ]);
    expect(person("user_123").memberships.map((m) => m.tenantId)).toEqual(["org_456"]);
    expect(person("cfo_100").memberships.map((m) => m.tenantId)).toEqual(["org_456"]);
  });
});

describe("resolving the one company a request is for", () => {
  it("DSOR-IDN-03a: one membership, and the company is implied", () => {
    const resolved = tenantFor(person("user_123"), { kind: "unnamed" }, "req_1");

    expect(resolved).toEqual({ tenant: "org_456" });
  });

  it("DSOR-IDN-03a: two memberships, and the login has to say which", () => {
    const resolved = tenantFor(person("accounts-payable-fte"), { kind: "unnamed" }, "req_1");

    if (!("refused" in resolved)) {
      throw new Error("an agent with two companies and no choice should have been refused");
    }

    expect(resolved.refused.code).toBe("TENANT_MISMATCH");
    expect(resolved.refused.retry).toBe("never");
  });

  it("DSOR-IDN-03a: naming one of your own companies puts the request in it", () => {
    const agent = person("accounts-payable-fte");

    expect(tenantFor(agent, { kind: "named", tenant: "org_789" }, "req_1")).toEqual({
      tenant: "org_789",
    });
    expect(tenantFor(agent, { kind: "named", tenant: "org_456" }, "req_1")).toEqual({
      tenant: "org_456",
    });
  });

  it("DSOR-IDN-03a: naming a company you are not in is refused, whether or not it exists", () => {
    // org_789 is real and user_123 is not in it. org_000 does not exist at all. The two refusals
    // must be the same words, so that being refused never tells you which companies are real.
    const real = tenantFor(person("user_123"), { kind: "named", tenant: "org_789" }, "req_1");
    const fake = tenantFor(person("user_123"), { kind: "named", tenant: "org_000" }, "req_1");

    if (!("refused" in real) || !("refused" in fake)) {
      throw new Error("both should have been refused");
    }

    expect(real.refused.code).toBe("TENANT_MISMATCH");
    expect(fake.refused.code).toBe("TENANT_MISMATCH");
    expect(real.refused.message.replace("org_789", "X")).toBe(
      fake.refused.message.replace("org_000", "X"),
    );
    expect(real.refused.message).not.toContain("org_456");
  });

  it("DSOR-IDN-03a: a company claim that is not text is refused, not treated as absent", () => {
    // `{ tenant: 42 }` from a caller with one membership must not quietly become that membership.
    // A claim that is present and wrong is a wrong claim.
    const resolved = tenantFor(person("user_123"), { kind: "malformed" }, "req_1");

    if (!("refused" in resolved)) {
      throw new Error("a malformed claim should have been refused");
    }

    expect(resolved.refused.code).toBe("TENANT_MISMATCH");
  });
});

describe("reading the claim out of a login", () => {
  it("DSOR-SRC-02a: a login with no company says so, a text company is named, anything else is malformed", () => {
    expect(tenantClaimed({ loggedInAs: "user_123" })).toEqual({ kind: "unnamed" });
    expect(tenantClaimed({ loggedInAs: "user_123", tenant: "org_456" })).toEqual({
      kind: "named",
      tenant: "org_456",
    });

    for (const bad of [42, null, {}, ["org_456"], ""]) {
      expect(
        tenantClaimed({ loggedInAs: "user_123", tenant: bad } as unknown as Login),
        String(bad),
      ).toEqual({
        kind: "malformed",
      });
    }
  });

  it("DSOR-SRC-02a: a company the login only inherits is not a claim", () => {
    const polluted = Object.create({ tenant: "org_789" }) as Login;

    Object.assign(polluted, { loggedInAs: "user_123" });

    expect(tenantClaimed(polluted)).toEqual({ kind: "unnamed" });
  });
});

describe("through the whole pipeline", () => {
  it("DSOR-SRC-02a: the agent cannot pick its company through the arguments", async () => {
    // user_123 belongs to one company, so a test with user_123 cannot tell "the arguments are
    // ignored" from "the arguments are honoured when the caller is a member". The agent belongs to
    // both; that is the caller that makes this bite. A review pointed it out.
    const db = await aDatabase();
    const agentFor456 = { loggedInAs: "accounts-payable-fte", tenant: "org_456" };

    // Working for org_456, naming org_789 in the arguments under names that are not identifiers:
    // still org_456's request, so org_789's address is a mismatch. (A bare `tenant` key is itself
    // refused under SRC-02b, in who-is-calling.test.ts.)
    const smuggled = await callOperation(agentFor456, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
      active_tenant: "org_789",
      activeTenantId: "org_789",
    });

    if (smuggled.kind !== "error") {
      throw new Error(`expected a refusal, got ${smuggled.kind}`);
    }

    expect(smuggled.envelope.code).toBe("TENANT_MISMATCH");

    // And the same login, asking inside org_456, gets org_456's invoice whatever else is planted.
    const honest = await callOperation(agentFor456, "invoice.get", {
      invoice: INV_1008,
      active_tenant: "org_789",
    });

    if (honest.kind !== "data") {
      throw new Error(`expected data, got ${honest.kind}`);
    }

    expect(honest.invoice.tenantId).toBe("org_456");

    await db.close();
  });

  it("DSOR-IDN-03a: a membership of a company this program does not serve resolves to nothing", () => {
    // "Active" means on the list this program serves. people.ts refuses such a membership at load,
    // but a hand-built principal never passes through people.ts, so the rule is held at the request.
    const stranger = {
      id: "contractor",
      type: "human" as const,
      role: "ap_worker",
      memberships: [{ tenantId: "org_000" }],
    };

    for (const claim of [
      { kind: "unnamed" as const },
      { kind: "named" as const, tenant: "org_000" },
    ]) {
      const resolved = tenantFor(stranger, claim, "req_1");

      if (!("refused" in resolved)) {
        throw new Error("a membership of an unserved company should resolve to nothing");
      }

      expect(resolved.refused.code).toBe("TENANT_MISMATCH");
    }
  });

  it("DSOR-IDN-03a: the agent without a company is refused before anything else is looked at", async () => {
    const db = await aDatabase();

    const answer = await callOperation({ loggedInAs: "accounts-payable-fte" }, "invoice.get", {
      invoice: INV_1008,
    });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("TENANT_MISMATCH");

    // "Before anything else is looked at", measured and not only titled: an operation that does not
    // exist, and a command this login may not call, are both answered TENANT_MISMATCH — not
    // UNSUPPORTED_CAPABILITY, not AUTHORIZATION_DENIED — and the record has no operation in it,
    // because none was resolved. A pipeline that resolved the tenant later would answer differently.
    const noSuchOperation = await callOperation(
      { loggedInAs: "accounts-payable-fte" },
      "execute_sql",
      {},
    );
    const notAllowed = await callOperation(
      { loggedInAs: "accounts-payable-fte" },
      "invoice.issue",
      {
        invoice: INV_1008,
      },
    );

    for (const refused of [noSuchOperation, notAllowed]) {
      if (refused.kind !== "error") {
        throw new Error(`expected a refusal, got ${refused.kind}`);
      }

      expect(refused.envelope.code).toBe("TENANT_MISMATCH");
    }

    const [record] = await theLog("org_456");

    expect(record?.operation).toBeUndefined();

    await db.close();
  });
});
