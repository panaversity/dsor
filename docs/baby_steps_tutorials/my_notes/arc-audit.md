# The arc audit · steps 01 to 06

2026-09-29. Three independent readers over all six steps at once, asking one question each:
**is every step one idea?** · **does any README claim more than its code does?** · **does the arc
hold together as one story?**

All three returned the same verdict — *holds together, with gaps* — and 33 findings between them.
Every finding was reproduced by hand before anything changed. This note records what it cost and
what it was worth, because it is the first time the whole set was looked at rather than one step.

## What held

Worth reading first, because it is the part that would have been easiest to fake:

- **Every break-it output in steps 01 to 04 was re-run and matched to the digit** — all fourteen.
- **Every `pnpm start` block matches the program byte for byte**, in all six steps.
- **Every test count in every header was right** at the time it was written.
- The four copied schemas are `cmp`-identical to `packages/spec/schemas/`. The §28 retry table is
  a faithful transcription of all 32 rows.
- **No step is skippable**, and the spine is genuinely cumulative: step 06's gate reads
  `authorization.permission`, which step 03 wrote into both contracts and nothing touched for
  three steps.

## What it found

### The one that mattered beyond this tutorial

`pnpm guard` had **never checked a rule id in any step**. It strips inline code spans before
looking for identifiers, and the tutorial writes every id in backticks. 171 distinct ids across
six steps and these notes, and the check had seen none of them.

It had already let `DSOR-SOD-01` through, which is not a rule — the registry has `SOD-01a` and
`SOD-01b` — into four files including the promises table the next session is told to act on. Two
wrong step numbers travelled the same way.

Full reasoning in [lesson 14](lessons.md) and [decision 40](decisions.md). The short version:
**before relying on a check, make it fail once.**

### Three real code defects

| Defect | Where it came from |
| --- | --- |
| step 05 still threw on a throwing getter, in login and in arguments | the step 06 review found it; I fixed step 06 and stopped, and step 05 has the same code. The tutorial's own rule is to fix the earliest step that has it |
| the state change step 04 introduced had **no store-level tests** | `test/invoice.test.ts` was byte-identical to step 03's. Every assertion about issuing went through `callOperation` |
| the `semantics` test could never reach its assertion | guarded by `if (answer.kind === "result")`, and the only draft had already been issued, so hardcoding the value passed all 79 tests |

### Four tests naming the wrong rule

Coverage is counted from titles, so each one inflated a rule it never exercised: a result-envelope
test titled `DSOR-ERR-01a`, a closed-schema test titled `DSOR-SCH-02` (that rule is about *where*
added fields go), and two registry tests titled `DSOR-OPR-02a` (that rule is about an *omitted*
mandatory field).

### Everything else

Wrong step numbers (controls is 27, not 14; segregation of duties is 30, not 20), three rule
paraphrases that dropped the clause carrying the difficulty, 17 file-opening sentence fragments
left by stripped `NEW IN STEP` markers, step 06 skipping the marker cleanup entirely, two
cross-step promises that later steps did not keep, and a handful of counts and forward references
that had gone stale.

## What was deliberately not fixed

Three things, each with the reasoning written where a reader meets it rather than only here:

- **Step 04 keeps a known hole.** `success()` hashes the caller's arguments after the invoice is
  issued, so an unhashable argument commits and then crashes. Fixing it in step 04 would make it a
  three-idea step and take away step 05's reason to exist. The claim was narrowed and the hole is
  named in the file. [Decision 39](decisions.md).
- **Step 05 keeps three ideas**, and now says so on the page. Moving the two argument guards to
  step 08 would leave thirteen steps in which a caller can crash a command that already succeeded.
  [Decision 41](decisions.md).
- **`TENANT` stays in the invoice module**, so identity imports from invoices. It waits for the
  step that has a reason to touch it. [Open question 5](open-questions.md).

## What this says about the other methods

Each of the three methods used on these steps finds a different class of defect, and none of them
finds another's:

| Method | Finds | Cannot find |
| --- | --- | --- |
| tests written red first | the thing you thought of | the thing you did not |
| mutating each guard | a guard no test protects | a guard that was never written; a test whose expected value is a constant |
| a hostile reviewer on one step | real bugs in that step's new code | a claim that is false across steps; a count that went stale |
| reading all six at once | stale numbers, broken promises, ideas in the wrong step, an untested safety net | a bug that needs running code to see |

Steps 05 and 06 had been attacked hard and still had three code defects between them, because both
reviews looked at one step. The counts and the promises could only go wrong *between* steps, so
only something reading the whole arc was ever going to see them.

The cost was one audit and about a day of fixing. The number that justifies it: **two of the four
high findings were false statements in committed work** — a rule id that does not exist and two
step numbers pointing a learner at the wrong steps — and none of the three earlier methods was
ever going to catch either.
