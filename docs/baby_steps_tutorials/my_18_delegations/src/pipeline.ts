// STEP 07: the order of the checks becomes a list.
//
// Every check this program makes already happened in the right order. What it did not have was
// anywhere that *said* the order. It was the order some lines sat in inside one function — and
// while steps 04 to 06 were built that order was reshuffled three times, with one test catching
// one of the three moves. The rest were right by attention, which is not a guarantee.
//
// The order is the guarantee. Step 06 proved it: move "does this invoice exist" above "may you"
// and a caller who may not act can count the invoices you hold, one guess at a time, by comparing
// RESOURCE_NOT_FOUND against AUTHORIZATION_DENIED.
//
// As a list, three things become possible that were not:
//
//   - a test can read the order and say what it is
//   - a later step adds a stage to a list instead of editing a function it could get wrong
//   - a second door can be handed the same list. There is one door today; step 42 adds an HTTP
//     server, and DSOR-OPR-04a says every interface must invoke the *same* pipeline
//
// Rule DSOR-EXE-01a: commands MUST pass through the pipeline steps in the order given.
// Rule DSOR-EXE-01b: an interface, connector, or operation MUST NOT skip a pipeline step that
// applies to it.

import type { Delegation } from "./delegation.ts";
import type { Login } from "./login.ts";
import type { Principal } from "./people.ts";
import type { OperationContract } from "./registry.ts";
// A type-only import, so nothing circular exists when Node runs this: `import type` is erased
// before the file executes. operations.ts imports the machinery from here, and this file needs
// only the *shape* of an answer from there.
import type { OperationAnswer } from "./operations.ts";

/** Whether a stage applies to every call, or only to a command. */
export type Applies = "both" | "command";

/** A query reads; a command changes something. The contract says which an operation is. */
export type OperationKind = "query" | "command";

/**
 * What a stage is given, and what it fills in.
 *
 * It starts as the request and grows: `authenticate` adds the principal, `resolve the operation`
 * adds the contract, and so on. Every field a later stage depends on is optional here, because at
 * the top of the list none of them is known yet — and the load-time check below is what makes sure
 * the stage that fills each one is actually in the list.
 */
export interface Context {
  readonly login: Login | undefined;
  readonly id: string;
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * STEP 08: one id for this request, minted before the first stage runs.
   *
   * It is required and not optional, which is the point. It used to be minted inside whichever
   * envelope happened to be built first, so it named *an answer* rather than *a request*. Step 08
   * writes a record about the same request, and a record whose `request_id` differs from the
   * answer's cannot be matched to it — which is the one job a correlation id has.
   */
  readonly requestId: string;
  readonly principal?: Principal;
  /** STEP 10: the one company this request is for, from §21 step 2. */
  readonly tenant?: string;
  readonly contract?: OperationContract;
  /** NEW IN STEP 18: what the login's scopes allow, when it carries any. They only narrow. */
  readonly scopes?: readonly string[];
  /** NEW IN STEP 18: the slip an agent's command runs under, from §21.3. */
  readonly delegation?: Delegation;
  /**
   * NEW IN STEP 18: what the agent may do under that slip, at this decision: the slip's permissions,
   * cut down to what its signer holds now and to the login's scopes. `authorize` asks this, and not
   * the agent's role, when it is there.
   */
  readonly authority?: readonly string[];
  readonly given?: Readonly<Record<string, unknown>>;
  /**
   * The fingerprint of the arguments, from the text the validate stage wrote down.
   *
   * It lives here, filled by the stage at §21.6, because §21.6 *is* "validate and canonicalize
   * input; compute payload hash". It used to be computed later by `success()`, from the caller's
   * object a **second** time — and a review found an object whose `toJSON` throws on its second
   * call, which committed the change and then threw at the caller. Written down once, hashed from
   * that text, carried from here.
   */
  readonly payloadHash?: string;
  /**
   * STEP 08: the id of the record §21.11 wrote, which is that stage's **proof of work**.
   *
   * It exists because of a hole a deep pass found. `assertPipeline` checks that a stage called
   * `record the decision` is in the list, in the right place, with the right flag — and it cannot
   * check what the function *does*. A door built with a no-op recorder therefore issued an invoice,
   * answered `COMMITTED`, and wrote **nothing**: a side effect with no evidence, which is the worst
   * shape `DSOR-EXE-02` has.
   *
   * A list check cannot close that. A *receipt* can: the stage leaves the record's id here, and the
   * door refuses to execute without one. So the guarantee no longer rests on the stage being the
   * right stage — it rests on a record existing.
   */
  readonly recorded?: string;
  /**
   * STEP 08: the refusal that has already happened, if one has.
   *
   * It is here because §21.11 must record a `DENY`, and the stage that records cannot record a
   * refusal it has not been shown. Set by the walker, never by a stage.
   */
  readonly refusal?: OperationAnswer;
}

/**
 * What a stage answers with: carry on with what it learned, or refuse.
 *
 * A refusal ends the walk. There is no "carry on but remember this went wrong" — the first no is
 * the answer, which is what makes the order matter.
 */
/**
 * STEP 09: a stage answers with a promise, because one of them talks to a database.
 *
 * Only `record the decision` needs this — it writes a row, and a row is on the other side of a
 * network. But a walker that awaits one stage has to await all of them, and a door that awaits the
 * walker has to be awaited by its caller, so the `await` reaches every call site in the program.
 *
 * That is the honest cost of a real database, and it arrives here rather than being hidden: nothing
 * in Node can write to PostgreSQL and return before it has.
 */
export type StageResult =
  | { readonly kind: "carry_on"; readonly context: Context }
  | { readonly kind: "refused"; readonly answer: OperationAnswer };

/** One line of the checklist. */
export interface Stage {
  /**
   * Its number in §21's list of seventeen, or `null` where §21 assumes the step.
   *
   * `resolve the operation` is the `null` one: §21 starts after the operation is known, because
   * there is no checklist to run for an operation that does not exist.
   */
  readonly at: number | null;
  readonly name: string;
  readonly applies: Applies;
  /**
   * STEP 08: does this stage still run once something has refused?
   *
   * For almost every stage the answer is no: the first no is the answer, and asking "may you" after
   * "who are you" already failed is pointless at best. §21.11 is the exception, and §21's own
   * diagram is emphatic about it — **RECORD DECISION — always, including DENY**. A refusal that is
   * not written down is the failure DSOR-EXE-02 exists to prevent: an agent can probe a hundred
   * operations it may not call and leave nothing behind.
   *
   * So a refusal does not end the walk any more. It is carried, the stages that do not apply to it
   * are skipped, and the evidence stages still run.
   */
  readonly evenAfterARefusal: boolean;
  readonly run: (context: Context) => StageResult | Promise<StageResult>;
}

/**
 * The stages this program must have, **in the order they must be in**.
 *
 * An ordered sequence, not a set, and that matters. When this was a set of names, a review found
 * that four of the twenty-four orderings of the real four stages passed the check — including
 * `resolve the operation` before `authenticate`, which answers an unauthenticated caller
 * `UNSUPPORTED_CAPABILITY` and tells them which operations exist. The §21 numbers could not catch
 * it, because `resolve the operation` carries `null` by design and a `null` is exempt from a rule
 * about numbers ascending.
 *
 * So the check is now: these names, in this relative order, with anything else allowed between
 * them. That is what `DSOR-EXE-01a` means by "in the order given", and it is the one thing in this
 * file that a later step must not be able to get wrong.
 */
const REQUIRED: readonly string[] = Object.freeze([
  "authenticate",
  // STEP 10: §21 step 2, and it has to be here, by name — a pipeline without it would answer
  // every request inside no company at all, and the URI check in piece 2 would have nothing to
  // compare against.
  "resolve the tenant",
  "resolve the operation",
  // NEW IN STEP 18: after the operation, because it asks whether the operation is a command, and
  // before authorize, which asks the power it computes. Required by name, so a pipeline without it
  // is refused at load, not discovered on an agent's first command (decision 127).
  "resolve the delegation",
  "authorize",
  "validate the input",
  // STEP 08. Last of the five, and that position is the requirement: DSOR-EXE-02 says the
  // decision is recorded *before the response is returned*, so nothing that produces a response may
  // sit between the checks and this line.
  "record the decision",
]);

/**
 * The stages allowed to carry `evenAfterARefusal`, **by name**.
 *
 * A review broke the first version of this open. The rule was positional — no *flagged* stage before
 * the recording — which left a flagged stage **after** it perfectly legal. The reviewer appended
 * `{ at: 14, name: "execute", evenAfterARefusal: true }`, `assertPipeline` accepted the list, and a
 * command the pipeline had **denied** was carried out anyway, with `DENY` sitting in the log beside
 * the invoice it had just issued.
 *
 * The flag was doing two jobs: "this is an evidence stage" and "this stage may act on a refused
 * request". Only the first is ever wanted, so this list decides which stages get it — not whoever
 * writes the pipeline. §21.16 and §21.17 join it when the decision bundle arrives.
 */
const AFTER_A_REFUSAL: readonly string[] = Object.freeze(["record the decision"]);

/**
 * The stages allowed to carry no §21 number.
 *
 * The other half of the same hole. `at: null` is exempt from the ascending rule — that is what it is
 * *for* — but nothing said which stages may claim it, so `null` was a wildcard. A review inserted one
 * unnumbered stage into the real five and found **all six positions accepted**, including before
 * `authenticate`; with a side effect in it, an invoice was issued before §21.11 recorded anything. Of
 * the 720 orderings of that six-stage list, six passed.
 *
 * So `null` means "§21 assumes this step", not "this step floats anywhere". One name qualifies.
 */
const UNNUMBERED: readonly string[] = Object.freeze(["resolve the operation"]);

/**
 * Refuses a list that cannot be trusted, and returns how many stages it checked.
 *
 * Five ways a list goes wrong, and every one of them is the kind of mistake a later step makes
 * while adding a line:
 *
 *   - it is empty
 *   - the same stage appears twice
 *   - a §21 number is not a number §21 has, or the numbers descend
 *   - the required stages are not in their required order
 *   - a command-only stage sits before the operation is resolved, so it would never run
 *
 * An earlier version of this comment said it refused "a stage in the wrong place", and it did not:
 * the only order rule was that non-null numbers never descend. A review permuted the four real
 * stages and found four of the twenty-four orderings accepted. The claim came first and the check
 * caught up, which is the wrong way round — see lesson 14 in the learner's notes.
 *
 * It takes the list as an argument rather than reading the one below, so a test can hand it a
 * rotten one — and so it can run at start-up instead of on the first request.
 */
export function assertPipeline(stages: readonly Stage[]): number {
  if (stages.length === 0) {
    throw new TypeError("the pipeline is empty: there is no checklist to run");
  }

  const seen = new Set<string>();
  let highest = 0;

  for (const stage of stages) {
    if (seen.has(stage.name)) {
      throw new TypeError(`the pipeline holds ${stage.name} twice`);
    }

    seen.add(stage.name);

    // `null` is not a wildcard — see UNNUMBERED. Without this, an unnumbered stage may sit anywhere at
    // all, because every rule about position here is a rule about numbers.
    if (stage.at === null && !UNNUMBERED.includes(stage.name)) {
      throw new TypeError(
        `${stage.name} carries no §21 number, so nothing says where it belongs: ` +
          `only ${UNNUMBERED.join(", ")} may be unnumbered`,
      );
    }

    if (stage.at !== null) {
      // §21 has seventeen steps, so a number outside that is not a §21 number. Without this, one
      // stage carrying NaN hides exactly one descent, because every comparison against NaN is
      // false.
      if (!Number.isSafeInteger(stage.at) || stage.at < 1 || stage.at > 17) {
        throw new TypeError(`${stage.name} claims §21.${stage.at}, which is not a step §21 has`);
      }

      if (stage.at < highest) {
        throw new TypeError(
          `the pipeline is out of order: §21.${stage.at} (${stage.name}) comes after §21.${highest}`,
        );
      }

      highest = stage.at;
    }
  }

  // A command-only stage cannot sit before the operation is resolved. Until that stage has run
  // there is no contract, so there is no *kind* to ask about, and the walker would step over the
  // command-only stage on every call — including commands. A stage that is silently never reached
  // is exactly what DSOR-EXE-01b forbids, and it would be invisible: nothing fails, the step just
  // never happens.
  const resolvesAt = stages.findIndex((stage) => stage.name === "resolve the operation");

  if (resolvesAt !== -1) {
    for (const [index, stage] of stages.entries()) {
      if (stage.applies === "command" && index < resolvesAt) {
        throw new TypeError(
          `${stage.name} applies to commands only and sits before the operation is resolved, ` +
            "so it would never run",
        );
      }
    }
  }

  // The required stages, in their required order. Anything may sit between them; nothing may
  // swap two of them.
  let expected = 0;

  for (const stage of stages) {
    const wants = REQUIRED.indexOf(stage.name);

    if (wants === -1) {
      continue;
    }

    if (wants !== expected) {
      throw new TypeError(
        `the pipeline runs ${stage.name} where ${REQUIRED[expected]} belongs: ` +
          `the order must be ${REQUIRED.join(" then ")}`,
      );
    }

    expected += 1;
  }

  if (expected < REQUIRED.length) {
    throw new TypeError(`the pipeline is missing ${REQUIRED[expected]}, which every call needs`);
  }

  // STEP 08: the three rules that make `record the decision` mean what it says.
  const records = stages.find((stage) => stage.name === "record the decision");

  // Unreachable while REQUIRED holds the same name and is checked above — and written anyway, because
  // a review showed why. This used to be `stages[findIndex(...)]`, and with an index of -1 both checks
  // below became silent no-ops that *accepted* every list: `undefined` skipped the first, and
  // `index < -1` is never true. They were correct only because the REQUIRED check happened to run
  // first, and nothing held that order — moving these blocks above it left all 198 tests passing.
  if (records === undefined) {
    throw new TypeError("the pipeline has no record the decision stage");
  }

  // The important one. A `record the decision` stage added with the flag off would be stepped over on
  // every refusal, and *nothing would fail*: every allowed call would still be recorded, every test
  // about a success would still pass, and denials would quietly stop being written down. That is the
  // exact failure §21's "always, including DENY" warns about, and it is invisible from outside — which
  // is why it is refused here, at start-up, by name.
  if (!records.evenAfterARefusal) {
    throw new TypeError(
      "record the decision must run even after a refusal, or denials go unrecorded",
    );
  }

  // §21: "Queries pass through steps 1-6 and 9, apply §19, and reach step 11 where DSOR-CLS-05
  // applies." So the recording applies to every kind of call there is. A review made it command-only,
  // `assertPipeline` accepted the list, and every read in the deployment went unrecorded while the
  // answers stayed perfect.
  if (records.applies !== "both") {
    throw new TypeError(
      "record the decision must apply to both kinds: §21.11 is reached by queries too",
    );
  }

  // And only a stage named in AFTER_A_REFUSAL may carry the flag at all. This replaces a positional
  // rule that let a flagged stage sit *after* the recording and execute a command that was denied.
  for (const stage of stages) {
    if (stage.evenAfterARefusal && !AFTER_A_REFUSAL.includes(stage.name)) {
      throw new TypeError(
        `${stage.name} may not run after a refusal: only ${AFTER_A_REFUSAL.join(", ")} may`,
      );
    }
  }

  return stages.length;
}

/**
 * Does this stage apply to this kind of call?
 *
 * One function, used by the walker and by nothing else — which is the point. There used to be a
 * `stagesFor` helper beside a condition inside `runPipeline` that said the same thing twice, and no
 * door ever called the helper. Two tests carried a rule id and certified the copy nobody ran.
 */
export function applies(stage: Stage, kind: OperationKind): boolean {
  // The positive form, `=== kind`, rather than `kind === "command"`. The two are identical while
  // `Applies` has exactly two members, and they stop being identical the day it gains `"query"` — at
  // which point the short version silently runs a query-only stage on every command, with no test
  // failing. A review asked for the form that stays right.
  return stage.applies === "both" || stage.applies === kind;
}

/** What has been walked, and what it found. */
export type PipelineResult =
  | { readonly kind: "ready"; readonly context: Context }
  | { readonly kind: "refused"; readonly answer: OperationAnswer };

/**
 * Walks the checklist and stops at the first no.
 *
 * This is the whole of `DSOR-EXE-01a`: the stages run in the order the list gives, and nothing
 * chooses to take them in a different one. The first refusal is the answer — there is no "carry on
 * and remember this went wrong", which is what makes the order matter.
 *
 * Whether a command-only stage applies is decided **as the walk reaches it**, not before the walk
 * starts. It has to be: which kind of operation this is comes from the contract, and the contract is
 * resolved *by a stage*. Before that stage has run there is no kind to ask about — so no
 * command-only stage may sit that early, and `assertPipeline` is where that will be refused.
 */
export async function runPipeline(
  stages: readonly Stage[],
  start: Context,
): Promise<PipelineResult> {
  // Frozen on the way in and again after every stage. A stage is meant to *return* what it learned,
  // not edit what it was handed — and without this it could rewrite the request under the checks
  // that already ran: change the id after authorize said yes, or the login after authenticate did.
  // `readonly` on Context is erased before Node runs, which is step 01's lesson in a fourth place.
  let context = Object.freeze(start);
  let refused: OperationAnswer | undefined;

  for (const stage of stages) {
    const kind: OperationKind = context.contract?.kind === "command" ? "command" : "query";

    if (!applies(stage, kind)) {
      continue;
    }

    // STEP 08: a refusal no longer returns from here. It is remembered, the rest of the
    // checks are skipped, and the stages marked `evenAfterARefusal` still run — because §21.11 has
    // to record a DENY, and it cannot record one it never reached.
    //
    // These two `continue`s can be swapped with no test failing, and that is worth knowing rather
    // than hiding. A review found the reason they *could* have mattered: `kind` comes from the
    // contract, which a stage fills, so after a refusal at `authenticate` there is no contract and
    // the kind falls back to `"query"` — which would silently skip a **command-only flagged** stage
    // on a refused command, an evidence hole nothing could see. What closes it is not the order of
    // these lines: it is `assertPipeline`, which lets only `record the decision` carry the flag and
    // insists that stage applies to both kinds. The case is unreachable by construction, so no test
    // can pin the order, and the guard that matters is named where it lives.
    if (refused !== undefined && !stage.evenAfterARefusal) {
      continue;
    }

    // Awaited whether or not this particular stage returns a promise. `await` on a plain value is
    // the value, so the stages that do not touch a database are unchanged by this.
    const result = await stage.run(context);

    if (result.kind === "refused") {
      // The *last* refusal wins, and only an `evenAfterARefusal` stage can ever overwrite an
      // earlier one. That is deliberate: the only stages that run after a refusal are the ones
      // writing the evidence, and a refusal from one of those means "I could not keep the promise
      // this answer depends on". DSOR-EXE-02 is a promise about the answer, so if it cannot be kept
      // the caller must be told that instead of being told the original no.
      refused = result.answer;
      context = Object.freeze({ ...context, refusal: result.answer });

      continue;
    }

    context = Object.freeze(result.context);
  }

  if (refused !== undefined) {
    return { kind: "refused", answer: refused };
  }

  return { kind: "ready", context };
}
