# Lessons

The mistakes that repeated across steps 01 to 06, and what catches each one. Kept
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

## 9 · Narrow reviewers must not sabotage the same folder at once

Lesson 8 is still right — five narrow passes finish where one wide pass stalls. What step 05
added is the other half of it: several of those passes **break the code on purpose** to see
whether a test goes red, and running them together in one folder means each one is measuring
a folder the others are also editing.

What it actually caused, in step 05:

- One pass reported failure counts that were contaminated until it re-ran the breaks in an
  isolated copy. Its final numbers are right *because* it noticed and re-ran; had it not
  noticed, wrong counts would have gone into the README as verified output.
- Another pass snapshotted `src/login.ts` as a backup **while a different pass's sabotage was
  applied**, so the backup held code with the unknown-name refusal removed. Restoring from
  that file would have silently deleted a guard and turned three tests red, and it would have
  looked like a restore rather than a change.

What to do instead: give each sabotaging pass its own copy of the folder, or run the
sabotaging passes one at a time and only the read-only passes in parallel. Either way, never
trust a backup file another agent left behind, and check `git status` and `pnpm check` before
believing any count that came out of a shared folder.

## 10 · Mutating one guard at a time cannot find a test that expects a constant

[Lesson 2](#2--passing-tests-prove-nothing-until-you-break-the-code) says break each guard in
turn. Step 05 found the limit of that method.

The caller's name is attached in twenty-two places. Each one was mutated separately and every
one was caught, so the guarantee was recorded as proven. A hostile review then replaced **all
of them at once** with the literal `"cfo_100"` — and all 100 tests passed. The test that
guarded attribution walked twelve call shapes with a single login, `cfo_100`, and asserted the
name was `"cfo_100"`. So the suite could never tell "carries the caller's name" from "carries
that one string", and `user_123`'s refusal could be stamped with the CFO's id.

One-at-a-time mutation cannot find this, because each single site still disagrees with the
others and something goes red. Only replacing every site with the same constant makes the code
self-consistent and wrong.

What catches it: when a test asserts a value, ask where the expected value came from. If it is
a literal that appears in the input as well, the test cannot distinguish the two. Vary the
input — here, three different logins — and assert against the **input**, not a constant. Then
mutate the whole family of sites together as well as one at a time.

## 11 · Check the mutation before you believe the survivor

Step 06's first sweep ran thirteen mutations and reported four survivors. Two of the four were
**my mistakes, not test gaps**:

- One cut the wrong lines out of `permissions.ts`, so the file no longer loaded. The run
  reported `74 passed (74)` — a *smaller total* than the real 126, because two whole files
  failed to import. A shrinking total is the tell, and "all passed" on a broken file reads
  exactly like a survivor.
- One claimed to move the may-you check after the arguments and moved it somewhere that
  changed nothing observable, because the argument that mattered is parsed inside the handler,
  further down. Redone properly, the test killed it at once.

So a survivor is a claim about two things: the test, **and** the mutation. Before believing it,
check that the mutation compiled, that the test total did not shrink, and that the mutated code
really does the wrong thing — run it and look at the output, not the diff.

Combined with [lesson 10](#10--mutating-one-guard-at-a-time-cannot-find-a-test-that-expects-a-constant),
the sweep now has three failure modes of its own: too narrow (one site at a time), too weak (a
mutation that changes nothing), and broken (a mutation that does not load).

## 12 · A sentinel that says `true` proves nothing

Step 04 marked "this check ran at start-up" with a boolean:

```ts
export const WIRING_CHECKED: boolean = ((): boolean => {
  assertPaired(registry, handlers);

  return true;
})();
```

Step 06 copied the idea for its role table, and a mutation found the hole: delete the call,
keep `return true`, and every test stays green. The sentinel says the check ran; all it really
proves is that somebody wrote `true`.

The fix is to make the sentinel carry a value that can only come from doing the work. The
checker now returns how many permissions it looked at, and the constant holds that number:

```ts
export const PERMISSIONS_CHECKED: number = checkPermissions(ROLES);
```

A test compares it with the table's real total, so deleting the call and leaving a plausible
number behind fails. It is not a proof — hardcoding today's correct answer still passes, and
only a child process could close that — but it moves the mistake from "delete a line" to
"delete a line, work out the right number, and keep it right as the table changes".

Where this applies: any flag that means "something happened". Prefer a count, a hash, or the
result itself over `true`.
