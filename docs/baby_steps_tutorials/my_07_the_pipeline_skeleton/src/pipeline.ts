// NEW IN STEP 07: the order of the checks becomes a list.
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
  readonly principal?: Principal;
  readonly contract?: OperationContract;
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
}

/**
 * What a stage answers with: carry on with what it learned, or refuse.
 *
 * A refusal ends the walk. There is no "carry on but remember this went wrong" — the first no is
 * the answer, which is what makes the order matter.
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
  readonly run: (context: Context) => StageResult;
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
  "resolve the operation",
  "authorize",
  "validate the input",
]);

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
    for (const [at, stage] of stages.entries()) {
      if (stage.applies === "command" && at < resolvesAt) {
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
  return stage.applies === "both" || kind === "command";
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
export function runPipeline(stages: readonly Stage[], start: Context): PipelineResult {
  // Frozen on the way in and again after every stage. A stage is meant to *return* what it learned,
  // not edit what it was handed — and without this it could rewrite the request under the checks
  // that already ran: change the id after authorize said yes, or the login after authenticate did.
  // `readonly` on Context is erased before Node runs, which is step 01's lesson in a fourth place.
  let context = Object.freeze(start);

  for (const stage of stages) {
    const kind: OperationKind = context.contract?.kind === "command" ? "command" : "query";

    if (!applies(stage, kind)) {
      continue;
    }

    const result = stage.run(context);

    if (result.kind === "refused") {
      return result;
    }

    context = Object.freeze(result.context);
  }

  return { kind: "ready", context };
}
