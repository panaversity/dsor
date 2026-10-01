# Step 08 · Write the decision first

Folder: [`my_08_write_the_decision_first`](../my_08_write_the_decision_first/README.md) · 232 tests
Spec: [§21](../../../specs/dsor/03-execution.md#21-command-pipeline),
[§29](../../../specs/dsor/03-execution.md#29-audit-and-decision-evidence),
[§30](../../../specs/dsor/03-execution.md#30-audit-integrity-and-retention) ·
`DSOR-EXE-02`, `DSOR-AUD-01`, `DSOR-AUD-04b`, `DSOR-EXE-03b`, `DSOR-MOD-04`, `DSOR-COR-01a`
Decisions [51 to 65](decisions.md). Lessons [17 and 18](lessons.md).

## What it does

One new line in the checklist, at its real §21 number:

```ts
alsoAfterARefusal(11, "record the decision", "both", recordTheDecision),
```

Every decision is written down before the answer goes back, including every refusal. Each record
carries the hash of the record before it, so editing one leaves every hash after it disagreeing.

## The hard part was the walker, not the stage

The walk **returned** at the first refusal. A stage at §21.11 would therefore never have seen one, and
every denial would have gone unrecorded — which is precisely the failure `DSOR-EXE-02` exists to
prevent. §21's diagram is emphatic: **RECORD DECISION — always, including DENY**.

So a refusal is carried instead of returned. `Stage` gained a flag, `Context` gained the refusal, and
`assertPipeline` gained three rules about them.

## Two corrections to what I planned

**The intent record is step 36's** ([decision 54](decisions.md#54--the-intent-record-is-step-36s-not-step-08s-2026-09-30)).
I had announced two stages. `DSOR-EXE-03a` needs a proposal id, an idempotency key and a connector, so
four of its six fields do not exist. Building it would have been a stub with a rule id on it.

**The request id had to be repaired first** ([decision 55](decisions.md)). `correlation.request_id` is
required by the schema, and the id was minted lazily inside whichever envelope was built first — so it
named an answer rather than a request. A record minting its own would have carried a different id from
the answer it was about.

## Built in seven pieces

| Piece | Tests | What it added |
| --- | --- | --- |
| 1 | 181 | the record, the chain and the clock, with nothing calling them |
| 2a | 184 | one request id per request |
| 2b | 197 | the stage, the flag, and the carried refusal |
| 3a | 198 | the step runs by itself again |
| 3b | 207 | six broken guarantees in `audit.ts` |
| 3c | 219 | eight more, and every mis-titled test |
| 4 | 219 | the README and these notes |
| 5 | 223 | a deep pass: fuzzing, then systematic mutation |
| 6 | 229 | what nine parallel reviews found, one per step |

## What the review found

`pnpm check` was green at 198. Every guard had been mutated. Four hostile passes found **fourteen
broken guarantees**. The three that mattered most:

| Finding | Why |
| --- | --- |
| **Nothing tested "never from the arguments."** The stage's comment called itself "`DSOR-MOD-03` in one sentence"; a reviewer made it read `context.args["subject"]` and all 198 tests passed | Every test used a well-behaved caller — critical rule 2. The forged record was schema-valid and its chain verified, because the forgery is *inside* the hash |
| **Deleting records off the end was undetectable.** Drop the record holding a denial: `true`. Drop two: `true`. Empty log: `true` | Chaining is evidence of an *edit*, never of a *deletion*. [Decision 60](decisions.md) adds the checkpoint §30 names |
| **`at: null` was a wildcard and the flag rule was positional** | Both were lists `assertPipeline` accepted. A flagged stage after the recording carried out a **denied** command, with `DENY` in the log beside the invoice |

Eleven test titles were wrong ([decision 64](decisions.md)), and a title is how coverage is counted.
Six chain tests were claiming `DSOR-AUD-01` — which a constant hash satisfies word for word — while the
README was simultaneously *disclaiming* `DSOR-AUD-04b`, the rule they actually prove.

## The break worth keeping

Break 1 gives the recording stage the flag off. Nothing about the program's output changes, every test
about an answer still passes, and denials silently stop being written down:

```text
 Test Files  7 failed | 9 passed (16)
      Tests  119 passed (119)
```

**119 of 219 collected, and nothing failed.** The program refuses to start. Third step running where
this shape has appeared, and I still had to be careful: the tell is the total, never the failure count.

## Limits written down

| Here | Becomes |
| --- | --- |
| the log is an array in one process | step 09: a restart loses everything today |
| `forgetTheLog()` erases the log, the flood counter and the head | step 09's database user has no `DELETE`. `DSOR-AUD-04a` is not claimed |
| `setClock` can backdate every record, and nothing stops a production path calling it | step 09, where the database stamps the row |
| a record says what was **decided**; a call that fails while executing is on the record as `ALLOW` | §21.15 `FINALIZE`, steps 36–37 |
| no `controls` array, because nothing evaluates a control | step 27 |
| a query's success has no envelope, so its `request_id` never reaches the caller | step 19 |
| the sequence is claimed by a read-then-write, safe only because nothing suspends | step 09: one atomic statement, a unique constraint, a real parallel test |
| `applies` in positive form, and the walker's two `continue`s, are equivalent mutants | said in the code, not here only |
| five of the door's six narrowing clauses are unreachable, and kept because the types need them | a belt for the day §21.11's completeness check moves |
| `verifyChain` cannot catch a chain recomputed from the beginning **together with its checkpoint** | a checkpoint the application cannot reach — step 09's database, step 39's hardening |

## The deep pass, after it was already done

Two things the hand-picked mutations could not find.

**A fuzz harness**: 20,412 calls, every combination of 28 hostile logins, 27 hostile operation ids and
28 hostile argument objects, checking eleven invariants after each one. Two failures, the same shape —
an error envelope carrying the caller's own text at full length: 200,026 characters from an invoice id
and 100,036 from a login name. Step 08 had already capped the *operation* id, which is exactly the
trap: four sites put caller text in a message, and capping them one at a time is how you miss the
fifth. The cap moved to `refusal()`, the one function every error envelope is built by, and the cap in
`nameOf` came out — two caps with two different wordings is
[lesson 17](lessons.md#17--a-guard-written-twice-can-be-half-broken).

**The receipt.** The probe above also showed something I had written off as unfixable: a door built
with a **no-op** `record the decision` passed every check `assertPipeline` can make — right name,
right place, right flag, applies to both kinds — and then **issued INV-1009, answered `COMMITTED`, and
wrote nothing**. A side effect with no evidence, which is the worst shape `DSOR-EXE-02` has. I had
called it a limit of list checking and pinned it with a test.

It is a limit of *list* checking. It is not a limit of the pipeline. A list cannot see what a function
does; a **receipt** can prove it did something. `recordTheDecision` now leaves the record's id in the
context, and the door refuses to execute without one — so the guarantee no longer rests on the stage
being the right stage, it rests on a record existing. The invoice stays `draft` and the caller is told
`invoice.issue finished the pipeline without a record of the decision`.

Two mutations were needed to make that honest. Removing the receipt fails 36 tests. Replacing it with
the literal `"pretend"` passed all 222 — the door was checking that *something* was there, not that the
something was real — so a stage placed after §21.11 now reads the receipt and a test asserts it is the
id of the record in the log.

**A systematic mutation sweep**: 190 mutants generated mechanically — every `===`, `!==`, `&&`, `||`,
`<`, `>`, `??`, `return true/false` and `+= 1` in the four source files, flipped one at a time. 25
survived, and reading them was the point:

| Survivors | Verdict |
| --- | --- |
| ~19 `?? -> \|\|` | equivalent. `a ?? b` and `a \|\| b` differ only when `a` is falsy-but-not-nullish, and no value in those positions can be `""` or `0` |
| 1 `+= 1 -> += 0` | on a loop over `NOT_YET_IMPLEMENTED`, which is empty, so the line never runs |
| 4 narrowing clauses in the door's guard, and 1 `&&` in the handler lookup | unreachable. They stay because TypeScript needs the narrowing before the handler call, and the comment says so |
| 3 in `envelopes.ts` | two equivalent, one a load-time guard that needs a broken schema file to reach |

Reading the survivors was the finding. Moving the completeness check into `recordTheDecision` during
the review had left the door's old guard with nothing to catch, and I had not noticed. Measured one
no-op stage at a time: `authenticate` and `resolve the operation` are caught by `authorize`,
`validate the input` by §21.11's own check. The clauses stay because TypeScript needs them narrowed
before the handler call — and the **sixth** clause, the receipt, is the one that earns its place.

The sweep also found duplication I had just written: a ternary chain picking the missing field's name
*and* the same conditions again for the narrowing. Flipping either copy failed nothing. One `if` now,
with the name worked out inside it — [lesson 17](lessons.md#17--a-guard-written-twice-can-be-half-broken)
in code three hours old.

And a comment that overstated itself: `pipeline.test.ts` claimed a no-op recorder was "caught in
decision-first.test.ts by looking at the log". It was not — those tests walk the *real* pipeline. That
comment is corrected, and the test that pinned the limit is now a test of the guarantee.

## What is claimed

`DSOR-EXE-02` for the ordering, not for "durably" or "controls evaluated". `DSOR-AUD-01` for the one
command's decisions, tested over records the **pipeline** wrote. `DSOR-AUD-04b` as detection against a
checkpoint. `DSOR-EXE-03b`'s decision branch — one complete side of a sentence joined by "or".
`DSOR-MOD-04` for the record, with all nineteen field names planted in the arguments at once.
`DSOR-COR-01a` between the record and the answer.

## What nine parallel reviews found, one per step

Nine agents, one per built step, each in its own copy: standalone run, `pnpm start`, a full systematic
mutation sweep with every survivor triaged, a README honesty audit re-running every pasted output, and
a test-title-versus-requirement-sentence check. **809 mutants across the nine steps.**

Five things landed on step 08.

**My README had gone stale, and that is the worst of it.** Six numbers were from before the previous
two commits: three break outputs, the "tests collected before" figure, the changed-file count, and a
"two mutations survive" line that a real sweep puts at 36. I had bumped the test total without
re-running the things that quote it. The rule I keep quoting at myself — *report what it printed* — is
the one I broke.

**Two misquoted requirement sentences.** `DSOR-COR-01a` was paraphrased as "the correlation
identifiers" in both the README and a code comment — and that comment's whole purpose was correcting
*other* wrong requirement ids. The real sentence names all seven.

**Three real gaps, each proven by construction, each now closed.** `canonical` sorts keys at every
depth and only the top level was tested, so a record with reordered `identity` keys verified with the
recursive half of the sort deleted. `lastHashOf`'s empty-log branch had no test, so a fresh log checked
against its own fresh head would have been reported as broken. And the door's `principal_id` on the
receipt refusal was unread — a branch the receipt had only just made reachable.

**`src/main.ts` had no tests. In any step.** This was the systemic finding, nine of the 33 gaps across
the tutorial: the program a learner runs and whose output the README pastes as proof is imported by no
test, so flipping one `===` inside it left every test green while `pnpm start` printed the opposite of
what the README promised, or crashed. Step 08 now has `test/main.test.ts`, which runs the real program
as a subprocess and checks what it prints, normalising only the hash column — which moves on every run,
because the time a decision was made is part of what is hashed.

That test paid for itself immediately. Break 1 used to print `119 passed (119)` with nothing failing;
it now shows five failures, all in `main.test.ts`, because that is the only file that runs the program
rather than importing it. And writing it found that `main.ts`'s own comment claimed the checkpoint
catches a dropped record without the demo ever showing it — so the demo now shows it:

```text
10 records, chain verifies against the head: true
drop the last record and the chain alone still says: true — but against the head: false
```
