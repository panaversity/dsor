// Step 43, revised by the learner: login.invite and login.unlink, two commands of DSoR's own. Only a
// tenant administrator, a person, may call them; the person invited or unlinked must be a person
// of the company; every call is recorded (DSOR-IDN-01; step 43's README, revisions R2 and R7).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { remoteKeys } from "../src/tokens.ts";
import { keyed } from "./helpers.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

let a: TestIssuer;
beforeAll(async () => {
  a = await startIssuer();
});
afterAll(async () => {
  await a.close();
});

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** A world of real logins whose book already links admin_100's and user_123's logins. */
async function adminWorld() {
  const w: RuleWorld = await ruleWorldOnTuesday();
  const issuers = new Map([
    ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ["org_789", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
  ]);
  await w.book.link({ issuer: a.issuer, subject: "ba_admin", principal: "admin_100" });
  await w.book.link({ issuer: a.issuer, subject: "ba_2c91", principal: "user_123" });
  const registry: Registry = { ...w.registry, logins: realLogins(issuers, w.book, remoteKeys()) };
  const ask = (who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
    call(registry, w.log, who, name, input);
  const as = async (subject: string, tenant = "org_456"): Promise<RequestEnvelope> =>
    keyed({ token: await a.sign(subject), tenant });
  return { w, ask, as };
}

describe("R2: login.invite", () => {
  it("DSOR-IDN-01: admin_100 invites cfo_100; the code's first call is cfo_100", async () => {
    const { w, ask, as } = await adminWorld();
    const answer = (await ask(await as("ba_admin"), "login.invite", { person: "dsor://org_456/person/cfo_100", reason: "new CFO" })) as {
      data: { invitation: string; person: string; code: string; expires_at: string };
      correlation: { principal_id: string };
    };
    expect(answer).toMatchObject({
      outcome: "COMMITTED",
      data: { person: "cfo_100" },
      correlation: { principal_id: "admin_100" },
    });
    expect(answer.data.invitation).toMatch(/^dsor:\/\/org_456\/invitation\/inv_[0-9a-f-]{36}$/);
    expect(answer.data.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const first = { token: await a.sign("ba_new_cfo"), tenant: "org_456", invitation: answer.data.code };
    expect(await ask(first, "invoice.get", INV_1008)).toMatchObject({ correlation: { principal_id: "cfo_100" } });
    expect((await w.log.records()).find((r) => r.operation === "login.invite@1")).toMatchObject({
      authorization: "ALLOW",
      correlation: { principal_id: "admin_100" },
    });
  });

  it("Step 43, R2: user_123, an AP supervisor, holds no login:invite and is refused", async () => {
    const { ask, as } = await adminWorld();
    const answer = await ask(await as("ba_2c91"), "login.invite", { person: "dsor://org_456/person/cfo_100", reason: "x" });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("Step 43, R2: the agent can never invite, slip or not", async () => {
    const { ask } = await adminWorld();
    const answer = await ask(keyed({ token: "tok_7f3a", tenant: "org_456" }), "login.invite", {
      person: "dsor://org_456/person/cfo_100",
      reason: "x",
    });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it.each([
    ["user_700", "a person of org_789"],
    ["accounts-payable-fte", "an agent"],
    ["cfo_999", "nobody DSoR knows"],
  ])("Step 43, R2: inviting %s, %s, into org_456 is refused, and nothing is invited", async (person) => {
    const { w, ask, as } = await adminWorld();
    const answer = await ask(await as("ba_admin"), "login.invite", {
      person: `dsor://org_456/person/${person}`,
      reason: "x",
    });
    expect(answer).toMatchObject({ code: "RESOURCE_NOT_FOUND", message: `no person "${person}" in org_456` });
    expect(await w.book.invitations()).toStrictEqual([]);
  });
});

describe("R7: login.unlink", () => {
  it("DSOR-IDN-01: admin_100 unlinks user_123; his next call is no caller", async () => {
    const { ask, as } = await adminWorld();
    const user = await as("ba_2c91");
    expect(await ask(user, "invoice.get", INV_1008)).toMatchObject({ correlation: { principal_id: "user_123" } });
    const answer = await ask(await as("ba_admin"), "login.unlink", { person: "dsor://org_456/person/user_123", reason: "left the company" });
    expect(answer).toMatchObject({ outcome: "COMMITTED", data: { person: "user_123", logins: 1, invitations: 0 } });
    expect(await ask(await as("ba_2c91"), "invoice.get", INV_1008)).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("Step 43, R7: user_123 cannot unlink the admin", async () => {
    const { ask, as } = await adminWorld();
    const answer = await ask(await as("ba_2c91"), "login.unlink", { person: "dsor://org_456/person/admin_100", reason: "x" });
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});
