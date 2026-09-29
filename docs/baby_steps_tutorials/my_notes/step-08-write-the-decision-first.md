# Step 08 · Write the decision first

Folder: [`my_08_write_the_decision_first`](../my_08_write_the_decision_first/README.md) · 219 tests
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

## What is claimed

`DSOR-EXE-02` for the ordering, not for "durably" or "controls evaluated". `DSOR-AUD-01` for the one
command's decisions, tested over records the **pipeline** wrote. `DSOR-AUD-04b` as detection against a
checkpoint. `DSOR-EXE-03b`'s decision branch — one complete side of a sentence joined by "or".
`DSOR-MOD-04` for the record, with all nineteen field names planted in the arguments at once.
`DSOR-COR-01a` between the record and the answer.
