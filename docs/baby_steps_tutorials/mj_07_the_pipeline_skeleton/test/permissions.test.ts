// What a caller may do, by claim (C1 to C6 in step 06's README).
import { describe, expect, it, vi } from "vitest";
import { handlers } from "../src/operations.ts";
import { checkRoles, permissionsOf } from "../src/permissions.ts";
import { logins, whoIsCalling, type Membership, type Principal } from "../src/principals.ts";
import { call } from "../src/pipeline.ts";
import {
  buildRegistry,
  type Contract,
  type ContractSource,
  type Handler,
  type Registry,
} from "../src/registry.ts";
import type { RequestEnvelope } from "../src/request.ts";
import {
  AGENT,
  BAD_REQUEST_ID,
  CFO,
  GOOD_ISSUE,
  STARTING_ROLES,
  SUPERVISOR,
  THE_AGENT,
  THE_CFO,
  THE_SUPERVISOR,
  contract,
  correlationFor,
  inputsWith,
  notGranted,
  notTheCaller,
  refusal,
  registry,
  rolesFile,
  shipped,
  shippedInputs,
  shippedRoles,
  shippedWith,
  source,
  without,
  type Caller,
} from "./helpers.ts";

/** The shipped operations plus one more, whose contract and code the test writes. */
function withOperation(
  extra: Record<string, unknown>,
  code?: Handler,
  // NEW IN STEP 07: a new operation may need an input schema of its own.
  inputs: ContractSource[] = shippedInputs,
): Registry {
  const id = extra["id"] as string;
  const withCode = code === undefined ? handlers : { ...handlers, [id]: code };
  return buildRegistry([...shipped, source(extra, `${id}.json`)], withCode, shippedRoles, inputs);
}

/** The whole refusal, when the caller does not hold the permission a call needs. */
function denied(name: string, permission: string, caller: Caller): Record<string, unknown> {
  return {
    code: "AUTHORIZATION_DENIED",
    message: notGranted(name, permission),
    retry: "never",
    correlation: correlationFor(caller),
  };
}

/** A made-up person, for roles and companies that the story's principals do not have. */
function person(memberships: Membership[]): Principal {
  return { id: "user_777", type: "human", memberships };
}

describe("C1: every permission is <resource>:<action>, checked at start-up", () => {
  it.each([
    ["capital letters", "Invoice:Read"],
    ["a wildcard", "invoice:*"],
    ["no action", "invoice"],
    ["nothing at all", ""],
    ["a space in front", " invoice:read"],
    ["a space after it", "invoice:read "],
    ["a suffix other than .propose", "invoice:issue.approve"],
    // Found by the review: a one-character change to the pattern let each of these in,
    // and every test still passed.
    ["a capital first letter", "Invoice:read"],
    ["a capital letter inside the resource", "inVoice:read"],
    ["a capital letter inside the action", "invoice:reAd"],
    ["a digit first", "1nvoice:read"],
    ["a dot where the colon goes", "invoice.read"],
    ["a star inside the action", "invoice:r*"],
    ["-propose instead of .propose", "invoice:issue-propose"],
    [".propose twice", "invoice:issue.propose.propose"],
    ["a hyphen", "purchase-order:release"],
    ["a line break", "invoice:read\nx"],
  ])("DSOR-AUT-01a: a role granting a permission with %s stops start-up", (_why, bad) => {
    const table = rolesFile({ ...STARTING_ROLES, CFO: ["invoice:read", bad] });
    expect(refusal(() => buildRegistry(shipped, handlers, table))).toMatch(
      `roles.json: the role "CFO" grants ${JSON.stringify(bad)}, which is not <resource>:<action>`,
    );
  });

  // A "yes" test pins what the specification's pattern allows, so a stricter check fails.
  it.each([
    ["the .propose form", "payment:execute.propose"],
    ["an underscore in the resource", "purchase_order:release"],
    ["a digit in the resource", "form_1099:file"],
    // Found by the review: a pattern that refused these passed every test.
    ["an underscore in the action", "invoice:read_all"],
    ["a digit in the action", "form:form_1099"],
    ["one letter on each side", "x:y"],
  ])("DSOR-AUT-01a: a role may grant a permission with %s", (_why, good) => {
    const table = rolesFile({ ...STARTING_ROLES, CFO: ["invoice:read", good] });
    expect(refusal(() => buildRegistry(shipped, handlers, table))).toBe("");
  });

  // Found by the review: every bad permission was last in its list, so code that checked
  // only the last one, or stopped at the first, passed.
  it("DSOR-AUT-01a: every bad permission is named, wherever it sits in the list", () => {
    const table = rolesFile({
      ...STARTING_ROLES,
      CFO: ["invoice:*", "Invoice:Read", "invoice:read"],
    });
    expect(checkRoles(table, logins.values()).problems).toEqual([
      'roles.json: the role "CFO" grants "invoice:*", which is not <resource>:<action>',
      'roles.json: the role "CFO" grants "Invoice:Read", which is not <resource>:<action>',
    ]);
  });

  // Step 06's decision 4: a role that is not in the table is a typo. It is found before
  // any caller arrives.
  it("DSOR-AUT-01a: a principal holding a role that is not in the table stops start-up", () => {
    const noCfo = rolesFile({ ap_agent: ["invoice:read"], ap_supervisor: ["invoice:read"] });
    expect(refusal(() => buildRegistry(shipped, handlers, noCfo))).toMatch(
      'roles.json: cfo_100 holds the role "CFO", which the table does not have',
    );
  });

  // Found by the review: the test above names a person, so a check that skipped agents
  // passed it. The agent's role is looked up too.
  it("DSOR-AUT-01a: an agent holding a role that is not in the table stops start-up too", () => {
    const noAgentRole = rolesFile({ ap_supervisor: ["invoice:read"], CFO: ["invoice:read"] });
    expect(refusal(() => buildRegistry(shipped, handlers, noAgentRole))).toMatch(
      'roles.json: accounts-payable-fte holds the role "ap_agent", which the table does not have',
    );
  });

  // A table kept in a plain object would find a role named toString (step 03). Found by
  // the review: a lookup that ignored capitals let cfo in.
  it.each([
    ["a name every JavaScript object has", "toString"],
    ["the right name in the wrong case", "cfo"],
  ])("DSOR-AUT-01a: a principal holding %s as a role stops start-up too", (_why, role) => {
    const odd = person([{ tenant_id: "org_456", roles: [role] }]);
    expect(checkRoles(rolesFile(STARTING_ROLES), [odd]).problems).toEqual([
      `roles.json: user_777 holds the role ${JSON.stringify(role)}, which the table does not have`,
    ]);
  });

  // Found by the review: code that looked only at the first membership, or only at the
  // one in org_456, missed a typo in another company.
  it("DSOR-AUT-01a: a role held in another company must be in the table too", () => {
    const odd = person([
      { tenant_id: "org_456", roles: ["CFO"] },
      { tenant_id: "org_789", roles: ["auditr"] },
    ]);
    expect(checkRoles(rolesFile(STARTING_ROLES), [odd]).problems).toEqual([
      'roles.json: user_777 holds the role "auditr", which the table does not have',
    ]);
  });

  // Found by the review: JSON.parse keeps the last of two lines for one role, so a second
  // ap_agent line could widen the agent to invoice:issue, and start-up saw nothing.
  it("DSOR-AUT-01a: a role written twice in the table stops start-up", () => {
    const text = JSON.stringify(STARTING_ROLES).replace(
      "}",
      ',"ap_agent":["invoice:read","invoice:issue"]}',
    );
    expect(refusal(() => buildRegistry(shipped, handlers, { file: "roles.json", text }))).toMatch(
      'roles.json: "ap_agent" is written twice in one object',
    );
  });

  it("DSOR-AUT-01a: a role table that is not JSON stops start-up", () => {
    const broken = { file: "roles.json", text: '{ "CFO": [' };
    expect(refusal(() => buildRegistry(shipped, handlers, broken))).toMatch(
      "roles.json: not valid JSON",
    );
  });

  it.each([
    ["a list", ["invoice:read"]],
    ["null", null],
    ["a text", "invoice:read"],
  ])("DSOR-AUT-01a: a role table that is %s stops start-up", (_why, table) => {
    expect(refusal(() => buildRegistry(shipped, handlers, rolesFile(table)))).toMatch(
      "roles.json: must be an object that gives each role a list of permissions",
    );
  });

  // A text is not a list, even though JavaScript can loop over its letters. Found by the
  // review: without the `continue`, a text was named once for each letter, null crashed
  // start-up, and the role was named "not in the table" as well. One problem, once.
  it.each([
    ["a text", "invoice:read"],
    ["null", null],
    ["a number", 42],
    ["an object", { read: "invoice:read" }],
  ])(
    "DSOR-AUT-01a: a role whose permissions are %s is named once, as not a list",
    (_why, grants) => {
      const table = rolesFile({ ...STARTING_ROLES, CFO: grants });
      expect(checkRoles(table, logins.values()).problems).toEqual([
        'roles.json: the role "CFO" must grant a list of permissions',
      ]);
    },
  );

  // A pattern test turns what it is given into text, and ["invoice:read"] becomes
  // "invoice:read".
  it.each([
    ["a number", 42],
    ["a list that holds a permission", ["invoice:read"]],
  ])("DSOR-AUT-01a: a role granting %s stops start-up", (_why, bad) => {
    const table = rolesFile({ ...STARTING_ROLES, CFO: [bad] });
    expect(refusal(() => buildRegistry(shipped, handlers, table))).toMatch(
      `roles.json: the role "CFO" grants ${JSON.stringify(bad)}, which is not <resource>:<action>`,
    );
  });

  // Every problem is named at once, the contracts' and the table's (step 03's README,
  // decision 2).
  it("DSOR-AUT-01a: problems in the role table are named with the contracts' problems", () => {
    const noRisk = without(contract("invoice.get"), "risk");
    const table = rolesFile({ ap_agent: ["invoice:*"], ap_supervisor: ["invoice:read"] });
    const message = refusal(() => buildRegistry(shippedWith(noRisk), handlers, table));
    expect(message).toMatch("invoice.get.json: must have required property 'risk'");
    expect(message).toMatch('roles.json: the role "ap_agent" grants "invoice:*"');
    expect(message).toMatch(
      'roles.json: cfo_100 holds the role "CFO", which the table does not have',
    );
  });

  // Step 03's schema check already refuses this contract, with the same pattern.
  it("DSOR-AUT-01a: a contract that needs Invoice:Read stops start-up", () => {
    const bad = { ...contract("invoice.get"), authorization: { permission: "Invoice:Read" } };
    expect(refusal(() => buildRegistry(shippedWith(bad), handlers, shippedRoles))).toMatch(
      "invoice.get.json: /authorization/permission must match pattern",
    );
  });
});

describe("C2: a caller holds the permissions of its roles, and only those", () => {
  it("DSOR-AUT-01a: the shipped roles.json is step 06's decision 6", () => {
    expect(JSON.parse(shippedRoles.text)).toStrictEqual(STARTING_ROLES);
  });

  it.each([
    ["accounts-payable-fte", "tok_7f3a", ["invoice:read"]],
    ["user_123", "tok_2c91", ["invoice:issue", "invoice:read"]],
    ["cfo_100", "tok_d4e8", ["invoice:read"]],
  ])("DSOR-AUT-01a: %s holds exactly the permissions its roles grant", (_who, token, held) => {
    expect([...permissionsOf(whoIsCalling({ token }), registry.roles)].sort()).toEqual(held);
  });

  // No rule id: only the roles in org_456 count, the one company of this step (step 06's
  // README, decision 1). Step 10 picks the company of each call. Found by the review:
  // with org_456 always last, code that read only the last membership passed, and so did
  // code that let org_4567 count as org_456.
  const COMPANIES: [string, Membership[], string[]][] = [
    [
      "another company listed first",
      [
        { tenant_id: "org_789", roles: ["ap_supervisor"] },
        { tenant_id: "org_456", roles: ["CFO"] },
      ],
      ["invoice:read"],
    ],
    [
      "another company listed last",
      [
        { tenant_id: "org_456", roles: ["CFO"] },
        { tenant_id: "org_789", roles: ["ap_supervisor"] },
      ],
      ["invoice:read"],
    ],
    ["a company whose id starts with org_456", [{ tenant_id: "org_4567", roles: ["CFO"] }], []],
    ["org_456 in capital letters", [{ tenant_id: "ORG_456", roles: ["CFO"] }], []],
  ];
  it.each(COMPANIES)("only the roles held in org_456 count: %s", (_why, memberships, held) => {
    expect([...permissionsOf(person(memberships), registry.roles)]).toEqual(held);
  });

  // Found by the review: every principal in the story holds one role, so code that read
  // only the first role, or only the last, passed every test.
  it("DSOR-AUT-01a: a caller with two roles holds what each of them grants", () => {
    const cfoApproves = { ...STARTING_ROLES, CFO: ["invoice:read", "payment:approve"] };
    const { roles } = checkRoles(rolesFile(cfoApproves), []);
    const twoRoles = person([{ tenant_id: "org_456", roles: ["ap_supervisor", "CFO"] }]);
    expect([...permissionsOf(twoRoles, roles)].sort()).toEqual([
      "invoice:issue",
      "invoice:read",
      "payment:approve",
    ]);
  });

  // Found by the review: code that gave a missing role every permission in the table
  // passed. Start-up refuses such a role for the principals it knows, so this caller is
  // made up.
  it("DSOR-AUT-01a: a role that the table does not have grants nothing", () => {
    const auditor = person([{ tenant_id: "org_456", roles: ["auditor"] }]);
    expect([...permissionsOf(auditor, registry.roles)]).toEqual([]);
  });

  // No rule id. Found by the review: one table shared by every registry passed, because
  // the tests happened to build their registries in a harmless order.
  it("building a second registry does not change what the first one grants", () => {
    const first = buildRegistry(shipped, handlers, shippedRoles);
    buildRegistry(shipped, handlers, rolesFile({ ...STARTING_ROLES, CFO: [] }));
    expect(call(first, CFO, "invoice.get", { id: "INV-1008" })).toMatchObject({
      data: { id: "INV-1008" },
    });
  });
});

describe("C3: a call whose permission the caller does not hold is refused", () => {
  it.each([
    ["cfo_100", CFO, THE_CFO],
    ["accounts-payable-fte", AGENT, THE_AGENT],
  ])("DSOR-AUT-01b: %s, who may read, is denied invoice.issue", (_who, request, caller) => {
    expect(call(registry, request, "invoice.issue", {})).toStrictEqual(
      denied("invoice.issue", "invoice:issue", caller),
    );
  });

  // The other half of the map's "done when": a caller without invoice:read cannot read.
  it("DSOR-AUT-01b: cfo_100 is denied invoice.get when the CFO role grants nothing", () => {
    const grantsNothing = rolesFile({ ...STARTING_ROLES, CFO: [] });
    const answer = call(buildRegistry(shipped, handlers, grantsNothing), CFO, "invoice.get", {
      id: "INV-1008",
    });
    expect(answer).toStrictEqual(denied("invoice.get", "invoice:read", THE_CFO));
  });

  // Step 06's decision 2: only an exact match grants. invoice:read is the start of
  // invoice:read_all, and grants none of it (break Q2b).
  it("DSOR-AUT-01b: holding invoice:read does not grant an operation that needs invoice:read_all", () => {
    const readAll = { permission: "invoice:read_all" };
    const list = { ...contract("invoice.get"), id: "invoice.list", authorization: readAll };
    expect(
      call(
        withOperation(list, () => []),
        AGENT,
        "invoice.list",
        {},
      ),
    ).toStrictEqual(denied("invoice.list", "invoice:read_all", THE_AGENT));
  });

  // The permission comes from the contract, not from the operation's name or its code.
  it("DSOR-AUT-01b: the permission checked is the one the contract names", () => {
    const needsIssue = {
      ...contract("invoice.get"),
      authorization: { permission: "invoice:issue" },
    };
    const changed = buildRegistry(shippedWith(needsIssue), handlers, shippedRoles);
    expect(call(changed, AGENT, "invoice.get", { id: "INV-1008" })).toStrictEqual(
      denied("invoice.get", "invoice:issue", THE_AGENT),
    );
    expect(call(changed, SUPERVISOR, "invoice.get", { id: "INV-1008" })).toMatchObject({
      data: { id: "INV-1008" },
    });
  });
});

describe("C4: an operation nobody was granted is denied to everyone", () => {
  const CALLERS: [string, RequestEnvelope, Caller][] = [
    ["accounts-payable-fte", AGENT, THE_AGENT],
    ["user_123", SUPERVISOR, THE_SUPERVISOR],
    ["cfo_100", CFO, THE_CFO],
  ];

  // The success signal (step 06's README): one new contract, and nothing else changed.
  // Nobody refused invoice.void. No role grants invoice:void, so nobody may call it.
  const voids = { ...contract("invoice.issue"), id: "invoice.void" };
  const withVoid = withOperation({ ...voids, authorization: { permission: "invoice:void" } });
  it.each(CALLERS)(
    "DSOR-AUT-01b: %s is denied invoice.void, which no role grants",
    (_who, request, caller) => {
      const input = { invoice: "dsor://org_456/invoice/INV-1008" };
      expect(call(withVoid, request, "invoice.void", input)).toStrictEqual(
        denied("invoice.void", "invoice:void", caller),
      );
    },
  );

  // A new query with code would run for anyone, if "nobody said no" meant "allowed".
  it.each(CALLERS)(
    "DSOR-AUT-01b: %s is denied vendor.get, new code no role grants, and the code never runs",
    (_who, request, caller) => {
      const spy = vi.fn<Handler>(() => ({ id: "VENDOR-44" }));
      const vendorGet = {
        ...contract("invoice.get"),
        id: "vendor.get",
        input: { schema: "VendorGetRequest" },
        output: { schema: "Vendor" },
        authorization: { permission: "vendor:read" },
      };
      // NEW IN STEP 07: vendor.get's input schema, so start-up accepts the new contract.
      const vendorInput = inputsWith(
        "VendorGetRequest.schema.json",
        '{ "type": "object", "additionalProperties": false }',
      );
      const answer = call(withOperation(vendorGet, spy, vendorInput), request, "vendor.get", {
        id: "VENDOR-44",
      });
      expect(answer).toStrictEqual(denied("vendor.get", "vendor:read", caller));
      expect(spy).not.toHaveBeenCalled();
    },
  );

  // Found by the review: the schema refuses such a contract at start-up, so only a
  // registry built by hand can hold one. No test held the code to its promise that
  // nobody may call it.
  it.each([
    ["an empty authorization", { authorization: {} }],
    ["no authorization at all", {}],
  ])(
    "DSOR-AUT-01b: a contract with %s, in a registry built by hand, is denied to everyone",
    (_why, part) => {
      const spy = vi.fn<Handler>(() => ({ id: "INV-1008" }));
      const bare = { ...without(contract("invoice.get"), "authorization"), ...part };
      const handMade: Registry = {
        contracts: new Map([["invoice.get", bare as Contract]]),
        handlers: new Map([["invoice.get", spy]]),
        roles: registry.roles,
        // NEW IN STEP 07: the shipped check for each operation's input.
        inputs: registry.inputs,
      };
      expect(call(handMade, SUPERVISOR, "invoice.get", { id: "INV-1008" })).toStrictEqual({
        code: "AUTHORIZATION_DENIED",
        message: '"invoice.get" names no permission, so nobody may call it',
        retry: "never",
        correlation: correlationFor(THE_SUPERVISOR),
      });
      expect(spy).not.toHaveBeenCalled();
    },
  );
});

describe("C5: who is calling, then the contract, then the permission, then 'is it built'", () => {
  // Found by the review: this test first checked only user_123's answer, which a step
  // with no permission check gives too. The pair shows the order: one operation, two
  // callers, two answers.
  it("DSOR-AUT-01b: a reader is denied invoice.issue, and user_123, who may issue, hears it is not built yet", () => {
    expect(call(registry, CFO, "invoice.issue", {})).toStrictEqual(
      denied("invoice.issue", "invoice:issue", THE_CFO),
    );
    // NEW IN STEP 07: a good input, so the call also passes line ⑥.
    expect(call(registry, SUPERVISOR, "invoice.issue", GOOD_ISSUE)).toStrictEqual({
      code: "UNSUPPORTED_CAPABILITY",
      message: '"invoice.issue" is not built yet',
      retry: "never",
      correlation: correlationFor(THE_SUPERVISOR),
    });
  });

  // With code, invoice.issue is refused because it is a command. A reader must still hear
  // that it is denied.
  it("DSOR-AUT-01b: a reader is denied invoice.issue even when it has code", () => {
    const issueHasCode = { ...handlers, "invoice.issue": () => "issued" };
    const answer = call(
      buildRegistry(shipped, issueHasCode, shippedRoles),
      CFO,
      "invoice.issue",
      {},
    );
    expect(answer).toStrictEqual(denied("invoice.issue", "invoice:issue", THE_CFO));
  });

  // Step 06's decision 3: the .propose form allows propose_only mode, which arrives in
  // step 23. It does not grant invoice:issue (break Q2a).
  it("DSOR-AUT-01b: a caller holding only invoice:issue.propose is denied invoice.issue", () => {
    const proposeOnly = rolesFile({
      ...STARTING_ROLES,
      CFO: ["invoice:read", "invoice:issue.propose"],
    });
    const proposing = buildRegistry(shipped, handlers, proposeOnly);
    expect(call(proposing, CFO, "invoice.issue", {})).toStrictEqual(
      denied("invoice.issue", "invoice:issue", THE_CFO),
    );
  });

  // No rule id: step 05's checks come before the permission (step 06's README, C5).
  // Found by the review: the permission check could move ahead of them, and every test
  // passed.
  it.each([
    ["a bad request id", { ...AGENT, request_id: "" }, {}, "VALIDATION_FAILED", BAD_REQUEST_ID],
    [
      "cfo_100 named in its arguments",
      AGENT,
      { principal: "cfo_100" },
      "AUTHORIZATION_DENIED",
      notTheCaller("principal"),
    ],
  ])(
    "the agent that sends %s to invoice.issue hears about that, not about its permission",
    (_why, request, input, code, message) => {
      expect(call(registry, request, "invoice.issue", input)).toStrictEqual({
        code,
        message,
        retry: "never",
        correlation: correlationFor(THE_AGENT),
      });
    },
  );
});

describe("C6: permissions never come from the caller", () => {
  it.each([
    ["a list of permissions", { permissions: ["invoice:issue"] }],
    ["a list of roles", { roles: ["ap_supervisor"] }],
  ])("DSOR-AUT-01b: %s in the input grants the agent nothing", (_why, claim) => {
    const input = { invoice: "dsor://org_456/invoice/INV-1008", ...claim };
    expect(call(registry, AGENT, "invoice.issue", input)).toStrictEqual(
      denied("invoice.issue", "invoice:issue", THE_AGENT),
    );
  });

  it("DSOR-AUT-01b: permissions and roles in the envelope, beside the token, grant nothing", () => {
    const request = { ...AGENT, permissions: ["invoice:issue"], roles: ["ap_supervisor"] };
    expect(call(registry, request as RequestEnvelope, "invoice.issue", {})).toStrictEqual(
      denied("invoice.issue", "invoice:issue", THE_AGENT),
    );
  });

  // No rule id: DSOR-AUT-01b is about what is denied. "Changes nothing" works the other
  // way too: an empty list takes nothing away.
  // NEW IN STEP 07: line ⑥ now refuses the list itself, since invoice.get's input schema
  // does not name it. It is refused as a bad input, and not as a denied permission.
  it("an empty list of permissions in the input is refused as a bad input", () => {
    const input = { id: "INV-1008", permissions: [] };
    expect(call(registry, AGENT, "invoice.get", input)).toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
