// Step 43b: each company's people, and their roles there, live in DSoR's own table. Line ① reads
// it for a person on the call; the company's role source, dsor_assignments, reads it for an absent
// signer. Agents and DSoR's system logins stay in src/principals.ts until step 44 (DSOR-IDN-01,
// DSOR-IDN-05, DSOR-IDN-07; step 43b's README, claims C1 and C2, decisions L5, D1, and D4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRoleSettings, readRoleSettings } from "../src/authority.ts";
import { realLogins } from "../src/logins.ts";
import type { PeopleStore } from "../src/people.ts";
import { call } from "../src/pipeline.ts";
import { logins, type Principal } from "../src/principals.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { remoteKeys } from "../src/tokens.ts";
import { keyed, withPlanted } from "./helpers.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";
import { ruleWorldOnTuesday, tableWorldOnTuesday } from "./rule-world.ts";

let a: TestIssuer;
beforeAll(async () => {
  a = await startIssuer();
});
afterAll(async () => {
  await a.close();
});

const BY = { person: "admin_100", reason: "a step 43b test" };
const CFO: RequestEnvelope = { token: "tok_d4e8", tenant: "org_456" };
const AGENT: RequestEnvelope = { token: "tok_7f3a", tenant: "org_456" };
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };
const PAY_1009 = { invoice: "dsor://org_456/invoice/INV-1009", expected_version: 1 };

/** A table of people that cannot be read: the database is down. */
function unreadable(people: PeopleStore): PeopleStore {
  const down = async (): Promise<never> => {
    throw new Error("the database is down");
  };
  return { ...people, membershipsOf: down, memberOf: down };
}

describe("C1: a person's companies and roles at line ① come from DSoR's table", () => {
  it("DSOR-IDN-01: a role revoked in the table is gone from cfo_100's next call, though src/principals.ts still says CFO", async () => {
    const w = await ruleWorldOnTuesday();
    expect(await call(w.registry, w.log, CFO, "invoice.get", INV_1008)).toMatchObject({
      data: { id: "INV-1008" },
    });
    await w.people.revoke("org_456", "cfo_100", "CFO", BY);
    expect(await call(w.registry, w.log, CFO, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      correlation: { principal_id: "cfo_100" },
    });
    expect(logins.get("tok_d4e8")?.memberships).toStrictEqual([
      { tenant_id: "org_456", roles: ["CFO"] },
    ]);
  });

  it("DSOR-IDN-01: a role granted and confirmed in the table counts on the next call, though src/principals.ts never named it", async () => {
    const w = await ruleWorldOnTuesday();
    const issue = { invoice: "dsor://org_456/invoice/INV-1008", expected_version: 1 };
    expect(await call(w.registry, w.log, keyed(CFO), "invoice.issue", issue)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    const asked = await w.people.grant("org_456", "cfo_100", "ap_supervisor", true, BY);
    await w.people.confirm("org_456", asked.id, { person: "user_123", reason: "second" });
    expect(await call(w.registry, w.log, keyed(CFO), "invoice.issue", issue)).not.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  it("DSOR-IDN-01: a person removed from her only company is no caller", async () => {
    const w = await ruleWorldOnTuesday();
    await w.people.remove("org_456", "cfo_100", BY);
    expect(await call(w.registry, w.log, CFO, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("DSOR-IDN-03a: a person removed from org_456, and active in org_789, is refused at line ② in org_456", async () => {
    const w = await ruleWorldOnTuesday();
    await w.people.add("org_789", "cfo_100", { person: "admin_700", reason: "joins org_789" });
    await w.people.remove("org_456", "cfo_100", BY);
    expect(await call(w.registry, w.log, CFO, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      message: "the caller may not work in the tenant it named",
    });
  });

  it("DSOR-IDN-01: a new hire, jane_200, with a linked login: no caller until person.add puts her in the table, then a caller with no role", async () => {
    const w = await ruleWorldOnTuesday();
    const issuers = new Map([
      ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
      ["org_789", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ]);
    await w.book.link({ issuer: a.issuer, subject: "ba_jane", principal: "jane_200" });
    const registry = { ...w.registry, logins: realLogins(issuers, w.book, remoteKeys()) };
    const jane = { token: await a.sign("ba_jane"), tenant: "org_456" };
    expect(await call(registry, w.log, jane, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    await w.people.add("org_456", "jane_200", BY);
    expect(await call(registry, w.log, jane, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHORIZATION_DENIED",
      correlation: { principal_id: "jane_200" },
    });
  });

  it("DSOR-APR-03a: user_123 prepares INV-1009 on his own login, and his AP supervisor role is revoked in the table before user_124 releases it: invalidated, as AUTHORIZATION_DENIED", async () => {
    const w = await ruleWorldOnTuesday();
    const prepared = await w.ask(
      { ...keyed({ token: "tok_2c91", tenant: "org_456" }), mode: "propose_only" },
      "payment.create",
      PAY_1009,
    );
    expect(prepared).toMatchObject({ outcome: "READY" });
    await w.people.revoke("org_456", "user_123", "ap_supervisor", BY);
    const proposal = (prepared as { proposal: string }).proposal;
    const user124 = {
      id: "user_124",
      type: "human",
      memberships: [{ tenant_id: "org_456", roles: ["ap_supervisor"] }],
    } as const;
    const released = await withPlanted(
      "tok_124",
      { ...user124, memberships: [...user124.memberships] } as unknown as Principal,
      () => w.ask(keyed({ token: "tok_124", tenant: "org_456" }), "proposal.execute", { proposal }),
      w.people,
    );
    // As step 31 re-checks a release: the proposal is invalidated, with the refusal as its cause.
    expect(released).toMatchObject({ code: "APPROVAL_INVALIDATED" });
    const id = proposal.split("/").at(-1) as string;
    expect(await w.proposals.get("org_456", id)).toMatchObject({ state: "INVALIDATED" });
  });

  it("Step 43b, L5: a table that cannot be read answers CONNECTOR_UNAVAILABLE to a person, never log in first", async () => {
    const w = await ruleWorldOnTuesday();
    const registry = { ...w.registry, people: unreadable(w.people) };
    expect(await call(registry, w.log, CFO, "invoice.get", INV_1008)).toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
      retry: "safe_same_key",
    });
  });

  it("Step 43b, D1: the agent is not in the table: it still works while the table cannot be read", async () => {
    const w = await ruleWorldOnTuesday();
    const registry = { ...w.registry, people: unreadable(w.people) };
    expect(await call(registry, w.log, keyed(AGENT), "payment.create", PAY_1009)).toMatchObject({
      outcome: "COMMITTED",
    });
  });
});

describe("C2: the table is the company's role source, dsor_assignments", () => {
  it("DSOR-IDN-05: the shipped role-sources.json names dsor_assignments for both companies, and passes", () => {
    const { settings, problems } = checkRoleSettings(readRoleSettings(), logins.values());
    expect(problems).toStrictEqual([]);
    expect([...settings.entries()].map(([t, s]) => [t, s.kind])).toStrictEqual([
      ["org_456", "dsor_assignments"],
      ["org_789", "dsor_assignments"],
    ]);
  });

  it("DSOR-IDN-05: user_123's AP supervisor revoked in the table: the agent's next payment under his slip is refused, though the fake directory still says active", async () => {
    const w = await tableWorldOnTuesday();
    expect(await w.draft("INV-1009")).toMatchObject({ outcome: "COMMITTED" });
    await w.people.revoke("org_456", "user_123", "ap_supervisor", BY);
    expect(await w.draft("INV-2002")).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-IDN-07: user_123 removed from org_456: the agent is refused, and del_100, the slip he signed, is suspended", async () => {
    const w = await tableWorldOnTuesday();
    await w.people.remove("org_456", "user_123", BY);
    expect(await w.draft("INV-1009")).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(await w.registry.delegations.get("org_456", "del_100")).toMatchObject({
      slip: { status: "suspended" },
    });
  });

  it("DSOR-IDN-06: the table cannot be read: the agent is refused, with no answer kept from the call before", async () => {
    const w = await tableWorldOnTuesday();
    expect(await w.draft("INV-1009")).toMatchObject({ outcome: "COMMITTED" });
    const registry = { ...w.registry };
    const down = unreadable(w.people);
    w.people.memberOf = down.memberOf;
    expect(
      await call(registry, w.log, keyed(AGENT), "payment.create", {
        invoice: "dsor://org_456/invoice/INV-2002",
        expected_version: 1,
      }),
    ).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
  });

  it("Step 43b, C2: scim is still refused at start-up: this step builds dsor_assignments, beside step 19's idp_lookup", () => {
    const text = JSON.stringify({
      org_456: { kind: "scim", max_staleness: "PT1H" },
      org_789: { kind: "dsor_assignments", max_staleness: "PT1H" },
    });
    const { problems } = checkRoleSettings({ file: "role-sources.json", text }, logins.values());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^role-sources\.json: org_456's kind "scim" is not built/);
  });
});
