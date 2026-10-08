# Step 23 · Three ways to call

**New in this step:** a command can be called in three modes, `execute`, `propose_only`, and
`validate_only`, and a `.propose` permission allows `propose_only` mode only (DSOR-OPR-05,
DSOR-OPR-06).

## In plain words

Until now a command ran one way: DSoR checks it, claims its key, makes its proposal, runs its code,
and answers. From this step, the request envelope can name a *mode*: the way the call runs. A
command with no mode runs in `execute` mode, as before.

| Mode | What it asks | What DSoR does | The answer |
| --- | --- | --- | --- |
| `execute` | "Do it, if the rules allow" | The whole checklist, as in step 22 | `COMMITTED`, with the data |
| `propose_only` | "Prepare it, and wait" | Lines ① to ⑥ of the checklist, the claim of the key, and the proposal. The proposal stops in READY. No code runs | `READY`, with the proposal |
| `validate_only` | "Would this be allowed?" | Lines ① to ⑥ of the checklist only. No claim, no proposal, no code | `VALIDATED`, with the decision `ALLOW` |

A *dry run* is a call in `validate_only` mode. The same call in `execute` mode is the *real
call*. In this tutorial, a dry run that a check refuses hears the same refusal as the real call
(decision 3). Every dry run's decision is recorded in the log, a yes or a no. A dry run changes
nothing that the command would change.

A proposal made in `propose_only` mode waits in READY until someone *releases* it: tells DSoR to
run it, with `proposal.execute`. Step 31 builds that command.

One more piece goes with `propose_only`. A permission is written with a colon, `payment:create`.
The command it allows is written with a dot, `payment.create`. A permission can also end in
`.propose`, as in `payment:create.propose`. Its holder may call `payment.create` in
`propose_only` mode only. The full permission covers its `.propose` form: whoever may create a
payment may also prepare one.

In the office picture, the new clerk can be asked three things: "draft this payment", "fill in
the request, leave it on my desk, and wait for my go", or "would you be allowed to draft this?".
The third question changes nothing in the company's records. The clerk still writes the question
and the answer in the logbook. The request on the desk is a proposal: an order-tracking page that
stops at "ready" and waits. And some jobs, such as ap_clerk, allow a person to prepare payments
and never to make one. When user_123 moves to such a job, the agent that works under user_123's
slip can only prepare too.

## Why it matters

Tuesday, 02:00. accounts-payable-fte plans the night's work. It wants to know if it may draft
PAY-901 for INV-1008, 31,400.00 USD. Before this step, the only way to ask was to do it. The draft
was written, the key was used, and a COMMITTED proposal recorded the attempt. No call could ask
without acting.

And user_123 wants the agent to prepare payments that only a person releases. Before this step, a
slip that listed `payment:create` let the agent make every draft by itself.

In step 19, the directory moved user_123 to ap_clerk, a job that could only read invoices. In a
real office, a clerk prepares payments for a supervisor to release. DSoR had no way to say
"prepare only", so this step gives ap_clerk `payment:create.propose`.

## The design, before any code

The learner made the decisions below on 2026-10-08, in two rounds of questions, each with a
recommendation. Claude Code decided the details, marked "(Claude Code)", and built the step while
the learner was away. Each decision is this tutorial's, with its downside.

The specification it relies on was read on 2026-10-08:

- [§7.3](../../../specs/dsor/01-model.md#73-invocation-modes): the table of the three modes,
  DSOR-OPR-05, and DSOR-OPR-06. After the rules, it says: "A principal that holds
  `<resource>:<action>.propose` but not `<resource>:<action>` can invoke the command in
  `propose_only` mode only."
- [§21](../../../specs/dsor/03-execution.md#21-command-pipeline): "A `validate_only` invocation
  skips steps 7 and 8 and takes no reservation in step 10." Line 12 says "Return here if" … "the
  mode is propose_only or validate_only". The concurrency check is line 14, after line 12.
- [§22](../../../specs/dsor/03-execution.md#22-idempotency): DSOR-IDM-01a, a key "in `execute` or
  `propose_only` mode".
- [§26.1](../../../specs/dsor/03-execution.md#261-one-model): `proposal.execute` may be called
  by "the requester, or a human holding the target permission".
- [§26.2](../../../specs/dsor/03-execution.md#262-lifecycle): READY, "in `propose_only` mode it
  waits for `proposal.execute`".
- [§15](../../../specs/dsor/02-security.md#15-authorization): the permission format, with the
  optional suffix `.propose`.
- `result-envelope.schema.json`: READY needs `proposal`, `payload_hash`, and `semantics`. VALIDATED
  needs `decision`. `proposal.schema.json`: a proposal's `mode` is `execute` or `propose_only`.

### The intent and the outcome

**Intent.** A caller can ask whether a command would be allowed, or prepare it for someone to
release. Neither one changes what the real call would change.

**Outcome.** What is true when this step is done:

1. The agent's dry run of a draft for INV-1008 answers `VALIDATED`, decision `ALLOW`. The
   database holds one new decision record, which says `validate_only`, and nothing else: no claim,
   no proposal, no draft.
2. The agent asks for the draft in `propose_only` mode. The answer says `READY` and names the
   proposal, which waits in READY, with two moves in the log. No draft is written yet.
3. The same key sent again in `propose_only` mode names the same proposal. The same key sent in
   `execute` mode is refused with `IDEMPOTENCY_CONFLICT`, and no draft is written.
4. The directory moves user_123 to ap_clerk, which holds `payment:create.propose`. The agent's
   call in `execute` mode is refused at line ⑤. Its call in `propose_only` mode answers READY,
   and writes no draft.
5. A dry run that a check refuses hears the refusal that the real call hears.
6. A call with no mode runs as in step 22.

**Not the outcome of this step:**

- `proposal.execute`. Nothing releases a proposal in READY yet (step 31).
- The code's own checks in a dry run or a prepared call, such as the version and "not issued"
  (decision 2).
- Reservations and holds, which a dry run must not take. A *reservation* sets aside part of a
  limit, such as 31,400.00 USD of the 200,000 USD daily limit. A *hold* locks a payment or an
  invoice while DSoR does not know if a payment went through, so that no other command can bind
  it. Neither is built yet. Step 24 builds the first reservation.

### What each rule says

| Rule | Claim | How we know |
| --- | --- | --- |
| DSOR-OPR-05 | **C1.** A command with no mode, or with mode `execute`, runs as in step 22 | Unit: both answer COMMITTED, through the same lines |
| DSOR-OPR-05 | **C2.** In `propose_only` mode the proposal waits in READY, the code does not run, and the answer says READY | Unit and database: the answer, the proposal and its two moves, the lines that run, and no draft |
| DSOR-OPR-05 | **C3.** In `validate_only` mode the answer says VALIDATED, with the decision ALLOW | Unit, and the schema |
| DSOR-OPR-06 | **C4.** A dry run makes no proposal, claims no key, and writes nothing that the command would write: only its decision record | Unit: the stores and the lines that run. Database: no claim, no proposal, no draft |
| §7.3, DSOR-EXE-02 | **C5.** A dry run's decision is still recorded, with its mode | Unit and database: one record, ALLOW, `validate_only` |
| (decision 3) | **C6.** A dry run that a check refuses hears the refusal the real call hears | Unit: refusals at line ⑤, at line ⑥, and by the check of the URIs, side by side with the real call |
| §7.3, DSOR-AUT-01b, DSOR-DEL-02 | **C7.** `payment:create.propose` allows `propose_only` mode only. `payment:create` covers it. For an agent, the slip and its signer must both cover it | Unit: a person, a slip that lists the `.propose` form, and the ap_clerk story |
| DSOR-IDM-01a | **C8.** A `propose_only` call must carry a key | Unit: refused at line ⑦, with no proposal |
| (decisions 4, 6, 7) | **C9.** A key keeps its mode. A dry run carries no key. A query carries no mode. A mode is one of the three | Unit. Database: the same key in two modes, one after the other, and at the same moment |
| DSOR-IDM-01c | **C10.** A replay of a `propose_only` call names the same READY proposal, and makes no second one | Unit and database |
| (decision 13) | **C11.** The database keeps each claim's mode and each proposal's, refuses `validate_only` in both, and gives an old claim `execute` | Database: hand-written SQL statements as `dsor_runtime`, and migration 016 on a claim made before it |
| DSOR-SCH-01 | **C12.** The READY and VALIDATED answers pass `result-envelope.schema.json`. A prepared proposal, as DSoR stores it, passes `proposal.schema.json` | Unit and database, through ajv |
| DSOR-TEN-02b, DSOR-SRC-02b | **C13.** Every operation is attacked with foreign URIs in each new mode too, and refused, and a prepared proposal keeps the request as line ⑥ checked it | Unit: step 12's cross-tenant suite, 51 attacks in each mode. Unit and database: what a prepared proposal keeps, field by field |

### Decisions the specification leaves to us

1. **No release yet.** `proposal.execute`, which runs every check again and runs only the stored
   request, belongs to step 31 (DSOR-APR-03a, DSOR-APR-10, DSOR-APR-13). A proposal made in
   `propose_only` mode waits in READY. *Downside:* nothing can release it, cancel it, or let it
   expire yet (open question 90 in [`research/open-questions.md`](../../../research/open-questions.md)).
2. **A dry run runs the checks of lines ① to ⑥, then line ⑪'s record.** The code at line ⑨ never
   runs, so nothing can be written. A `propose_only` call skips the code at line ⑨ too. Its code
   runs when someone releases it. *Downside:* the code's own checks are not seen. A dry run of a
   request decided on an old version says ALLOW, and a `propose_only` call for it waits in READY.
   When step 32 moves "not issued" out of the code, to line ⑨, a dry run can check it there. The
   version check stays with the work: §21 checks it at line 14, after a dry run returns. And line
   ③ still runs in a dry run: when the directory reports the signer gone, it suspends the signer's
   slips, as on any call (DSOR-IDN-07; open question 95).
3. **A dry run's "no" is the real call's error envelope.** It has the same code, message, and
   retry class. A "yes" is `{ outcome: "VALIDATED", decision: "ALLOW" }`. *Downside:* "the dry run
   says no" looks like "the call failed" (open question 94).
4. **The mode travels in the request envelope, as `mode`.** No mode means `execute`. A word that
   is not one of the three is refused at line ①. A claim keeps its mode beside the fingerprint, so
   one key sent in two modes is refused with `IDEMPOTENCY_CONFLICT`. *Downside:* a replay compares
   one more thing. And the mode is not in the payload hash, so a proposal's fingerprint says
   nothing about its mode (open question 93).
5. **The `.propose` permission is built.**
   - ap_clerk gains `payment:create.propose`, and a slip may list it.
   - A full permission covers its `.propose` form. That holds inside step 18's rule too: an agent
     may use only what its slip lists and its signer holds now. So when one side holds
     `payment:create` and the other only `payment:create.propose`, the agent gets
     `payment:create.propose`.
   - A `.propose` holder's dry run is refused, because §7.3 says "propose_only mode only".

   *Downside:* nothing releases what a clerk prepares until step 31, and a clerk cannot ask for a
   dry run (open question 92).
6. **A dry run carries no key.** A dry run that carries one is refused at line ①, with
   VALIDATION_FAILED. Since step 20, a query that carries a key is refused with the same code, at
   line ⑦. *Downside:* an agent that changes only the mode on one request must also drop its key.
7. **A query carries no mode, not even `execute`.** It is refused with VALIDATION_FAILED, right
   after DSoR finds the operation. *Downside:* a client that always sends `mode: "execute"` must
   leave it off for reads.
8. **Where a call stops (Claude Code).** The *stop* is the place where a call ends its checks and
   gives its answer early. §21 puts it at line ⑫, after the record. In this tutorial the code does
   its work at line ⑨, before line ⑫. So a dry run ends after line ⑥, and a `propose_only` call
   after line ⑧. Both then go to line ⑪, the record, and answer. Lines ① to ⑩ became one
   function, `decide`, so each mode returns its answer where it ends. *Downside:* line ⑫ is still a
   comment. The stop moves to its own place when the work moves after the *intent record*: the
   note "I am about to do X" that DSoR writes before the work (§21, line 13). Step 36 builds it.
9. **The two new answers (Claude Code).** READY carries what the schema asks for: the outcome,
   the proposal, the payload hash, the semantics, and the correlation. It carries no data, because
   the code did not run. VALIDATED carries the outcome, the decision, and the correlation, and
   nothing else. It has no payload hash, so nothing suggests that a dry run's yes holds for a later
   real call. *Downside:* a dry run gives the caller nothing to show later.
10. **Each command's record names its mode (Claude Code),** under this tutorial's own name,
    `invocation_mode`, because the audit record has no field for it. A query's record names none.
    A dry run's record says ALLOW and `ok`. A `propose_only` call's record says ALLOW when its
    proposal is waiting. *Downside:* a reader must look at the mode to tell a dry run from a real
    call.
11. **Which line refuses what (Claude Code).** Line ① refuses a word that is not a mode, and a dry
    run that carries a key, beside the envelope's other checks. A query that names a mode is
    refused as soon as DSoR knows the operation is a query: right after it finds the operation,
    and before line ⑤ reads the mode. Line ⑦ refuses a `propose_only` call with no key, where
    step 20 checks every key. *Downside:* the order decides which of two refusals a caller hears.
12. **A prepared claim keeps "ready" (Claude Code).** A `propose_only` claim keeps
    `{"ready": true, "proposal": …}` as its answer, and a replay gives back the same READY answer.
    *Downside:* a third shape of kept answer, which a replay checks: `ready` must be `true`, with a
    proposal.
13. **Migration 016 (Claude Code).** It adds `mode` to each claim, and fills every old claim with
    `execute`, the only mode before this step. Then it removes the column's default value, so
    every new claim must name its mode. A proposal may be `execute` or `propose_only`. Neither
    table takes `validate_only`. `dsor_runtime` can set a claim's mode when it adds the claim. It
    can never change it. *Downside:* an old claim's `execute` is true only because no other mode
    existed.
14. **A contract names the full permission (Claude Code).** Start-up refuses a contract whose
    permission is a `.propose` form. In `execute` mode, such a contract would let a holder of the
    `.propose` form run the command. *Downside:* one more start-up check.
15. **The refusal says what a `.propose` form allows (Claude Code).** A caller that holds only
    `payment:create.propose` hears: `"payment.create" needs payment:create, which the caller does
    not hold; payment:create.propose allows propose_only mode only`. *Downside:* a longer message.
    Two tests of earlier steps wrote the old message out in full.
16. **A replay checks that its answer fits the claim's mode (Claude Code, from the review).** A
    waiting proposal is answered only from a `propose_only` claim, and a value or a refusal only
    from an `execute` claim. Any other pair is a bug or a change by hand, and gives
    INTERNAL_ERROR. *Downside:* one more check of DSoR's own record, which only a fault can fail.

### The tests, by claim

| Claims | Where |
| --- | --- |
| C1 to C10, C12, C13 | [`test/modes.test.ts`](test/modes.test.ts) |
| C2, C4, C5, C9 to C13 | [`test/modes.db.test.ts`](test/modes.db.test.ts) |
| C7 | Also [`test/permissions.test.ts`](test/permissions.test.ts) and [`test/role-source.test.ts`](test/role-source.test.ts), whose messages changed |

### Breaks we will try, and what we expect

| Break | What we expect |
| --- | --- |
| B1. The dry run's stop is gone | The dry run carries no key, so line ⑦ refuses it. It still writes nothing |
| B2. The claim forgets its mode | One key, prepared and then sent to execute, hears READY. One key, executed and then sent to prepare, hears COMMITTED |
| B3. The `.propose` form stands in for the full one | The agent that works under the clerk's slip drafts a payment in `execute` mode |

The learner's predictions for these come in the understanding session: a talk-through of this
code with the learner, through the `understand-baby-step` skill.

### Left open, and not this step's idea

- `proposal.execute`, and who may release a prepared proposal (step 31; DSOR-APR-11).
- A proposal in READY that waits forever: no cancel, and no expiry (open question 90).
- The code's checks in a dry run and in a prepared call (step 32 for "not issued").
- Whether a `.propose` holder may ask for a dry run (open question 92).
- Whether a key is bound to its mode (open question 93), and the shape of a dry run's "no" (open
  question 94). The open questions are in [`research/open-questions.md`](../../../research/open-questions.md).
- Whether a dry run may suspend a gone signer's slips (open question 95).
- Where the two stops go when line ⑩ is built. Both stop before line ⑩, the controls and the
  limits. When steps 24, 27, 30, and 32 build them, the stops must come after them. If not, a dry
  run says ALLOW where the real call is refused, and a prepared proposal waits in READY where it
  should wait for an approval.
- Paying twice. A proposal in READY under one key, and a real call under another, can stand for
  the same payment, until one attempt at a time arrives (§25, step 32).
- A replay of a `propose_only` call answers READY from its claim, even after its proposal has
  moved on. Step 31, which moves it on, decides what such a replay says.

## Before you build: set up a database

As in step 22: a local PostgreSQL 17, the step's own database, `.env` written by a command that
prints nothing, and `pnpm migrate`. Migration 016 runs.

## What changed since step 22

| File | What changed |
| --- | --- |
| `migrations/016_modes.sql` | **New.** The claim's mode, and the proposal's two modes |
| `src/request.ts` | The envelope's `mode`, read once at line ①. A dry run's key is refused |
| `src/pipeline.ts` | Lines ① to ⑩ are one function, `decide`. A query's mode is refused. Line ⑤ checks in the call's mode. A dry run stops after line ⑥, a prepared call after line ⑧. The record names the mode. The flag `reachedCode` is now `allowed`, because these two calls never reach their code |
| `src/permissions.ts` | The `.propose` form: covered by its full permission, inside the slip-and-signer cut too, and enough in `propose_only` mode only. Start-up refuses a contract that names one |
| `src/claims.ts`, `src/postgres.ts` | A claim keeps its mode and refuses another. A `propose_only` claim keeps the waiting proposal and runs no work |
| `src/proposals.ts` | A proposal keeps its mode, and a prepared one stops at READY |
| `src/envelope.ts`, `src/log.ts` | The READY and VALIDATED answers, and the record's `invocation_mode` |
| `src/registry.ts` | The start-up check of the contracts' permissions |
| `roles.json`, `store.json` | ap_clerk may prepare a payment. The claim's new column |
| `src/main.ts` | A dry run, a prepared draft, the same key refused in `execute` mode, and the clerk who may still prepare |
| `test/modes.test.ts`, `test/modes.db.test.ts` | **New.** The claims C1 to C12 |
| `test/owner-claims.ts` | Plants a claim that keeps a waiting proposal, and runs migration 016 on a claim made before it |
| The other tests | The envelope's new field, the role table, records that name their mode, the claim's column and grant, and helpers that took "no data" to mean "a refusal" |
| `.env.example` | The same as step 22's. The learner copies it in: Claude Code may not read or write a `.env` file of any kind |

```bash
git diff --no-index ../mj_22_proposals_and_their_states/src src
git diff --no-index ../mj_22_proposals_and_their_states/test test
```

## Run it

```bash
pnpm install
pnpm migrate
pnpm start
```

From a real run on 2026-10-08, shortened. The agent asks first, with a dry run. Then it asks for
the draft in `propose_only` mode, and then sends the same key to execute:

```text
the agent's dry run: {
  outcome: 'VALIDATED',
  decision: 'ALLOW',
  correlation: { request_id: 'req_478300c9-…', agent_id: 'accounts-payable-fte' }
}
the agent prepares a draft: {
  outcome: 'READY',
  proposal: 'dsor://org_456/proposal/prop_6d971498-7ec4-4148-a40b-733745228a9b',
  payload_hash: 'sha256:f9e407e3c5a699ba22b4401cc8ee2dd8c54593d8ba612096956af2f725e5f1d0',
  semantics: 'compensatable',
  correlation: { request_id: 'req_699efbd3-…', agent_id: 'accounts-payable-fte' }
}
its proposal, READY: dsor://org_456/proposal/prop_6d971498-7ec4-4148-a40b-733745228a9b
  (new) → PROPOSED, by accounts-payable-fte: payment.create called
  PROPOSED → READY, by dsor: no control asks for an approval: controls are not built yet
the same key, to execute: IDEMPOTENCY_CONFLICT: the idempotency_key was used for "payment.create" in propose_only mode, and a key keeps its mode
```

In the night, the directory moves user_123 to ap_clerk:

```text
ap_clerk, the agent drafts: AUTHORIZATION_DENIED: "payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now; payment:create.propose allows propose_only mode only
ap_clerk, the agent reads: answered, INV-1008
ap_clerk, the agent prepares: READY
```

## Break it

Each break ran in a copy of this step outside the repository, on a local PostgreSQL 17 database
of its own, on 2026-10-08. The output is copied as it was printed. Each scenario ran first on the
step's code as it is ("built" in the output), then once with the break.

**B1. The dry run's stop is gone.** In the copy's `src/pipeline.ts`, `if (mode ===
"validate_only") {` became `if (false) {`. The agent's dry run, with no key:

```text
=== built
before: drafts for INV-1008: 0, claims: 0, proposals: 0
the agent's dry run hears: VALIDATED
after:  drafts for INV-1008: 0, claims: 0, proposals: 0
=== B1, the dry run's stop is gone
before: drafts for INV-1008: 1, claims: 2, proposals: 2
the agent's dry run hears: VALIDATION_FAILED: "payment.create" needs an idempotency_key in the request envelope
after:  drafts for INV-1008: 1, claims: 2, proposals: 2
```

The dry run went on to line ⑦, which asked for a key. A dry run carries none (decision 6), so it
was refused, and still wrote nothing. The missing stop failed closed.

B1 ran on the same database after the other scenarios, so its "before" counts hold their rows.

**B2. The claim forgets its mode.** In the copy's `src/postgres.ts`, the line that compares the
claim's mode was deleted:

```text
=== built
key 1, propose_only: READY
key 1 again, execute: IDEMPOTENCY_CONFLICT: the idempotency_key was used for "payment.create" in propose_only mode, and a key keeps its mode
key 2, execute: COMMITTED, PAY-901
key 2 again, propose_only: IDEMPOTENCY_CONFLICT: the idempotency_key was used for "payment.create" in execute mode, and a key keeps its mode
=== B2, the claim forgets its mode
key 1, propose_only: READY
key 1 again, execute: READY
key 2, execute: COMMITTED, PAY-902
key 2 again, propose_only: COMMITTED, PAY-902
```

A caller that asked to prepare heard that PAY-902 was made. A caller that asked to execute heard
READY, and nothing ran. Both answers are true of the first call, and wrong for this one
(decision 4).

**B3. The `.propose` form stands in for the full one.** In the copy's `src/permissions.ts`, the
permission wanted became the `.propose` form in every mode. user_123 is moved to ap_clerk, and the
agent asks for the draft in `execute` mode:

```text
=== built
ap_clerk, the agent drafts in execute mode: AUTHORIZATION_DENIED: "payment.create" needs payment:create, which user_123, who signed slip del_100, does not hold now; payment:create.propose allows propose_only mode only
drafts made: 0
=== B3, the .propose form stands in for the full one
ap_clerk, the agent drafts in execute mode: COMMITTED, PAY-903
drafts made: 1
```

One condition in the check is all that stands between "prepare only" and a written draft.

## Build it yourself with Claude Code

This is how the step was built.

| # | Move | What was done |
|---|---|---|
| 1 | Decide | Seven questions to the learner in two rounds, each with a recommendation. The learner took every recommendation |
| 2 | Red | `test/modes.test.ts` first |
| 3 | Green | The envelope's mode, the `.propose` form, the claim's mode, the prepared proposal's stop at READY, the two answers, and `decide` |
| 4 | The old tests | The envelope's new field, the role table, records that name their mode, the `.propose` hint in two messages, and helpers that took "no data" to mean "a refusal" |
| 5 | The database | Migration 016, the store map, `test/modes.db.test.ts`, and the owner's tools |
| 6 | The program | A dry run, a prepared draft, the same key refused in `execute` mode, and the clerk who may still prepare |
| 7 | Break it | B1 to B3 in a copy outside the repository, on a local PostgreSQL |
| 8 | Review | 44 small breaks, each tried alone against the tests, in a copy. A reviewer who had not seen the conversation attacked the rules and the code, and a second one read this README as a student would. All three are under "Think it through" |

To start it in a new session:

```text
Build step 23 in learner mode from the design in
docs/baby_steps_tutorials/mj_23_three_ways_to_call/README.md.
```

What each move broke, measured. These were not predictions:

| Move | What failed |
| --- | --- |
| Red | 43 of the 49 new unit tests failed: DSoR refused `mode` as a field of the envelope that it does not read. 6 passed before any new code. 2 expect a "yes" with no mode: a draft and a read. 4 expect a refusal that the old code already gave, or a field that is not there yet |
| Green, the type check | 13 places in 8 files took "no data" to mean "a refusal", which READY and VALIDATED are not. 6 places that build a claim or a proposal passed no mode |
| Green, the old unit tests | 14 tests in 5 files: the envelope's list of fields (8), the role table written out in full (1), records that now name their mode (3), and the `.propose` hint in two messages (2) |
| The database | 5 tests in 4 files: the grants written out in full (1), two hand-written claims with no mode (2), a record that names its mode (1), and the owner's tool for migration 015's guard (1) |
| The program | 1 test, which counts the program's calls: 4 more |
| The store map | 1 unit test, which wrote the claim's columns out in full. It was found late: see "Think it through" |

## Check yourself

Walk each call through the checklist, and stop at the first line that says no.

1. The agent sends `payment.create` for INV-1008 in `validate_only` mode, with no key. What does
   it hear, and what does the database hold after?
2. The same dry run, with an idempotency key. What does it hear?
3. The agent asks for the draft in `propose_only` mode, with a key. Then it sends the same request
   with the same key and no mode. What does each call hear? Is a draft written?
4. The directory moves user_123 to ap_clerk. The agent asks for the draft in `execute` mode, then
   in `propose_only` mode with a new key. What does each call hear?
5. The agent's dry run is for a draft decided on version 2, and INV-1008 is at version 1. What
   does the dry run hear, and what does the real call hear?

<details>
<summary>Answers</summary>

1. `VALIDATED`, decision `ALLOW`. The database holds one new decision record, which says
   `validate_only`. No claim, no proposal, no draft (DSOR-OPR-06).
2. `VALIDATION_FAILED` at line ①: a dry run claims nothing, so it carries no key. The key stays
   free for a real call (decision 6).
3. The first hears `READY` and names its proposal, which waits in READY. The second hears
   `IDEMPOTENCY_CONFLICT`: a key keeps its mode. No draft is written (decision 4).
4. `execute`: `AUTHORIZATION_DENIED` at line ⑤, which says that `payment:create.propose` allows
   `propose_only` mode only. `propose_only`: `READY` (decision 5).
5. The dry run hears `VALIDATED`: the version is checked by the code, which a dry run never runs.
   The real call hears `STALE_STATE` (decision 2). Even in §21's full checklist, a dry run never
   sees the version: line 14 checks it, after line 12 returns.

</details>

## Think it through

Claude Code ran its own sweep of 44 small breaks once the step was green. Then a reviewer who had
not seen the conversation attacked the rules and the code, with 16 breaks of its own. A second
reviewer read this README as a student would. Claude Code chose each fix.

**What the code review found, and what changed.** No guarantee broke against its attacks. Every
finding was a break that left every test green.

| # | Found | Fixed by |
| --- | --- | --- |
| M1 | Only `payment.create` was tried in the two new modes. In a copy where only `payment.create` heard the mode, a request to prepare the cancel of PAY-901 cancelled it, and every test passed | Each command in each mode. `payment.cancel`, prepared, answers READY with its own semantics, `atomic`, and changes nothing. `invoice.issue`, which has no code, is refused in every mode as the real call is |
| M2 | In `propose_only` mode, the check of the URIs is the only company check before a proposal is kept, and the cross-tenant suite sent every command in `execute` mode only | Step 12's cross-tenant suite runs in each new mode too: 51 attacks each, no findings. A database test of another company's invoice in `propose_only` mode: refused, with no claim and no proposal |
| M3 | Line ⑥ was not tried in `propose_only` mode. A copy that skipped it kept an amount of 999999.00 and no version in a READY proposal: the only request `proposal.execute` may ever run | Three bad requests in `propose_only` mode, each refused as the real call is, with its key left free |
| M4 | Nothing pinned what a prepared proposal keeps: its payload, its fingerprint, its URIs, and who asked | One test in each tier, field by field |
| L1, L2 | A replay of a waiting answer could name another company's proposal, or drop the first call's request id, and no database test saw it | Two database tests |
| L3 | The race of two modes always had the same winner: the call sent first | Both orders, and one call after the other |
| L4 | A replay did not check its answer against its claim's mode: a planted READY answered an `execute` call | Decision 16, with two planted claims |
| L5, L6 | The order of the two comparisons, and one message of line ⑤, were not pinned | A test each |
| L7 | "A dry run writes nothing" said too much. A dry run that learns its signer is gone suspends the signer's slips, as every call does (DSOR-IDN-07) | The words, a test that pins it, and open question 95 |

**What the README review found.** "Draft" named both a payment and a call. "Release",
"reservation", "hold", and "intent record" were not defined. The new clerk was told to "pay", when
this command only drafts, and "a clerk in training" was a new picture that did not fit. And
decision 2 promised that step 32 would bring the version check before the work. It does not: §21
checks the version at line 14, after a dry run returns. Each is fixed. A comment from step 21 named
step 33 for the intent record. It is step 36, and this step's copy says so.

**What the sweeps found.**

- **The first run:** 44 breaks, and 31 failed a test. The other 13, all on the database side, were
  "killed" by one unit test that failed with no break at all: `store.json` had changed, and only
  the database tests ran after it. The test was fixed, and the 13 ran again.
- **The second run:** 12 of the 13 failed a test. One survived: the claim store's own check of a
  waiting answer with no proposal. The checklist checks the same thing one line later, so the call
  still failed, and no test saw the store's check go. A test now tries the store alone, and the
  break fails it.
- **The reviewer's 16 breaks,** run again against the new tests: each failed the test written for
  it. So did a break of decision 16's own check.

**What the build taught.**

- **A missing stop failed closed (B1),** because decision 6 had taken the dry run's key away. One
  decision guarded another.
- **In `propose_only` mode, the checks before line ⑦ are the whole guard.** No code runs, so
  nothing reads through the company's lock until the release. The review's four highest findings
  all came from that one fact.
- **A key that forgets its mode answers the wrong question truthfully (B2).**
- **Run both tiers before a sweep, and read what killed each break.** A test that fails with no
  break turns every break into a false "kill".

**Left open on purpose:** the list under "Left open, and not this step's idea", above.

## The rules this step meets

| Rule | What it says | Where in the spec | Proved by |
| --- | --- | --- | --- |
| DSOR-OPR-05 | Every command supports the `execute`, `propose_only`, and `validate_only` invocation modes | [§7.3 Invocation modes](../../../specs/dsor/01-model.md#73-invocation-modes) | Unit tests in [`test/modes.test.ts`](test/modes.test.ts): the three modes and their answers. Database tests in [`test/modes.db.test.ts`](test/modes.db.test.ts) |
| DSOR-OPR-06 | A `validate_only` invocation creates no proposal, takes no reservation, places no hold, and causes no side effect | [§7.3 Invocation modes](../../../specs/dsor/01-model.md#73-invocation-modes) | Unit and database tests: no proposal, no claim, no draft, and one record. No reservation or hold is built yet, so that part holds only because there is none. When a later step builds them, each must skip a dry run |
| DSOR-IDM-01a | A state-changing command in `execute` or `propose_only` mode carries an idempotency key | [§22 Idempotency](../../../specs/dsor/03-execution.md#22-idempotency) | The `propose_only` clause: a `propose_only` call with no key is refused at line ⑦. The `execute` clause is step 20's |
| (§7.3, no id) | A holder of a `.propose` form, without the full permission, may call in `propose_only` mode only | [§7.3 Invocation modes](../../../specs/dsor/01-model.md#73-invocation-modes) | Unit tests: a person, a slip that lists the `.propose` form, and the agent of a signer who holds only it |

## Next

Step 24 · Limits with reservations. It adds a per-payment limit and a daily limit, and reserves
the amount in one database step, like booking the last hotel room. A dry run takes no reservation
(§21).
