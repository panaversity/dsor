// NEW IN STEP 05: who is calling, by claim (C1 to C6 in the README).
import { describe, expect, it, vi } from "vitest";
import { logins } from "../src/principals.ts";
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
  // the request id before the login (README, "Think it through").
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

  // No rule id: the story's three principals are this tutorial's decision 3.
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
  ])("DSOR-SRC-02a: with %s in the arguments, the answer names the agent", (_why, input) => {
    expect(call(registry, AGENT, "invoice.get", input).correlation).toStrictEqual(AS_AGENT);
  });
});

// The places that README decision 4 lists. Each test builds its own input, with one name
// in one place.
const PLACES = [
  "principal",
  "principal_id",
  "subject",
  "actor",
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

  it.each([
    ["a list", ["cfo_100"]],
    ["an object", { id: "cfo_100" }],
  ])("DSOR-SRC-02b: cfo_100 inside %s is refused too", (_why, name) => {
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

  it("DSOR-SRC-02b: a person who names itself is accepted", () => {
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

  // No rule id: checking the arguments before the operation's name is decision 7's order.
  it("a principal named in the arguments is refused even for an operation that does not exist", () => {
    expect(call(registry, AGENT, "invoice.delete", { principal: "cfo_100" })).toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});

describe("C6: the caller's request id is used, and with none DSoR makes one", () => {
  it("DSOR-COR-01b: the caller's request id comes back in correlation", () => {
    const request = { ...AGENT, request_id: "ap-run-0926-001" };
    expect(call(registry, request, "invoice.get", { id: "INV-1008" }).correlation).toStrictEqual({
      request_id: "ap-run-0926-001",
      ...THE_AGENT,
    });
  });

  it("DSOR-COR-01b: the caller's request id labels even a refusal for a missing login", () => {
    const answer = call(registry, { request_id: "ap-run-0926-001" }, "invoice.get", {});
    expect(answer).toStrictEqual({ ...NO_LOGIN, correlation: { request_id: "ap-run-0926-001" } });
  });

  // No rule id: the limits are this tutorial's decision 6.
  it.each([
    ["one character", "r"],
    ["128 characters", "r".repeat(128)],
  ])("a request id of %s is used", (_why, id) => {
    const answer = call(registry, { ...AGENT, request_id: id }, "invoice.get", { id: "INV-1008" });
    expect(answer.correlation.request_id).toBe(id);
  });

  // No rule id: refusing a request id DSoR cannot use is this tutorial's decision 6. The
  // refusal carries an id that DSoR made.
  it.each([
    ["a number", 7],
    ["null", null],
    ["empty", ""],
    ["129 characters", "r".repeat(129)],
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
});
