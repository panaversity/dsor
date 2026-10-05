# Step 07 · The pipeline skeleton

Folder: [`my_07_the_pipeline_skeleton`](../my_07_the_pipeline_skeleton/README.md) · 181 tests
Spec: [§21](../../../specs/dsor/03-execution.md#21-command-pipeline) · `DSOR-EXE-01a`,
`DSOR-EXE-01b`
Decisions [46 to 50](decisions.md).

## What it does, and what it does not

It adds no check. `pnpm start` is byte-identical to step 06's and every step 06 test passes
unchanged. What it changes is where the order of the checks lives: it was the order some lines sat
in inside one function, and it is now a list.

```ts
export const PIPELINE: readonly Stage[] = Object.freeze([
  stage(1, "authenticate", "both", authenticate),
  stage(null, "resolve the operation", "both", resolveTheOperation),
  stage(5, "authorize", "both", authorize),
  stage(6, "validate the input", "both", validateTheInput),
]);
```

Four files differ from step 06 — `pipeline.ts`, `pipeline.test.ts`, `operations.ts`,
`package.json` — for a step that moved every check in the program.

## Why it was worth a step

The order *is* the security guarantee. Step 06 proved it by moving one check below another and
watching a caller learn which invoices exist.

And while steps 04 to 06 were built, that order was reshuffled **three times**: step 05 put the
argument copy before the contract lookup, step 06 hoisted the lookup above the copy, step 04 took
the copy back. One test caught one of the three. The other two were right by attention.

`DSOR-OPR-04a` is the other half: every interface must invoke the *same* pipeline. A list can be
handed to step 42's HTTP server. The shape of a function cannot.

## Built in five pieces

| Piece | Tests | What it added |
| --- | --- | --- |
| 1 | 157 | the list and its rules, with nothing walking it yet |
| 2 | 157 | `callOperation` walks it; the inline sequence is gone |
| 3 | 161 | `makeDoor`, and the two branches nothing reached |
| 4 | 169 | what a hostile review found |
| 5 | 169 | the README, with every break re-run |

Piece 1 deliberately shipped code that did nothing yet, because the list could be tested before
anything depended on it — [decision 38](decisions.md) again, and the same payoff.

## What the review found

`pnpm check` was green at 161, every guard had been mutated, and the output matched step 06's byte
for byte. Four reviewers then found **sixteen** confirmed findings. Two were guarantees, and both
were claims in this step's own comments.

| Finding | Why it mattered |
| --- | --- |
| `assertPipeline` said it refuses "a stage in the wrong place" and did not. `resolve the operation` carries `null`, so it was exempt from the only order rule. **4 of 24 orderings passed** | [Decision 50](decisions.md). Measured before and after: 4 of 24, then 1 of 24 |
| the test written for the step's central claim proved nothing — all seven inputs were writable strings, so authorization could be moved *after* the arguments were read with all 161 tests green | the fix is three inputs that only the validate stage can refuse, sent as a caller who may not issue |
| `success()` stringified the caller's object a **second** time, after the invoice was issued | [Decision 49](decisions.md) and [lesson 16](lessons.md). Not new in step 07 — steps 04, 05 and 06 all did it |

Both of the first two are the same mistake: **a check nobody had fed the thing it was supposed to
catch.** That is [lesson 14](lessons.md), and this is its second outing.

Fourteen smaller findings, all closed. Three were tests of mine that proved nothing: the
`INTERNAL_ERROR` test asserted `askedBy` against a literal that was also its input
([lesson 10](lessons.md), in this step's own new test); it lazied one stage where four needed it;
and `stagesFor` was dead code deciding applicability a second way, with two tests carrying a rule id
to certify the copy no door called.

## The break worth keeping

Break 1 swaps two stages in the list, and the program refuses to start:

```text
 Test Files  5 failed | 8 passed (13)
      Tests  97 passed (97)
```

**97 collected, not 169, and nothing failed.** Seventy-two tests never ran, because five files
import a module that throws while loading. It is the strongest result a break can get — and it looks
exactly like a break nothing caught. Step 03's break 1 teaches the same thing, and I still fell for
it four times while building this step, which is [lesson 11](lessons.md).

## Limits written down

| Here | Becomes |
| --- | --- |
| four of §21's seventeen stages | the gaps in the numbering name the step that brings each |
| every stage applies to both kinds | step 20's idempotency claim is the first command-only one |
| `DSOR-OPR-04a` not claimed: one interface, so nothing proves two share the list | step 42 |
| the list check cannot see what a stage *does* | nothing can; a test does instead |
| `STAGES_CHECKED` hardcoded to today's number passes | only a child process could close it |
| `Object.hasOwn` on the handlers lookup changes nothing today | `registry` is a Map, which has no prototype keys |

The last two are in the code as comments, not here only, because a guard that cannot be killed is
worth a sentence where a reader meets it.

## What is claimed

`DSOR-EXE-01a` for the four stages that exist, with a permutation test asserting that of all 24
orderings exactly one is accepted. `DSOR-EXE-01b` in the sense the step can support: no stage that
applies is skipped, and a list that *would* skip one is refused at start-up. Step 06's
`DSOR-AUT-01a` and `01b`, step 05's `DSOR-IDN-01`, and the "not from the arguments" half of
`DSOR-SRC-02a` all still hold.
