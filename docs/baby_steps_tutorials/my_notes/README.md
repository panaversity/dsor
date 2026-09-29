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
| [open-questions.md](open-questions.md) | Found by reading ahead; needs settling before the step it affects |
| [arc-audit.md](arc-audit.md) | What three independent readers found across all six steps at once, and what each method can and cannot catch |
| [step-01-one-invoice-in-memory.md](step-01-one-invoice-in-memory.md) | Money as text and a currency |
| [step-02-canonical-uris.md](step-02-canonical-uris.md) | One permanent address per record |
| [step-03-operations-and-contracts.md](step-03-operations-and-contracts.md) | Named operations, spec sheets, a registry |
| [step-04-result-and-error-envelopes.md](step-04-result-and-error-envelopes.md) | Codes and retry classes |
| [step-05-who-is-calling.md](step-05-who-is-calling.md) | A caller, and a refusal when there is none |
| [step-06-permissions-deny-by-default.md](step-06-permissions-deny-by-default.md) | Roles, and anything ungranted refused |

Step 00 came with the repository and was not built here. It is a tiny TypeScript project
with one pure function and two tests, and every later step begins as a copy of it.

## Where things stand

| | Tests | State |
| --- | --- | --- |
| `00_foundation` | 2 | came with the repository |
| `my_01_one_invoice_in_memory` | 15 | done |
| `my_02_canonical_uris` | 30 | done |
| `my_03_operations_and_contracts` | 65 | done |
| `my_04_result_and_error_envelopes` | 95 | done |
| `my_05_who_is_calling` | 124 | done |
| `my_06_permissions_deny_by_default` | 146 | done, built a piece at a time |

Each count includes everything inherited from the steps before it, because a step is a
copy of the step before plus one new idea.

Next is step 07, `the_pipeline_skeleton`: the three questions step 06 left as the shape of one
function become a written checklist that later steps add lines to and never reorder.

## Promises made to later steps

Things a later step must do, decided earlier. A closed question is easy to stop reading, so
they are listed here where the next session will see them.

| Step | What it owes | Decided in |
| --- | --- | --- |
| ~~06~~ | ~~`AUTHORIZATION_DENIED`~~ — paid, 2026-09-28 | step 05's README |
| 08 | The audit log. `DSOR-AUD-01` cannot be claimed there as the map describes it — its schema requires the §30 hash chain, which the map does not schedule until step 39 | [open question 1](open-questions.md) |
| 10 | Resolve the company from the caller's `memberships`, which step 05 created and never reads, instead of comparing against one hard-coded value | [decision 22](decisions.md) |
| 27 | Controls in CEL, so more than one rule can apply to a request and the strictest wins (`DSOR-AUT-02b`, `02c`) | step 06's README |
| 18 | The delegation, so an agent can act *for* a person — the running example's normal case, which no step before it can build | [decision 23](decisions.md) |
| 18, 19 | A **role source**. Step 06's roles are in the source code, so `DSOR-IDN-04a` is not met | step 06's README |
| 30 | Segregation of duties (`DSOR-SOD-01a`). Step 06's break 3 shows the hole: one word in a table lets the person who approves a payment also create it | step 06's README |
| 22 | `REQUIRE_APPROVAL`, the third authorization outcome (`DSOR-AUT-02a`). Step 06 has only yes and no | step 06's README |
| 42 | Copy and validate `security-context.schema.json`: the shape identity arrives in, `direct` mode, with the three modes as the lesson | [decision 32](decisions.md) |
| 44 | `DSOR-IDN-02a` — an agent authenticating with its own credentials. Step 05 does not meet it, whatever an earlier version of its README said | [decision 27](decisions.md) |

## How we work, in one more line than before

Three methods were in use through step 06, and an audit of all six steps at once added a fourth.
None of them finds what another finds — the table at the end of [arc-audit.md](arc-audit.md) says
which is blind to what. The short version: tests find what you thought of, mutation finds guards no
test protects, a hostile reviewer finds real bugs in one step's new code, and only reading the
whole arc finds a stale number, a broken promise, or a safety net that never worked.

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

`pnpm guard` walks every markdown file in the repository, including this one, and it checks
that every relative link resolves to a real file and a real heading. Run it from the repository
root after editing anything here.

**It checks the rule ids in these notes and in every step, as of 2026-09-29** — including ids
written in backticks, which is how the tutorial writes all of them. It did not until that date:
it stripped inline code spans first, so of 171 ids across six steps it had seen none, and it let
`DSOR-SOD-01` sit in four files while staying green. The check was extended, and proven by probe
three ways: a bogus id in backticks now fails, a bogus id in plain text still fails, and a
no-longer-used exemption fails too. See [decision 42](decisions.md).

**Two ids in this directory are deliberately not real**: `DSOR-FAKE-99`, the probe that proved
the gap, and `DSOR-SOD-01`, quoted as the example of an id that does not exist. Prose about a bad
identifier has to be able to name it, so both are listed in the guard's own `ILLUSTRATIVE` map
with the reason they are there — and the guard fails if either stops being used, so the exemption
cannot outlive its purpose.

[`docs/status.md`](../../status.md) is the only authority on what the repository has
built. These notes describe learner copies, which are not part of that.
