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
| [step-07-the-pipeline-skeleton.md](step-07-the-pipeline-skeleton.md) | The order of the checks becomes a list |
| [step-08-write-the-decision-first.md](step-08-write-the-decision-first.md) | Every decision is written down before the answer, refusals included |
| [step-09-postgres-on-neon.md](step-09-postgres-on-neon.md) | The log lives in a database the application may not rewrite |
| [step-10-tenants.md](step-10-tenants.md) | Two companies in one program, resolved from the login and kept apart |
| [step-11-row-level-security.md](step-11-row-level-security.md) | The second lock: PostgreSQL hides every other company's rows |
| [step-12-cross-tenant-test-suite.md](step-12-cross-tenant-test-suite.md) | One generated test that calls every operation with another company's address |
| [step-13-bounded-queries.md](step-13-bounded-queries.md) | A list whose size is the server's: one page, a cursor that is an address, a door that measures |
| [step-14-classification-and-masking.md](step-14-classification-and-masking.md) | Every field labelled, the agent cleared, what is above it left out and listed, and every confidential read written down |
| [step-15-freshness-labels.md](step-15-freshness-labels.md) | Every answer says how fresh it is, and a saved copy may not call itself current |
| [step-16-the-control-plane-store.md](step-16-the-control-plane-store.md) | DSoR's own schema beside the business's, and the log moved into it |
| [step-17-vendors-and-payments.md](step-17-vendors-and-payments.md) | Vendors and payments, and every command says whether it can be undone |
| [step-18-delegations.md](step-18-delegations.md) | The permission slip: the agent acts only under one, cut down to what its signer holds now |
| [step-19-unattended-mode-and-the-role-source.md](step-19-unattended-mode-and-the-role-source.md) | The agent at night under a slip, the signer's authority asked of the company's directory |
| [step-20-idempotency-keys.md](step-20-idempotency-keys.md) | Every command carries a key, so a retry never pays twice |
| [step-21-optimistic-concurrency.md](step-21-optimistic-concurrency.md) | A command says which version it decided on, and a record that moved on is refused |
| [step-22-proposals-and-their-states.md](step-22-proposals-and-their-states.md) | Every command becomes a proposal whose state moves only forward |
| [step-23-three-ways-to-call.md](step-23-three-ways-to-call.md) | Execute, prepare for later, or a dry run that changes nothing |
| [step-24-limits-with-reservations.md](step-24-limits-with-reservations.md) | A daily limit, booked in one statement, so racing payments never spend past it |
| [step-25-revocation-and-the-emergency-brake.md](step-25-revocation-and-the-emergency-brake.md) | A brake on one agent or every agent, and a slip that can be torn up |

Step 00 came with the repository and was not built here. It is a tiny TypeScript project
with one pure function and two tests, and every later step begins as a copy of it.

## Where things stand

This section held a table of counts, and it stopped at step 09.
[`docs/status.md`](../../status.md) lists every `my_` build with its tests, and is kept true with
each step; each step's own note, listed above, says what was built and what its reviews found.

Step 08 turned out to be §21.11 only. §21.13, the intent record, is step 36's: it needs a proposal id,
an idempotency key and a connector, none of which exist yet
([decision 54](decisions.md#54--the-intent-record-is-step-36s-not-step-08s-2026-09-30)).

## Promises made to later steps

Things a later step must do, decided earlier. A closed question is easy to stop reading, so
they are listed here where the next session will see them.

| Step | What it owes | Decided in |
| --- | --- | --- |
| ~~06~~ | ~~`AUTHORIZATION_DENIED`~~ — paid, 2026-09-28 | step 05's README |
| ~~07~~ | ~~the ordered checklist~~ — paid, 2026-09-29 | step 06's README |
| ~~08~~ | ~~the audit log, with the §30 hash chain~~ — paid, 2026-09-30. `DSOR-AUD-01` and `DSOR-AUD-04b` are both claimed, 04b as detection against a checkpoint | [open question 1](open-questions.md) |
| ~~08~~ | ~~`DSOR-EXE-02`: §21.11~~ — paid, 2026-09-30 | step 07's README |
| ~~09~~ | ~~The log must survive a restart, the database must stamp the time, and the read-then-write that claims a sequence must become one atomic statement with a unique constraint on `(chain, sequence)`~~ — paid, 2026-10-04, proven by a real parallel `*.db.test.ts` | step 08's `audit.ts`, `// found live 2026-09-30` |
| ~~09~~ | ~~`DSOR-AUD-04a`: an application database user with no `UPDATE` and no `DELETE` on the log~~ — paid, 2026-10-04, and the program refuses to start if its account could rewrite the log (decision 75) | [decision 65](decisions.md), step 08's README |
| — | A query's success has no envelope, so the caller never learns the `request_id` of the record its read produced. Ten of twelve records in step 08's demo are reads. This is [open question 19](../../../research/open-questions.md), not a debt of step 19 | step 08's README, "The gap a query leaves" |
| 27 | `DSOR-EXE-02` says the decision record holds the **controls evaluated**. Nothing evaluates a control until then, so step 08's records have no `controls` array | step 08's README |
| 36 | `DSOR-EXE-03a` and the intent-record half of `DSOR-EXE-03b`: §21.13. It needs a proposal id, an idempotency key and a connector, so four of its six fields do not exist yet | [decision 54](decisions.md#54--the-intent-record-is-step-36s-not-step-08s-2026-09-30) |
| 36, 37 | A record says what was **decided**, never what happened. §21.15 `FINALIZE` — `COMMITTED`, `FAILED`, `OUTCOME_UNKNOWN` — is what makes the outcome evidence, and step 08 records a call as `ALLOW` even when it then fails | [decision 58](decisions.md) |
| ~~10~~ | ~~Resolve the company from the caller's `memberships`, which step 05 created and never reads, instead of comparing against one hard-coded value~~ — paid, 2026-10-05 | [decision 22](decisions.md) |
| ~~18~~ | ~~The delegation, so an agent can act *for* a person~~ — paid, 2026-10-11 | [decision 23](decisions.md) |
| ~~18, 19~~ | ~~A **role source**~~ — paid, 2026-10-11: step 19 asks the company's directory | step 06's README |
| ~~20~~ | ~~The idempotency claim, §21.7~~ — paid, 2026-10-11 | step 07's README |
| 29 | `REQUIRE_APPROVAL`, the third authorization outcome (`DSOR-AUT-02a`). Step 06 has only yes and no; the map puts approvals at step 29 | step 06's README |
| 27 | Controls in CEL, so more than one rule can apply to a request and the strictest wins (`DSOR-AUT-02b`, `02c`) | step 06's README |
| 30 | Segregation of duties (`DSOR-SOD-01a`). Step 06's break 3 shows the hole: one word in a table lets the person who approves a payment also create it | step 06's README |
| 42 | Copy and validate `security-context.schema.json`: the shape identity arrives in, `direct` mode, with the three modes as the lesson | [decision 32](decisions.md) |
| 42 | `DSOR-OPR-04a`. Step 07 built `makeDoor` so a second interface is *given* the list, but with one interface nothing proves two share it | step 07's README |
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
