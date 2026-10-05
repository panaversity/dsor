// The test step 05 existed for: who you are comes from the login, never from the arguments.
//
// The map's "done when" for this step reads: putting `"principal": "cfo_100"` inside the
// arguments changes nothing.

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callOperation } from "../src/operations.ts";
import { aDatabase } from "./support/database.ts";

const INV_1009 = "dsor://org_456/invoice/INV-1009";

const INV_1008 = "dsor://org_456/invoice/INV-1008";
const SUPERVISOR = { loggedInAs: "user_123" } as const;

// STEP 06. Two tests below used to issue an invoice as cfo_100. She may not any more —
// `approver` grants invoice:read and payment:approve, and not invoice:issue — so they ask as
// the agent, which holds it. Nothing about what they test has changed. A new gate in front of
// the program changing which caller a test needs is exactly what it looks like when permissions
// start working.
const ISSUER = { loggedInAs: "accounts-payable-fte", tenant: "org_456" } as const;

// STEP 09: the log lives in a database, so these tests need one. A single PGlite for the
// whole file — creating one costs about 350ms, and one per test would turn this suite into minutes.
let db: Awaited<ReturnType<typeof aDatabase>>;

beforeAll(async () => {
  db = await aDatabase();
});

afterAll(async () => {
  await db.close();
});

describe("who you are comes from the login, never from the arguments", () => {
  // cfo_100 is the person who approves large payments. If a caller could claim to be her
  // by writing it down, every approval rule in DSoR would be worth nothing.
  it("DSOR-SRC-02a: a principal named in the arguments is ignored", async () => {
    const honest = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });
    const lying = await callOperation(SUPERVISOR, "invoice.get", {
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

  it("DSOR-SRC-02a: a tenant named in the arguments is ignored too", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.get", {
      invoice: INV_1008,
      tenant: "org_999",
      active_tenant: "org_999",
    });

    expect(answer.kind).toBe("data");
  });

  // The test above only shows a useless extra field is harmless. This one sends what an
  // attacker would: an address for another company, and the *right* company written into
  // the arguments beside it, hoping the written one is believed. It must buy nothing.
  it("DSOR-SRC-02a: the right company in the arguments cannot buy another company's record", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.get", {
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
  it("DSOR-SRC-02a: a principal named in the arguments is ignored by the command as well", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.issue", {
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
  it("an answer cannot be edited after it is handed out", async () => {
    const answer = await callOperation(SUPERVISOR, "invoice.get", { invoice: INV_1008 });

    expect(Object.isFrozen(answer)).toBe(true);
    expect(() => {
      (answer as { askedBy: string }).askedBy = "cfo_100";
    }).toThrow(TypeError);
    expect(answer.askedBy).toBe("user_123");
  });

  // A caller-supplied object that throws when it is read. src/operations.ts promises that every
  // refusal comes back as an envelope, and a hostile review found two places where it did not:
  // the login, and the arguments. A stack trace is not an envelope a caller can act on.
  it("DSOR-ERR-01a: an object that throws when read is refused, not thrown at", async () => {
    const throwingLogin = {
      get loggedInAs(): string {
        throw new Error("boom");
      },
    };

    const one = await callOperation(throwingLogin as never, "invoice.get", { invoice: INV_1008 });

    if (one.kind !== "error") {
      throw new Error(`expected a refusal, got ${one.kind}`);
    }

    expect(one.envelope.code).toBe("AUTHENTICATION_REQUIRED");

    const throwingArgs = {
      get invoice(): string {
        throw new Error("boom");
      },
    };

    const two = await callOperation(SUPERVISOR, "invoice.issue", throwingArgs);

    if (two.kind !== "error") {
      throw new Error(`expected a refusal, got ${two.kind}`);
    }

    expect(two.envelope.code).toBe("VALIDATION_FAILED");
  });

  // STEP 09, and it is the same hole one layer further out. The test above sends an object
  // with a throwing *getter*, and `ownString` catches that because the read sits inside a `try`.
  // `Object.hasOwn` sat **outside** it — and `Object.hasOwn` consults a Proxy's
  // `getOwnPropertyDescriptor` trap, so a caller who sends a Proxy with a throwing trap never
  // reaches the `try` at all. Measured before the fix:
  //
  //     callOperation THREW: boom
  //     records written while that happened: 0
  //
  // A raw Error and an empty audit log, from one object a caller chose to send. The arguments side
  // was already safe (`VALIDATION_FAILED`, one record written); only the login was not.
  it("DSOR-ERR-01a: a login whose own Proxy trap throws is refused, not thrown at", async () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(): never {
          throw new Error("boom");
        },
      },
    );

    const answer = await callOperation(hostile as never, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("AUTHENTICATION_REQUIRED");
    expect(answer.envelope.retry).toBe("never");
  });

  // Which traps are actually on this path, measured rather than assumed. I first wrote this test
  // expecting all four to be refused, and two of them are not — correctly:
  //
  //     getOwnPropertyDescriptor   refused AUTHENTICATION_REQUIRED   <-- the hole that was fixed
  //     get                        refused AUTHENTICATION_REQUIRED
  //     has                        resolved to user_123
  //     ownKeys                    resolved to user_123
  //
  // `Object.hasOwn` consults `getOwnPropertyDescriptor`, not `has` and not `ownKeys`. So a login
  // that traps those two is still a login whose `loggedInAs` is genuinely its own and genuinely
  // readable, and resolving it is the right answer, not a miss. Measured 2026-10-04.
  it("DSOR-ERR-01a: the two traps this path does consult are both refused", async () => {
    for (const [name, handler] of [
      [
        "getOwnPropertyDescriptor",
        {
          getOwnPropertyDescriptor: (): never => {
            throw new Error("boom");
          },
        },
      ],
      [
        "get",
        {
          get: (): never => {
            throw new Error("boom");
          },
        },
      ],
    ] as const) {
      const hostile = new Proxy({ loggedInAs: "user_123" }, handler);
      const answer = await callOperation(hostile as never, "invoice.get", { invoice: INV_1008 });

      if (answer.kind !== "error") {
        throw new Error(`the ${name} trap should have been refused, got ${answer.kind}`);
      }

      expect(answer.envelope.code, name).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  // And the two it does not consult. A trap that is never reached cannot refuse a login that is
  // otherwise perfectly good, so these resolve — and this test is what would notice if a later
  // change started reading the login through `in` or `Object.keys` and made them throwable.
  // No rule id: this asserts a *success*, so it proves nothing about normalising a caller into a
  // principal. It is a regression pin for the measurement above, and a title naming a rule would
  // have counted as coverage of something it does not cover.
  it("a trap this path never consults does not change the answer", async () => {
    for (const [name, handler] of [
      [
        "has",
        {
          has: (): never => {
            throw new Error("boom");
          },
        },
      ],
      [
        "ownKeys",
        {
          ownKeys: (): never => {
            throw new Error("boom");
          },
        },
      ],
    ] as const) {
      const hostile = new Proxy({ loggedInAs: "user_123" }, handler);
      const answer = await callOperation(hostile as never, "invoice.get", { invoice: INV_1008 });

      expect(answer.kind, name).not.toBe("error");
      expect(answer.askedBy, name).toBe("user_123");
    }
  });

  it("DSOR-IDN-01: with nobody logged in, nothing happens at all", async () => {
    const answer = await callOperation(undefined, "invoice.get", { invoice: INV_1008 });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("AUTHENTICATION_REQUIRED");
    expect(answer.envelope.retry).toBe("never");
  });

  // The login is checked before anything else, which is what DSOR-IDN-01's "before any
  // other processing" means. A nonsense operation and a nonsense address both come second.
  it("DSOR-IDN-01: the login is checked before the operation or the arguments", async () => {
    const noOperation = await callOperation(undefined, "execute_sql", { sql: "select 1" });
    const noAddress = await callOperation(undefined, "invoice.get", {});

    for (const answer of [noOperation, noAddress]) {
      if (answer.kind !== "error") {
        throw new Error("both should have been refused");
      }

      // Not UNSUPPORTED_CAPABILITY, not VALIDATION_FAILED. The caller was refused first.
      expect(answer.envelope.code).toBe("AUTHENTICATION_REQUIRED");
    }
  });

  it("DSOR-IDN-01: the agent asks as itself, and is a principal like any other", async () => {
    const answer = await callOperation(
      { loggedInAs: "accounts-payable-fte", tenant: "org_456" },
      "invoice.get",
      {
        invoice: INV_1008,
      },
    );

    expect(answer.kind).toBe("data");
    expect(answer.askedBy).toBe("accounts-payable-fte");
  });

  // No rule id, for the reason given on the walk below: this step has no audit, no
  // connectors and no events, so it supports DSOR-COR-01a in part and claims neither it nor
  // DSOR-COR-01b for attribution. DSOR-COR-01b is about generating a request id, and the two
  // tests that prove that live in test/envelopes.test.ts.
  it("the answer records who asked", async () => {
    const answer = await callOperation({ loggedInAs: "cfo_100" }, "invoice.issue", {
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
  it("every answer says who asked, and so does the envelope inside it", async () => {
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
        const answer = await callOperation({ loggedInAs: who }, id, args);
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
  it("DSOR-ERR-01a: an argument that cannot be written down is refused before anything is issued", async () => {
    const circular: Record<string, unknown> = { invoice: INV_1009 };
    circular["itself"] = circular;

    const answer = await callOperation(ISSUER, "invoice.issue", circular);

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("VALIDATION_FAILED");
    expect(answer.askedBy).toBe("accounts-payable-fte");
    expect(answer.envelope.correlation.principal_id).toBe("accounts-payable-fte");

    // And INV-1009 is still a draft, so nothing happened.
    const after = await callOperation(ISSUER, "invoice.get", { invoice: INV_1009 });

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
  it("the answer that changes something says who asked, and the arguments are read once", async () => {
    let reads = 0;
    const args = {
      get invoice(): string {
        reads += 1;

        return reads === 1 ? INV_1009 : "dsor://org_456/invoice/INV-0000";
      },
    };

    const answer = await callOperation(ISSUER, "invoice.issue", args);

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

  // Losing a name is bad. Inventing one is worse: an unauthenticated request stamped with
  // a real person's id would put a caller in the record who never asked for anything.
  it("DSOR-IDN-01: a refused login is attributed to nobody, never to a real person", async () => {
    for (const login of [undefined, { loggedInAs: "nobody" }, { loggedInAs: "cfo_100_evil" }]) {
      const answer = await callOperation(login, "invoice.get", { invoice: INV_1008 });

      if (answer.kind !== "error") {
        throw new Error("that login should have been refused");
      }

      expect(answer.askedBy).toBe("(nobody)");
      expect(answer.envelope.correlation.principal_id).toBeUndefined();
      expect(["user_123", "cfo_100", "accounts-payable-fte"]).not.toContain(answer.askedBy);
    }
  });
});
