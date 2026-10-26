// Step 43c: a person of a company on its own directory signs in through that directory, and her
// token's sub is the uuid her directory pushed. That uuid names her in that company's copy, with no
// invitation. Nothing else in the token names anyone (DSOR-IDN-01, DSOR-IDN-04a, DSOR-IDN-04b;
// step 43c's README, claim C6, the learner's L6).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyConfirms, copyLogins, issuerProblems } from "../src/company-people.ts";
import type { Issuers } from "../src/issuers.ts";
import { realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { remoteKeys } from "../src/tokens.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";
import type { RuleWorld } from "./rule-world.ts";
import { scimWorldOnTuesday, spokeMinutesAgo, UUIDS } from "./scim-world.ts";

let authentik: TestIssuer;
let other: TestIssuer;
beforeAll(async () => {
  authentik = await startIssuer();
  other = await startIssuer();
});
afterAll(async () => {
  await authentik.close();
  await other.close();
});

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

/** The world's registry, with real logins: org_456 trusts its authentik, org_789 another issuer. */
function signedIn(w: RuleWorld) {
  const issuers: Issuers = new Map([
    ["org_456", [{ issuer: authentik.issuer, audience: authentik.audience, jwks: authentik.jwks }]],
    ["org_789", [{ issuer: other.issuer, audience: other.audience, jwks: other.jwks }]],
  ]);
  const byUuid = copyLogins(w.copy, w.registry.roleSettings, issuers);
  return {
    ...w.registry,
    logins: realLogins(
      issuers,
      w.book,
      remoteKeys(),
      Date.now,
      byUuid,
      copyConfirms(w.copy, w.registry.roleSettings),
    ),
  };
}

describe("Step 43c, C6: a login links by the uuid its directory pushed", () => {
  it("DSOR-IDN-01: the learner's L6: a token from org_456's authentik whose sub is cfo_100's uuid is cfo_100, with no invitation", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const token = await authentik.sign(UUIDS.cfo_100);
    expect(
      await call(signedIn(w), w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({ correlation: { principal_id: "cfo_100" }, data: { id: "INV-1008" } });
  });

  it.each([
    ["a uuid nobody was pushed with", "0b6f1d1e-3c3a-4a52-9a43-999999999999"],
    ["cfo_100's username, not her uuid", "cfo_100"],
  ])("DSOR-IDN-04b: a sub that is %s is no caller", async (_case, sub) => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const token = await authentik.sign(sub);
    expect(
      await call(signedIn(w), w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("DSOR-IDN-04b: break B7: a token's preferred_username names nobody: only its sub does", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const token = await authentik.sign("0b6f1d1e-3c3a-4a52-9a43-999999999999", {
      preferred_username: "cfo_100",
      groups: ["Finance-Approvers"],
    });
    expect(
      await call(signedIn(w), w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("DSOR-IDN-04a: another company's issuer, with cfo_100's uuid as sub, is no caller: the uuid names her only through org_456's own issuer", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const token = await other.sign(UUIDS.cfo_100);
    expect(
      await call(signedIn(w), w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("DSOR-IDN-07: the learner's L8: a user deleted in authentik signs in no more, whatever her token says", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const row = (await w.copy.users("org_456", { field: "userName", value: "cfo_100" }))[0]!;
    await w.copy.deleteUser("org_456", row.id);
    const token = await authentik.sign(UUIDS.cfo_100);
    expect(
      await call(signedIn(w), w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("DSOR-IDN-01: the roles are DSoR's, from the copy and the map: a token's groups claim gives none", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    // jane_200 is in no group in the copy; her token claims Finance-Approvers, the CFO's group.
    const jane = "0b6f1d1e-3c3a-4a52-9a43-000000000200";
    await w.copy.createUser("org_456", { user_name: "jane_200", external_id: jane, active: true });
    const token = await authentik.sign(jane, { groups: ["Finance-Approvers"], roles: ["CFO"] });
    const drafted = (await w.draft("INV-1008")) as { proposal: string; payload_hash: string };
    expect(
      await call(
        signedIn(w),
        w.log,
        { token, tenant: "org_456", idempotency_key: "k-login-by-uuid-1" },
        "proposal.approve",
        { proposal: drafted.proposal, payload_hash: drafted.payload_hash },
      ),
    ).toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

// From the review of step 43c, finding 6: with one issuer for two companies, org_789's directory could
//   push a user with cfo_100's uuid, and cfo_100 could sign in no more.
describe("Step 43c, the review's finding 6: a company on its directory has an issuer of its own", () => {
  it("DSOR-IDN-04a: the learner's L6: start-up refuses org_456 on scim when org_789 lists the same issuer", () => {
    const one = { issuer: authentik.issuer, audience: authentik.audience, jwks: authentik.jwks };
    const scim = new Map([
      ["org_456", { kind: "scim" as const, max_staleness: "PT2H", ms: 7_200_000 }],
      ["org_789", { kind: "dsor_assignments" as const, max_staleness: "PT1H", ms: 3_600_000 }],
    ]);
    expect(
      issuerProblems(
        scim,
        new Map([
          ["org_456", [one]],
          ["org_789", [one]],
        ]),
      ),
    ).toStrictEqual([
      `issuers.json: org_456 takes its people from its own directory, so its issuer ${authentik.issuer} is its own: org_789 lists it too`,
    ]);
    expect(
      issuerProblems(
        scim,
        new Map([
          ["org_456", [one]],
          ["org_789", []],
        ]),
      ),
    ).toStrictEqual([]);
  });

  it("DSOR-IDN-04a: a uuid two companies' copies name, under one shared issuer, names nobody", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.copy.createUser("org_789", {
      user_name: "mallory_1",
      external_id: UUIDS.cfo_100,
      active: true,
    });
    const shared = [
      { issuer: authentik.issuer, audience: authentik.audience, jwks: authentik.jwks },
    ];
    const issuers: Issuers = new Map([
      ["org_456", shared],
      ["org_789", shared],
    ]);
    const both = new Map([
      ["org_456", { kind: "scim" as const, max_staleness: "PT2H", ms: 7_200_000 }],
      ["org_789", { kind: "scim" as const, max_staleness: "PT2H", ms: 7_200_000 }],
    ]);
    expect(
      await copyLogins(w.copy, both, issuers)(authentik.issuer, UUIDS.cfo_100),
    ).toBeUndefined();
  });
});

// From the review of step 43c, finding 7: a login linked by step 43's invitation, before org_456 moved
//   to its directory, still named its person, and login.unlink is refused for org_456 now.
describe("Step 43c, the review's finding 7: for a company on its directory, the copy decides who a login is", () => {
  it("DSOR-IDN-04a: an old link of cfo_100, under a sub her directory never pushed, counts in no company on scim", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    const oldSub = "neon-user-0001";
    await w.book.link({ issuer: authentik.issuer, subject: oldSub, principal: "cfo_100" });
    const token = await authentik.sign(oldSub);
    const answer = await call(
      signedIn(w),
      w.log,
      { token, tenant: "org_456" },
      "invoice.get",
      INV_1008,
    );
    expect(answer).not.toHaveProperty("data");
    expect(answer).toMatchObject({
      code: expect.stringMatching(/AUTHENTICATION_REQUIRED|AUTHORIZATION_DENIED/),
    });
  });

  it("DSOR-IDN-01: her link under her own uuid counts as before", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.book.link({ issuer: authentik.issuer, subject: UUIDS.cfo_100, principal: "cfo_100" });
    const token = await authentik.sign(UUIDS.cfo_100);
    expect(
      await call(signedIn(w), w.log, { token, tenant: "org_456" }, "invoice.get", INV_1008),
    ).toMatchObject({ correlation: { principal_id: "cfo_100" }, data: { id: "INV-1008" } });
  });
});
