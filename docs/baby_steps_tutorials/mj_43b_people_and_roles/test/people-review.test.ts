// Step 43b: what the hostile review of this step found, each written red first. One company's
// administrator could take another company's person; a removed CFO's approval still released a
// payment; the list of powerful roles missed what it did not name; and smaller gaps (step 43b's
// README, "What the review found").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { realLogins } from "../src/logins.ts";
import { isPowerful, memoryPeople } from "../src/people.ts";
import { call } from "../src/pipeline.ts";
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

const ADMIN_456: RequestEnvelope = { token: "tok_a100", tenant: "org_456" };
const ADMIN_789: RequestEnvelope = { token: "tok_a700", tenant: "org_789" };
const CFO: RequestEnvelope = { token: "tok_d4e8", tenant: "org_456" };
const AGENT: RequestEnvelope = { token: "tok_7f3a", tenant: "org_456" };
const OWNER = { person: "owner", reason: "a step 43b test" };
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

const as = (w: RuleWorld, who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  w.ask(keyed(who), name, input);

/** The agent's INV-1008, which waits for the CFO, and cfo_100's approval of it. */
async function approvedByCfo(w: RuleWorld): Promise<{ proposal: string; id: string }> {
  const drafted = (await w.draft("INV-1008")) as { proposal: string; payload_hash: string };
  const id = drafted.proposal.split("/").at(-1) as string;
  const approved = await as(w, CFO, "proposal.approve", {
    proposal: drafted.proposal,
    payload_hash: drafted.payload_hash,
  });
  expect(approved).toMatchObject({ outcome: "COMMITTED" });
  return { proposal: drafted.proposal, id };
}

describe("From the review, finding 1: one company's administrator cannot take another company's person", () => {
  it("DSOR-IDN-03a: admin_700 cannot add cfo_100, a person of org_456, to org_789", async () => {
    const w = await ruleWorldOnTuesday();
    expect(
      await as(w, ADMIN_789, "person.add", {
        person: "dsor://org_789/person/cfo_100",
        reason: "x",
      }),
    ).toMatchObject({ code: "CONFLICT", message: "the id cfo_100 is taken: choose another" });
    expect(await w.people.memberOf("org_789", "cfo_100")).toBeUndefined();
  });

  it("DSOR-IDN-03a: admin_100 and admin_700 add the same new id at the same moment: one adds it, the other hears the id is taken (the code review of step 43b, finding 3)", async () => {
    const w = await ruleWorldOnTuesday();
    const both = await Promise.all([
      as(w, ADMIN_456, "person.add", { person: "dsor://org_456/person/jane_300", reason: "x" }),
      as(w, ADMIN_789, "person.add", { person: "dsor://org_789/person/jane_300", reason: "x" }),
    ]);
    expect(both.filter((answer) => "outcome" in answer)).toHaveLength(1);
    expect(both.filter((answer) => "code" in answer && answer.code === "CONFLICT")).toHaveLength(1);
    expect(await w.people.companiesOf("jane_300")).toHaveLength(1);
  });

  it("DSOR-IDN-03a: a person in both companies: org_789's login.unlink never ends the login org_456's invitation made", async () => {
    const w = await ruleWorldOnTuesday();
    // cfo_100 works in both, as the owner's rows can say.
    await w.people.add("org_789", "cfo_100", OWNER);
    const issuers = new Map([
      ["org_456", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
      ["org_789", [{ issuer: a.issuer, audience: a.audience, jwks: a.jwks }]],
    ]);
    const registry = { ...w.registry, logins: realLogins(issuers, w.book, remoteKeys()) };
    const { code } = await w.book.invite("org_456", "cfo_100", {
      person: "admin_100",
      reason: "x",
    });
    const token = await a.sign("ba_cfo");
    expect(
      await call(
        registry,
        w.log,
        { token, tenant: "org_456", invitation: code },
        "invoice.get",
        INV_1008,
      ),
    ).toMatchObject({ correlation: { principal_id: "cfo_100" } });
    const ended = await as(w, ADMIN_789, "login.unlink", {
      person: "dsor://org_789/person/cfo_100",
      reason: "x",
    });
    expect(ended).toMatchObject({ outcome: "COMMITTED", data: { logins: 0 } });
    expect(
      await call(registry, w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({
      correlation: { principal_id: "cfo_100" },
    });
  });
});

describe("From the review, finding 2: an approval counts only while its approver still holds the role", () => {
  it.each([
    ["removed from org_456", (w: RuleWorld) => w.people.remove("org_456", "cfo_100", OWNER)],
    [
      "whose CFO role is revoked",
      (w: RuleWorld) => w.people.revoke("org_456", "cfo_100", "CFO", OWNER),
    ],
  ])(
    "DSOR-APR-03b: cfo_100 approves INV-1008 and is then %s: the agent's release is invalidated, and nothing is paid",
    async (_what, change) => {
      const w = await ruleWorldOnTuesday();
      const { proposal, id } = await approvedByCfo(w);
      await change(w);
      const released = await as(w, AGENT, "proposal.execute", { proposal });
      expect(released).toMatchObject({ code: "APPROVAL_INVALIDATED" });
      expect(await w.proposals.get("org_456", id)).toMatchObject({ state: "INVALIDATED" });
      expect(w.drafted.filter((p) => p.invoice_id === "INV-1008")).toStrictEqual([]);
    },
  );

  it("DSOR-APR-03b: with cfo_100 still CFO, the same release goes through", async () => {
    const w = await ruleWorldOnTuesday();
    const { proposal } = await approvedByCfo(w);
    expect(await as(w, AGENT, "proposal.execute", { proposal })).toMatchObject({
      outcome: "COMMITTED",
    });
  });
});

describe("From the review, findings 5 and 8: which roles are powerful, and which a person may hold", () => {
  const roles = (map: Record<string, string[]>) =>
    new Map(Object.entries(map).map(([k, v]) => [k, new Set(v)]));
  it.each([
    ["CFO", true],
    ["ap_supervisor", true],
    ["tenant_admin", true],
    ["ap_clerk", false],
  ])("Step 43b, L1: the shipped %s is powerful: %s", async (role, powerful) => {
    const w = await ruleWorldOnTuesday();
    expect(isPowerful(role, w.registry.roles)).toBe(powerful);
  });

  it.each([
    ["rule:manage", true],
    ["control:suspend", true],
    ["login:invite", true],
    ["invoice:read", false],
  ])(
    "Step 43b, L1: a role holding only %s is powerful: %s, because only harmless permissions are named",
    (permission, powerful) => {
      expect(isPowerful("custom", roles({ custom: [permission] }))).toBe(powerful);
    },
  );

  it.each(["scheduler", "rate_loader"])(
    "Step 43b, L6: %s is a role of DSoR's system logins, never granted to a person",
    async (role) => {
      const w = await ruleWorldOnTuesday();
      expect(
        await as(w, ADMIN_456, "role.grant", {
          person: "dsor://org_456/person/cfo_100",
          role,
          reason: "x",
        }),
      ).toMatchObject({
        code: "VALIDATION_FAILED",
        message: `${role} is a role of DSoR's system logins, never a person's`,
      });
    },
  );
});

describe("From the review, findings 6, 9, 11, and 13: the smaller gaps", () => {
  it("Step 43b, D6: a pending grant ends with its person: removed, added again, it can never be confirmed", async () => {
    const people = memoryPeople();
    const asked = await people.grant("org_456", "user_123", "CFO", true, {
      person: "admin_100",
      reason: "x",
    });
    await people.remove("org_456", "user_123", OWNER);
    await people.add("org_456", "user_123", OWNER);
    await expect(
      people.confirm("org_456", asked.id, { person: "owner", reason: "x" }),
    ).rejects.toThrow(`no grant waits as ${asked.id} in org_456`);
  });

  it("Step 43b, C4: the table itself refuses a grant to someone who is no active person of the company", async () => {
    const people = memoryPeople();
    await expect(people.grant("org_456", "user_700", "ap_clerk", false, OWNER)).rejects.toThrow(
      "user_700 is no active person of org_456",
    );
  });

  it("Step 43b, C3: person.remove cancels the person's open invitations, and a removed person cannot be invited", async () => {
    const w = await ruleWorldOnTuesday();
    const jane = { person: "dsor://org_456/person/jane_200", reason: "new hire" };
    await as(w, ADMIN_456, "person.add", jane);
    expect(await as(w, ADMIN_456, "login.invite", jane)).toMatchObject({ outcome: "COMMITTED" });
    await as(w, ADMIN_456, "person.remove", jane);
    expect((await w.book.invitations()).every((i) => i.cancelled_by === "admin_100")).toBe(true);
    expect(await as(w, ADMIN_456, "login.invite", jane)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it.each(["owner", "dsor"])(
    "Step 43b, C3: %s is a name DSoR's records use for itself, never a person's",
    async (id) => {
      const w = await ruleWorldOnTuesday();
      expect(
        await as(w, ADMIN_456, "person.add", {
          person: `dsor://org_456/person/${id}`,
          reason: "x",
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED" });
    },
  );

  it("DSOR-EXE-02: a confirm refused as SOD_VIOLATION is recorded DENY", async () => {
    const w = await ruleWorldOnTuesday();
    const asked = (await as(w, ADMIN_456, "role.grant", {
      person: "dsor://org_456/person/user_123",
      role: "CFO",
      reason: "x",
    })) as { data: { grant: string } };
    expect(
      await as(w, ADMIN_456, "role.confirm", { grant: asked.data.grant, reason: "x" }),
    ).toMatchObject({
      code: "SOD_VIOLATION",
    });
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "role.confirm@1",
      authorization: "DENY",
      result: "SOD_VIOLATION",
    });
  });
});
