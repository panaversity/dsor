// Step 43c: one truth per company. A company whose people come from its own directory takes no change
// to its people from DSoR's own commands: step 43b's five, and step 43's invitations and unlinks. Each
// is refused at line ⑨, before any work, and recorded DENY (DSOR-IDN-05, DSOR-EXE-02; step 43c's
// README, claim C7, the learner's L10).
import { describe, expect, it } from "vitest";
import type { Answer } from "../src/envelope.ts";
import type { RequestEnvelope } from "../src/request.ts";
import { keyed } from "./helpers.ts";
import type { RuleWorld } from "./rule-world.ts";
import { scimWorldOnTuesday, spokeMinutesAgo } from "./scim-world.ts";

// admin_100, in Tenant-Admins in org_456's copy, so its tenant administrator.
const ADMIN_456: RequestEnvelope = { token: "tok_a100", tenant: "org_456" };
const ADMIN_789: RequestEnvelope = { token: "tok_a700", tenant: "org_789" };
const JANE = { person: "dsor://org_456/person/jane_200", reason: "a new hire" };
const CFO = { person: "dsor://org_456/person/cfo_100", reason: "x" };

const as = (w: RuleWorld, who: RequestEnvelope, name: string, input: unknown): Promise<Answer> =>
  w.ask(keyed(who), name, input);

describe("Step 43c, C7: a company on its directory takes no change to its people from DSoR", () => {
  it.each([
    ["person.add", JANE],
    ["person.remove", CFO],
    ["role.grant", { ...CFO, role: "ap_clerk" }],
    [
      "role.confirm",
      { grant: "dsor://org_456/grant/grt_00000000-0000-4000-8000-000000000000", reason: "x" },
    ],
    ["role.revoke", { ...CFO, role: "CFO" }],
    ["login.invite", CFO],
    ["login.unlink", CFO],
  ])(
    "DSOR-IDN-05: the learner's L10: %s in org_456 is refused, and recorded DENY",
    async (name, input) => {
      const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
      expect(await as(w, ADMIN_456, name, input)).toMatchObject({
        code: "CONFLICT",
        message: "org_456's people come from its own directory: change them there",
      });
      expect((await w.log.records()).at(-1)).toMatchObject({
        operation: `${name}@1`,
        authorization: "DENY",
        result: "CONFLICT",
      });
      // Nothing changed: cfo_100 is still the CFO her directory says she is.
      expect(await w.people.memberOf("org_456", "cfo_100")).toStrictEqual({
        status: "active",
        roles: ["CFO"],
      });
    },
  );

  it("DSOR-IDN-05: org_789, on DSoR's own table, still changes its people as in step 43b", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    expect(
      await as(w, ADMIN_789, "person.add", {
        person: "dsor://org_789/person/jane_789",
        reason: "a new hire",
      }),
    ).toMatchObject({ outcome: "COMMITTED", data: { person: "jane_789", status: "active" } });
  });
});

// From the review of step 43c: person.add of an id that lives only in another company's copy.
describe("Step 43c, the review: an id in a directory's copy is taken for DSoR's own table too", () => {
  it("DSOR-IDN-03a: admin_700 adds jane_456, a person only org_456's copy has, to org_789: taken", async () => {
    const w = await scimWorldOnTuesday(spokeMinutesAgo(30));
    await w.copy.createUser("org_456", {
      user_name: "jane_456",
      external_id: "0b6f1d1e-3c3a-4a52-9a43-000000000456",
      active: true,
    });
    expect(
      await as(w, ADMIN_789, "person.add", {
        person: "dsor://org_789/person/jane_456",
        reason: "x",
      }),
    ).toMatchObject({ code: "CONFLICT", message: "the id jane_456 is taken: choose another" });
  });
});
