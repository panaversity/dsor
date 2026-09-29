# Step 07 · The pipeline skeleton

**New in this step:** the order of the checks stops being the order some lines sit in, and becomes
a list.

## Read this first: nothing new is checked

This is the only step so far that adds no check and refuses nothing it did not refuse before. Run
`pnpm start` and the output is **byte-identical** to step 06's. All of step 06's tests pass
unchanged.

That is not a small step. It is the difference between a program that happens to be right and one
that says what right is.

## In plain words

Your program already asks four questions, in this order:

```text
who are you?  →  does this operation exist?  →  may you?  →  are the arguments valid?
```

Until now that order was **where the lines happened to sit** inside one function. Nothing said it
was the order. Nothing could check it. This step turns it into a list:

```ts
export const PIPELINE: readonly Stage[] = Object.freeze([
  stage(1, "authenticate", "both", authenticate),
  stage(null, "resolve the operation", "both", resolveTheOperation),
  stage(5, "authorize", "both", authorize),
  stage(6, "validate the input", "both", validateTheInput),
]);
```

and `callOperation` walks it and stops at the first no.

## Why it matters

While steps 04 to 06 were built, that order was **reshuffled three times**. Step 05 put the
argument copy before the contract lookup; step 06 hoisted the lookup above the copy; step 04 took
the copy back entirely. One test caught one of those three moves. The other two were right because
somebody was paying attention, and attention is not a guarantee.

And you already know what it costs when the order is wrong, because step 06 tested it: put "does
this invoice exist" before "may you", and `cfo_100` can count invoices she has no permission to see
by comparing `RESOURCE_NOT_FOUND` against `AUTHORIZATION_DENIED`. **The order is the security
guarantee.**

The failure that is coming is worse. `DSOR-OPR-04a` says *every interface MUST invoke the same DSoR
pipeline*. Today there is one door. **Step 42 adds an HTTP server.** If the order lives in the shape
of a function, the second door gets its own order and nobody notices until they disagree — which is
how real systems end up with a web API that checks permissions and a batch job that does not.

## The numbers are §21's

§21 of the specification is a seventeen-line checklist. You have four of them, and each carries its
real number:

| | Stage | Arrives in |
| --- | --- | --- |
| 1 | authenticate | step 05 |
| — | resolve the operation | step 03 |
| 5 | authorize | step 06 |
| 6 | validate the input | steps 02–04 |
| 2 | resolve the tenant | step 10 |
| 3 | resolve the delegation, verify the actor chain | steps 18–19 |
| 4 | check operational status: suspension, freeze, breaker | step 26 |
| 7 | claim the idempotency key | step 20 |
| 8 | create or load the proposal | step 22 |
| 9 | read bound state, check preconditions | steps 11–13 |
| 10 | evaluate controls, segregation of duties, limits | steps 27–30 |
| 11 | **record the decision, always, including DENY** | step 08 |
| 13 | **write the intent record, before any side effect** | step 36 |
| 14 | execute through the connector | step 34 |
| 15 | finalize: COMMITTED, FAILED or OUTCOME_UNKNOWN | step 37 |
| 16 | commit or release reservations, enqueue events | steps 30, 39 |
| 17 | seal the decision bundle | step 40 |

**The gaps in the numbering are the roadmap.** A list that jumps 1 → 5 → 6 says what is missing
more honestly than thirteen stages that do nothing.

`resolve the operation` carries no number, and that is not an oversight: §21 *begins* after the
operation is known, because there is no checklist to run for an operation that does not exist.

## Why a list, and not comments

Three things become possible that were not:

- **A test can read the order.** `test/pipeline.test.ts` asserts it directly, and — the test this
  step most needed — takes every one of the 24 orderings of the four stages and asserts that
  **exactly one** is accepted.
- **A later step adds a line** rather than editing a function it could get wrong.
- **A second door can be handed the same list.** `makeDoor(stages)` builds one, and
  `callOperation` is `makeDoor(PIPELINE)`. Step 42's HTTP server gets the same list, because it is
  *given* the list rather than choosing it.

### What the list check refuses

`assertPipeline` runs when the program loads and refuses five things, each the mistake a later step
makes while adding a line:

- the list is empty
- the same stage appears twice
- a §21 number is not one §21 has, or the numbers descend
- the required stages are not in their required order
- a command-only stage sits before the operation is resolved, so it would never run

That last one needs a word. Whether a command-only stage applies depends on the contract — and the
contract is resolved *by a stage*. Before that stage has run there is no kind to ask about, so a
command-only stage placed earlier would be stepped over on **every** call, including commands. A
step that is silently never reached is what `DSOR-EXE-01b` forbids, and it would be invisible:
nothing fails, the step just never happens.

### What it cannot refuse, and this is important

`REQUIRED` is a list of **names**. A stage called `authorize` that returns "carry on" without asking
anything satisfies the check — a review built exactly that door. There is no way to read a
function's meaning out of a list.

So the check is not the only thing guarding the order. `test/deny-by-default.test.ts` is: a door
whose `authorize` does nothing lets `cfo_100` issue an invoice, and that is a failing test. Break 4
below is that door.

## What changed since step 06

```text
my_07_the_pipeline_skeleton/
  src/pipeline.ts          NEW  Stage, Context, assertPipeline, applies, runPipeline
  test/pipeline.test.ts    NEW  23 tests: the list, its rules, and the walk
  src/operations.ts    CHANGED  the four stages, PIPELINE, makeDoor; callOperation walks the list
  package.json         CHANGED  name and description only
```

Four files. For a step that moved every check in the program, that is the point: the checks
themselves did not change, only where the order lives.

To see every difference yourself:

```bash
cd docs/baby_steps_tutorials
diff -ru --exclude node_modules --exclude pnpm-lock.yaml \
  my_06_permissions_deny_by_default my_07_the_pipeline_skeleton
```

## Run it

```bash
cd docs/baby_steps_tutorials/my_07_the_pipeline_skeleton
pnpm install
pnpm start
pnpm check                 # typecheck, then test. 169 tests pass
```

```text
Hello, accounts-payable-fte.

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued
accounts-payable-fte  (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

user_123              (no envelope)            dsor://org_456/invoice/INV-1008  31400.00 USD  issued

cfo_100               (no envelope)            dsor://org_456/invoice/INV-1009  2500.00 USD  draft
cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
accounts-payable-fte  COMMITTED                dsor://org_456/invoice/INV-1009  issued

not logged in           (nobody)              AUTHENTICATION_REQUIRED  retry: never                nobody is logged in
nobody by that name     (nobody)              AUTHENTICATION_REQUIRED  retry: never                "nobody" is not someone this program knows
logged in, bad address  user_123              VALIDATION_FAILED        retry: never                not a canonical URI: "INV-1008"
logged in, no contract  user_123              UNSUPPORTED_CAPABILITY   retry: never                execute_sql is not an operation: this program has no contract for it
denied, real invoice    cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
denied, no such invoice cfo_100               AUTHORIZATION_DENIED     retry: never                cfo_100 may not call invoice.issue
```

Compare that with step 06's output. It is the same, line for line — `diff` reports nothing. A step
whose whole job is to change where something *lives* should change nothing about what the program
*does*, and that is how you check.

## Break it

Five breaks. Change the code back after each. Every number below was produced by running it.

**1. Swap two stages in the list.** In `src/operations.ts`, put `resolve the operation` above
`authenticate`. Run `pnpm test`:

```text
 Test Files  5 failed | 8 passed (13)
      Tests  97 passed (97)

TypeError: the pipeline runs resolve the operation where authenticate belongs: the order must be
authenticate then resolve the operation then authorize then validate the input
```

**Read the totals.** 97 collected, not 169 — and *nothing failed*. Seventy-two tests did not fail;
they never ran, because five test files import a module that throws while it is loading. The program
refuses to start. That is what "refused at start-up" looks like from the outside, and it is the
strongest answer a break can get.

It is also a trap. "All passed" on a shrunken total looks exactly like a break that nothing caught.
When you run these, read the total first.

**2. Make the walker take the list backwards.** In `src/pipeline.ts`, change
`for (const stage of stages)` to `for (const stage of [...stages].reverse())` — **the one inside
`runPipeline`**, not the one inside `assertPipeline`. Run `pnpm test`:

```text
      Tests  44 failed | 125 passed (169)
```

Forty-four. The order is load-bearing for nearly every test in the step.

There are two loops with that same first line, and mutating both is a different experiment: it
breaks the start-up check instead, and you get break 1's shrinking total. That caught me four times
while building this step.

**3. Let the walk carry on after a refusal.** In `runPipeline`, change `return result` to
`continue`. Run `pnpm test`:

```text
      Tests  15 failed | 154 passed (169)
```

The first no has to be the answer. Without that, a caller who failed a check has later checks run
on them anyway — and the last one to speak wins.

**4. Make `authorize` do nothing, and keep its name.** In the list, replace the `authorize` stage's
function with `(context) => carryOn(context)`. Run `pnpm test`:

```text
     × DSOR-AUT-01b: a door whose authorize does nothing passes the list check and is caught here
     × DSOR-AUT-01b: cfo_100 may not issue one, and nothing happens when she tries
     × DSOR-AUT-01b: the refusal does not say which permission was missing
     × DSOR-SRC-02a: the permission comes from the contract, never from the arguments
     × DSOR-AUT-01b: being refused for authority tells the caller nothing about the data
     × DSOR-AUT-01b: the supervisor may issue, and does
      Tests  6 failed | 163 passed (169)
```

This is the break to sit with. **`assertPipeline` is perfectly happy** — the list still holds four
stages with the right names in the right order. A list cannot see what a function does. What catches
it is behaviour: `cfo_100` can now issue an invoice.

**5. Stop freezing the context between stages.** In `runPipeline`, drop the two `Object.freeze`
calls. Run `pnpm test`:

```text
     × DSOR-EXE-01a: a stage cannot edit the context it was given
      Tests  1 failed | 168 passed (169)
```

A stage is meant to *return* what it learned, not edit what it was handed. Without the freeze a
stage can rewrite the request under the checks that already ran — change the operation id after
`authorize` has said yes. `readonly` on `Context` is erased before Node runs, which is step 01's
lesson in a fourth place.

## Build it yourself with Claude Code

This folder is a learner copy — the `my_` prefix. The official `07_the_pipeline_skeleton` is still
listed as planned in the [map](../readme.md), so there is nothing to compare against yet.

```bash
cd docs/baby_steps_tutorials
cp -r my_06_permissions_deny_by_default my_07_the_pipeline_skeleton
cd my_07_the_pipeline_skeleton
rm -rf node_modules && pnpm install
claude
```

Ask for the problem before the code:

> I have finished step 06, where anything nobody granted is refused. Now I want step 07 of the DSoR
> baby steps: the pipeline skeleton. Read the map's entry for step 07 and §21 of the specification.
> Then tell me what problem this step solves — not what it adds. Do not write any code yet, and ask
> me how literal the checklist should be before you do.

Then, once you agree on the shape:

> Write the failing tests first, titled with the rule ids. Build it a piece at a time, and stop
> after each: the list on its own before anything walks it, then the walk. The proof the walk worked
> is that every test from step 06 still passes unchanged and `pnpm start` is byte-identical.

And the part that finds real bugs:

> Now attack it. Try to make a check run at the wrong moment or not at all. Build a list that
> passes every rule `assertPipeline` has and is still wrong. Hand the checker a wrong order — note
> that every ordering test reads PIPELINE, so none of them has ever done that. And compare this
> step's behaviour against step 06's across hundreds of calls, because "all tests pass" does not
> prove the behaviour is unchanged when the tests were written for this program.

## Check yourself

1. What does this step change about what the program *does*?
2. The order was already right. Why is writing it down worth a step?
3. Why does `resolve the operation` carry no §21 number?
4. `assertPipeline` checks five things. Name the one it **cannot** check, and say what catches that
   instead.
5. A command-only stage may not sit before `resolve the operation`. Why not?
6. In break 1 the output says `97 passed (97)` and nothing failed. Why is that the *strongest*
   result a break can get, and why is it also a trap?
7. Is this step secure?

<details>
<summary>Answers</summary>

1. Nothing. `pnpm start` is byte-identical to step 06's and every step 06 test passes unchanged.
   What changed is that the order is now something a test can read and a later step cannot quietly
   get wrong.
2. Because the order *is* the guarantee, and it had been reshuffled three times in three steps with
   one test noticing one of the moves. And because `DSOR-OPR-04a` says every interface must invoke
   the same pipeline: a list can be handed to step 42's HTTP server, and the shape of a function
   cannot.
3. Because §21 begins after the operation is known. There is no checklist to run for an operation
   that does not exist, so the specification does not number the step that finds out.
4. It cannot check what a stage *does*. `REQUIRED` is a list of names, so a stage called `authorize`
   that asks nothing satisfies it. What catches that is behaviour — `cfo_100` can issue an invoice —
   which is break 4.
5. Because whether it applies depends on the contract, and the contract is resolved by a stage.
   Placed earlier, there is no kind to ask about, so the walker steps over it on every call
   including commands — a step that is silently never reached, which is what `DSOR-EXE-01b` forbids.
6. Strongest because the program did not start at all: a wrong order is not something you discover
   on a request. A trap because "97 passed, 0 failed" reads like a break nothing caught, when really
   seventy-two tests never ran. Always read the total.
7. No more than step 06 was. Nothing here is authenticated, the roles are in the source, and
   thirteen of §21's seventeen steps do not exist — including the two that matter most for evidence:
   recording the decision, which is step 08, and writing the intent record, which is step 36. What
   *is* real is that
   the four checks that exist run in a declared order, that order is checked when the program loads,
   and a second door cannot invent its own.

</details>

## The rules this step meets

- **[DSOR-EXE-01a · L1]** Commands MUST pass through the pipeline steps in the order given.
  ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))
- **[DSOR-EXE-01b · L1]** An interface, connector, or operation MUST NOT skip a pipeline step that
  applies to it. ([§21](../../../specs/dsor/03-execution.md#21-command-pipeline))

`DSOR-EXE-01a` is met for the four stages that exist: they run in the order the list gives, the
order is checked when the program loads, and a permutation test asserts that of all 24 orderings
exactly one is accepted.

`DSOR-EXE-01b` is met in the sense the step can support: no stage that applies is skipped, and a
list that *would* skip one — a command-only stage before the contract is known — is refused at
start-up. The rule also covers interfaces and connectors, and there is one interface and no
connector, so most of its surface has nothing to skip yet.

Step 06's `DSOR-AUT-01a` and `01b` still hold, along with step 05's `DSOR-IDN-01` and the "not from
the arguments" half of `DSOR-SRC-02a`.

Rules nearby this step does **not** claim:

| Rule | Why not |
| --- | --- |
| `DSOR-OPR-04a` | Every interface must invoke the same pipeline. The machinery is here — a door is *given* its list — but there is one interface, so nothing yet proves two of them share it. Step 42 adds the second, and that is when this becomes claimable. |
| `DSOR-EXE-02` | The decision must be recorded before the response, denials included. Nothing is recorded anywhere yet: §21.11 is step 08. |
| `DSOR-EXE-03a` | A durable intent record before any side effect. §21.13, step 36 — it needs a proposal id, an idempotency key and a connector, none of which exist before then. The refusal of arguments that cannot be written down is the smallest shape of it and not the rule. |
| `DSOR-EXE-03b` | No execution if the evidence cannot be written. Its sentence covers the decision record *or* the intent record: step 08 meets the decision branch, step 36 the intent branch. |
| `DSOR-EXE-04a`, `04b` | Atomic commit of state, outcome and outbox; an intent record with no outcome is `OUTCOME_UNKNOWN`. Steps 34 and 37. |
| `DSOR-AUT-02a` | `ALLOW`, `DENY` and `REQUIRE_APPROVAL`. Two answers here. Step 22. |
| `DSOR-IDM-01a`–`01c` | The idempotency claim, §21.7 — the first stage that will apply to commands only. Step 20. |

## What a review found after this looked finished

`pnpm check` was green at 161 tests, every guard had been mutated, and `pnpm start` matched step
06's byte for byte. Four reviewers then attacked it: **sixteen findings confirmed**, seven refuted.
Two were guarantees rather than gaps, and both were claims in this step's own comments:

- **`assertPipeline` said it refuses "a stage in the wrong place". It did not.** The only order rule
  was that §21 numbers never descend — and `resolve the operation` carries `null` by design, so it
  was exempt from a rule about numbers. A reviewer permuted the four stages: **four of twenty-four
  orderings passed**, including `resolve the operation` before `authenticate`. `makeDoor` built that
  door, while its own comment said a door whose order cannot be trusted should not exist.
- **The test written for the step's central claim proved nothing.** "Being refused for authority
  tells the caller nothing about the data" sent seven perfectly writable strings, so every refusal
  it collected came from downstream of both stages. Authorization could be moved to run *after* the
  arguments were read and all 161 tests stayed green.

Both are fixed, and both are the same mistake: **a check nobody had fed the thing it was supposed to
catch.** That is lesson 14 in the learner's notes, and it had already cost something once before.

There is a reason this section exists in three step READMEs now. A green suite and a finished
mutation sweep are not enough, and the person least able to see it is the one who wrote both.

**Next:** step 08, write the decision first — §21.11, the line of the checklist that matters most for
evidence: the decision is recorded before the response even when the answer is no.

> Corrected 2026-09-30, while building step 08. This section used to promise §21.11 **and** §21.13
> together. §21.13's rule, `DSOR-EXE-03a`, requires the proposal id, the idempotency key and the
> connector, so four of its six fields do not exist until far later — the map puts it at step 36, and
> building it here would have been a stub with a rule id on it. See
> [decision 54](../my_notes/decisions.md#54--the-intent-record-is-step-36s-not-step-08s-2026-09-30).
