// Who is calling, and what a login may be.
//
// A login says who you are. These tests say what a login is allowed to be, and what
// happens when there is not one. Nothing here is about what you may DO — that is step 06.

import { describe, expect, it } from "vitest";
import { everyone, findPerson } from "../src/people.ts";
import { principalFrom, type Login } from "../src/login.ts";

describe("the people this program knows", () => {
  it("DSOR-IDN-01: each one has a type and the company they belong to", () => {
    const supervisor = findPerson("user_123");

    if (supervisor === undefined) {
      throw new Error("user_123 is missing from the people list");
    }

    expect(supervisor.type).toBe("human");
    expect(supervisor.memberships).toEqual([{ tenantId: "org_456" }]);
  });

  // The agent has its own entry and its own identity. It does not borrow a person's.
  // Titled DSOR-IDN-01, not DSOR-IDN-02a. What this proves is that a principal carries a
  // **type**, which is IDN-01's own words. IDN-02a is about an agent authenticating with its
  // own credentials, and nothing here authenticates anything — see the README's list of rules
  // this step does not claim.
  it("DSOR-IDN-01: the agent is a principal in its own right", () => {
    expect(findPerson("accounts-payable-fte")?.type).toBe("agent");
    expect(findPerson("user_123")?.type).toBe("human");
    expect(findPerson("cfo_100")?.type).toBe("human");
  });

  // A login name that merely BEGINS with a real id must not be that person. Without this,
  // changing the comparison to startsWith lets "cfo_100_evil" log in AS cfo_100 — the
  // person who approves large payments — and the four rejected names below all miss it,
  // because none of them extends a real id.
  it("DSOR-IDN-01: a name is matched whole, never as a prefix or a fragment", () => {
    for (const name of [
      "cfo_100_evil",
      "user_1234",
      "accounts-payable-fte-2",
      "user_12",
      "cfo_10",
      "user_123 ",
      " user_123",
    ]) {
      expect(findPerson(name), `${name} must not be anybody`).toBeUndefined();
    }

    expect(findPerson("user_123")?.id).toBe("user_123");
  });

  it("DSOR-IDN-01: a principal's companies cannot be added to or rewritten", () => {
    const supervisor = findPerson("user_123");

    if (supervisor === undefined) {
      throw new Error("user_123 is missing from the people list");
    }

    // Freezing the list does not freeze what is in it — the same trap step 01 met with
    // invoices. Both are needed, and step 10 builds the tenant boundary on this value.
    expect(Object.isFrozen(supervisor.memberships)).toBe(true);
    expect(Object.isFrozen(supervisor.memberships[0])).toBe(true);
    expect(() => {
      // @ts-expect-error memberships is a readonly array, so push must not compile
      supervisor.memberships.push({ tenantId: "org_999" });
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error the tenant id is readonly, so this assignment must not compile
      supervisor.memberships[0].tenantId = "org_999";
    }).toThrow(TypeError);
    expect(findPerson("user_123")?.memberships).toEqual([{ tenantId: "org_456" }]);
  });

  // everyone() hands back the real list. If it were not frozen, a caller could add a
  // principal of their own invention — and then log in as it.
  it("the cast cannot be added to", () => {
    expect(Object.isFrozen(everyone())).toBe(true);
    expect(() => {
      // @ts-expect-error the cast is a readonly array, so push must not compile
      everyone().push({ id: "intruder", type: "human", memberships: [] });
    }).toThrow(TypeError);
    expect(findPerson("intruder")).toBeUndefined();
  });

  it("the whole story's cast is here, and nobody else", () => {
    expect(
      everyone()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["accounts-payable-fte", "cfo_100", "user_123"]);
  });
});

describe("logging in", () => {
  it("DSOR-IDN-01: a login becomes a principal", () => {
    const who = principalFrom({ loggedInAs: "user_123" }, "req_1");

    if ("refused" in who) {
      throw new Error(`expected a principal, got ${who.refused.code}`);
    }

    expect(who.principal.id).toBe("user_123");
    expect(who.principal.type).toBe("human");
  });

  // Decision 22: switching is the point. Step 06 needs two callers to contrast.
  it("DSOR-IDN-01: a different login is a different principal", () => {
    const a = principalFrom({ loggedInAs: "user_123" }, "req_1");
    const b = principalFrom({ loggedInAs: "cfo_100" }, "req_1");

    if ("refused" in a || "refused" in b) {
      throw new Error("both of those should have logged in");
    }

    expect(a.principal.id).toBe("user_123");
    expect(b.principal.id).toBe("cfo_100");
  });

  // Decision 21: no login, no answer.
  it("DSOR-IDN-01: nobody logged in is refused, and a retry cannot help", () => {
    const who = principalFrom(undefined, "req_1");

    if (!("refused" in who)) {
      throw new Error("a missing login should have been refused");
    }

    expect(who.refused.code).toBe("AUTHENTICATION_REQUIRED");
    expect(who.refused.retry).toBe("never");
  });

  it("DSOR-IDN-01: a name nobody has is refused the same way", () => {
    for (const name of ["nobody", "USER_123", "", "user_124"]) {
      const who = principalFrom({ loggedInAs: name }, "req_1");

      if (!("refused" in who)) {
        throw new Error(`${JSON.stringify(name)} should have been refused`);
      }

      expect(who.refused.code).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  // Both refusals carry the same code and retry class on purpose, so the message is the
  // only thing that tells them apart.
  it("DSOR-IDN-01: each refusal says in words which refusal it is", () => {
    const nobody = principalFrom(undefined, "req_1");
    const stranger = principalFrom({ loggedInAs: "nobody" }, "req_1");

    if (!("refused" in nobody) || !("refused" in stranger)) {
      throw new Error("both of those should have been refused");
    }

    expect(nobody.refused.message).toContain("logged in");
    expect(stranger.refused.message).toContain('"nobody"');
  });

  // A login arrives from outside the program, so at run time it is data, not a type.
  // `Login` is erased before Node runs: nothing stops a caller handing over `null`, or an
  // object whose `loggedInAs` is a number. The whole job of this function is to refuse, so
  // it must refuse these too — never throw. A thrown error is not an envelope, and a caller
  // cannot act on a stack trace.
  it("DSOR-IDN-01: a login that is not a login is refused, never thrown at", () => {
    const rubbish: readonly unknown[] = [
      null,
      {},
      { loggedInAs: 7 },
      { loggedInAs: null },
      { loggedInAs: ["user_123"] },
      "user_123",
      0,
    ];

    for (const login of rubbish) {
      const who = principalFrom(login as Login | undefined, "req_1");

      if (!("refused" in who)) {
        throw new Error(`${JSON.stringify(login)} should have been refused`);
      }

      expect(who.refused.code, JSON.stringify(login)).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  // A name the object does not own, only inherits. The login must hold its own name: a
  // program that reads an inherited one can be handed an empty object and find a principal
  // in it, which is an identity arriving from somewhere nobody chose.
  it("DSOR-IDN-01: a name inherited from a prototype is not a login", () => {
    const polluted = Object.create({ loggedInAs: "cfo_100" }) as Login;

    // The name really is readable — this is not a test of nothing.
    expect(polluted.loggedInAs).toBe("cfo_100");

    const who = principalFrom(polluted, "req_1");

    if (!("refused" in who)) {
      throw new Error("an inherited name should have been refused");
    }

    expect(who.refused.code).toBe("AUTHENTICATION_REQUIRED");
  });

  // `refusal` takes the request id and the caller's name in two adjacent optional slots, so
  // passing one where the other belongs typechecks cleanly. These two refusals pass neither,
  // which is exactly where such a swap would go unnoticed. The request id is generated, so
  // it has a shape, and a name does not have that shape.
  it("DSOR-COR-01b: an identity refusal carries a generated request id, not a name", () => {
    for (const login of [undefined, { loggedInAs: "cfo_100_evil" }]) {
      const who = principalFrom(login, "req_1");

      if (!("refused" in who)) {
        throw new Error("that login should have been refused");
      }

      expect(who.refused.correlation.request_id).toMatch(/^req_\d+$/);
      expect(who.refused.correlation.principal_id).toBeUndefined();
    }
  });

  it("a principal cannot be edited after it is handed out", () => {
    const who = principalFrom({ loggedInAs: "user_123" }, "req_1");

    if ("refused" in who) {
      throw new Error("user_123 should have logged in");
    }

    expect(Object.isFrozen(who.principal)).toBe(true);
    expect(() => {
      // @ts-expect-error the id is readonly, so this assignment must not compile
      who.principal.id = "cfo_100";
    }).toThrow(TypeError);
  });
});
