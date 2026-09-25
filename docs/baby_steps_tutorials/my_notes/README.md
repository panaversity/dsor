# Notes on building DSoR in baby steps

Working notes for Wania's run through the
[baby-steps tutorial](../readme.md), on the branch `wania/dev-DSoR-in-baby-steps`.

These are **not** part of the tutorial. The tutorial's own step folders are
`00_foundation` and the planned `NN_name` folders; the learner copies are `my_NN_name`.
This directory records what was built in those copies, and **why each decision was
taken**, so a choice can be revisited later without working it out again from the code.

Started 2026-09-25, covering work done from 2026-09-22 onward.

## What is here

| File | Holds |
| --- | --- |
| [decisions.md](decisions.md) | Every decision, numbered, with its reason, its cost, and the alternative that was rejected |
| [lessons.md](lessons.md) | The mistakes that repeated, and what catches each one |
| [step-01-one-invoice-in-memory.md](step-01-one-invoice-in-memory.md) | Money as text and a currency |
| [step-02-canonical-uris.md](step-02-canonical-uris.md) | One permanent address per record |
| [step-03-operations-and-contracts.md](step-03-operations-and-contracts.md) | Named operations, spec sheets, a registry |
| [step-04-result-and-error-envelopes.md](step-04-result-and-error-envelopes.md) | Codes and retry classes |

Step 00 came with the repository and was not built here. It is a tiny TypeScript project
with one pure function and two tests, and every later step begins as a copy of it.

## Where things stand

| | Tests | State |
| --- | --- | --- |
| `00_foundation` | 2 | came with the repository |
| `my_01_one_invoice_in_memory` | 13 | done |
| `my_02_canonical_uris` | 24 | done |
| `my_03_operations_and_contracts` | 53 | done |
| `my_04_result_and_error_envelopes` | 79 | done |

Each count includes everything inherited from the steps before it, because a step is a
copy of the step before plus one new idea.

Next is step 05, `who_is_calling`.

## How we work

Settled over steps 01 to 04. Each line is here because skipping it cost something.

1. **Read before writing.** The step's entry in the map, the specification sections it
   names, and every rule id in the registry. Step 04's central claim was wrong for a week
   because a schema was described from memory rather than read.
2. **Tests first, and watch them fail.** A test written after the code has never been
   observed to fail, so it has proved nothing. Where the code came first, the guarantee is
   recovered by breaking the code on purpose and watching the test go red.
3. **Break every guard on purpose.** Delete or weaken each check in turn and confirm some
   test goes red. A guard no test kills is decoration. This has found a real gap in every
   step it has been run on.
4. **Run it, quote it.** Every command output in a README was produced by running the
   command. Never written from memory, and re-run whenever the code or the counts move.
5. **Small commits, each green on its own.** Verified by checking each commit out into a
   clean directory and running it, not by assuming. One commit was rewritten for failing
   this.
6. **Say what is not met.** Every step README lists the rules it does *not* claim and why.
   A step that meets a rule partly says which part.
7. **Ask a hostile reviewer before calling it done.** Five narrow passes, one job each.
   One large agent stalled twice; narrow ones finish.
8. **Write the decision down here, when it is taken.** Not afterwards.

## Rules that constrain these notes

`pnpm guard` walks every markdown file in the repository, including this one. So a
`DSOR-` identifier written here must exist in
[`requirements.json`](../../../packages/spec/requirements.json), and every relative link
must resolve to a real file and a real heading. Run `pnpm guard` from the repository root
after editing anything here.

[`docs/status.md`](../../status.md) is the only authority on what the repository has
built. These notes describe learner copies, which are not part of that.
