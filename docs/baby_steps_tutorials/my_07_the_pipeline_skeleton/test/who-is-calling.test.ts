// The test step 05 existed for: who you are comes from the login, never from the arguments.
//
// The map's "done when" for this step reads: putting `"principal": "cfo_100"` inside the
// arguments changes nothing.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { callOperation } from "../src/operations.ts";

const INV_1009 = "dsor://org_456/invoice/INV-1009";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const SUPERVISOR = { loggedInAs: "user_123" } as const;

// STEP 06. Two tests below used to issue an invoice as cfo_100. She may not any more —
// `approver` grants invoice:read and payment:approve, and not invoice:issue — so they ask as
// the agent, which holds it. Nothing about what they test has changed. A new gate in front of
// the program changing which caller a test needs is exactly what it looks like when permissions
// start working.
const ISSUER = { loggedInAs: "accounts-payable-fte" } as const;

describe("who you are comes from the login, never from the arguments", () => {
  // cfo_100 is the person who approves large payments. If a caller could claim to be her
  // by writing it down, every approval rule in DSoR would be worth nothing.
  it("DSOR-SRC-02a: a principal named in the arguments is ignored", () => {
    const honest = callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });
    const lying = callOperation(SUPERVISOR, "invoice.get", {
      invoice: INV_1008,
      principal: "cfo_100",
      subject: "cfo_100",
      loggedInAs: "cfo_100",
    });

    // Same answer, and the answer says user_123 asked, not cfo_100.
    expect(lying.kind).toBe(honest.kind);
    expect(lying.askedBy).toBe("user_123");
    expect(honest.askedBy).toBe("user_123");
  });

  it("DSOR-SRC-02a: a tenant named in the arguments is ignored too", () => {
    const answer = callOperation(SUPERVISOR, "invoice.get", {
      invoice: INV_1008,
      tenant: "org_999",
      active_tenant: "org_999",
    });

    expect(answer.kind).toBe("data");
  });

  // The test above only shows a useless extra field is harmless. This one sends what an
  // attacker would: an address for another company, and the *right* company written into
  // the arguments beside it, hoping the written one is believed. It must buy nothing.
  it("DSOR-SRC-02a: the right company in the arguments cannot buy another company's record", () => {
    const answer = callOperation(SUPERVISOR, "invoice.get", {
      invoice: "dsor://org_999/invoice/INV-1008",
      tenant: "org_456",
      active_tenant: "org_456",
      activeTenantId: "org_456",
    });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("TENANT_MISMATCH");
  });

  // The command path shares invoiceIdFrom with the query, but its own success envelope
  // names the principal separately. A review proved that field could be read out of the
  // arguments with every test still green, so the command is asked the question too.
  it("DSOR-SRC-02a: a principal named in the arguments is ignored by the command as well", () => {
    const answer = callOperation(SUPERVISOR, "invoice.issue", {
      invoice: INV_1008,
      principal: "cfo_100",
      principal_id: "cfo_100",
    });

    if (answer.kind !== "error") {
      throw new Error(`INV-1008 is already issued, so expected a refusal, got ${answer.kind}`);
    }

    expect(answer.askedBy).toBe("user_123");
    expect(answer.envelope.correlation.principal_id).toBe("user_123");
  });

  // Step 01's lesson, applied to this step's own new type. `readonly` is erased before Node
  // runs, so the answer a caller is handed must be frozen as well as declared readonly —
  // and `askedBy` is this step's entire record of who asked.
  it("an answer cannot be edited after it is handed out", () => {
    const answer = callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(Object.isFrozen(answer)).toBe(true);
    expect(() => {
      (answer as { askedBy: string }).askedBy = "cfo_100";
    }).toThrow(TypeError);
    expect(answer.askedBy).toBe("user_123");
  });

  // A caller-supplied object that throws when it is read. src/operations.ts promises that every
  // refusal comes back as an envelope, and a hostile review found two places where it did not:
  // the login, and the arguments. A stack trace is not an envelope a caller can act on.
  it("DSOR-ERR-01a: an object that throws when read is refused, not thrown at", () => {
    const throwingLogin = {
      get loggedInAs(): string {
        throw new Error("boom");
      },
    };

    const one = callOperation(throwingLogin as never, "invoice.get", { invoice: INV_1008 });

    if (one.kind !== "error") {
      throw new Error(`expected a refusal, got ${one.kind}`);
    }

    expect(one.envelope.code).toBe("AUTHENTICATION_REQUIRED");

    const throwingArgs = {
      get invoice(): string {
        throw new Error("boom");
      },
    };

    const two = callOperation(SUPERVISOR, "invoice.issue", throwingArgs);

    if (two.kind !== "error") {
      throw new Error(`expected a refusal, got ${two.kind}`);
    }

    expect(two.envelope.code).toBe("VALIDATION_FAILED");
  });

  it("DSOR-IDN-01: with nobody logged in, nothing happens at all", () => {
    const answer = callOperation(undefined, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("AUTHENTICATION_REQUIRED");
    expect(answer.envelope.retry).toBe("never");
  });

  // The login is checked before anything else, which is what DSOR-IDN-01's "before any
  // other processing" means. A nonsense operation and a nonsense address both come second.
  it("DSOR-IDN-01: the login is checked before the operation or the arguments", () => {
    const noOperation = callOperation(undefined, "execute_sql", { sql: "select 1" });
    const noAddress = callOperation(undefined, "invoice.get", {});

    for (const answer of [noOperation, noAddress]) {
      if (answer.kind !== "error") {
        throw new Error("both should have been refused");
      }

      // Not UNSUPPORTED_CAPABILITY, not VALIDATION_FAILED. The caller was refused first.
      expect(answer.envelope.code).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  it("DSOR-IDN-01: the agent asks as itself, and is a principal like any other", () => {
    const answer = callOperation({ loggedInAs: "accounts-payable-fte" }, "invoice.get", {
      invoice: INV_1008,
    });

    expect(answer.kind).toBe("data");
    expect(answer.askedBy).toBe("accounts-payable-fte");
  });

  // No rule id, for the reason given on the walk below: this step has no audit, no
  // connectors and no events, so it supports DSOR-COR-01a in part and claims neither it nor
  // DSOR-COR-01b for attribution. DSOR-COR-01b is about generating a request id, and the tests
  // that prove that live in test/envelopes.test.ts and test/login.test.ts.
  it("the answer records who asked", () => {
    const answer = callOperation({ loggedInAs: "cfo_100" }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-9999",
    });

    if (answer.kind !== "error") {
      throw new Error("INV-9999 does not exist, so this should be a refusal");
    }

    expect(answer.askedBy).toBe("cfo_100");
    expect(answer.envelope.correlation.principal_id).toBe("cfo_100");
  });

  // The caller's name is attached in twenty-two separate places — every answer, and every
  // envelope inside one. This walks all of them, because a name attached in twenty-one
  // places and dropped in the twenty-second is the kind of gap nobody notices.
  //
  // Both halves matter. `askedBy` is what the program answers with. The envelope's
  // `correlation.principal_id` is what would be *stored* — and from step 08 that is the
  // audit record, so a missing one there is evidence with no caller in it.
  //
  // **Every caller, not one caller.** The first version of this test logged in as
  // `cfo_100` and asserted the name was `"cfo_100"`. A hostile review replaced every
  // attachment with the literal `"cfo_100"` and all 100 tests passed: the suite could not
  // tell "carries the caller's name" from "carries that one string". So the expected value
  // is now the login's own name, and three different people walk the same calls.
  //
  // No rule id. Attribution is groundwork for `DSOR-COR-01a`, which also wants the
  // identifiers carried through connectors, audit and events — none of which exist yet —
  // and for `DSOR-IDN-02b`, which needs the audit log of step 08. Neither is claimed here,
  // so neither is named in a title.
  it("every answer says who asked, and so does the envelope inside it", () => {
    const calls: readonly (readonly [string, Record<string, unknown>])[] = [
      ["invoice.get", { invoice: INV_1008 }], // data
      ["invoice.get", { invoice: "INV-1008" }], // bad address
      ["invoice.get", { invoice: "dsor://org_999/invoice/INV-1008" }], // wrong company
      ["invoice.get", { invoice: "dsor://org_456/invoice/INV-9999" }], // not found
      ["invoice.get", {}], // no address at all
      ["invoice.get", { invoice: "dsor://org_456/vendor/VENDOR-44" }], // wrong kind of thing
      ["invoice.issue", { invoice: "INV-1009" }], // bad address
      ["invoice.issue", { invoice: "dsor://org_456/invoice/INV-9999" }], // not found
      ["invoice.issue", { invoice: INV_1008 }], // already issued
      ["invoice.issue", {}], // no address at all
      ["invoice.issue", { invoice: "dsor://org_456/vendor/VENDOR-44" }], // wrong kind of thing
      ["execute_sql", { sql: "select 1" }], // no contract
    ];

    for (const who of ["user_123", "cfo_100", "accounts-payable-fte"]) {
      for (const [id, args] of calls) {
        const answer = callOperation({ loggedInAs: who }, id, args);
        const where = `${who} ${id} ${JSON.stringify(args)}`;

        expect(answer.askedBy, where).toBe(who);

        if (answer.kind !== "data") {
          expect(answer.envelope.correlation.principal_id, `${where} envelope`).toBe(who);
        }
      }
    }
  });

  // An argument that cannot be written down at all. The receipt fingerprints the arguments,
  // so an unhashable one used to let the invoice be issued and *then* throw — a change made
  // with no envelope, no code and no record of who did it. It has to be refused first.
  //
  // This is the first small shape of DSOR-EXE-03a, "the intent record is written before the
  // side effect". Step 08 builds the real thing.
  it("DSOR-ERR-01a: an argument that cannot be written down is refused before anything is issued", () => {
    const circular: Record<string, unknown> = { invoice: INV_1009 };
    circular["itself"] = circular;

    const answer = callOperation(ISSUER, "invoice.issue", circular);

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(answer.askedBy).toBe("accounts-payable-fte");
    expect(answer.envelope.correlation.principal_id).toBe("accounts-payable-fte");

    // And INV-1009 is still a draft, so nothing happened.
    const after = callOperation(ISSUER, "invoice.get", { invoice: INV_1009 });

    if (after.kind !== "data") {
      throw new Error("INV-1009 should still be readable");
    }

    expect(after.invoice.status).toBe("draft");
  });

  // The success path separately, because issuing a draft can only be done once and no
  // other test looks at who asked for the one answer that changed something.
  //
  // It also proves the arguments are read **once**. The arguments belong to the caller, and
  // they used to be read twice: once to decide which invoice to issue, and again to
  // fingerprint the receipt. A property with a getter could answer differently each time, so
  // the receipt described a request that never happened. Here the getter hands back a decoy
  // on any read after the first, and the fingerprint must still be of INV-1009.
  it("the answer that changes something says who asked, and the arguments are read once", () => {
    let reads = 0;
    const args = {
      get invoice(): string {
        reads += 1;

        return reads === 1 ? INV_1009 : "dsor://org_456/invoice/INV-0000";
      },
    };

    const answer = callOperation(ISSUER, "invoice.issue", args);

    if (answer.kind !== "result") {
      throw new Error(`expected a result, got ${answer.kind}`);
    }

    expect(answer.askedBy).toBe("accounts-payable-fte");
    expect(answer.envelope.correlation.principal_id).toBe("accounts-payable-fte");
    expect(reads).toBe(1);

    const honest = createHash("sha256")
      .update(JSON.stringify({ invoice: INV_1009 }))
      .digest("hex");

    expect(answer.envelope.payload_hash).toBe(`sha256:${honest}`);
  });

  // Added 2026-10-05. The one shape of "from the arguments" that no test above sends: no login
  // at all, and a real person's name planted in the arguments. Every planted-principal test
  // above logs in first, so a fallback that read `args.principal` only when the login was
  // missing would never fire under them. It was tried here: with that fallback inside
  // `authenticate`, this test was the only one of 181 that went red. The answer must still be
  // the refusal nobody-is-logged-in gets, attributed to nobody — a program that believed the
  // arguments here would file the call under cfo_100 and then ask the permission question on
  // her behalf.
  it("DSOR-SRC-02a: with nobody logged in, a principal planted in the arguments is not the caller", () => {
    const planted = [
      { principal: "cfo_100" },
      { principal: "user_123" },
      { loggedInAs: "cfo_100" },
      { principal_id: "user_123", subject: "user_123" },
    ] as const;

    for (const id of ["invoice.get", "invoice.issue"]) {
      for (const extra of planted) {
        const answer = callOperation(undefined, id, { invoice: INV_1008, ...extra });
        const where = `${id} ${JSON.stringify(extra)}`;

        if (answer.kind !== "error") {
          throw new Error(`${where}: expected a refusal, got ${answer.kind}`);
        }

        // Not AUTHORIZATION_DENIED, not CONFLICT: those would mean a person was found first.
        expect(answer.envelope.code, where).toBe("AUTHENTICATION_REQUIRED");
        expect(answer.askedBy, where).toBe("(nobody)");
        expect(answer.envelope.correlation.principal_id, where).toBeUndefined();
      }
    }
  });

  // Losing a name is bad. Inventing one is worse: an unauthenticated request stamped with
  // a real person's id would put a caller in the record who never asked for anything.
  it("DSOR-IDN-01: a refused login is attributed to nobody, never to a real person", () => {
    for (const login of [undefined, { loggedInAs: "nobody" }, { loggedInAs: "cfo_100_evil" }]) {
      const answer = callOperation(login, "invoice.get", { invoice: INV_1008 });

      if (answer.kind !== "error") {
        throw new Error("that login should have been refused");
      }

      expect(answer.askedBy).toBe("(nobody)");
      expect(answer.envelope.correlation.principal_id).toBeUndefined();
      expect(["user_123", "cfo_100", "accounts-payable-fte"]).not.toContain(answer.askedBy);
    }
  });
});
