// Step 43c: a push is a call like any other. directory.push changes a company's copy and
// directory.read reads it, called only by that company's directory login, a system principal with
// one role in one company. Each call is recorded, and the latest ALLOW record is when DSoR last heard
// from the directory (DSOR-IDN-03a, DSOR-IDN-05, DSOR-EXE-02; step 43c's README, claim C3, decisions
// D1, D2, D4, and D5).
import { describe, expect, it } from "vitest";
import { readRoleSettings, SCIM_ROLE_SOURCES } from "../src/authority.ts";
import type { Answer } from "../src/envelope.ts";
import { memoryCopy, type DirectoryCopy } from "../src/directory-copy.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { AGENT, CFO, keyed } from "./helpers.ts";
import { ruleWorld, type RuleWorld } from "./rule-world.ts";
import { scimWorldOnTuesday, spokeMinutesAgo, storyCopy, UUIDS } from "./scim-world.ts";

const DIRECTORY_456: RequestEnvelope = { token: "tok_5c1a", tenant: "org_456" };
const DIRECTORY_789: RequestEnvelope = { token: "tok_5c7b", tenant: "org_789" };

// The company the caller's call names, as the SCIM door writes it from the token.
const companyOf = (who: RequestEnvelope) => `dsor://${who.tenant}/tenant/${who.tenant}`;
/** A push of one change, written { change: kind, …its fields }, into the caller's company. */
const push = (
  w: RuleWorld,
  who: RequestEnvelope,
  { change, ...fields }: { change: string } & Record<string, unknown>,
): Promise<Answer> =>
  w.ask(keyed(who), "directory.push", {
    company: companyOf(who),
    change: { kind: change, ...fields },
  });
const read = (
  w: RuleWorld,
  who: RequestEnvelope,
  input: Record<string, unknown>,
): Promise<Answer> => w.ask(who, "directory.read", { company: companyOf(who), ...input });

const JANE = {
  user_name: "jane_200",
  external_id: "fc9b026d-0000-4000-8000-000000000200",
  display_name: "Jane Doe",
  active: true,
};

// Both companies on their own directories, each with a map, for the tests of one company's rows
//   against another's.
const BOTH = {
  file: "role-sources.json",
  text: JSON.stringify({
    org_456: { kind: "scim", max_staleness: "PT2H" },
    org_789: { kind: "scim", max_staleness: "PT2H" },
  }),
};
const BOTH_MAPS = {
  file: "role-maps.json",
  text: JSON.stringify({
    org_456: [{ group: UUIDS.finance, name: "Finance-Approvers", role: "CFO" }],
    org_789: [],
  }),
};

/** Tuesday's world, with org_456 on its directory, this copy, and the log as the only clock of hearing. */
async function emptyScimWorld(
  settings = readRoleSettings(SCIM_ROLE_SOURCES),
  copy: DirectoryCopy = memoryCopy(),
): Promise<RuleWorld> {
  const w = ruleWorld(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    settings,
    { copy, maps: settings === BOTH ? BOTH_MAPS : undefined },
  );
  await w.rates.load("org_456", {
    source: "ecb-daily",
    base: "EUR",
    published_at: "2026-10-06T14:00:00.000Z",
    rates: { USD: "1.0800", GBP: "0.8532", PKR: "302.40" },
  });
  return w;
}

describe("Step 43c, C3: org_456's directory login keeps org_456's copy", () => {
  it("DSOR-IDN-05: authentik's first push, as the real check saw it: users, then groups with members; cfo_100 then approves as CFO", async () => {
    const fresh = await emptyScimWorld();
    const cfo = (await push(fresh, DIRECTORY_456, {
      change: "user.create",
      account: { user_name: "cfo_100", external_id: UUIDS.cfo_100, active: true },
    })) as { outcome: string; data: { id: string } };
    expect(cfo).toMatchObject({ outcome: "COMMITTED", data: { user_name: "cfo_100" } });
    const group = await push(fresh, DIRECTORY_456, {
      change: "group.create",
      group: { name: "Finance-Approvers", external_id: UUIDS.finance, members: [cfo.data.id] },
    });
    expect(group).toMatchObject({
      outcome: "COMMITTED",
      data: { members: [{ id: cfo.data.id }] },
    });
    expect(await fresh.people.memberOf("org_456", "cfo_100")).toStrictEqual({
      status: "active",
      roles: ["CFO"],
    });
  });

  it("DSOR-EXE-02: a push is recorded ALLOW, by org_456's directory login, in org_456", async () => {
    const w = await emptyScimWorld();
    await push(w, DIRECTORY_456, { change: "user.create", account: JANE });
    expect((await w.log.records()).at(-1)).toMatchObject({
      operation: "directory.push@1",
      authorization: "ALLOW",
      tenant: "org_456",
      correlation: { principal_id: "directory-org_456" },
    });
  });

  it("DSOR-IDN-06: decision D2: before org_456's directory has spoken, nobody of org_456 can be read; its first push makes the copy count", async () => {
    const w = await emptyScimWorld();
    await expect(w.people.memberOf("org_456", "jane_200")).rejects.toThrow(
      "DSoR has not heard from the directory of org_456 recently enough",
    );
    await push(w, DIRECTORY_456, { change: "user.create", account: JANE });
    expect(await w.people.memberOf("org_456", "jane_200")).toStrictEqual({
      status: "active",
      roles: [],
    });
  });

  it("DSOR-IDN-06: decision D2: a read alone, as authentik's quiet sync sends, counts as hearing from the directory (the real check, F3)", async () => {
    const w = await emptyScimWorld(readRoleSettings(SCIM_ROLE_SOURCES), await storyCopy());
    expect(await w.draft("INV-2002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(await read(w, DIRECTORY_456, { what: "users" })).toMatchObject({
      data: { items: expect.any(Array) },
    });
    expect(await w.draft("INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });

  // From the real run of 2026-10-26: authentik, pointed at a fresh copy, sent pushes that all failed,
  //   and each was an ALLOW record, so DSoR called the empty copy current.
  // Changed by the learner's L7b, after the review of step 43c, finding 5: and a refused push makes
  //   the copy stale at once, whatever reads follow, until a later push succeeds. Otherwise a refused
  //   deactivation kept a leaver's power for as long as authentik retried.
  it("DSOR-IDN-06: the learner's L7b: a refused push stops the copy at once; reads after it do not bring it back; a push that succeeds does", async () => {
    const w = await emptyScimWorld(readRoleSettings(SCIM_ROLE_SOURCES), await storyCopy());
    await read(w, DIRECTORY_456, { what: "users" });
    expect(await w.draft("INV-2002")).toMatchObject({ outcome: "COMMITTED" });
    const nobody = "00000000-0000-4000-8000-00000000dead";
    const finance = (
      await w.copy.groups("org_456", { field: "externalId", value: UUIDS.finance })
    )[0]!;
    expect(
      await push(w, DIRECTORY_456, {
        change: "group.change",
        id: finance.id,
        operations: [{ op: "add", members: [nobody] }],
      }),
    ).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await w.draft("INV-2007")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    await read(w, DIRECTORY_456, { what: "groups" });
    expect(await w.draft("INV-2007")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(
      await push(w, DIRECTORY_456, {
        change: "group.change",
        id: finance.id,
        operations: [{ op: "add", members: [] }],
      }),
    ).toMatchObject({ outcome: "COMMITTED" });
    expect(await w.draft("INV-2007")).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-IDN-06: decision D2: only org_456's own directory login is org_456's directory: another company's directory, and the agent's own calls, are no word from it (the review of step 43c)", async () => {
    const w = await emptyScimWorld(BOTH, await storyCopy());
    await read(w, DIRECTORY_789, { what: "users" });
    await w.ask({ token: "tok_7f3a", tenant: "org_456" }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });
    expect(await w.draft("INV-2002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
  });

  it("DSOR-IDN-03a: decision D4: a search by org_456's directory shows org_456's copy only", async () => {
    const both = await emptyScimWorld(BOTH);
    await push(both, DIRECTORY_789, {
      change: "user.create",
      account: { ...JANE, user_name: "jane_789" },
    });
    expect(
      await read(both, DIRECTORY_456, {
        what: "users",
        filter: { field: "userName", value: "jane_789" },
      }),
    ).toMatchObject({ data: { items: [] } });
  });
});

describe("Step 43c, C3: who may push, and what a push may say", () => {
  it.each([
    ["cfo_100, a person", CFO],
    ["the agent", AGENT],
  ])("DSOR-AUT-01a: %s cannot push", async (_who, who) => {
    // A fresh copy, so line ① and line ③ pass, and only the permission can refuse.
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    expect(await push(w, who, { change: "user.create", account: JANE })).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  it("DSOR-IDN-03a: org_789's directory login cannot push into org_456", async () => {
    const w = await emptyScimWorld();
    expect(
      await push(
        w,
        { ...DIRECTORY_789, tenant: "org_456" },
        { change: "user.create", account: JANE },
      ),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await w.copy.users("org_456")).toStrictEqual([]);
  });

  it("DSOR-TEN-02b: a push by org_456's directory that names org_789's company is refused, and changes nothing", async () => {
    const w = await emptyScimWorld();
    expect(
      await w.ask(keyed(DIRECTORY_456), "directory.push", {
        company: "dsor://org_789/tenant/org_789",
        change: { kind: "user.create", account: JANE },
      }),
    ).toMatchObject({ code: "TENANT_MISMATCH" });
    expect(await w.copy.users("org_456")).toStrictEqual([]);
  });

  it("DSOR-IDN-05: the learner's L10: a push into org_789, which is on DSoR's own table, is refused", async () => {
    const w = await emptyScimWorld();
    expect(await push(w, DIRECTORY_789, { change: "user.create", account: JANE })).toMatchObject({
      code: "CONFLICT",
      message: "org_789's role source is DSoR's own table, not its directory",
    });
  });

  it.each([
    ["an e-mail address", "carla@example.com"],
    ["a name in capitals", "Carla"],
    ["DSoR's own name for the owner", "owner"],
    ["the agent's id", "accounts-payable-fte"],
    ["a system login's id", "dsor-scheduler"],
    ["a directory login's id", "directory-org_456"],
  ])(
    "DSOR-IDN-01: decision D5: a username that is %s is no person's DSoR id",
    async (_case, name) => {
      const w = await emptyScimWorld();
      expect(
        await push(w, DIRECTORY_456, {
          change: "user.create",
          account: { ...JANE, user_name: name },
        }),
      ).toMatchObject({ code: "VALIDATION_FAILED" });
    },
  );

  it("DSOR-IDN-05: decision D5: a user with no externalId is refused, never kept unkeyed (the real check, F8)", async () => {
    const w = await emptyScimWorld();
    const { external_id: _x, ...noId } = JANE;
    expect(await push(w, DIRECTORY_456, { change: "user.create", account: noId })).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("DSOR-IDN-03a: an id DSoR's table gives a person of org_789 is taken for org_456's directory", async () => {
    const w = await emptyScimWorld();
    expect(
      await push(w, DIRECTORY_456, {
        change: "user.create",
        account: { ...JANE, user_name: "user_700" },
      }),
    ).toMatchObject({ code: "CONFLICT", message: "the id user_700 is taken: choose another" });
  });

  it("DSOR-IDN-03a: decision D4: org_456's directory cannot change a row of org_789's copy", async () => {
    const both = await emptyScimWorld(BOTH);
    const theirs = (await push(both, DIRECTORY_789, {
      change: "user.create",
      account: { ...JANE, user_name: "jane_789" },
    })) as { data: { id: string } };
    expect(
      await push(both, DIRECTORY_456, {
        change: "user.replace",
        id: theirs.data.id,
        account: { ...JANE, user_name: "jane_789", active: false },
      }),
    ).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    expect((await both.copy.users("org_789"))[0]).toMatchObject({ active: true });
  });
});

// Changed by the learner's L8b, after the review of step 43c, finding 1: at the next use, a person
//   suspended and made active again before the agent next called never had her slips suspended,
//   though her directory reported it.
describe("Step 43c, L8b: the push that says a person left suspends her slips, in its own transaction", () => {
  /** The status of del_100, the slip user_123 signed. */
  const del100 = async (w: RuleWorld): Promise<string> =>
    ((await w.registry.delegations.get("org_456", "del_100")) as { slip: { status: string } }).slip
      .status;

  it.each([
    [
      "active: false",
      (id: string) => ({
        change: "user.replace",
        id,
        account: { user_name: "user_123", external_id: UUIDS.user_123, active: false },
      }),
    ],
    ["a delete", (id: string) => ({ change: "user.delete", id })],
  ])(
    "DSOR-IDN-07: %s of user_123 suspends del_100 at once, before the agent calls",
    async (_case, change) => {
      const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
      const row = (await w.copy.users("org_456", { field: "userName", value: "user_123" }))[0]!;
      expect(await push(w, DIRECTORY_456, change(row.id))).toMatchObject({ outcome: "COMMITTED" });
      expect(await del100(w)).toBe("suspended");
    },
  );

  it("DSOR-IDN-07: user_123 suspended and made active again before the agent calls: del_100 stays suspended", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const row = (await w.copy.users("org_456", { field: "userName", value: "user_123" }))[0]!;
    const account = { user_name: "user_123", external_id: UUIDS.user_123 };
    await push(w, DIRECTORY_456, {
      change: "user.replace",
      id: row.id,
      account: { ...account, active: false },
    });
    await push(w, DIRECTORY_456, {
      change: "user.replace",
      id: row.id,
      account: { ...account, active: true },
    });
    expect(await del100(w)).toBe("suspended");
    expect(await w.draft("INV-2002")).toMatchObject({ code: "DELEGATION_REQUIRED" });
  });

  it("DSOR-IDN-07: an active user's change, a new display name, suspends nothing", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const row = (await w.copy.users("org_456", { field: "userName", value: "user_123" }))[0]!;
    await push(w, DIRECTORY_456, {
      change: "user.replace",
      id: row.id,
      account: {
        user_name: "user_123",
        external_id: UUIDS.user_123,
        display_name: "Umar K.",
        active: true,
      },
    });
    expect(await del100(w)).toBe("active");
  });
});
