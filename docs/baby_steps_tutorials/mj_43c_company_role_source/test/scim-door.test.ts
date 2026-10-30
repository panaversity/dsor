// Step 43c: the SCIM door, a real HTTP server on 127.0.0.1, called with fetch, with the very requests
// org_456's authentik sent in the real check of 2026-10-26. The company is the token's; every request
// becomes one call() of directory.push or directory.read; the answer is in SCIM's own shape
// (RFC 7644; DSOR-IDN-03a, DSOR-IDN-05, DSOR-TEN-02b; step 43c's README, claims C2 and C3, decisions
// D3, D4, and D7).
import { request, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { readRoleSettings, SCIM_ROLE_SOURCES } from "../src/authority.ts";
import { memoryCopy } from "../src/directory-copy.ts";
import { listen } from "../src/server.ts";
import { memoryClients, scimDoorOver } from "../src/scim-door.ts";
import { ruleWorld, type RuleWorld } from "./rule-world.ts";
import { UUIDS } from "./scim-world.ts";

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((done) => s.close(done))));
});

// Each company's directory token, as the owner's pnpm directory-token makes one: random, shown once.
const TOKEN_456 = randomBytes(24).toString("hex");
const TOKEN_789 = randomBytes(24).toString("hex");

/** org_456 on its directory, with an empty copy, and its SCIM door on a free port. */
async function doorOf(
  w: RuleWorld = ruleWorld(
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
    readRoleSettings(SCIM_ROLE_SOURCES),
    { copy: memoryCopy() },
  ),
  // The host names the door takes, beside its own 127.0.0.1 and port.
  hosts: readonly string[] = ["host.lima.internal:8044"],
) {
  const clients = memoryClients([
    [TOKEN_456, "org_456"],
    [TOKEN_789, "org_789"],
  ]);
  const server = scimDoorOver(w.registry, w.log, clients, hosts);
  open.push(server);
  const port = await listen(server, "127.0.0.1", 0);
  return { w, base: `http://127.0.0.1:${port}`, port };
}

type Reply = { status: number; body: Record<string, unknown> };

// No token at all, apart from a token that is wrong.
const NONE: unique symbol = Symbol("no token");

/**
 * One SCIM request, as authentik sends it: a bearer token and a JSON body. node:http, not fetch,
 * because fetch never lets a caller choose the Host header, and the door's host check reads it.
 */
async function scim(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  token: string | typeof NONE = TOKEN_456,
  host?: string,
): Promise<Reply> {
  const url = new URL(`${base}${path}`);
  const headers: Record<string, string> = { "content-type": "application/scim+json" };
  if (token !== NONE) headers["authorization"] = `Bearer ${token}`;
  headers["host"] = host ?? url.host;
  const text =
    body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((done, fail) => {
    const req = request(
      { host: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (res) => {
        let got = "";
        res.on("data", (chunk) => (got += chunk));
        res.on("end", () =>
          done({
            status: res.statusCode ?? 0,
            body: got === "" ? {} : (JSON.parse(got) as Record<string, unknown>),
          }),
        );
      },
    );
    req.on("error", fail);
    req.end(text);
  });
}

const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";

/** authentik's POST of a user, as the real check recorded it, with its mapping's four fields. */
const userBody = (userName: string, externalId: string, active = true) => ({
  schemas: [USER],
  userName,
  displayName: userName,
  active,
  externalId,
});

describe("Step 43c, C2: the SCIM door takes only a directory's own token, for its own company", () => {
  it.each<[string, string | typeof NONE]>([
    ["no token", NONE],
    ["a wrong token", randomBytes(24).toString("hex")],
    ["the tests' fake token of org_456's directory login", "tok_5c1a"],
  ])(
    "DSOR-IDN-04a: decision D3: %s is answered 401, and nothing is pushed",
    async (_case, token) => {
      const { w, base } = await doorOf();
      const reply = await scim(
        base,
        "POST",
        "/scim/v2/Users",
        userBody("cfo_100", UUIDS.cfo_100),
        token,
      );
      expect(reply.status).toBe(401);
      expect(reply.body).toMatchObject({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      });
      expect(await w.copy.users("org_456")).toStrictEqual([]);
    },
  );

  // From the real run of 2026-10-26: authentik's token was ended, its pushes were answered 401 for
  //   minutes, and DSoR's evidence held nothing of them.
  it("DSOR-EXE-02: a request with a token DSoR does not know is refused at line ① and recorded DENY, as step 42's door records one", async () => {
    const { w, base } = await doorOf();
    const before = (await w.log.records()).length;
    const reply = await scim(
      base,
      "POST",
      "/scim/v2/Users",
      userBody("cfo_100", UUIDS.cfo_100),
      "a".repeat(48),
    );
    expect(reply.status).toBe(401);
    const records = (await w.log.records()).slice(before);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "directory.push@1",
      authorization: "DENY",
      result: "AUTHENTICATION_REQUIRED",
    });
  });

  it("DSOR-TEN-02b: decision D3: the company is the token's: org_789's token pushes into org_789, whatever the request says", async () => {
    const { w, base } = await doorOf();
    const reply = await scim(
      base,
      "POST",
      "/scim/v2/Users?tenant=org_456",
      { ...userBody("jane_789", "0b6f1d1e-3c3a-4a52-9a43-000000000789"), tenant: "org_456" },
      TOKEN_789,
    );
    // org_789 is on DSoR's own table, so its push is refused; and org_456's copy is untouched.
    expect(reply.status).toBe(409);
    expect(await w.copy.users("org_456")).toStrictEqual([]);
  });

  it("DSOR-OPR-04a: decision D7: a path outside /scim/v2/ is no SCIM request", async () => {
    const { base } = await doorOf();
    expect((await scim(base, "GET", "/invoices/INV-1008")).status).toBe(404);
  });

  it("DSOR-OPR-04a: decision D7: a host the door was not given is refused 421, as step 42's door refuses one", async () => {
    const { base } = await doorOf();
    expect(
      (await scim(base, "GET", "/scim/v2/Users", undefined, TOKEN_456, "evil.example:8044")).status,
    ).toBe(421);
  });

  it("DSOR-OPR-04a: decision D7: the host the containers use for this computer is taken (the real check, F9)", async () => {
    const { base } = await doorOf();
    const reply = await scim(
      base,
      "GET",
      "/scim/v2/Users",
      undefined,
      TOKEN_456,
      "host.lima.internal:8044",
    );
    expect(reply).toMatchObject({ status: 200, body: { totalResults: 0, Resources: [] } });
  });
});

describe("Step 43c, C3: authentik's requests, as the real check recorded them", () => {
  it("DSOR-IDN-05: the first sync: the service's config, the users, the groups, and their members; cfo_100 is then org_456's CFO", async () => {
    const { w, base } = await doorOf();
    expect((await scim(base, "GET", "/scim/v2/ServiceProviderConfig")).status).toBe(200);
    expect((await scim(base, "GET", "/scim/v2/Users?count=100&startIndex=1")).body).toMatchObject({
      totalResults: 0,
    });
    const cfo = await scim(base, "POST", "/scim/v2/Users", userBody("cfo_100", UUIDS.cfo_100));
    expect(cfo).toMatchObject({
      status: 201,
      body: { schemas: [USER], userName: "cfo_100", externalId: UUIDS.cfo_100, active: true },
    });
    const group = await scim(base, "POST", "/scim/v2/Groups", {
      schemas: [GROUP],
      displayName: "Finance-Approvers",
      externalId: UUIDS.finance,
    });
    expect(group.status).toBe(201);
    const added = await scim(base, "PATCH", `/scim/v2/Groups/${String(group.body["id"])}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "add", path: "members", value: [{ value: cfo.body["id"] }] }],
    });
    expect(added).toMatchObject({ status: 200, body: { members: [{ value: cfo.body["id"] }] } });
    expect(await w.people.memberOf("org_456", "cfo_100")).toStrictEqual({
      status: "active",
      roles: ["CFO"],
    });
  });

  it("DSOR-IDN-07: a deactivation is a PUT of the whole user, active: false; she is then suspended", async () => {
    const { w, base } = await doorOf();
    const cfo = await scim(base, "POST", "/scim/v2/Users", userBody("cfo_100", UUIDS.cfo_100));
    const put = await scim(base, "PUT", `/scim/v2/Users/${String(cfo.body["id"])}`, {
      ...userBody("cfo_100", UUIDS.cfo_100, false),
      id: cfo.body["id"],
    });
    expect(put).toMatchObject({ status: 200, body: { active: false } });
    expect((await w.people.memberOf("org_456", "cfo_100"))?.status).toBe("suspended");
  });

  it("DSOR-IDN-05: leaving a group is a PATCH remove with a filter path (the real check, F7)", async () => {
    const { w, base } = await doorOf();
    const cfo = await scim(base, "POST", "/scim/v2/Users", userBody("cfo_100", UUIDS.cfo_100));
    const group = await scim(base, "POST", "/scim/v2/Groups", {
      schemas: [GROUP],
      displayName: "Finance-Approvers",
      externalId: UUIDS.finance,
      members: [{ value: cfo.body["id"] }],
    });
    const removed = await scim(base, "PATCH", `/scim/v2/Groups/${String(group.body["id"])}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "remove", path: `members[value eq "${String(cfo.body["id"])}"]` }],
    });
    expect(removed).toMatchObject({ status: 200, body: { members: [] } });
    expect((await w.people.memberOf("org_456", "cfo_100"))?.roles).toStrictEqual([]);
  });

  it("DSOR-IDN-07: a deleted user is answered 204, and deprovisioned", async () => {
    const { w, base } = await doorOf();
    const cfo = await scim(base, "POST", "/scim/v2/Users", userBody("cfo_100", UUIDS.cfo_100));
    expect((await scim(base, "DELETE", `/scim/v2/Users/${String(cfo.body["id"])}`)).status).toBe(
      204,
    );
    expect((await w.people.memberOf("org_456", "cfo_100"))?.status).toBe("deprovisioned");
    expect((await scim(base, "GET", `/scim/v2/Users/${String(cfo.body["id"])}`)).status).toBe(404);
  });

  it("DSOR-IDN-05: the double post: the second is 409 uniqueness, and authentik's search then finds org_456's own user (the real check, F5)", async () => {
    const { base } = await doorOf();
    const first = await scim(
      base,
      "POST",
      "/scim/v2/Users",
      userBody("admin_100", UUIDS.admin_100),
    );
    const second = await scim(
      base,
      "POST",
      "/scim/v2/Users",
      userBody("admin_100", UUIDS.admin_100),
    );
    expect(second).toMatchObject({ status: 409, body: { scimType: "uniqueness" } });
    const search = await scim(
      base,
      "GET",
      `/scim/v2/Users?filter=${encodeURIComponent('userName eq "admin_100"')}`,
    );
    expect(search).toMatchObject({
      status: 200,
      body: { totalResults: 1, Resources: [{ id: first.body["id"] }] },
    });
  });

  it("DSOR-IDN-03a: decision D4: authentik's search after a 409 never finds another company's person, so its PUT has nothing to take over (the real check, F5)", async () => {
    const both = ruleWorld(
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
      {
        file: "role-sources.json",
        text: JSON.stringify({
          org_456: { kind: "scim", max_staleness: "PT2H" },
          org_789: { kind: "scim", max_staleness: "PT2H" },
        }),
      },
      {
        copy: memoryCopy(),
        maps: { file: "role-maps.json", text: JSON.stringify({ org_456: [], org_789: [] }) },
      },
    );
    const { base } = await doorOf(both);
    const theirs = await scim(
      base,
      "POST",
      "/scim/v2/Users",
      userBody("jane_300", UUIDS.cfo_100),
      TOKEN_789,
    );
    expect(theirs.status).toBe(201);
    // org_456's authentik posts its own jane_300: taken, as the real check's second run did.
    const ours = await scim(base, "POST", "/scim/v2/Users", userBody("jane_300", UUIDS.user_123));
    expect(ours).toMatchObject({ status: 409, body: { scimType: "uniqueness" } });
    const search = await scim(
      base,
      "GET",
      `/scim/v2/Users?filter=${encodeURIComponent('userName eq "jane_300"')}`,
    );
    expect(search.body).toMatchObject({ totalResults: 0, Resources: [] });
    const takeover = await scim(base, "PUT", `/scim/v2/Users/${String(theirs.body["id"])}`, {
      ...userBody("jane_300", UUIDS.user_123),
      id: theirs.body["id"],
    });
    expect(takeover.status).toBe(404);
    expect(await both.copy.user("org_789", String(theirs.body["id"]))).toMatchObject({
      external_id: UUIDS.cfo_100,
    });
  });

  it("DSOR-IDN-05: decision D5: a user with no externalId, as authentik's default mapping sends, is refused 400 invalidValue (the real check, F8)", async () => {
    const { w, base } = await doorOf();
    const { externalId: _x, ...noId } = userBody("cfo_100", UUIDS.cfo_100);
    const reply = await scim(base, "POST", "/scim/v2/Users", noId);
    expect(reply).toMatchObject({ status: 400, body: { scimType: "invalidValue" } });
    expect(await w.copy.users("org_456")).toStrictEqual([]);
  });

  it("DSOR-EXE-02: every SCIM request is one recorded call, by org_456's directory login", async () => {
    const { w, base } = await doorOf();
    await scim(base, "POST", "/scim/v2/Users", userBody("cfo_100", UUIDS.cfo_100));
    await scim(base, "GET", "/scim/v2/Users");
    const records = (await w.log.records()).slice(-2);
    expect(
      records.map((r) => [r.operation, r.authorization, r.correlation.principal_id]),
    ).toStrictEqual([
      ["directory.push@1", "ALLOW", "directory-org_456"],
      ["directory.read@1", "ALLOW", "directory-org_456"],
    ]);
  });
});

// From the review of step 43c, findings 2 to 4: the door read PATCH out of order, guessed at what it
//   did not read, took a missing active as true, and left its own refusals out of the evidence.
describe("Step 43c, the review's findings 2 to 4: the door reads what it reads, in order, and records what it refuses", () => {
  /** org_456's copy with cfo_100 and user_123, and Finance-Approvers holding cfo_100. */
  async function withGroup() {
    const door = await doorOf();
    const cfo = await scim(door.base, "POST", "/scim/v2/Users", userBody("cfo_100", UUIDS.cfo_100));
    const sup = await scim(
      door.base,
      "POST",
      "/scim/v2/Users",
      userBody("user_123", UUIDS.user_123),
    );
    const group = await scim(door.base, "POST", "/scim/v2/Groups", {
      schemas: [GROUP],
      displayName: "Finance-Approvers",
      externalId: UUIDS.finance,
      members: [{ value: cfo.body["id"] }],
    });
    return {
      ...door,
      cfo: String(cfo.body["id"]),
      sup: String(sup.body["id"]),
      group: `/scim/v2/Groups/${String(group.body["id"])}`,
    };
  }
  const patch = (Operations: unknown[]) => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations,
  });

  it("DSOR-IDN-05: finding 2: operations apply in their order: an add, then a replace, leaves only the replace's members", async () => {
    const g = await withGroup();
    const reply = await scim(
      g.base,
      "PATCH",
      g.group,
      patch([
        { op: "add", path: "members", value: [{ value: g.sup }] },
        { op: "replace", path: "members", value: [{ value: g.cfo }] },
      ]),
    );
    expect(reply).toMatchObject({ status: 200, body: { members: [{ value: g.cfo }] } });
    expect((await g.w.people.memberOf("org_456", "user_123"))?.roles).toStrictEqual([]);
  });

  it("DSOR-IDN-05: finding 2: a replace with no path reads its members too: an empty list empties the group", async () => {
    const g = await withGroup();
    const reply = await scim(
      g.base,
      "PATCH",
      g.group,
      patch([{ op: "replace", value: { displayName: "Finance-Approvers", members: [] } }]),
    );
    expect(reply).toMatchObject({ status: 200, body: { members: [] } });
    expect((await g.w.people.memberOf("org_456", "cfo_100"))?.roles).toStrictEqual([]);
  });

  it("DSOR-IDN-05: finding 4: a remove of members with no value is RFC 7644's remove of every member", async () => {
    const g = await withGroup();
    const reply = await scim(g.base, "PATCH", g.group, patch([{ op: "Remove", path: "members" }]));
    expect(reply).toMatchObject({ status: 200, body: { members: [] } });
  });

  it.each([
    [
      "a key it does not read",
      [{ op: "replace", value: { displayName: "x", owner: "admin_100" } }],
    ],
    ["members as one object, not a list", [{ op: "add", path: "members", value: { value: "x" } }]],
    [
      "a member with a key it does not read",
      [{ op: "add", path: "members", value: [{ value: "x", primary: true }] }],
    ],
    ["an operation it does not know", [{ op: "move", path: "members", value: [] }]],
  ])(
    "DSOR-EXE-02: finding 2: a PATCH with %s is refused 400 and recorded, never guessed, and changes nothing",
    async (_case, operations) => {
      const g = await withGroup();
      const before = (await g.w.log.records()).length;
      const reply = await scim(g.base, "PATCH", g.group, patch(operations));
      expect(reply.status).toBe(400);
      expect((await g.w.log.records()).slice(before)).toStrictEqual([
        expect.objectContaining({
          operation: "directory.push@1",
          authorization: "DENY",
          result: "VALIDATION_FAILED",
        }),
      ]);
      // The copy is as it was. And, by the learner's L7b, the company is stopped until a push succeeds.
      expect((await g.w.copy.standing("org_456", "cfo_100"))?.groups).toStrictEqual([
        UUIDS.finance,
      ]);
      await expect(g.w.people.memberOf("org_456", "cfo_100")).rejects.toThrow("recently enough");
    },
  );

  it.each([
    ["no active", { schemas: [USER], userName: "cfo_100", externalId: UUIDS.cfo_100 }],
    ["active: null", { ...userBody("cfo_100", UUIDS.cfo_100), active: null }],
  ])(
    "DSOR-IDN-07: finding 3: a PUT with %s is refused, never read as active",
    async (_case, body) => {
      const g = await withGroup();
      await scim(
        g.base,
        "PUT",
        `/scim/v2/Users/${g.cfo}`,
        userBody("cfo_100", UUIDS.cfo_100, false),
      );
      const reply = await scim(g.base, "PUT", `/scim/v2/Users/${g.cfo}`, body);
      expect(reply).toMatchObject({ status: 400, body: { scimType: "invalidValue" } });
      expect((await g.w.copy.standing("org_456", "cfo_100"))?.status).toBe("suspended");
    },
  );

  it.each([
    [
      "a PATCH of a user",
      "PATCH",
      "/scim/v2/Users/0b6f1d1e-3c3a-4a52-9a43-000000000001",
      patch([]),
    ],
    ["a body that is not JSON", "POST", "/scim/v2/Users", "{ not json"],
    ["a path the door does not know", "GET", "/scim/v2/Schemas", undefined],
    [
      "a filter the door does not read",
      "GET",
      `/scim/v2/Users?filter=${encodeURIComponent('userName co "a"')}`,
      undefined,
    ],
  ])(
    "DSOR-EXE-02: finding 4: %s, from org_456's directory, is refused and recorded",
    async (_case, method, path, body) => {
      const { w, base } = await doorOf();
      const before = (await w.log.records()).length;
      const reply = await scim(base, method, path, body);
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect((await w.log.records()).slice(before)).toStrictEqual([
        expect.objectContaining({
          authorization: "DENY",
          correlation: expect.objectContaining({ principal_id: "directory-org_456" }),
        }),
      ]);
    },
  );
});
