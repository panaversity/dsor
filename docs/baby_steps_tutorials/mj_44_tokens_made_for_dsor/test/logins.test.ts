// NEW IN STEP 44: line ① with tokens made for DSoR. In pnpm serve's world a person is who a token
// from the one trusted sign-in server says, found in DSoR's own table by the token's sub, and an
// agent keeps its key. Every refused login hears one answer, recorded before the answer leaves
// (DSOR-IDN-01, DSOR-IDN-04a, DSOR-IDN-04b, DSOR-EXE-02; step 44's README, claims C1 to C4 and C6,
// decisions 44-1, 44-5, 44-6, 44-7, and 44-10).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Answer } from "../src/envelope.ts";
import { createLog, type DecisionLog } from "../src/log.ts";
import { realLogins } from "../src/logins.ts";
import { call } from "../src/pipeline.ts";
import { logins, type Principal } from "../src/principals.ts";
import type { Handler, Registry } from "../src/registry.ts";
import { remoteKeys } from "../src/tokens.ts";
import {
  CFO,
  INV_1008_OF_456,
  LOG_IN_FIRST,
  MASKED_1008_OF_456,
  NOBODY,
  NOT_A_MEMBER,
  OUR_EXTENSIONS,
  THE_789_SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_SUPERVISOR,
  correlationFor,
  log,
  notGranted,
  registry,
  registryWith,
} from "./helpers.ts";
import { PEOPLE_APP, startIssuer, type TestIssuer } from "./issuer.ts";

const INV_1008 = { invoice: "dsor://org_456/invoice/INV-1008" };

// The refusal of a call with no login DSoR accepts. Every refused token and key hears this one.
const NO_LOGIN = {
  code: "AUTHENTICATION_REQUIRED",
  message: LOG_IN_FIRST,
  retry: "never",
  correlation: correlationFor(NOBODY),
};

let sso: TestIssuer;
let stranger: TestIssuer;
// pnpm serve's world: a token from the test's sign-in server for a person, a key for an agent.
let served: Registry;
beforeAll(async () => {
  sso = await startIssuer();
  stranger = await startIssuer();
  served = { ...registry, logins: realLogins(sso.signIn, remoteKeys()) };
});
afterAll(async () => {
  await sso.close();
  await stranger.close();
});

/** A call in pnpm serve's world, in org_456, with this token or key. */
function asServed(
  token: string,
  operation = "invoice.get",
  input: unknown = INV_1008,
  into: DecisionLog = log,
): Promise<Answer> {
  return call(served, into, { token, tenant: "org_456" }, operation, input);
}

/** The data of an answer, or the whole answer when it was refused. */
function dataOf(answer: Answer): unknown {
  return "data" in answer ? answer.data : answer;
}

const seconds = (): number => Math.floor(Date.now() / 1000);

describe("C1: a person is who a token made for DSoR says", () => {
  it("DSOR-IDN-01: cfo_100's token from the trusted server makes cfo_100 the caller, a person, who reads INV-1008 whole", async () => {
    const answer = await asServed(await sso.sign("cfo_100"));
    expect(answer.correlation).toStrictEqual(correlationFor(THE_CFO));
    expect(dataOf(answer)).toStrictEqual(INV_1008_OF_456);
  });
});

describe("C2: every refused login hears one answer, at line ①, recorded before it leaves", () => {
  // Each fails one check, and the same token without that fault counts (test/tokens.test.ts). A
  //   good token for someone the table lists as no person, and a key no agent holds, are refused
  //   the same (decisions 44-6, 44-7, and 44-10).
  const REFUSED: [string, () => Promise<string>][] = [
    [
      "a token made for DSoR's test copy at 8043",
      () => sso.sign("cfo_100", { aud: "http://127.0.0.1:8043" }),
    ],
    ["a token without the dsor scope", () => sso.sign("cfo_100", { scope: "openid profile" })],
    ["a token from a client not on DSoR's list", () => sso.sign("cfo_100", { azp: "reports" })],
    [
      "a token issued 61 minutes ago, its exp a day away",
      () => sso.sign("cfo_100", { iat: seconds() - 61 * 60, exp: seconds() + 86_400 }),
    ],
    [
      "a token signed with another server's key",
      () => stranger.sign("cfo_100", { iss: sso.issuer }),
    ],
    // The review's finding: an agent acting for cfo_100, named in act (RFC 8693), is not cfo_100.
    [
      "a token for cfo_100 whose act names the agent acting for her",
      () => sso.sign("cfo_100", { act: { sub: "accounts-payable-fte" } }),
    ],
    ["a good token for user_555, whom DSoR's table does not list", () => sso.sign("user_555")],
    ["a good token for the agent, accounts-payable-fte", () => sso.sign("accounts-payable-fte")],
    ["a good token for dsor-scheduler, a system login", () => sso.sign("dsor-scheduler")],
    ["cfo_100's step-42 key, tok_d4e8", async () => "tok_d4e8"],
    ["three parts that are no token", async () => "a.b.c"],
    ["a key no agent holds", async () => "tok_0000"],
  ];
  it.each(REFUSED)(
    "DSOR-IDN-01: %s hears AUTHENTICATION_REQUIRED, the same answer as every other",
    async (_why, make) => {
      expect(await asServed(await make())).toStrictEqual(NO_LOGIN);
    },
  );

  it("DSOR-IDN-01: a refused token stops at line ①: the company's code never runs, and no line after ① starts", async () => {
    const spy = vi.fn<Handler>(() => "ran");
    const world: Registry = { ...registryWith(spy), logins: served.logins };
    const token = await sso.sign("cfo_100", { aud: "http://127.0.0.1:8043" });
    const lines: number[] = [];
    const request = { token, tenant: "org_456" };
    const answer = await call(world, log, request, "test.run", INV_1008, (n) => lines.push(n));
    expect(answer).toStrictEqual(NO_LOGIN);
    expect(spy).not.toHaveBeenCalled();
    // Line ⑪ records the refusal, as it records every call (step 08's README, decision 1).
    expect(lines).toStrictEqual([1, 11]);
  });

  it("DSOR-EXE-02: the refusal is recorded with its reason before the answer, and the record never holds the token", async () => {
    const token = await sso.sign("cfo_100", { scope: "openid profile" });
    const kept = createLog();
    const answer = await asServed(token, "invoice.get", INV_1008, kept);
    const records = await kept.records();
    expect(records).toStrictEqual([
      expect.objectContaining({
        operation: "invoice.get@1",
        authorization: "DENY",
        result: "AUTHENTICATION_REQUIRED",
        reason: LOG_IN_FIRST,
        correlation: answer.correlation,
      }),
    ]);
    // Refused before line ② checked a company, and a bad token names nobody (decision 44-10).
    expect(records[0]).not.toHaveProperty("tenant");
    expect(records[0]).not.toHaveProperty("extensions");
    expect(JSON.stringify(records)).not.toContain(token);
    // A log that cannot take the record: the answer waits for the record, so it is this one.
    const full: DecisionLog = {
      add: async () => {
        throw new Error("disk full at /var/dsor/log");
      },
    };
    expect(await asServed(token, "invoice.get", INV_1008, full)).toMatchObject({
      code: "EVIDENCE_STORE_UNAVAILABLE",
      correlation: correlationFor(NOBODY),
    });
  });
});

describe("C3: companies and roles come only from DSoR's table, by the token's sub", () => {
  it("DSOR-IDN-04b: user_700's token claims org_456 and CFO; DSoR reads neither, and user_700 is refused in org_456", async () => {
    const claims = { tenant_id: "org_456", org_role: "CFO", roles: ["CFO"] };
    const token = await sso.sign("user_700", claims);
    expect(await asServed(token)).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: NOT_A_MEMBER,
      retry: "never",
      correlation: correlationFor(THE_789_SUPERVISOR),
    });
  });

  it("DSOR-IDN-04a: user_123's roles come from the table by sub: ap_supervisor, never the CFO the token claims", async () => {
    const token = await sso.sign("user_123", { org_role: "CFO", roles: ["CFO"] });
    const read = await asServed(token);
    expect(read.correlation).toStrictEqual(correlationFor(THE_SUPERVISOR));
    expect(dataOf(read)).toStrictEqual(INV_1008_OF_456);
    // Drafting a rule needs rule:draft, which a CFO holds and ap_supervisor does not.
    expect(await asServed(token, "rule.draft", {})).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: notGranted("rule.draft", "rule:draft"),
      retry: "never",
      correlation: correlationFor(THE_SUPERVISOR),
    });
  });

  it("Step 44, 44-10: a good token for user_555, whom nobody listed, hears AUTHENTICATION_REQUIRED, and the record says why", async () => {
    const kept = createLog();
    const answer = await asServed(await sso.sign("user_555"), "invoice.get", INV_1008, kept);
    expect(answer).toStrictEqual(NO_LOGIN);
    const [record] = await kept.records();
    expect(record?.extensions).toStrictEqual({
      [OUR_EXTENSIONS]: {
        unlisted_login: { issuer: sso.issuer, subject: "user_555", client: PEOPLE_APP },
      },
    });
  });
});

describe("C4: in pnpm serve, a person signs in with a token, and an agent keeps its key", () => {
  it.each([
    ["tok_2c91", "user_123"],
    ["tok_d4e8", "cfo_100"],
    ["tok_a100", "admin_100"],
    ["tok_e1a7", "user_700"],
    ["tok_a700", "admin_700"],
  ])("Step 44, 44-6: %s, %s's step-42 key, is refused at line ①", async (key) => {
    expect(await asServed(key)).toStrictEqual(NO_LOGIN);
  });

  it("Step 44, 44-6: the agent's key, tok_7f3a, still works, and its answer is masked as before", async () => {
    const answer = await asServed("tok_7f3a");
    expect(answer.correlation).toStrictEqual(correlationFor(THE_AGENT));
    expect(dataOf(answer)).toStrictEqual(MASKED_1008_OF_456);
  });

  it("Step 44, 44-6: a system login's key, dsor-scheduler's tok_5c4e, is still found at line ①", async () => {
    const answer = await asServed("tok_5c4e");
    expect(answer.correlation).toStrictEqual(correlationFor({ principal_id: "dsor-scheduler" }));
  });

  it("Step 44, 44-6: pnpm start's world keeps step 42's table, where tok_d4e8 is cfo_100", async () => {
    const answer = await call(registry, log, CFO, "invoice.get", INV_1008);
    expect(answer.correlation).toStrictEqual(correlationFor(THE_CFO));
    expect(dataOf(answer)).toStrictEqual(INV_1008_OF_456);
  });

  it("Step 44, 44-7: three parts with dots are a token, never a key, even when the table holds them as the agent's", async () => {
    const agent = logins.get("tok_7f3a") as Principal;
    const table = new Map([
      ["x.y.z", agent],
      ["tok_7f3a", agent],
    ]);
    const world: Registry = { ...registry, logins: realLogins(sso.signIn, remoteKeys(), table) };
    const as = (token: string): Promise<Answer> =>
      call(world, log, { token, tenant: "org_456" }, "invoice.get", INV_1008);
    expect(await as("x.y.z")).toStrictEqual(NO_LOGIN);
    expect((await as("tok_7f3a")).correlation).toStrictEqual(correlationFor(THE_AGENT));
  });
});

describe("C6: keys that cannot be fetched are an outage, not a bad token", () => {
  it("Step 44, 44-1: when the server's keys cannot be fetched, the caller hears CONNECTOR_UNAVAILABLE, safe_same_key, recorded with the cause", async () => {
    const down = await startIssuer();
    const world: Registry = { ...registry, logins: realLogins(down.signIn, remoteKeys()) };
    const token = await down.sign("cfo_100");
    down.down(true);
    const kept = createLog();
    const answer = await call(world, kept, { token, tenant: "org_456" }, "invoice.get", INV_1008);
    const cause = `the sign-in server's keys could not be fetched (${down.issuer}): try again`;
    expect(answer).toStrictEqual({
      code: "CONNECTOR_UNAVAILABLE",
      message: cause,
      retry: "safe_same_key",
      correlation: correlationFor(NOBODY),
    });
    expect(await kept.records()).toStrictEqual([
      expect.objectContaining({
        authorization: "DENY",
        result: "CONNECTOR_UNAVAILABLE",
        reason: cause,
      }),
    ]);
    await down.close();
  });

  it("Step 44, 44-1: a token whose key the server does not publish is a bad token, not an outage", async () => {
    const forged = await stranger.sign("cfo_100", { iss: sso.issuer }, { kid: "no-such-key" });
    expect(await asServed(forged)).toStrictEqual(NO_LOGIN);
  });
});
