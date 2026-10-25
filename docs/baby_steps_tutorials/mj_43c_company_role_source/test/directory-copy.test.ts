// Step 43c: the copy of a company's directory, as DSoR keeps it. Each read and each write is inside
// one company, and nothing in it is ever another company's (DSOR-IDN-03a, DSOR-IDN-05; step 43c's
// README, claim C3, decisions L5, D4, D5, and D6).
import { describe, expect, it } from "vitest";
import { memoryCopy } from "../src/directory-copy.ts";
import { storyCopy, UUIDS } from "./scim-world.ts";

const JANE = {
  user_name: "jane_200",
  external_id: "fc9b026d-0000-4000-8000-000000000200",
  display_name: "Jane Doe",
  active: true,
};

describe("Step 43c, C3: the copy keeps each company's users, groups, and members", () => {
  it("DSOR-IDN-05: a new user gets DSoR's own id for SCIM, and her username is her DSoR id", async () => {
    const copy = memoryCopy();
    const jane = await copy.createUser("org_456", JANE);
    expect(jane).toMatchObject({ person: "jane_200", external_id: JANE.external_id, active: true });
    expect(jane.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await copy.standing("org_456", "jane_200")).toStrictEqual({
      status: "active",
      groups: [],
    });
  });

  it("DSOR-IDN-05: the learner's L5: a renamed user keeps her DSoR id; only her username changes", async () => {
    const copy = memoryCopy();
    const jane = await copy.createUser("org_456", JANE);
    const renamed = await copy.replaceUser("org_456", jane.id, { ...JANE, user_name: "jane_doe" });
    expect(renamed).toMatchObject({ person: "jane_200", user_name: "jane_doe" });
    expect(await copy.standing("org_456", "jane_doe")).toBeUndefined();
  });

  it("DSOR-IDN-03a: an id another company has is taken, and the answer names no company", async () => {
    const copy = await storyCopy();
    await expect(
      copy.createUser("org_789", { ...JANE, user_name: "cfo_100" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "the id cfo_100 is taken: choose another",
    });
  });

  it("DSOR-IDN-03a: an id another company had, and deleted, is taken too", async () => {
    const copy = memoryCopy();
    const jane = await copy.createUser("org_456", JANE);
    await copy.deleteUser("org_456", jane.id);
    await expect(copy.createUser("org_789", JANE)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await copy.companiesOf("jane_200")).toStrictEqual(["org_456"]);
  });

  it("DSOR-IDN-05: the same user posted twice in one company is a conflict, which authentik answers with a search (the real check, F5)", async () => {
    const copy = memoryCopy();
    await copy.createUser("org_456", JANE);
    await expect(copy.createUser("org_456", JANE)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "jane_200 is in org_456's copy already",
    });
    expect(await copy.users("org_456", { field: "userName", value: "jane_200" })).toHaveLength(1);
  });

  // Changed by the review of step 43c, finding 1: a new person under a deleted person's id inherited
  //   her slips and her approvals, which name the id. An id this company had is hers for good.
  it("DSOR-IDN-07: an id this company had under another externalId is taken: a new hire never inherits a leaver's slips", async () => {
    const copy = memoryCopy();
    const first = await copy.createUser("org_456", JANE);
    await copy.deleteUser("org_456", first.id);
    await expect(
      copy.createUser("org_456", { ...JANE, external_id: "fc9b026d-0000-4000-8000-000000000201" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "the id jane_200 is taken: choose another",
    });
  });

  it("DSOR-IDN-05: the same person, by the same externalId, may come back after a delete, as a new row", async () => {
    const copy = memoryCopy();
    const first = await copy.createUser("org_456", JANE);
    await copy.deleteUser("org_456", first.id);
    const back = await copy.createUser("org_456", JANE);
    expect(back.id).not.toBe(first.id);
    expect(await copy.standing("org_456", "jane_200")).toMatchObject({ status: "active" });
  });

  it("DSOR-IDN-05: a user's externalId never changes", async () => {
    const copy = memoryCopy();
    const jane = await copy.createUser("org_456", JANE);
    await expect(
      copy.replaceUser("org_456", jane.id, {
        ...JANE,
        external_id: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "a user's externalId never changes" });
  });

  it.each([
    ["active: false", { active: false }, "suspended"],
    ["active: true again", { active: true }, "active"],
  ])("DSOR-IDN-07: the learner's L8: %s makes her %s", async (_case, change, status) => {
    const copy = memoryCopy();
    const jane = await copy.createUser("org_456", JANE);
    await copy.replaceUser("org_456", jane.id, { ...JANE, active: false });
    await copy.replaceUser("org_456", jane.id, { ...JANE, ...change });
    expect((await copy.standing("org_456", "jane_200"))?.status).toBe(status);
  });

  it("DSOR-IDN-07: the learner's L8: a deleted user is deprovisioned, and leaves her groups", async () => {
    const copy = await storyCopy();
    const cfo = (await copy.users("org_456", { field: "userName", value: "cfo_100" }))[0]!;
    await copy.deleteUser("org_456", cfo.id);
    expect(await copy.standing("org_456", "cfo_100")).toStrictEqual({
      status: "deprovisioned",
      groups: [],
    });
    const finance = (
      await copy.groups("org_456", { field: "externalId", value: UUIDS.finance })
    )[0]!;
    expect(finance.members).toStrictEqual([]);
  });

  it("DSOR-IDN-05: a member added and removed, as authentik sends them (the real check, F1 and F7)", async () => {
    const copy = await storyCopy();
    const [jane] = [await copy.createUser("org_456", JANE)];
    const finance = (
      await copy.groups("org_456", { field: "externalId", value: UUIDS.finance })
    )[0]!;
    await copy.changeGroup("org_456", finance.id, { add: [jane.id], remove: [] });
    expect((await copy.standing("org_456", "jane_200"))?.groups).toStrictEqual([UUIDS.finance]);
    await copy.changeGroup("org_456", finance.id, { add: [], remove: [jane.id] });
    expect((await copy.standing("org_456", "jane_200"))?.groups).toStrictEqual([]);
  });

  it("DSOR-IDN-05: decision D6: a member DSoR has no user for is refused, never dropped in silence", async () => {
    const copy = await storyCopy();
    const finance = (
      await copy.groups("org_456", { field: "externalId", value: UUIDS.finance })
    )[0]!;
    const nobody = "00000000-0000-4000-8000-00000000dead";
    await expect(
      copy.changeGroup("org_456", finance.id, { add: [nobody], remove: [] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: `member ${nobody} is no user in org_456's copy`,
    });
  });

  it("DSOR-IDN-03a: decision D4: org_789 can neither see nor change org_456's rows", async () => {
    const copy = await storyCopy();
    const cfo = (await copy.users("org_456", { field: "userName", value: "cfo_100" }))[0]!;
    expect(await copy.user("org_789", cfo.id)).toBeUndefined();
    expect(await copy.users("org_789", { field: "userName", value: "cfo_100" })).toStrictEqual([]);
    expect(await copy.replaceUser("org_789", cfo.id, { ...JANE, user_name: "x" })).toBeUndefined();
    expect(await copy.deleteUser("org_789", cfo.id)).toBe(false);
    expect((await copy.standing("org_456", "cfo_100"))?.status).toBe("active");
  });

  it("DSOR-IDN-03a: a member of another company's copy is no member here", async () => {
    const copy = await storyCopy();
    const cfo = (await copy.users("org_456", { field: "userName", value: "cfo_100" }))[0]!;
    const theirs = await copy.createGroup("org_789", {
      name: "Finance-Approvers",
      external_id: "00000000-0000-4000-8000-000000000789",
      members: [],
    });
    await expect(
      copy.changeGroup("org_789", theirs.id, { add: [cfo.id], remove: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("DSOR-IDN-05: a login's uuid names its person in her company only, and never a deleted one (the learner's L6)", async () => {
    const copy = await storyCopy();
    expect(await copy.personOf("org_456", UUIDS.cfo_100)).toBe("cfo_100");
    expect(await copy.personOf("org_789", UUIDS.cfo_100)).toBeUndefined();
    const cfo = (await copy.users("org_456", { field: "userName", value: "cfo_100" }))[0]!;
    await copy.deleteUser("org_456", cfo.id);
    expect(await copy.personOf("org_456", UUIDS.cfo_100)).toBeUndefined();
  });
});
