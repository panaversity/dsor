// Step 43: real logins for people, through the whole checklist. A signed token is checked, its login
// is looked up in DSoR's own table of links, and the principal keeps only the companies whose issuer
// signed it. Nothing else in the token decides anything (DSOR-IDN-01, DSOR-IDN-04a, DSOR-IDN-04b,
// DSOR-APR-05a; step 43's README, claims C3 to C6, decisions D1, D5, D6, and D8).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { FAKE_LOGINS, memoryLinks, realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import type { Registry } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { remoteKeys } from "../src/tokens.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";
import { ruleWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

// Two sign-in services: org_456's and org_789's.
let a: TestIssuer;
let b: TestIssuer;
beforeAll(async () => {
  a = await startIssuer();
  b = await startIssuer();
});
afterAll(async () => {
  await a.close();
  await b.close();
});

/** A world of step 29's rules, whose registry takes real logins for people. */
async function realWorld(): Promise<{ w: RuleWorld; registry: Registry }> {
  const w = await ruleWorldOnTuesday();
  const issuers = new Map([
    ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ["org_789", [{ issuer: b.issuer, audience: b.audience, jwks: b.jwks }]],
  ]);
  // DSoR's own table: which principal each login is. The subjects are the issuers' user ids.
  const links = memoryLinks([
    { issuer: a.issuer, subject: "ba_8c1f", principal: "cfo_100" },
    { issuer: a.issuer, subject: "ba_2c91", principal: "user_123" },
    { issuer: b.issuer, subject: "ba_7e00", principal: "user_700" },
    // A link that names an agent: agents get real logins only in step 44.
    { issuer: a.issuer, subject: "ba_ap_fte", principal: "accounts-payable-fte" },
  ]);
  return { w, registry: { ...w.registry, logins: realLogins(issuers, links, remoteKeys()) } };
}

function ask(
  registry: Registry,
  w: RuleWorld,
  who: RequestEnvelope,
  name: string,
  input: unknown,
): Promise<Answer> {
  return call(registry, w.log, who, name, input);
}

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
const as = async (
  issuer: TestIssuer,
  subject: string,
  tenant = "org_456",
  claims = {},
): Promise<RequestEnvelope> => ({
  token: await issuer.sign(subject, claims),
  tenant,
});

describe("C3: a login is DSoR's to name", () => {
  it("DSOR-IDN-01: cfo_100 signs in, and her token is normalized into the principal cfo_100, who reads INV-1008 whole", async () => {
    const { w, registry } = await realWorld();
    const answer = await ask(registry, w, await as(a, "ba_8c1f"), "invoice.get", INV_1008);
    expect(answer).toMatchObject({
      data: { id: "INV-1008", amount: { value: "31400.00", currency: "USD" } },
      correlation: { principal_id: "cfo_100" },
    });
  });

  it("DSOR-IDN-01: a good token whose login DSoR has no link for is no caller: line ① refuses it", async () => {
    const { w, registry } = await realWorld();
    const answer = await ask(registry, w, await as(a, "ba_somebody_new"), "invoice.get", INV_1008);
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("DSOR-IDN-04b: user_123's token says role CFO; DSoR never reads it: rule.draft is refused for permission", async () => {
    const { w, registry } = await realWorld();
    const claims = { role: "CFO", roles: ["CFO"], name: "The CFO" };
    const answer = await ask(
      registry,
      w,
      await as(a, "ba_2c91", "org_456", claims),
      "rule.draft",
      {},
    );
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      correlation: { principal_id: "user_123" },
    });
    // cfo_100 holds rule:draft in DSoR's own table, so the same call passes line ⑤ and line ⑥ refuses it.
    const cfo = await ask(registry, w, await as(a, "ba_8c1f"), "rule.draft", {});
    expect(cfo).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("Step 43, D1: a link that names an agent is refused: only people sign in this way", async () => {
    const { w, registry } = await realWorld();
    const answer = await ask(registry, w, await as(a, "ba_ap_fte"), "invoice.get", INV_1008);
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });
});

describe("C4: a token counts only where its issuer is configured", () => {
  it("DSOR-IDN-04a: user_700's token from org_789's issuer reads org_789's INV-1008", async () => {
    const { w, registry } = await realWorld();
    const who = await as(b, "ba_7e00", "org_789");
    const answer = await ask(registry, w, who, "invoice.get", {
      invoice: "dsor://org_789/invoice/INV-1008",
    });
    expect(answer).toMatchObject({
      data: { tenant_id: "org_789" },
      correlation: { principal_id: "user_700" },
    });
  });

  it("DSOR-IDN-04a: a token of org_789's issuer, in org_456, is refused at line ②", async () => {
    const { w, registry } = await realWorld();
    // Linked to cfo_100 at org_789's issuer: she has no membership in org_789, and org_456 does not
    //   trust that issuer, so she has no company at all.
    const links = memoryLinks([{ issuer: b.issuer, subject: "ba_8c1f", principal: "cfo_100" }]);
    const issuers = new Map([
      ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
      ["org_789", [{ issuer: b.issuer, audience: b.audience, jwks: b.jwks }]],
    ]);
    const crossed = { ...registry, logins: realLogins(issuers, links, remoteKeys()) };
    const answer = await ask(crossed, w, await as(b, "ba_8c1f"), "invoice.get", INV_1008);
    expect(answer).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "the caller may not work in the tenant it named",
    });
  });
});

describe("C5: the fake tokens of people are gone where logins are real", () => {
  it("Step 43, D1: tok_d4e8, from the public file, is refused at line ①", async () => {
    const { w, registry } = await realWorld();
    const answer = await ask(
      registry,
      w,
      { token: "tok_d4e8", tenant: "org_456" },
      "invoice.get",
      INV_1008,
    );
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("Step 43, D1: the agent's tok_7f3a still works until step 44, and gets INV-1008 without its amounts", async () => {
    const { w, registry } = await realWorld();
    const answer = await ask(
      registry,
      w,
      { token: "tok_7f3a", tenant: "org_456" },
      "invoice.get",
      INV_1008,
    );
    expect(answer).toMatchObject({
      data: { id: "INV-1008" },
      correlation: { agent_id: "accounts-payable-fte" },
    });
    expect((answer as { data: object }).data).not.toHaveProperty("amount");
  });

  it("Step 43, D8: a world that keeps step 05's table still takes tok_d4e8", async () => {
    const { w } = await realWorld();
    const old = { ...w.registry, logins: FAKE_LOGINS };
    const answer = await ask(
      old,
      w,
      { token: "tok_d4e8", tenant: "org_456" },
      "invoice.get",
      INV_1008,
    );
    expect(answer).toMatchObject({ correlation: { principal_id: "cfo_100" } });
  });
});

describe("C3: no login, nothing else (the review's L6 and L9)", () => {
  it("DSOR-IDN-01: a forged token under real logins never reaches the company's code", async () => {
    const { w, registry } = await realWorld();
    const stranger = await startIssuer();
    const forged = await stranger.sign(
      "ba_8c1f",
      { iss: a.issuer, aud: a.audience },
      { kid: "key-1" },
    );
    const spy = vi.fn(() => ({ id: "INV-1008" }));
    const watched = {
      ...registry,
      handlers: new Map([...registry.handlers, ["invoice.get", spy]]),
    };
    const answer = await ask(
      watched,
      w,
      { token: forged, tenant: "org_456" },
      "invoice.get",
      INV_1008,
    );
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(spy).not.toHaveBeenCalled();
    await stranger.close();
  });

  it("DSOR-IDN-01: a login source that throws gives no caller: line ① refuses, with the caller's own request id", async () => {
    const { w, registry } = await realWorld();
    const broken = {
      ...registry,
      logins: {
        find: async (): Promise<undefined> => {
          throw new Error("the table of links is down");
        },
      },
    };
    const who = { token: "anything", tenant: "org_456", request_id: "req_from_the_phone" };
    expect(await ask(broken, w, who, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      correlation: { request_id: "req_from_the_phone" },
    });
  });
});

describe("C6: the CFO approves under her own login", () => {
  it("DSOR-APR-05a: the agent's INV-1008 waits; tok_d4e8 cannot approve it; cfo_100's own token does", async () => {
    const { w, registry } = await realWorld();
    const agent = { token: "tok_7f3a", tenant: "org_456", idempotency_key: "pay-1008" };
    const waits = (await ask(registry, w, agent, "payment.create", {
      ...INV_1008,
      expected_version: 1,
    })) as {
      proposal: string;
      payload_hash: string;
    };
    const approval = { proposal: waits.proposal, payload_hash: waits.payload_hash };
    const stranger = { token: "tok_d4e8", tenant: "org_456", idempotency_key: "stranger-1" };
    expect(await ask(registry, w, stranger, "proposal.approve", approval)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    const cfo = { ...(await as(a, "ba_8c1f")), idempotency_key: "cfo-1" };
    expect(await ask(registry, w, cfo, "proposal.approve", approval)).toMatchObject({
      outcome: "COMMITTED",
      data: { state: "APPROVED" },
      correlation: { principal_id: "cfo_100" },
    });
  });
});
