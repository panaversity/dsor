// NEW IN STEP 45: line ② asks too. A person's companies and roles come from her company's lookup,
// asked about whom line ① found, never from a row in DSoR's code and never from a claim in her token
// (step 45's README, C2; decision Q7). DSoR's own table holds no person: only agents and the timer
// jobs' logins (C8, D6, D7). DSoR asks a test sign-in server for org_456.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLog } from "../src/log.ts";
import { FAKE_LOGINS, realLogins } from "../src/logins.ts";
import { lookupDirectory } from "../src/lookup.ts";
import type { Payment } from "../src/payment.ts";
import { call } from "../src/pipeline.ts";
import { logins } from "../src/principals.ts";
import type { Registry } from "../src/registry.ts";
import { STAND_IN_KEYS, STAND_IN_PEOPLE } from "../src/stand-in.ts";
import { remoteKeys } from "../src/tokens.ts";
import { CFO, STORY_PEOPLE, SUPERVISOR, keyed, slipRegistry } from "./helpers.ts";
import { startIssuer, type TestIssuer } from "./issuer.ts";
import { NIGHT } from "./role-source-list.ts";
import { startSignInServer, type SignInServer } from "./sign-in-server.ts";

const INVOICE = { invoice: "dsor://org_456/invoice/INV-1008" };
const DRAFT = { ...INVOICE, expected_version: 1 };
const STRANGER = "the caller may not work in the tenant it named";

let server: SignInServer;
let rows: Payment[];
let registry: Registry;

/** Sets DSoR's clock to this time of the story's night, in UTC. */
function at(time: string): void {
  vi.setSystemTime(new Date(`${NIGHT}T${time}Z`));
}

beforeEach(async () => {
  // Only the date: the network needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  at("02:00:00");
  server = await startSignInServer("org_456", {
    user_123: { status: "active", roles: ["ap_supervisor"] },
    cfo_100: { status: "active", roles: ["CFO"] },
  });
  rows = [];
  const lookup = lookupDirectory({ tenant: "org_456", address: server.address, key: server.key });
  registry = slipRegistry(undefined, undefined, rows, new Map([["org_456", lookup]]));
});

afterEach(async () => {
  await server.stop();
  vi.useRealTimers();
});

describe("C8, D6, and D7: DSoR's own table holds no person", () => {
  it("D7: src/principals.ts holds no person: every login in it is an agent, an application, or a timer job", () => {
    expect([...logins.values()].filter((login) => login.type === "human")).toStrictEqual([]);
    expect([...logins.values()].map((login) => login.id)).not.toContain("cfo_100");
  });

  it("D7: at the stand-in, a person's key names her and nothing more: tok_d4e8 is cfo_100, with no company until line ② asks", async () => {
    expect(await FAKE_LOGINS.find("tok_d4e8")).toStrictEqual({
      id: "cfo_100",
      type: "human",
      memberships: [],
    });
  });

  it("D7: the stand-in knows the story's people as the tests do, typed out twice", () => {
    expect(STAND_IN_PEOPLE).toStrictEqual(STORY_PEOPLE);
    expect([...STAND_IN_KEYS.values()].sort()).toStrictEqual(
      ["admin_100", "admin_700", "cfo_100", "user_123", "user_700"].sort(),
    );
  });

  it("D6: the timer jobs keep their keys: dsor-scheduler's tok_5c4e and dsor-rates's tok_3b8f, with their companies from DSoR's table", async () => {
    expect(await FAKE_LOGINS.find("tok_5c4e")).toMatchObject({
      id: "dsor-scheduler",
      type: "system",
      memberships: [
        { tenant_id: "org_456", roles: ["scheduler"] },
        { tenant_id: "org_789", roles: ["scheduler"] },
      ],
    });
    expect(await FAKE_LOGINS.find("tok_3b8f")).toMatchObject({ id: "dsor-rates", type: "system" });
  });
});

describe("C2 and Q7: line ② asks a person's company what she holds", () => {
  it("DSOR-IDN-04a: cfo_100 reads INV-1008 as the CFO org_456's lookup says she is, and DSoR asked about her", async () => {
    expect(await call(registry, createLog(), CFO, "invoice.get", INVOICE)).toMatchObject({
      data: { id: "INV-1008", amount: { value: "31400.00", currency: "USD" } },
    });
    expect(server.seen()).toStrictEqual([
      { tenant: "org_456", person: "cfo_100", authorization: `Bearer ${server.key}` },
    ]);
  });

  it("DSOR-IDN-04a: the lookup moves user_123 to ap_clerk at 02:05; her own draft at 02:06 is refused at line ⑤, and her read is still answered", async () => {
    expect(
      await call(registry, createLog(), keyed(SUPERVISOR), "payment.create", DRAFT),
    ).toMatchObject({ data: { status: "draft" } });
    at("02:05:00");
    server.set("user_123", { status: "active", roles: ["ap_clerk"] });
    at("02:06:00");
    const lines: number[] = [];
    const refused = await call(
      registry,
      createLog(),
      keyed(SUPERVISOR),
      "payment.create",
      DRAFT,
      (n) => lines.push(n),
    );
    expect(refused).toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(lines).toContain(5);
    expect(await call(registry, createLog(), SUPERVISOR, "invoice.get", INVOICE)).toMatchObject({
      data: { id: "INV-1008" },
    });
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["gone", { status: "gone" as const, roles: [] }],
    ["suspended", { status: "suspended" as const, roles: [] }],
  ])(
    "DSOR-IDN-03a: org_456's lookup says user_123 is %s: her own read is refused at line ②, with the words a stranger hears",
    async (_word, entry) => {
      server.set("user_123", entry);
      const lines: number[] = [];
      const log = createLog();
      const answer = await call(registry, log, SUPERVISOR, "invoice.get", INVOICE, (n) =>
        lines.push(n),
      );
      expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED", message: STRANGER });
      expect(lines).toStrictEqual([1, 2, 11]);
      expect(await log.records()).toMatchObject([
        { authorization: "DENY", result: "AUTHORIZATION_DENIED" },
      ]);
    },
  );

  it("Q7: the lookup cannot answer and DSoR keeps nothing about user_123: her own read is refused at line ② with FRESHNESS_UNSATISFIABLE", async () => {
    server.replyStatus(503);
    const lines: number[] = [];
    const answer = await call(registry, createLog(), SUPERVISOR, "invoice.get", INVOICE, (n) =>
      lines.push(n),
    );
    expect(answer).toMatchObject({
      code: "FRESHNESS_UNSATISFIABLE",
      message:
        '"invoice.get": DSoR has no answer about user_123 from the directory of org_456 that is recent enough',
    });
    expect(lines).toStrictEqual([1, 2, 11]);
  });

  // Found by piece 5's breaks: no login source brought memberships, so line ② keeping them went
  //   unseen. A token's claims would be such memberships (DSOR-IDN-04b).
  it("C2: a login that brings memberships of its own changes nothing: line ② takes the lookup's, and user_123 drafts as the ap_supervisor it says she is", async () => {
    const claiming: Registry = {
      ...registry,
      logins: {
        find: async () => ({
          id: "user_123",
          type: "human" as const,
          memberships: [{ tenant_id: "org_456", roles: ["CFO"] }],
        }),
      },
    };
    expect(
      await call(claiming, createLog(), keyed(SUPERVISOR), "payment.create", DRAFT),
    ).toMatchObject({ data: { status: "draft" } });
  });

  it("C2: the bundle of user_123's own draft says her authority came from the role source, as of 02:00", async () => {
    const log = createLog();
    expect(await call(registry, log, keyed(SUPERVISOR), "payment.create", DRAFT)).toMatchObject({
      data: { status: "draft" },
    });
    expect(await log.bundles()).toMatchObject([
      {
        identity: {
          mode: "direct",
          subject: "user_123",
          subject_authority: { source: "role_source", as_of: `${NIGHT}T02:00:00.000Z` },
        },
      },
    ]);
  });
});

describe("C2 and DSOR-IDN-04b: in pnpm serve's world, a token names a person and nothing more", () => {
  let issuer: TestIssuer;
  let served: Registry;

  beforeEach(async () => {
    issuer = await startIssuer();
    served = { ...registry, logins: realLogins(issuer.signIn, remoteKeys()) };
  });

  afterEach(async () => {
    await issuer.close();
  });

  it("DSOR-IDN-04b: a token for user_700 that claims CFO in org_456 changes nothing: org_456's lookup does not list her, and line ② refuses her", async () => {
    const token = await issuer.sign("user_700", { roles: ["CFO"], tenant: "org_456" });
    const lines: number[] = [];
    const answer = await call(
      served,
      createLog(),
      { token, tenant: "org_456" },
      "invoice.get",
      INVOICE,
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({ code: "AUTHORIZATION_DENIED", message: STRANGER });
    expect(lines).toStrictEqual([1, 2, 11]);
    expect(server.seen().map((asked) => asked.person)).toStrictEqual(["user_700"]);
  });

  it("DSOR-IDN-04b: a token for cfo_100 that claims ap_clerk changes nothing: she reads INV-1008 as the CFO the lookup says she is", async () => {
    const token = await issuer.sign("cfo_100", { roles: ["ap_clerk"] });
    expect(
      await call(served, createLog(), { token, tenant: "org_456" }, "invoice.get", INVOICE),
    ).toMatchObject({ data: { id: "INV-1008", amount: { value: "31400.00", currency: "USD" } } });
  });

  it("C2: a good token whose subject names an agent in DSoR's table makes nobody that agent: it is refused at line ①", async () => {
    const token = await issuer.sign("accounts-payable-fte");
    const lines: number[] = [];
    const answer = await call(
      served,
      createLog(),
      { token, tenant: "org_456" },
      "invoice.get",
      INVOICE,
      (n) => lines.push(n),
    );
    expect(answer).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(lines).toStrictEqual([1, 11]);
    expect(server.seen()).toStrictEqual([]);
  });
});
