# Lessons

The mistakes that repeated across steps 01 to 04, and what catches each one. Kept
separately from [decisions.md](decisions.md) because these are not choices — they are
things that went wrong more than once.

---

## 1 · A shape check is not a meaning check

This turned up in all four steps, in the same form every time. A pattern or a type proves
something has the right *shape* and says nothing about whether it *means* anything.

| Step | The shape check | What it accepted |
| --- | --- | --- |
| 01 | `currency: string` matching `^[A-Z]{3}$` | `ZZZ`, `QQQ` — not assigned currencies |
| 02 | the normative URI pattern | `dsor://acme/...` — a company name as the tenant |
| 03 | `operation-contract.schema.json` | `predicates: []`, and `"not CEL at all !!!"` |
| 04 | `error-envelope.schema.json` | `CONFLICT` with `retry: "safe_same_key"` |

Every one of these is now either checked in code or written down as a limit. The habit
that works: after writing a check, ask what it accepts that it should not, and either close
the gap or say so where a reader will meet it.

## 2 · Passing tests prove nothing until you break the code

Every step where guards were mutated one at a time turned up something no test protected.
Not a few — the counts:

| Step | Guards found unprotected |
| --- | --- |
| 02 | 2 (`parseUri`'s freeze, `formatUri`'s round-trip compare) |
| 03 | 5 of 19 mutations survived |
| 04 | 9 in the first sweep, then 11 in a second, wider one |

The worst single case: **22 of the 32 rows** of step 04's retry table were reached by no
test. Mutating all 22 at once left all 76 tests green. A wrong row is a wrong instruction —
`AUTHORIZATION_DENIED` marked retry-safe re-sends a forbidden request for ever.

What catches it: delete or weaken each check in turn, run the tests, and record which
survive. Assert the target text appears exactly once before editing, or a no-op edit scores
as a kill. For every survivor, prove the guard does real work with a throwaway probe before
writing a test for it — otherwise it may be an equivalent mutant and not a gap at all.

## 3 · Quoted output goes stale the moment anything moves

Every README quotes real command output. Every time the code or the test count changed,
some of it became wrong, and it was never obvious by reading.

Cases: step 02's `TS2353` line moved when the formatter reflowed a signature. Step 03's
`execute_sql` message changed in code and stayed old in two README transcripts, where it
also read backwards. Step 04's break counts moved three times as tests were added.

What catches it: re-run every quoted command after any change, and diff the block against
the real output rather than reading it. A one-line script that extracts the fenced block
and compares it is worth more than care.

## 4 · Writing counts from memory

Test counts were wrong in step 03 twice — `fourteen` for 13 and `fifteen` for 16 — and the
second contradicted the README's own arithmetic six lines later. Both were written from
memory instead of counted.

It happened again while writing these notes: the step 03 note said "three tests fail" for a
break its own README records as four. Verification caught it. The tendency is real and
persistent, not a one-off.

What catches it: `grep -cE '^\s*it\(' test/*.ts`, or reading the number out of the README
that already has it. Never a recollection.

## 5 · Describing a file instead of reading it

Step 04's centrepiece claim — "the schema pins exactly one code's retry class" — was wrong.
It pins three. The step's own `BATCH_PARTIAL` test proved it at the time, so the README
contradicted its own test suite.

Also in this class: "seven places" for what is eleven `$ref`s to seven definitions, and a
strict-mode explanation that named the wrong cause for nine of thirteen failures.

Two more of the same kind, found by verifying these notes: the step 01 note blamed the money
gaps on "nothing tests trailing junk", when trailing junk on the *value* is tested and is
what protects that pattern — the untested parts are its two quantifiers and the currency
pattern. And the step 04 note said all three pinned codes are unknown-outcome cases, when
`BATCH_PARTIAL` is pinned for the opposite reason: every item's outcome is known.

What catches it: read the file and count, in the same minute as writing the sentence. And
have someone else check the finished text against the code — all three of these survived
writing and were only caught by verification.

## 6 · Claiming a rule without its condition

`DSOR-ERR-01b` was paraphrased as "an error must not leak whether a resource exists",
dropping *"the caller is not authorized to read"* — which is the whole rule. With no caller
and no permissions in step 04, the step was safe; the paraphrase made it look guilty.

What catches it: quote a rule from
[`requirements.json`](../../../packages/spec/requirements.json), never from memory, and
keep every clause.

## 7 · A commit that was never run

One step 04 commit was red: `main.ts` could not compile against the new answer type, and
splitting it from the operations change left a commit whose typecheck failed. It was
committed without reading the check output.

What catches it: run the check before each commit and read what it printed, and verify the
whole series afterwards by checking each commit out into a clean directory. That history
was rewritten into one commit, with the reason in its message.

## 8 · One large reviewer stalls; narrow ones finish

A single hostile-review agent given the whole step stalled twice with no output, once after
ten minutes. Splitting the same work into five passes with one job each — outputs, claims,
readability, leftovers, cross-references — finished every time and found 38 and 41 findings
respectively.

What works: one job per pass, named explicitly, with instructions to stay inside it.
