// NEW IN STEP 05: who is calling, by claim (C1 to C6 in step 05's README).
import { describe, expect, it, vi } from "vitest";
import { callerIds, logins, whoIsCalling, type PrincipalType } from "../src/principals.ts";
import { call, type Handler } from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  BAD_REQUEST_ID,
  CFO,
  LOG_IN_FIRST,
  NOBODY,
  SUPERVISOR,
  THE_AGENT,
  correlationFor,
  notTheCaller,
  registry,
  registryWith,
} from "./helpers.ts";

const AS_AGENT = correlationFor(THE_AGENT);

// The refusal of a call that has no login DSoR knows. Every such refusal is this one.
const NO_LOGIN = {
  code: "AUTHENTICATION_REQUIRED",
  message: LOG_IN_FIRST,
  retry: "never",
  correlation: correlationFor(NOBODY),
};

describe("C1: the principal is found first", () => {
  // invoice.delete has no contract, and invoice.issue has no code. A caller with no login
  // must not learn even that.
  it.each([["invoice.delete"], ["invoice.issue"], ["invoice.get"]])(
    "DSOR-IDN-01: a call to %s with no login is refused with AUTHENTICATION_REQUIRED",
    (name) => {
      expect(call(registry, {}, name, { id: "INV-1008" })).toStrictEqual(NO_LOGIN);
    },
  );

  // Found when the design was checked against the specification: the design first checked
  // the request id before the login (step 05's README, "Think it through").
  it.each([
    ["a request id DSoR cannot use", { request_id: "" }, { id: "INV-1008" }],
    ["cfo_100 named in the arguments", {}, { id: "INV-1008", principal: "cfo_100" }],
  ])(
    "DSOR-IDN-01: with no login, %s still gets AUTHENTICATION_REQUIRED",
    (_why, request, input) => {
      expect(call(registry, request, "invoice.get", input)).toStrictEqual(NO_LOGIN);
    },
  );

  it("DSOR-IDN-01: with no login, the operation's code never runs", () => {
    const spy = vi.fn<Handler>(() => "ran");
    expect(call(registryWith(spy), {}, "test.run", {})).toStrictEqual(NO_LOGIN);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("C2: a call with no login DSoR knows is refused", () => {
  // Every one gets the same code and message, so a refusal never tells a caller which
  // tokens or principals exist.
  const NOT_A_LOGIN: [string, unknown][] = [
    ["no token", {}],
    ["an empty token", { token: "" }],
    ["a token DSoR never gave", { token: "tok_0000" }],
    ["a principal's own id", { token: "cfo_100" }],
    // A table kept in a plain object would find something under this name (step 03).
    ["a name every JavaScript object has", { token: "toString" }],
    ["a real token with a space after it", { token: "tok_7f3a " }],
    // Found by the review: a lookup that ignored capitals let this one in.
    ["a real token in capital letters", { token: "TOK_7F3A" }],
    // A plain object turns a list into text, and ["tok_7f3a"] becomes "tok_7f3a".
    ["a list that holds a real token", { token: ["tok_7f3a"] }],
    ["an envelope that is null", null],
  ];
  it.each(NOT_A_LOGIN)(
    "DSOR-IDN-01: %s is refused with AUTHENTICATION_REQUIRED",
    (_why, request) => {
      const answer = call(registry, request as RequestEnvelope, "invoice.get", { id: "INV-1008" });
      expect(answer).toStrictEqual(NO_LOGIN);
    },
  );

  // Found by the review: no test put a login token in the arguments.
  it("DSOR-IDN-01: a login token inside the arguments is not a login", () => {
    const input = { id: "INV-1008", token: "tok_d4e8" };
    expect(call(registry, {}, "invoice.get", input)).toStrictEqual(NO_LOGIN);
  });
});

describe("C3: every principal has a type and at least one tenant membership", () => {
  it("DSOR-IDN-01: each principal has a type from §12's list, and a membership in a tenant", () => {
    const principals = [...logins.values()];
    // An empty table would make the loop below prove nothing.
    expect(principals).toHaveLength(3);
    for (const principal of principals) {
      expect(["human", "agent", "application", "system"]).toContain(principal.type);
      expect(principal.memberships.length).toBeGreaterThan(0);
      // The form of a tenant id that this tutorial chose in step 02.
      for (const { tenant_id } of principal.memberships) expect(tenant_id).toMatch(/^org_[0-9]+$/);
    }
  });

  // Found by the review: the test above checks the table, not what a call finds in it.
  const FOUND: [string, string, string, string[]][] = [
    ["tok_7f3a", "accounts-payable-fte", "agent", []],
    ["tok_2c91", "user_123", "human", ["ap_supervisor"]],
    ["tok_d4e8", "cfo_100", "human", ["CFO"]],
  ];
  it.each(FOUND)(
    "DSOR-IDN-01: the token %s finds %s, with a type and a membership",
    (token, id, type, roles) => {
      const memberships = [{ tenant_id: "org_456", roles }];
      expect(whoIsCalling({ token })).toStrictEqual({ id, type, memberships });
    },
  );

  // No rule id: the story's three principals are step 05's decision 3.
  it("the table holds the story's three principals, each with its own token", () => {
    const inOrg456 = (roles: string[]) => [{ tenant_id: "org_456", roles }];
    expect(Object.fromEntries(logins)).toStrictEqual({
      tok_7f3a: { id: "accounts-payable-fte", type: "agent", memberships: inOrg456([]) },
      tok_2c91: { id: "user_123", type: "human", memberships: inOrg456(["ap_supervisor"]) },
      tok_d4e8: { id: "cfo_100", type: "human", memberships: inOrg456(["CFO"]) },
    });
  });
});

describe("C4: who is calling comes only from the token and DSoR's own table", () => {
  it.each([
    ["tok_7f3a", { agent_id: "accounts-payable-fte" }],
    ["tok_2c91", { principal_id: "user_123" }],
    ["tok_d4e8", { principal_id: "cfo_100" }],
  ])("DSOR-SRC-02a: the token %s is named in correlation as its own principal", (token, caller) => {
    expect(call(registry, { token }, "invoice.get", { id: "INV-1008" })).toStrictEqual({
      data: expect.objectContaining({ id: "INV-1008" }),
      correlation: correlationFor(caller),
    });
  });

  // Some of these calls are refused. The refusal names the agent too.
  it.each([
    ["an invoice id", { id: "INV-1008" }],
    ["an invoice that does not exist", { id: "INV-9999" }],
    ["nothing", {}],
    ["cfo_100 as the principal", { id: "INV-1008", principal: "cfo_100" }],
    [
      "cfo_100 in a correlation object",
      { id: "INV-1008", correlation: { principal_id: "cfo_100" } },
    ],
    ["the text cfo_100 as the whole input", "cfo_100"],
    // Found by the review: no test put a login token in the arguments.
    ["the CFO's login token", { id: "INV-1008", token: "tok_d4e8" }],
  ])("DSOR-SRC-02a: with %s in the arguments, the answer names the agent", (_why, input) => {
    expect(call(registry, AGENT, "invoice.get", input).correlation).toStrictEqual(AS_AGENT);
  });

  // Found by the review: no test sent the envelope a field besides the token and the
  // request id. Only the token says who is calling.
  it("DSOR-SRC-02a: a principal written in the envelope, beside the token, is never used", () => {
    const request = { ...AGENT, principal: "cfo_100" } as RequestEnvelope;
    expect(call(registry, request, "invoice.get", { id: "INV-1008" })).toStrictEqual({
      data: expect.objectContaining({ id: "INV-1008" }),
      correlation: AS_AGENT,
    });
  });

  // No rule id: which field names the caller is step 05's decision 9. Found by the
  // review: the table holds no application and no system, so a check for "human" passed.
  const NAMED_IN: [PrincipalType, string][] = [
    ["agent", "agent_id"],
    ["human", "principal_id"],
    ["application", "principal_id"],
    ["system", "principal_id"],
  ];
  it.each(NAMED_IN)("a caller of type %s is named in %s", (type, field) => {
    expect(callerIds({ id: "x_1", type, memberships: [] })).toStrictEqual({ [field]: "x_1" });
  });
});

// The places that step 05's decision 4 lists. Each test builds its own input, with one name
// in one place.
const PLACES = [
  "principal",
  "principal_id",
  "subject",
  "actor",
  "actor_chain",
  "agent_id",
  "user",
  "correlation.principal_id",
  "correlation.agent_id",
];
function naming(place: string, name: unknown): Record<string, unknown> {
  const [outer = "", inner] = place.split(".");
  return { id: "INV-1008", [outer]: inner === undefined ? name : { [inner]: name } };
}

describe("C5: a principal named in the arguments must be the caller", () => {
  it.each(PLACES)(
    "DSOR-SRC-02b: cfo_100 in %s, sent with the agent's token, is refused with AUTHORIZATION_DENIED",
    (place) => {
      expect(call(registry, AGENT, "invoice.get", naming(place, "cfo_100"))).toStrictEqual({
        code: "AUTHORIZATION_DENIED",
        message: notTheCaller(place),
        retry: "never",
        correlation: AS_AGENT,
      });
    },
  );

  // DSoR never looks the name up. So the refusal is the same whether that principal exists
  // or not, and it tells the caller nothing about who exists.
  it.each(PLACES)(
    "DSOR-SRC-02b: a name that nobody has, in %s, is refused the same way",
    (place) => {
      expect(call(registry, AGENT, "invoice.get", naming(place, "user_999"))).toStrictEqual({
        code: "AUTHORIZATION_DENIED",
        message: notTheCaller(place),
        retry: "never",
        correlation: AS_AGENT,
      });
    },
  );

  // Anything there but the caller's own id is refused. Found by the review: null, and a
  // list that held the agent's own id, were never sent.
  it.each([
    ["cfo_100 inside a list", ["cfo_100"]],
    ["cfo_100 inside an object", { id: "cfo_100" }],
    ["the agent's own id inside a list", ["accounts-payable-fte"]],
    ["null", null],
  ])("DSOR-SRC-02b: %s, in principal, is refused too", (_why, name) => {
    expect(call(registry, AGENT, "invoice.get", naming("principal", name))).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });

  it.each(PLACES)("DSOR-SRC-02b: the agent's own id in %s is accepted", (place) => {
    expect(
      call(registry, AGENT, "invoice.get", naming(place, "accounts-payable-fte")),
    ).toMatchObject({ data: { id: "INV-1008" } });
  });

  // A check made only for agents would pass every test above.
  it("DSOR-SRC-02b: a person who names another person is refused too", () => {
    expect(call(registry, SUPERVISOR, "invoice.get", naming("principal", "cfo_100"))).toStrictEqual(
      {
        code: "AUTHORIZATION_DENIED",
        message: notTheCaller("principal"),
        retry: "never",
        correlation: correlationFor({ principal_id: "user_123" }),
      },
    );
  });

  it("DSOR-SRC-02b: a person who names themselves is accepted", () => {
    expect(call(registry, CFO, "invoice.get", naming("principal_id", "cfo_100"))).toMatchObject({
      data: { id: "INV-1008" },
    });
  });

  it("DSOR-SRC-02b: when the arguments name someone else, the operation's code never runs", () => {
    const spy = vi.fn<Handler>(() => "ran");
    expect(call(registryWith(spy), AGENT, "test.run", { principal: "cfo_100" })).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // Found by the review: with the request id checked first, a bad request id hid the
  // attempt to act as the CFO behind VALIDATION_FAILED.
  it("DSOR-SRC-02b: a principal named in the arguments is refused even with a bad request id", () => {
    const request = { ...AGENT, request_id: "" };
    expect(call(registry, request, "invoice.get", naming("principal", "cfo_100"))).toStrictEqual({
      code: "AUTHORIZATION_DENIED",
      message: notTheCaller("principal"),
      retry: "never",
      correlation: AS_AGENT,
    });
  });

  // No rule id: checking the arguments before the operation's name is step 05's decision 7.
  it("a principal named in the arguments is refused even for an operation that does not exist", () => {
    expect(call(registry, AGENT, "invoice.delete", { principal: "cfo_100" })).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});

describe("C6: the caller's request id is used, and with none DSoR makes one", () => {
  // No rule id on these two. Found by the review: DSOR-COR-01b covers only a call that
  // sends no request id, and step 04's tests prove that. Using the caller's own id is
  // what §32 describes, and step 05's decisions 6 and 7.
  it("the caller's request id comes back in correlation", () => {
    const request = { ...AGENT, request_id: "ap-run-0926-001" };
    expect(call(registry, request, "invoice.get", { id: "INV-1008" }).correlation).toStrictEqual({
      request_id: "ap-run-0926-001",
      ...THE_AGENT,
    });
  });

  it("the caller's request id labels even a refusal for a missing login", () => {
    const answer = call(registry, { request_id: "ap-run-0926-001" }, "invoice.get", {});
    expect(answer).toStrictEqual({ ...NO_LOGIN, correlation: { request_id: "ap-run-0926-001" } });
  });

  // No rule id: the limits are step 05's decision 6.
  it.each([
    ["one character", "r"],
    ["128 characters", "r".repeat(128)],
    // Found by the review: code that trimmed the id changed what came back.
    ["spaces around it", " ap-run-7 "],
    ["64 emoji, which JavaScript counts as 128", "😀".repeat(64)],
  ])("a request id of %s is used, exactly as sent", (_why, id) => {
    const answer = call(registry, { ...AGENT, request_id: id }, "invoice.get", { id: "INV-1008" });
    expect(answer.correlation.request_id).toBe(id);
  });

  // No rule id: refusing a request id DSoR cannot use is step 05's decision 6. The
  // refusal carries an id that DSoR made.
  it.each([
    ["a number", 7],
    ["null", null],
    ["empty", ""],
    ["129 characters", "r".repeat(129)],
    // Found by the review: code that counted emoji as one each let this one in.
    ["65 emoji, which JavaScript counts as 130", "😀".repeat(65)],
  ])("a request id that is %s is refused with VALIDATION_FAILED", (_why, request_id) => {
    expect(
      call(registry, { ...AGENT, request_id }, "invoice.get", { id: "INV-1008" }),
    ).toStrictEqual({
      code: "VALIDATION_FAILED",
      message: BAD_REQUEST_ID,
      retry: "never",
      correlation: AS_AGENT,
    });
  });

  // No rule id: step 05's decisions 6 and 7. Found by the review: every test of a bad
  // request id used invoice.get, and none looked at whether the operation's code ran.
  it("a bad request id is refused before the operation's code runs", () => {
    const spy = vi.fn<Handler>(() => "ran");
    const answer = call(registryWith(spy), { ...AGENT, request_id: "" }, "test.run", {});
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a bad request id is refused before the operation's name is read", () => {
    const answer = call(registry, { ...AGENT, request_id: "" }, "invoice.delete", {});
    expect(answer).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
