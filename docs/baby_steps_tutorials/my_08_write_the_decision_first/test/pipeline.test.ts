// NEW IN STEP 07: the order of the checks, as something a test can read.
//
// Nothing here calls an operation. The whole point of this step is that the order stopped being
// the order some lines happened to sit in, and became a list — so these tests are about the list.

import { describe, expect, it } from "vitest";
import { assertPipeline, runPipeline, applies, type Context, type Stage } from "../src/pipeline.ts";
// The machinery lives in pipeline.ts; the actual list lives in operations.ts, because the stages
// need the registry and the handlers and those belong to the operations.
import { callOperation, makeDoor, PIPELINE, STAGES_CHECKED } from "../src/operations.ts";
import { forgetTheLog, theLog } from "../src/audit.ts";
import { getInvoice, resetInvoices } from "../src/invoice.ts";

/** A stage that does nothing, for tests about the list rather than about the work. */
function fake(
  at: number | null,
  name: string,
  applies: Stage["applies"] = "both",
  // NEW IN STEP 08. `record the decision` is the only stage that needs it true, so it defaults to
  // the answer that is right for every other stage — and a list built with the wrong one is exactly
  // what the two new checks in assertPipeline refuse.
  evenAfterARefusal = name === "record the decision",
): Stage {
  return Object.freeze({
    at,
    name,
    applies,
    evenAfterARefusal,
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
      "record the decision",
    ]);
  });

  // §21 numbers its seventeen steps. This step has four, and the gaps in the numbering are the
  // roadmap: 1 to 5 is missing the tenant, the delegation and the operational status; after 6 come
  // the idempotency claim, the proposal, the preconditions and the controls.
  it("DSOR-EXE-01a: each stage carries its §21 number, and they only ever go up", () => {
    expect(PIPELINE.map((s) => s.at)).toEqual([1, null, 5, 6, 11]);

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
      fake(11, "record the decision"),
    ];

    // The whole list is fine, so the cases below fail for the reason claimed.
    expect(assertPipeline(whole)).toBe(5);

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

  /**
   * The walker itself, against a refusal. A review pointed out that `runPipeline` was called exactly
   * twice in this file and neither call refused — so every claim about "carry the refusal, skip the
   * unflagged, run the flagged, the last one wins" was proven only indirectly, through `callOperation`.
   * Swapping the two `continue`s in the walker left all 198 tests passing.
   */
  it("DSOR-EXE-02: a refusal is carried, the unflagged are skipped, and the flagged still run", () => {
    const ran: string[] = [];
    const refuses = (name: string, flagged: boolean, no: boolean): Stage =>
      Object.freeze({
        at: null,
        name,
        applies: "both" as const,
        evenAfterARefusal: flagged,
        run: (context: Context) => {
          ran.push(name);

          return no
            ? {
                kind: "refused" as const,
                answer: Object.freeze({
                  kind: "error" as const,
                  askedBy: "(nobody)",
                  envelope: { code: name, message: name, retry: "never" } as never,
                }),
              }
            : { kind: "carry_on" as const, context };
        },
      });

    const start = { login: undefined, id: "invoice.get", args: {}, requestId: "req_1" };
    const walked = runPipeline(
      [refuses("first", false, true), refuses("second", false, true), refuses("third", true, true)],
      start,
    );

    // "second" never ran, because something had already refused and it is not flagged.
    expect(ran).toEqual(["first", "third"]);

    // And the flagged stage's refusal replaced the first one — which is what makes an unrecordable
    // denial come back as EVIDENCE_STORE_UNAVAILABLE rather than as the denial.
    if (walked.kind !== "refused" || walked.answer.kind !== "error") {
      throw new Error(`expected a refusal in an error envelope, got ${walked.kind}`);
    }

    expect(walked.answer.envelope.code).toBe("third");

    // The flagged stage is handed the refusal that happened, and a context whose later fields were
    // never filled — because the stages that fill them were skipped. Nothing says a flagged stage may
    // assume otherwise, so this is the promise it is owed.
    ran.length = 0;

    let sawRefusal: unknown;
    const watcher: Stage = Object.freeze({
      at: null,
      name: "record the decision",
      applies: "both" as const,
      evenAfterARefusal: true,
      run: (context: Context) => {
        sawRefusal = context.refusal;

        expect(context.principal).toBeUndefined();
        expect(context.requestId).toBe("req_1");

        return { kind: "carry_on" as const, context };
      },
    });

    runPipeline([refuses("first", false, true), watcher], start);

    expect((sawRefusal as { envelope: { code: string } }).envelope.code).toBe("first");
  });

  /**
   * The hole a deep pass found, and the fix for it.
   *
   * `assertPipeline` checks that a stage called `record the decision` is in the list, in the right
   * place, with the right flag, applying to both kinds. It cannot check what the function *does* —
   * so a door built with a **no-op** recorder passed every check, issued INV-1009, answered
   * `COMMITTED`, and wrote **nothing**. A side effect with no evidence, which is the worst shape
   * `DSOR-EXE-02` has.
   *
   * A list check cannot close that, and this test used to say so and stop there. A **receipt** can:
   * the stage leaves its record id in the context, and the door refuses to execute without one. So
   * the guarantee no longer rests on the stage being the right stage — it rests on a record existing.
   */
  it("DSOR-EXE-02: nothing executes without the record §21.11 wrote", () => {
    forgetTheLog();
    resetInvoices();

    const blind = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: (context: Context) => ({ kind: "carry_on" as const, context }),
          })
        : stage,
    );

    // The list is accepted: the name is there, the flag is on, it applies to both kinds.
    expect(assertPipeline(blind)).toBe(PIPELINE.length);

    const answer = makeDoor(blind)({ loggedInAs: "user_123" }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
    });

    if (answer.kind !== "error") {
      throw new Error(`expected a refusal, got ${answer.kind}`);
    }

    expect(answer.envelope.code).toBe("INTERNAL_ERROR");
    expect(answer.envelope.retry).toBe("never");
    expect(answer.envelope.message).toContain("without a record of the decision");

    // The point of the whole step: no evidence, so nothing happened.
    expect(getInvoice("INV-1009")?.status).toBe("draft");
    expect(theLog()).toHaveLength(0);

    // And the real pipeline does the same call, records it, and issues the invoice.
    const real = callOperation({ loggedInAs: "user_123" }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
    });

    expect(real.kind).toBe("result");
    expect(theLog()).toHaveLength(1);
    expect(getInvoice("INV-1009")?.status).toBe("issued");
  });

  /**
   * The receipt names a record that is actually in the log.
   *
   * Without this, replacing `recorded: written?.record_id` with any literal string passed the whole
   * suite — the door was checking that *something* was there, not that the something was real. A stage
   * placed after §21.11 reads the receipt, which is how a test can see a field that is otherwise
   * private to the walk.
   */
  it("DSOR-EXE-02: the receipt names the record that was written", () => {
    forgetTheLog();

    let receipt: string | undefined;
    const peek: Stage = Object.freeze({
      at: 13,
      name: "read the receipt",
      applies: "both",
      evenAfterARefusal: false,
      run: (context: Context) => {
        receipt = context.recorded;

        return { kind: "carry_on" as const, context };
      },
    });

    const answer = makeDoor([...PIPELINE, peek])({ loggedInAs: "user_123" }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });

    expect(answer.kind).toBe("data");
    expect(theLog()).toHaveLength(1);

    // Not merely present — the id of the record that exists.
    expect(receipt).toBe(theLog()[0]!.record_id);
    expect(receipt).toMatch(/^audit:org_456:\d+:0$/);
  });

  // A query too, because a read is the case where nothing would have looked wrong at all.
  it("DSOR-EXE-02: a read without a record is refused as well", () => {
    forgetTheLog();

    const blind = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({
            ...stage,
            run: (context: Context) => ({ kind: "carry_on" as const, context }),
          })
        : stage,
    );

    const answer = makeDoor(blind)({ loggedInAs: "user_123" }, "invoice.get", {
      invoice: "dsor://org_456/invoice/INV-1008",
    });

    // It used to come back as `data` with the invoice in it, and nothing written down.
    expect(answer.kind).toBe("error");
    expect(theLog()).toHaveLength(0);
  });

  // NEW IN STEP 08, and every one of these is a list a review got `assertPipeline` to ACCEPT.
  it("DSOR-EXE-01a: an unnumbered stage may not float anywhere it likes", () => {
    const floating = fake(null, "do the side effect");

    // Six positions in the real five-stage list. Every one of them used to be accepted.
    for (let at = 0; at <= PIPELINE.length; at += 1) {
      const list = [...PIPELINE.slice(0, at), floating, ...PIPELINE.slice(at)];

      expect(() => assertPipeline(list), `position ${at}`).toThrow(/carries no §21 number/);
    }

    // And `resolve the operation` is still allowed to, because §21 assumes that step.
    expect(assertPipeline(PIPELINE)).toBe(PIPELINE.length);
  });

  it("DSOR-EXE-02: only the recording stage may run after a refusal, wherever it sits", () => {
    for (const name of PIPELINE.map((stage) => stage.name)) {
      if (name === "record the decision") {
        continue;
      }

      const flagged = PIPELINE.map((stage) =>
        stage.name === name ? Object.freeze({ ...stage, evenAfterARefusal: true }) : stage,
      );

      expect(() => assertPipeline(flagged), name).toThrow(/may not run after a refusal/);
    }

    // The case the positional rule missed: flagged and sitting AFTER the recording. A review appended
    // exactly this with a side effect in it, and a DENIED command was carried out.
    const late = fake(14, "execute", "both", true);

    expect(() => assertPipeline([...PIPELINE, late])).toThrow(/may not run after a refusal/);

    // Unflagged, the same stage in the same place is fine.
    expect(assertPipeline([...PIPELINE, fake(14, "execute")])).toBe(PIPELINE.length + 1);
  });

  it("DSOR-EXE-01b: a command-only recording stage stops the program", () => {
    // §21 routes queries to step 11 too, so a command-only recording stage answers every read
    // perfectly and records none of them. assertPipeline accepted it until a review said so.
    const commandOnly = PIPELINE.map((stage) =>
      stage.name === "record the decision"
        ? Object.freeze({ ...stage, applies: "command" as const })
        : stage,
    );

    expect(() => assertPipeline(commandOnly)).toThrow(/must apply to both kinds/);
    expect(() => makeDoor(commandOnly)).toThrow(/must apply to both kinds/);
  });

  // A door is checked when it is built, and then walks a frozen copy — not the array it was handed.
  it("DSOR-OPR-04a: a door cannot be rewritten after it has been checked", () => {
    const list = [...PIPELINE];
    const door = makeDoor(list);

    // Every one of these used to change what the door did, after the check had passed.
    list.length = 2;
    list.push(fake(99, "nonsense"));

    const answer = door({ loggedInAs: "cfo_100" }, "invoice.issue", {
      invoice: "dsor://org_456/invoice/INV-1009",
    });

    expect(answer.kind).toBe("error");
    expect(answer.kind === "error" && answer.envelope.code).toBe("AUTHORIZATION_DENIED");
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
        evenAfterARefusal: false,
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
      requestId: "req_1",
      contract: { kind: "query" } as never,
    });
    expect(ran).toEqual(["authenticate", "read the state"]);

    // A command: every stage runs.
    ran.length = 0;
    runPipeline(list, {
      login: undefined,
      id: "invoice.issue",
      args: {},
      requestId: "req_1",
      contract: { kind: "command" } as never,
    });
    expect(ran).toEqual(["authenticate", "claim the idempotency key", "read the state"]);
  });

  // A command-only stage cannot sit before the contract is resolved, because until then there is no
  // kind to ask about — the walker would step over it on every call, including commands. That is a
  // silent skip, which is exactly what DSOR-EXE-01b forbids, so the list is refused at start-up.
  it("DSOR-EXE-01b: a command-only stage before the contract is resolved stops the program", () => {
    // This test used to give the command-only stage `at: null`, so that "the numbers still ascend and
    // this list fails for the one reason under test". That worked because `null` was a wildcard — which
    // is the hole a review found, and the wildcard is gone. §21.2 is a real step number, it is below
    // the §21.5 that follows, and `resolve the operation` carries no number, so the list still fails
    // for exactly one reason.
    const tooEarly = [
      fake(1, "authenticate"),
      fake(2, "claim the idempotency key", "command"),
      fake(null, "resolve the operation"),
      fake(5, "authorize"),
      fake(6, "validate the input"),
      fake(11, "record the decision"),
    ];

    expect(() => assertPipeline(tooEarly)).toThrow(/before the operation is resolved/);

    // The same stage one line later is fine.
    const inOrder = [
      fake(1, "authenticate"),
      fake(null, "resolve the operation"),
      fake(5, "authorize"),
      fake(6, "validate the input"),
      fake(7, "claim the idempotency key", "command"),
      fake(11, "record the decision"),
    ];

    expect(assertPipeline(inOrder)).toBe(6);
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
      // Only the stages that FILL something can leave the walk short. Two stages fill nothing, and
      // each has its own test elsewhere because a no-op version of each is a different failure:
      //
      //   - `authorize` only refuses, so a no-op one lets the wrong caller through — that is
      //     deny-by-default, tested in deny-by-default.test.ts.
      //   - `record the decision` only writes, so a no-op one answers perfectly well and silently
      //     stops keeping evidence. This comment used to say it was "caught in decision-first.test.ts
      //     by looking at the log", and that overstated it: those tests walk the *real* PIPELINE, so
      //     they prove the real stage records. A door built with a **substituted** no-op recorder is
      //     not caught by anything, and cannot be — `assertPipeline` reads names and flags, never
      //     what a function does. The test below pins that limit so a later step meets it on purpose.
      const fillsNothing = new Set(["authorize", "record the decision"]);
      const fillers = PIPELINE.filter((stage) => !fillsNothing.has(stage.name));

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
    // INV-1009 is the story's only draft, and the test above issues it. Decision 59's seam is what
    // stops this test depending on the order it happens to run in.
    resetInvoices();

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
      evenAfterARefusal: false,
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

    // And the **first** stage too, which is the only one that can see the freeze on the way in.
    // `runPipeline` freezes `start` and then freezes again after every stage, so a vandal anywhere but
    // position one is stopped by the second freeze — which means removing the first one changed nothing
    // that any test could see. Found by a mutation sweep after the review.
    let firstThrew = "";
    const earlyVandal: Stage = Object.freeze({
      at: 1,
      name: "authenticate",
      applies: "both",
      evenAfterARefusal: false,
      run: (context: Context) => {
        try {
          (context as { id: string }).id = "invoice.issue";
        } catch (error) {
          firstThrew = (error as Error).constructor.name;
        }

        return { kind: "carry_on" as const, context };
      },
    });

    runPipeline(
      PIPELINE.map((stage) => (stage.name === "authenticate" ? earlyVandal : stage)),
      { login: undefined, id: "invoice.get", args: {}, requestId: "req_1" },
    );

    expect(firstThrew).toBe("TypeError");

    // And the call it actually made is the one that was asked for, not the one the stage wanted.
    expect(answer.kind).toBe("error");
  });

  // The test this step most needed and did not have. A review permuted the four real stages and
  // found FOUR of the twenty-four orderings accepted — including `resolve the operation` before
  // `authenticate`, which answers an unauthenticated caller UNSUPPORTED_CAPABILITY and tells them
  // which operations exist. Every other ordering test here reads PIPELINE, so none of them ever
  // handed the checker a wrong order.
  //
  // Step 08 made the list five long, so this now walks 120 orderings instead of 24, and still
  // exactly one is accepted. The test cost nothing to strengthen: the number came from the list.
  it("DSOR-EXE-01a: of every ordering of the real stages, exactly one is accepted", () => {
    const orderings = <T>(xs: readonly T[]): T[][] =>
      xs.length <= 1
        ? [[...xs]]
        : xs.flatMap((x, i) =>
            orderings([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]),
          );

    const all = orderings(PIPELINE);

    expect(all).toHaveLength(120);

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
