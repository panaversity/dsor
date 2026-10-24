// Step 43b: five commands of DSoR's own change the table of people. person.add and person.remove,
// role.grant, role.confirm, and role.revoke. Only a tenant administrator, a person, may call them;
// a powerful role waits for a second administrator, who is neither the one who asked nor the one it
// names; every call is recorded (DSOR-IDN-01, DSOR-IDN-07, DSOR-SOD-04c; step 43b's README, claims
// C3 to C6, decisions L1 to L4 and D3).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { keyed } from "./helpers.ts";
import { ruleWorldOnTuesday, tableWorldOnTuesday, type RuleWorld } from "./rule-world.ts";

const ADMIN: RequestEnvelope = { token: "tok_a100", tenant: "org_456" };
const CFO: RequestEnvelope = { token: "tok_d4e8", tenant: "org_456" };
const SUPERVISOR: RequestEnvelope = { token: "tok_2c91", tenant: "org_456" };
const AGENT: RequestEnvelope = { token: "tok_7f3a", tenant: "org_456" };
const OWNER = { person: "owner", reason: "pnpm grant, for the test" };
const DAY = 86_400_000;

const person = (id: string): string => `dsor://org_456/person/${id}`;

/** One of DSoR's own commands, called with a fresh key. */
function as(w: RuleWorld, who: RequestEnvelope, name: string, input: unknown): Promise<Answer> {
  return w.ask(keyed(who), name, input);
}

/** A world where cfo_100 is org_456's second administrator, as the owner's pnpm grant makes her. */
async function twoAdmins(): Promise<RuleWorld> {
  const w = await ruleWorldOnTuesday();
  await w.people.grant("org_456", "cfo_100", "tenant_admin", false, OWNER);
  return w;
}

/** The data of a committed answer. */
function dataOf(answer: Answer): Record<string, unknown> {
  expect(answer).toMatchObject({ outcome: "COMMITTED" });
  return (answer as { data: Record<string, unknown> }).data;
}

describe("C3: person.add and person.remove", () => {
  it("DSOR-IDN-01: admin_100 adds jane_200, a new hire, with no role; the call is recorded", async () => {
    const w = await ruleWorldOnTuesday();
    const added = await as(w, ADMIN, "person.add", {
      person: person("jane_200"),
      reason: "new AP clerk",
    });
    expect(dataOf(added)).toStrictEqual({ person: "jane_200", status: "active" });
    expect(await w.people.memberOf("org_456", "jane_200")).toStrictEqual({
      status: "active",
      roles: [],
    });
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "person.add@1",
      authorization: "ALLOW",
      correlation: { principal_id: "admin_100" },
    });
  });

  it.each([
    ["user_123, who is a person of org_456 already", "user_123", "CONFLICT"],
    ["accounts-payable-fte, an agent", "accounts-payable-fte", "VALIDATION_FAILED"],
    ["dsor-scheduler, a system login", "dsor-scheduler", "VALIDATION_FAILED"],
  ])("Step 43b, C3: adding %s is refused", async (_who, id, code) => {
    const w = await ruleWorldOnTuesday();
    expect(await as(w, ADMIN, "person.add", { person: person(id), reason: "x" })).toMatchObject({
      code,
    });
  });

  it.each([
    ["user_123, an AP supervisor", SUPERVISOR],
    ["the agent", AGENT],
  ])("Step 43b, C3: %s may not add a person", async (_who, who) => {
    const w = await ruleWorldOnTuesday();
    expect(
      await as(w, who, "person.add", { person: person("jane_200"), reason: "x" }),
    ).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    expect(await w.people.memberOf("org_456", "jane_200")).toBeUndefined();
  });

  it("DSOR-IDN-07: admin_100 removes user_123: his next call is no caller, and the agent's next payment under his slip is refused, the slip suspended", async () => {
    const w = await tableWorldOnTuesday();
    const removed = await as(w, ADMIN, "person.remove", {
      person: person("user_123"),
      reason: "left the company",
    });
    expect(dataOf(removed)).toStrictEqual({
      person: "user_123",
      status: "deprovisioned",
      roles: 1,
    });
    expect(
      await w.ask(SUPERVISOR, "invoice.get", { invoice: "dsor://org_456/invoice/INV-1008" }),
    ).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(await w.draft("INV-1009")).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(await w.registry.delegations.get("org_456", "del_100")).toMatchObject({
      slip: { status: "suspended" },
    });
  });

  it("Step 43b, C3: removing a person who is no member of org_456 is RESOURCE_NOT_FOUND", async () => {
    const w = await ruleWorldOnTuesday();
    expect(
      await as(w, ADMIN, "person.remove", { person: person("user_700"), reason: "x" }),
    ).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      message: 'no person "user_700" in org_456',
    });
  });
});

describe("C4: role.grant", () => {
  it("Step 43b, L1: an AP clerk is no powerful role: jane_200 holds it at once", async () => {
    const w = await ruleWorldOnTuesday();
    await as(w, ADMIN, "person.add", { person: person("jane_200"), reason: "new AP clerk" });
    const granted = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("jane_200"),
        role: "ap_clerk",
        reason: "her job",
      }),
    );
    expect(granted).toMatchObject({ person: "jane_200", role: "ap_clerk", state: "active" });
    expect(granted["grant"]).toMatch(/^dsor:\/\/org_456\/grant\/grt_[0-9a-f-]{36}$/);
    expect(await w.people.memberOf("org_456", "jane_200")).toStrictEqual({
      status: "active",
      roles: ["ap_clerk"],
    });
  });

  it("Step 43b, L1: CFO may approve, so a CFO grant to user_123 waits seven days for a second administrator, and counts for nothing until then", async () => {
    const w = await ruleWorldOnTuesday();
    const granted = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("user_123"),
        role: "CFO",
        reason: "promoted",
      }),
    );
    expect(granted).toMatchObject({ person: "user_123", role: "CFO", state: "pending" });
    expect(Date.parse(granted["expires_at"] as string) - w.clock.now).toBe(7 * DAY);
    expect((await w.people.memberOf("org_456", "user_123"))?.roles).toStrictEqual([
      "ap_supervisor",
    ]);
  });

  it.each([
    [
      "a role roles.json does not have",
      { person: person("user_123"), role: "cfo", reason: "x" },
      "VALIDATION_FAILED",
    ],
    [
      "a role the person holds already",
      { person: person("user_123"), role: "ap_supervisor", reason: "x" },
      "CONFLICT",
    ],
    [
      "a person who is no member of org_456",
      { person: person("user_700"), role: "ap_clerk", reason: "x" },
      "RESOURCE_NOT_FOUND",
    ],
  ])("Step 43b, C4: a grant of %s is refused", async (_case, input, code) => {
    const w = await ruleWorldOnTuesday();
    expect(await as(w, ADMIN, "role.grant", input)).toMatchObject({ code });
  });

  it.each([
    ["user_123, an AP supervisor", SUPERVISOR],
    ["the agent", AGENT],
  ])("Step 43b, C4: %s may not grant a role", async (_who, who) => {
    const w = await ruleWorldOnTuesday();
    expect(
      await as(w, who, "role.grant", { person: person("cfo_100"), role: "ap_clerk", reason: "x" }),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

describe("C5: role.confirm", () => {
  it("DSOR-SOD-04c: admin_100 asks for CFO for user_123, and cfo_100, a second administrator, confirms it: user_123's next call holds CFO", async () => {
    const w = await twoAdmins();
    const asked = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("user_123"),
        role: "CFO",
        reason: "promoted",
      }),
    );
    const confirmed = dataOf(
      await as(w, CFO, "role.confirm", { grant: asked["grant"], reason: "agreed" }),
    );
    expect(confirmed).toMatchObject({
      grant: asked["grant"],
      person: "user_123",
      role: "CFO",
      state: "active",
    });
    expect((await w.people.memberOf("org_456", "user_123"))?.roles.sort()).toStrictEqual([
      "CFO",
      "ap_supervisor",
    ]);
  });

  it("DSOR-SOD-04c: the administrator who asked cannot confirm their own grant", async () => {
    const w = await twoAdmins();
    const asked = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("user_123"),
        role: "CFO",
        reason: "promoted",
      }),
    );
    expect(
      await as(w, ADMIN, "role.confirm", { grant: asked["grant"], reason: "me" }),
    ).toMatchObject({
      code: "SOD_VIOLATION",
    });
    expect((await w.people.memberOf("org_456", "user_123"))?.roles).toStrictEqual([
      "ap_supervisor",
    ]);
  });

  it("Step 43b, D3: the person a grant names cannot confirm it, though they are an administrator", async () => {
    const w = await twoAdmins();
    const asked = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("cfo_100"),
        role: "ap_supervisor",
        reason: "more",
      }),
    );
    expect(
      await as(w, CFO, "role.confirm", { grant: asked["grant"], reason: "mine" }),
    ).toMatchObject({
      code: "SOD_VIOLATION",
    });
  });

  it.each([
    ["user_123, an AP supervisor", SUPERVISOR],
    ["the agent", AGENT],
  ])("Step 43b, C5: %s may not confirm a grant", async (_who, who) => {
    const w = await twoAdmins();
    const asked = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("cfo_100"),
        role: "ap_supervisor",
        reason: "x",
      }),
    );
    expect(await as(w, who, "role.confirm", { grant: asked["grant"], reason: "x" })).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  it("Step 43b, D7: a grant confirmed once, or past its seven days, cannot be confirmed", async () => {
    const w = await twoAdmins();
    const once = dataOf(
      await as(w, ADMIN, "role.grant", { person: person("user_123"), role: "CFO", reason: "x" }),
    );
    dataOf(await as(w, CFO, "role.confirm", { grant: once["grant"], reason: "x" }));
    expect(await as(w, CFO, "role.confirm", { grant: once["grant"], reason: "x" })).toMatchObject({
      code: "CONFLICT",
    });
    const late = dataOf(
      await as(w, ADMIN, "role.grant", {
        person: person("user_123"),
        role: "tenant_admin",
        reason: "x",
      }),
    );
    w.clock.now += 7 * DAY + 1000;
    expect(await as(w, CFO, "role.confirm", { grant: late["grant"], reason: "x" })).toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("C6: role.revoke", () => {
  it("DSOR-IDN-01: admin_100 revokes user_123's AP supervisor: his next invoice.issue is refused", async () => {
    const w = await ruleWorldOnTuesday();
    const revoked = dataOf(
      await as(w, ADMIN, "role.revoke", {
        person: person("user_123"),
        role: "ap_supervisor",
        reason: "moved",
      }),
    );
    expect(revoked).toStrictEqual({ person: "user_123", role: "ap_supervisor", ended: 1 });
    expect(
      await w.ask(keyed(SUPERVISOR), "invoice.issue", {
        invoice: "dsor://org_456/invoice/INV-1008",
        expected_version: 1,
      }),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("Step 43b, C6: a revoked pending grant can never be confirmed", async () => {
    const w = await twoAdmins();
    const asked = dataOf(
      await as(w, ADMIN, "role.grant", { person: person("user_123"), role: "CFO", reason: "x" }),
    );
    dataOf(
      await as(w, ADMIN, "role.revoke", {
        person: person("user_123"),
        role: "CFO",
        reason: "changed my mind",
      }),
    );
    expect(await as(w, CFO, "role.confirm", { grant: asked["grant"], reason: "x" })).toMatchObject({
      code: "CONFLICT",
    });
  });

  it("Step 43b, C6: revoking a role the person does not hold is RESOURCE_NOT_FOUND", async () => {
    const w = await ruleWorldOnTuesday();
    expect(
      await as(w, ADMIN, "role.revoke", { person: person("user_123"), role: "CFO", reason: "x" }),
    ).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("Step 43b, C3: login.invite asks the table: jane_200 can be invited once person.add has added her, and not before", async () => {
    const w = await ruleWorldOnTuesday();
    const invite = { person: person("jane_200"), reason: "new AP clerk" };
    expect(await as(w, ADMIN, "login.invite", invite)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
    await as(w, ADMIN, "person.add", invite);
    expect(await as(w, ADMIN, "login.invite", invite)).toMatchObject({ outcome: "COMMITTED" });
  });
});
