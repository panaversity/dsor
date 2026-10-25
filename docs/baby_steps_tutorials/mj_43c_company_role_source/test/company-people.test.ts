// Step 43c: for a company on its own directory, line ① and the role source read the copy, through the
// company's role map, and only while the directory has spoken within max_staleness (DSOR-IDN-05,
// DSOR-IDN-06, DSOR-IDN-07; step 43c's README, claims C4 and C5, decisions L2, L7, L8, and D2).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { CFO, keyed, SUPERVISOR } from "./helpers.ts";
import type { RuleWorld } from "./rule-world.ts";
import { scimWorldOnTuesday, spokeMinutesAgo, UUIDS } from "./scim-world.ts";

const USER_700: RequestEnvelope = { token: "tok_e1a7", tenant: "org_789" };
const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// A command carries a fresh idempotency key; a query carries none.
const as = (w: RuleWorld, who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  w.ask(name === "invoice.get" ? who : keyed(who), name, input);

/** The copy's row of one of org_456's people. */
async function rowOf(w: RuleWorld, person: string) {
  return (await w.copy.users("org_456", { field: "userName", value: person }))[0]!;
}

/** The agent drafts INV-1008, which waits for the CFO; then cfo_100 approves it. */
async function cfoApproves(w: RuleWorld): Promise<Answer> {
  const drafted = (await w.draft("INV-1008")) as { proposal: string; payload_hash: string };
  return as(w, CFO, "proposal.approve", {
    proposal: drafted.proposal,
    payload_hash: drafted.payload_hash,
  });
}

/** The status of del_100, the slip user_123 signed. */
async function del100(w: RuleWorld): Promise<string> {
  return ((await w.registry.delegations.get("org_456", "del_100")) as { slip: { status: string } })
    .slip.status;
}

describe("Step 43c, C4: a company on scim is read from its directory's copy", () => {
  it("DSOR-IDN-05: cfo_100, in Finance-Approvers in org_456's copy, approves INV-1008 as its CFO", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    expect(await cfoApproves(w)).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-IDN-04a: removed from Finance-Approvers in authentik, cfo_100 holds no CFO in DSoR", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const finance = (
      await w.copy.groups("org_456", { field: "externalId", value: UUIDS.finance })
    )[0]!;
    await w.copy.changeGroup("org_456", finance.id, {
      add: [],
      remove: [(await rowOf(w, "cfo_100")).id],
    });
    expect(await w.people.memberOf("org_456", "cfo_100")).toStrictEqual({
      status: "active",
      roles: [],
    });
    expect(await cfoApproves(w)).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("DSOR-IDN-04a: the Common mistake: a second group named Finance-Approvers, with another id, gives no role", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.copy.createGroup("org_456", {
      name: "Finance-Approvers",
      external_id: "0b6f1d1e-3c3a-4a52-9a43-222222222222",
      members: [(await rowOf(w, "user_123")).id],
    });
    expect((await w.people.memberOf("org_456", "user_123"))?.roles).toStrictEqual([
      "ap_supervisor",
    ]);
  });

  it("DSOR-IDN-07: the learner's L8: user_123 made inactive in authentik: the agent's payment under del_100 is refused, and del_100 is suspended", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const row = await rowOf(w, "user_123");
    await w.copy.replaceUser("org_456", row.id, { ...row, active: false });
    expect(await w.draft("INV-2002")).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(await del100(w)).toBe("suspended");
    expect(w.drafted).toStrictEqual([]);
  });

  it("DSOR-IDN-07: the learner's L8: user_123 deleted in authentik: the same, and he is deprovisioned", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.copy.deleteUser("org_456", (await rowOf(w, "user_123")).id);
    expect(await w.people.memberOf("org_456", "user_123")).toStrictEqual({
      status: "deprovisioned",
      roles: [],
    });
    expect(await w.draft("INV-2002")).toMatchObject({ code: "DELEGATION_REQUIRED" });
    expect(await del100(w)).toBe("suspended");
  });

  // From the review of step 43c, finding 1: a new user123 under the leaver's id paid under her slip.
  it("DSOR-IDN-07: user_123 deleted, and a new hire pushed as user_123 with another uuid: refused as taken, and the agent pays nothing under del_100", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.copy.deleteUser("org_456", (await rowOf(w, "user_123")).id);
    await expect(
      w.copy.createUser("org_456", {
        user_name: "user_123",
        external_id: "99999999-0000-4000-8000-000000000123",
        active: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await w.draft("INV-2002")).toMatchObject({ code: "DELEGATION_REQUIRED" });
  });

  it("DSOR-IDN-01: the learner's L8: user_123, suspended and then active again, is a caller again", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const row = await rowOf(w, "user_123");
    await w.copy.replaceUser("org_456", row.id, { ...row, active: false });
    // Active in no company: no caller at all, as step 43b answers a person removed everywhere.
    expect(await as(w, SUPERVISOR, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    await w.copy.replaceUser("org_456", row.id, { ...row, active: true });
    expect(await as(w, SUPERVISOR, "invoice.get", INV_1008)).toMatchObject({
      correlation: { principal_id: "user_123" },
      data: { id: "INV-1008" },
    });
  });

  it("DSOR-IDN-05: the learner's L10: org_456's own table is not read: cfo_100 not pushed is no caller, whatever the table says", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.copy.deleteUser("org_456", (await rowOf(w, "cfo_100")).id);
    expect(
      (await w.registry.people.membershipsOf("cfo_100")).map((m) => m.tenant_id),
    ).toStrictEqual([]);
    expect(await as(w, CFO, "invoice.get", INV_1008)).toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("DSOR-IDN-05: org_789, on DSoR's own table, is read from the table as in step 43b", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    expect(await w.people.memberOf("org_789", "user_700")).toStrictEqual({
      status: "active",
      roles: ["ap_supervisor"],
    });
    expect(
      await as(w, USER_700, "invoice.get", { invoice: "dsor://org_789/invoice/INV-1008" }),
    ).toMatchObject({ correlation: { principal_id: "user_700" }, data: { id: "INV-1008" } });
  });
});

describe("Step 43c, C5: a copy whose directory has not spoken within two hours is not used", () => {
  it("DSOR-IDN-06: the learner's L7: two hours and a minute since org_456's authentik spoke, the agent under user_123's slip is refused", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(121));
    expect(await w.draft("INV-2002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
    expect(w.drafted).toStrictEqual([]);
    // Not known to be gone: only not known. del_100 is not suspended.
    expect(await del100(w)).toBe("active");
  });

  it("DSOR-IDN-06: an hour and fifty-nine minutes since it spoke, the copy counts", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(119));
    expect(await w.draft("INV-2002")).toMatchObject({ outcome: "COMMITTED" });
  });

  it("DSOR-IDN-06: a directory DSoR has never heard from: the agent is refused", async () => {
    const w = await scimWorldOnTuesday(async () => undefined);
    expect(await w.draft("INV-2002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
  });

  it("DSOR-IDN-06: a person on the call, with an old copy, is refused as an outage, never as a stranger", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(121));
    // Changed by the real run of 2026-10-26: and it says which copy is old, not that a table could not
    //   be read.
    expect(await as(w, CFO, "invoice.get", INV_1008)).toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
      message:
        "the sign-in service could not be checked now (DSoR has not heard from the directory of org_456 recently enough): try again",
    });
  });

  it("DSOR-IDN-06: a time from the future is no answer: a clock that went back never makes an old copy young", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(-10));
    expect(await w.draft("INV-2002")).toMatchObject({ code: "FRESHNESS_UNSATISFIABLE" });
  });

  it("DSOR-IDN-06: org_789, on DSoR's own table, is never refused for org_456's silence", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(121));
    expect(
      await as(w, USER_700, "invoice.get", { invoice: "dsor://org_789/invoice/INV-1008" }),
    ).toMatchObject({ correlation: { principal_id: "user_700" }, data: { id: "INV-1008" } });
  });
});
