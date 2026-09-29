// NEW IN STEP 07: the order of the checks, as something a test can read.
//
// Nothing here calls an operation. The whole point of this step is that the order stopped being
// the order some lines happened to sit in, and became a list — so these tests are about the list.

import { describe, expect, it } from "vitest";
import { assertPipeline, runPipeline, applies, type Context, type Stage } from "../src/pipeline.ts";
// The machinery lives in pipeline.ts; the actual list lives in operations.ts, because the stages
// need the registry and the handlers and those belong to the operations.
import { callOperation, makeDoor, PIPELINE, STAGES_CHECKED } from "../src/operations.ts";

/** A stage that does nothing, for tests about the list rather than about the work. */
function fake(at: number | null, name: string, applies: Stage["applies"] = "both"): Stage {
  return Object.freeze({
    at,
    name,
    applies,
    run: (context: Context) => ({ kind: "carry_on" as const, context }),
  });
}

describe("the pipeline", () => {
  // The order, written out. If a later step inserts a stage in the wrong place, this is what says
  // so — which is the whole reason the order is a list and not the shape of a function.
  it("DSOR-EXE-01a: the stages run in this order", () => {
    expect(PIPELINE.map((s) => s.name)).toEqual([
      "authenticate",
      "resolve the operation",
      "authorize",
      "validate the input",
    ]);
  });

  // §21 numbers its seventeen steps. This step has four, and the gaps in the numbering are the
  // roadmap: 1 to 5 is missing the tenant, the delegation and the operational status; after 6 come
  // the idempotency claim, the proposal, the preconditions and the controls.
  it("DSOR-EXE-01a: each stage carries its §21 number, and they only ever go up", () => {
    expect(PIPELINE.map((s) => s.at)).toEqual([1, null, 5, 6]);

    const numbered = PIPELINE.map((s) => s.at).filter((at): at is number => at !== null);

    expect([...numbered].sort((a, b) => a - b)).toEqual(numbered);
  });

  it("DSOR-EXE-01a: no stage appears twice", () => {
    expect(new Set(PIPELINE.map((s) => s.name)).size).toBe(PIPELINE.length);
  });

  // `applies` is the one place that decides, and the walker is its only caller. There used to be a
  // `stagesFor` helper saying the same thing beside a condition inside the walker, and no door ever
  // called the helper — so the two tests here certified a copy nothing ran.
  it("DSOR-EXE-01b: a command-only stage applies to a command and not to a query", () => {
    const both = fake(1, "authenticate");
    const only = fake(7, "claim the idempotency key", "command");

    expect(applies(both, "query")).toBe(true);
    expect(applies(both, "command")).toBe(true);
    expect(applies(only, "query")).toBe(false);
    expect(applies(only, "command")).toBe(true);
  });

  it("DSOR-EXE-01b: every stage in the real list applies to both kinds, for now", () => {
    for (const stage of PIPELINE) {
      expect(applies(stage, "query"), stage.name).toBe(true);
      expect(applies(stage, "command"), stage.name).toBe(true);
    }
  });

  // A bad list is refused when the program loads, the way a bad contract is in step 03 and a bad
  // role table is in step 06. A pipeline is the one thing in this program whose *order* is the
  // guarantee, so a list that cannot be trusted is not something to discover on a request.
  it("DSOR-EXE-01a: a list whose numbers go backwards stops the program", () => {
    expect(() => assertPipeline([fake(5, "authorize"), fake(1, "authenticate")])).toThrow(
      /out of order/,
    );
  });

  it("DSOR-EXE-01a: a list with the same stage twice stops the program", () => {
    expect(() => assertPipeline([fake(1, "authenticate"), fake(5, "authenticate")])).toThrow(
      /twice/,
    );
  });

  // Each of the four is named, and dropping any one of them is refused by name. A count would
  // have caught a short list; the names catch the *wrong* list.
  it("DSOR-EXE-01b: a list missing any stage the program needs stops it, by name", () => {
    const whole = [
      fake(1, "authenticate"),
      fake(null, "resolve the operation"),
      fake(5, "authorize"),
      fake(6, "validate the input"),
    ];

    // The whole list is fine, so the cases below fail for the reason claimed.
    expect(assertPipeline(whole)).toBe(4);

    for (const missing of whole) {
      const short = whole.filter((s) => s !== missing);

      expect(() => assertPipeline(short), missing.name).toThrow(missing.name);
    }
  });

  it("DSOR-EXE-01a: an empty list stops the program", () => {
    expect(() => assertPipeline([])).toThrow(/is empty/);
  });

  // The count, not `true`. Lesson 12: a boolean beside a start-up check can be left behind when
  // the check is deleted, and every test stays green.
  it("DSOR-EXE-01a: the list was checked when the program loaded, all of it", () => {
    expect(STAGES_CHECKED).toBe(PIPELINE.length);
    expect(STAGES_CHECKED).toBeGreaterThan(0);
  });

  it("the list cannot be edited after it is handed out", () => {
    expect(Object.isFrozen(PIPELINE)).toBe(true);

    for (const stage of PIPELINE) {
      expect(Object.isFrozen(stage), stage.name).toBe(true);
      expect(() => {
        (stage as { name: string }).name = "something else";
      }, stage.name).toThrow(TypeError);
    }

    expect(() => (PIPELINE as Stage[]).push(fake(99, "sneak in"))).toThrow(TypeError);
  });

  // Piece 2 left this branch unreached: every stage in the real list applies to both kinds, so
  // nothing walked a command-only one. These walk a list of their own, which is the honest way to
  // test a mechanism the real list does not yet exercise.
  it("DSOR-EXE-01b: the walker skips a command-only stage for a query, and runs it for a command", () => {
    const ran: string[] = [];
    const watch = (at: number | null, name: string, applies: Stage["applies"]): Stage =>
      Object.freeze({
        at,
        name,
        applies,
        run: (context: Context) => {
          ran.push(name);

          return { kind: "carry_on" as const, context };
        },
      });

    const list = [
      watch(1, "authenticate", "both"),
      watch(7, "claim the idempotency key", "command"),
      watch(9, "read the state", "both"),
    ];

    // A query: the contract says `query`, so the command-only stage is stepped over.
    ran.length = 0;
    runPipeline(list, {
      login: undefined,
      id: "invoice.get",
      args: {},
      contract: { kind: "query" } as never,
    });
    expect(ran).toEqual(["authenticate", "read the state"]);

    // A command: every stage runs.
    ran.length = 0;
    runPipeline(list, {
      login: undefined,
      id: "invoice.issue",
      args: {},
      contract: { kind: "command" } as never,
    });
    expect(ran).toEqual(["authenticate", "claim the idempotency key", "read the state"]);
  });

  // A command-only stage cannot sit before the contract is resolved, because until then there is no
  // kind to ask about — the walker would step over it on every call, including commands. That is a
  // silent skip, which is exactly what DSOR-EXE-01b forbids, so the list is refused at start-up.
  it("DSOR-EXE-01b: a command-only stage before the contract is resolved stops the program", () => {
    // The command-only stage carries no §21 number, so the numbers still ascend and this list
    // fails for the one reason under test rather than for being out of order as well.
    const tooEarly = [
      fake(1, "authenticate"),
      fake(null, "claim the idempotency key", "command"),
      fake(null, "resolve the operation"),
      fake(5, "authorize"),
      fake(6, "validate the input"),
    ];

    expect(() => assertPipeline(tooEarly)).toThrow(/before the operation is resolved/);

    // The same stage one line later is fine.
    const inOrder = [
      fake(1, "authenticate"),
      fake(null, "resolve the operation"),
      fake(5, "authorize"),
      fake(6, "validate the input"),
      fake(7, "claim the idempotency key", "command"),
    ];

    expect(assertPipeline(inOrder)).toBe(5);
  });

  // A door is how an interface gets the pipeline. DSOR-OPR-04a says every interface must invoke the
  // *same* pipeline, so a door is built from a list and the list is checked as the door is built —
  // not on the first request, and not by trusting whoever builds it.
  it("DSOR-OPR-04a: a door cannot be built from a list that does not pass the check", () => {
    expect(() => makeDoor([fake(1, "authenticate")])).toThrow(/missing/);
    expect(() => makeDoor([])).toThrow(/is empty/);
  });

  // And the branch piece 2 could not reach. A stage that says it carried on without filling in what
  // it is for leaves the walk finishing without something the execution needs. That is this
  // program's bug, not the caller's, which is what INTERNAL_ERROR means.
  //
  // Every stage, not one: a review pointed out that lazying only `validate the input` left the
  // other three unproven, and that removing `authorize`'s own guard made the door THROW at the
  // caller with all 161 tests green. And two callers, not one, asserted against the login rather
  // than a literal — the literal was lesson 10 in this step's own new test.
  it("DSOR-ERR-01a: a stage that does not do its job is INTERNAL_ERROR, not a crash", () => {
    for (const login of [{ loggedInAs: "user_123" }, { loggedInAs: "cfo_100" }]) {
      // Only the stages that FILL something can leave the walk short. `authorize` fills nothing —
      // it only refuses — so a no-op `authorize` is a different failure, and it has its own test
      // below.
      const fillers = PIPELINE.filter((stage) => stage.name !== "authorize");

      for (const lazied of fillers) {
        const list = PIPELINE.map((stage) =>
          stage.name === lazied.name
            ? Object.freeze({
                ...stage,
                run: (context: Context) => ({ kind: "carry_on" as const, context }),
              })
            : stage,
        );

        const where = `${login.loggedInAs} with ${lazied.name} lazied`;
        const answer = makeDoor(list)(login, "invoice.get", {
          invoice: "dsor://org_456/invoice/INV-1008",
        });

        if (answer.kind !== "error") {
          throw new Error(`${where}: expected a refusal, got ${answer.kind}`);
        }

        expect(answer.envelope.code, where).toBe("INTERNAL_ERROR");
        expect(answer.envelope.retry, where).toBe("never");

        // Who it is attributed to follows what actually happened: nobody, when authenticate is the
        // stage that did nothing; otherwise the caller who asked.
        const expected = lazied.name === "authenticate" ? "(nobody)" : login.loggedInAs;

        expect(answer.askedBy, where).toBe(expected);

        // And "(nobody)" is never written into the evidence as if it were a person.
        if (lazied.name === "authenticate") {
          expect(answer.envelope.correlation.principal_id, where).toBeUndefined();
        } else {
          expect(answer.envelope.correlation.principal_id, where).toBe(login.loggedInAs);
        }
      }
    }
  });

  // What the list check CANNOT see, stated as a test rather than only as a comment.
  //
  // `REQUIRED` is a list of names, so a stage called `authorize` that returns carry_on without
  // asking anything satisfies assertPipeline — a review built exactly that door. There is no way to
  // check a function's meaning from a list. What catches it is behaviour: cfo_100 does not hold
  // invoice:issue, and with that door she can issue.
  it("DSOR-AUT-01b: a door whose authorize does nothing passes the list check and is caught here", () => {
    const hollow = PIPELINE.map((stage) =>
      stage.name === "authorize"
        ? Object.freeze({
            ...stage,
            run: (context: Context) => ({ kind: "carry_on" as const, context }),
          })
        : stage,
    );

    // The list is fine. That is the point.
    expect(assertPipeline(hollow)).toBe(PIPELINE.length);

    const answer = makeDoor(hollow)({ loggedInAs: "cfo_100" }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
    });

    // She gets past the gate, which is exactly what the real door must never allow.
    expect(answer.kind).not.toBe("error");

    // And the real door refuses her.
    const real = callOperation({ loggedInAs: "cfo_100" }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
    });

    if (real.kind !== "error") {
      throw new Error(`the real door should refuse cfo_100, got ${real.kind}`);
    }

    expect(real.envelope.code).toBe("AUTHORIZATION_DENIED");
  });

  // Every path out of the door hands back a frozen answer. `readonly` is erased before Node runs, so
  // without this a caller could rewrite `askedBy` on the answer they were given — and two of these
  // paths had no test at all.
  it("every answer the door gives back is frozen", () => {
    const good = "dsor://org_456/invoice/INV-1008";
    const paths = [
      ["nobody logged in", undefined, "invoice.get", { invoice: good }],
      ["a name nobody has", { loggedInAs: "nobody" }, "invoice.get", { invoice: good }],
      ["no such operation", { loggedInAs: "user_123" }, "execute_sql", {}],
      ["an id that is not text", { loggedInAs: "user_123" }, Symbol("id"), {}],
      ["an id from the prototype", { loggedInAs: "user_123" }, "toString", {}],
      ["denied", { loggedInAs: "cfo_100" }, "invoice.issue", { invoice: good }],
      ["already issued", { loggedInAs: "user_123" }, "invoice.issue", { invoice: good }],
      ["read", { loggedInAs: "user_123" }, "invoice.get", { invoice: good }],
    ] as const;

    for (const [why, login, id, args] of paths) {
      const answer = callOperation(
        login as never,
        id as never,
        args as Readonly<Record<string, unknown>>,
      );

      expect(Object.isFrozen(answer), why).toBe(true);
      expect(() => {
        (answer as { askedBy: string }).askedBy = "cfo_100";
      }, why).toThrow(TypeError);
    }
  });

  // An operation named by something that is not text used to reach a template string and throw a
  // raw TypeError at the caller. And `handlers` is a plain object, so an id of "toString" found a
  // function on Object.prototype — the same lookup that let a role named `toString` grant
  // permissions in step 06.
  it("DSOR-ERR-01a: an operation named by something that is not text is refused, not thrown at", () => {
    for (const id of [Symbol("nope"), 7, null, undefined, {}, ["invoice.get"]]) {
      const answer = callOperation({ loggedInAs: "user_123" }, id as never, {});

      if (answer.kind !== "error") {
        throw new Error(`${String(id)}: expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code, String(id)).toBe("UNSUPPORTED_CAPABILITY");
    }
  });

  it("DSOR-ERR-01a: an operation id that only exists on Object.prototype is not an operation", () => {
    for (const id of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      const answer = callOperation({ loggedInAs: "user_123" }, id, {});

      if (answer.kind !== "error") {
        throw new Error(`${id}: expected a refusal, got ${answer.kind}`);
      }

      expect(answer.envelope.code, id).toBe("UNSUPPORTED_CAPABILITY");
    }
  });

  // A stage returns what it learned; it does not edit what it was handed. The context is frozen on
  // the way in and after every stage, so a stage cannot rewrite the request under the checks that
  // already ran — change the id after authorize said yes, say.
  it("DSOR-EXE-01a: a stage cannot edit the context it was given", () => {
    let threw = "";
    const vandal: Stage = Object.freeze({
      at: null,
      name: "resolve the operation",
      applies: "both",
      run: (context: Context) => {
        try {
          (context as { id: string }).id = "invoice.issue";
        } catch (error) {
          threw = (error as Error).constructor.name;
        }

        return { kind: "carry_on" as const, context };
      },
    });

    const list = PIPELINE.map((stage) => (stage.name === vandal.name ? vandal : stage));
    const answer = makeDoor(list)({ loggedInAs: "user_123" }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });

    expect(threw).toBe("TypeError");

    // And the call it actually made is the one that was asked for, not the one the stage wanted.
    expect(answer.kind).toBe("error");
  });

  // The test this step most needed and did not have. A review permuted the four real stages and
  // found FOUR of the twenty-four orderings accepted — including `resolve the operation` before
  // `authenticate`, which answers an unauthenticated caller UNSUPPORTED_CAPABILITY and tells them
  // which operations exist. Every other ordering test here reads PIPELINE, so none of them ever
  // handed the checker a wrong order.
  it("DSOR-EXE-01a: of every ordering of the real stages, exactly one is accepted", () => {
    const orderings = <T>(xs: readonly T[]): T[][] =>
      xs.length <= 1
        ? [[...xs]]
        : xs.flatMap((x, i) =>
            orderings([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
          );

    const all = orderings(PIPELINE);

    expect(all).toHaveLength(24);

    const accepted = all.filter((list) => {
      try {
        assertPipeline(list);

        return true;
      } catch {
        return false;
      }
    });

    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.map((stage) => stage.name)).toEqual(PIPELINE.map((stage) => stage.name));
  });

  // The two swaps that matter most, named, so a failure says which guarantee went — and which guard
  // caught it. The numbers catch a swap between two numbered stages; the name order catches the ones
  // they cannot, which are the swaps involving a stage that carries `null`.
  it("DSOR-EXE-01a: the orders the checker refuses, in the words a reader needs", () => {
    const byName = (name: string): Stage => {
      const found = PIPELINE.find((stage) => stage.name === name);

      if (found === undefined) {
        throw new Error(`${name} is not in the pipeline`);
      }

      return found;
    };

    // Resolving the operation before knowing who is asking tells a stranger which operations exist.
    // Only the name order can catch this one: `resolve the operation` carries no number.
    expect(() =>
      assertPipeline([
        byName("resolve the operation"),
        byName("authenticate"),
        byName("authorize"),
        byName("validate the input"),
      ]),
    ).toThrow(/authenticate belongs/);

    // Reading the arguments before authority is settled is the leak step 06 tested for. The numbers
    // catch this one, because 6 before 5 descends.
    expect(() =>
      assertPipeline([
        byName("authenticate"),
        byName("resolve the operation"),
        byName("validate the input"),
        byName("authorize"),
      ]),
    ).toThrow(/out of order/);
  });

  // §21 has seventeen steps, so a number outside that is not a §21 number. NaN is the one that
  // matters: every comparison against it is false, so one NaN hides exactly one descent.
  it("DSOR-EXE-01a: a §21 number §21 does not have stops the program", () => {
    for (const at of [0, 18, 99, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const list = [
        fake(1, "authenticate"),
        fake(null, "resolve the operation"),
        fake(at, "authorize"),
        fake(6, "validate the input"),
      ];

      expect(() => assertPipeline(list), String(at)).toThrow(/not a step §21 has/);
    }
  });
});
